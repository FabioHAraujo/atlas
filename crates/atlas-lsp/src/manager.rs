//! Owns every language-server instance: one per (server, root), shared by all open documents
//! of that root. Lazy start on first open, refcount, idle shutdown, crash restart with backoff.
//!
//! No polling: every transition is driven by a document command, a server event, or a single
//! armed timer (idle shutdown / restart backoff).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow, bail};
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::caps;
use crate::install::{self, Installer, Launch};
use crate::registry::{self, Server};
use crate::rpc::{Peer, RpcError};
use crate::server::{self, Event, Live, Shared};
use crate::text;

/// What the host forwards to its clients.
#[derive(Debug)]
pub enum Push {
    Diagnostics {
        path: String,
        version: Option<i64>,
        diagnostics: Value,
    },
    /// Full server list, sent whenever any state/progress/message changes.
    Status(Vec<ServerStatus>),
    ApplyEdit {
        id: String,
        edit: Value,
    },
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ServerStatus {
    pub name: String,
    pub root: String,
    pub language: String,
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Downloading,
    Starting,
    Ready,
    Crashed,
    Missing,
}

/// Tunables; tests shrink them.
#[derive(Debug, Clone)]
pub struct Config {
    pub idle_shutdown: Duration,
    pub init_timeout: Duration,
    /// Restarts allowed inside `restart_window` before the server is left `crashed`.
    pub max_restarts: usize,
    pub restart_window: Duration,
    pub restart_backoff: Duration,
    /// Per-request timeout; a hung server must not hold a client call forever.
    pub request_timeout: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            idle_shutdown: Duration::from_secs(300),
            init_timeout: Duration::from_secs(120),
            max_restarts: 3,
            restart_window: Duration::from_secs(60),
            restart_backoff: Duration::from_millis(500),
            request_timeout: Duration::from_secs(60),
        }
    }
}

struct Doc {
    inst: Arc<Inst>,
    language: String,
    version: i64,
    text: String,
}

/// How the server wants document changes.
#[derive(Debug, Clone, Copy, PartialEq)]
enum DocSync {
    None,
    Full,
    Incremental,
}

fn sync_kind(capabilities: &Value) -> DocSync {
    let ts = &capabilities["textDocumentSync"];
    let kind = ts
        .as_i64()
        .or_else(|| ts.get("change").and_then(Value::as_i64));
    match kind {
        Some(1) => DocSync::Full,
        Some(2) => DocSync::Incremental,
        Some(_) => DocSync::None,
        // Absent: servers that send nothing expect full text.
        None => DocSync::Full,
    }
}

fn wants_save_text(capabilities: &Value) -> bool {
    capabilities["textDocumentSync"]["save"]["includeText"] == true
}

enum Phase {
    Downloading,
    Starting,
    Ready(Arc<Live>),
    Crashed(String),
    Missing(String),
}

struct InstState {
    phase: Phase,
    /// Open documents (paths) using this instance.
    docs: Vec<String>,
    restarts: VecDeque<Instant>,
    idle_gen: u64,
}

pub struct Inst {
    server: &'static Server,
    root: String,
    language: String,
    gen_id: u64,
    st: Mutex<InstState>,
    shared: Arc<Shared>,
    /// Bumped on every phase change; `open` waits on it.
    phase_changed: tokio::sync::watch::Sender<u64>,
}

impl Inst {
    fn status(&self) -> ServerStatus {
        let st = self.st.lock();
        let (state, message) = match &st.phase {
            Phase::Downloading => (State::Downloading, None),
            Phase::Starting => (State::Starting, None),
            Phase::Ready(_) => (State::Ready, self.shared.message.lock().clone()),
            Phase::Crashed(m) => (State::Crashed, Some(m.clone())),
            Phase::Missing(m) => (State::Missing, Some(m.clone())),
        };
        let progress = match &st.phase {
            Phase::Downloading | Phase::Starting | Phase::Ready(_) => self.shared.progress_text(),
            _ => None,
        };
        ServerStatus {
            name: self.server.name.into(),
            root: self.root.clone(),
            language: self.language.clone(),
            state,
            progress,
            message,
        }
    }

    fn live(&self) -> Option<Arc<Live>> {
        match &self.st.lock().phase {
            Phase::Ready(l) => Some(l.clone()),
            _ => None,
        }
    }

    fn set_phase(&self, p: Phase) {
        self.st.lock().phase = p;
        self.phase_changed.send_modify(|n| *n += 1);
    }
}

/// Resolves a server to a launch command. Production: [`Installer`]; tests: a fixed binary.
pub trait Resolver: Send + Sync + 'static {
    fn resolve<'a>(
        &'a self,
        server: &'static Server,
        progress: &'a dyn install::Progress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Launch>> + Send + 'a>>;
}

pub struct DefaultResolver {
    pub base: PathBuf,
    pub installer: Installer,
}

impl Resolver for DefaultResolver {
    fn resolve<'a>(
        &'a self,
        server: &'static Server,
        progress: &'a dyn install::Progress,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Launch>> + Send + 'a>> {
        Box::pin(self.installer.resolve(&self.base, server, progress))
    }
}

pub struct Manager {
    inner: Arc<Inner>,
}

struct Inner {
    cfg: Config,
    base: PathBuf,
    resolver: Arc<dyn Resolver>,
    push: mpsc::Sender<Push>,
    events: mpsc::Sender<(u64, Event)>,
    insts: Mutex<HashMap<(String, String), Arc<Inst>>>,
    docs: Mutex<HashMap<String, Doc>>,
    next_gen: AtomicU64,
    /// Request ids chosen by clients (`rid`) → (peer, server request id), for `lsp_cancel`.
    cancels: Mutex<HashMap<String, (Peer, i64)>>,
    edit_acks: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    /// Test hook: launch command overrides per server name.
    closed: std::sync::atomic::AtomicBool,
}

pub struct OpenReply {
    pub server: Option<&'static str>,
    pub status: &'static str,
    pub capabilities: Value,
}

impl Manager {
    /// `push` receives everything for the clients; it is bounded, so a stalled client costs
    /// dropped diagnostics rather than memory.
    pub fn new(base: &Path, cfg: Config, push: mpsc::Sender<Push>) -> Manager {
        let resolver = Arc::new(DefaultResolver {
            base: base.to_path_buf(),
            installer: Installer::default(),
        });
        Self::with_resolver(base, cfg, push, resolver)
    }

    pub fn with_resolver(
        base: &Path,
        cfg: Config,
        push: mpsc::Sender<Push>,
        resolver: Arc<dyn Resolver>,
    ) -> Manager {
        let (events, rx) = mpsc::channel(1024);
        let inner = Arc::new(Inner {
            cfg,
            base: base.to_path_buf(),
            resolver,
            push,
            events,
            insts: Mutex::default(),
            docs: Mutex::default(),
            next_gen: AtomicU64::new(1),
            cancels: Mutex::default(),
            edit_acks: Mutex::default(),
            closed: Default::default(),
        });
        tokio::spawn(event_loop(Arc::downgrade(&inner), rx));
        Manager { inner }
    }

    pub fn status(&self) -> Vec<ServerStatus> {
        self.inner.statuses()
    }

    /// Open (or re-open after a client reconnect) a document. Returns once the server is
    /// resolved and started or known to be unavailable; a download/start in progress by
    /// another document is awaited, never duplicated.
    pub async fn open(
        &self,
        path: &str,
        language_id: &str,
        text: String,
        version: i64,
        fallback_root: Option<&Path>,
    ) -> OpenReply {
        let inner = &self.inner;
        let Some(server) = registry::for_language(language_id) else {
            return OpenReply {
                server: None,
                status: "disabled",
                capabilities: Value::Null,
            };
        };
        let root = registry::find_root(server, Path::new(path), fallback_root)
            .to_string_lossy()
            .into_owned();
        let key = (server.name.to_string(), root.clone());
        // Re-open of an already tracked path: close the old attachment first.
        if inner.docs.lock().contains_key(path) {
            self.close_inner(path, false).await;
        }
        let (inst, fresh) = {
            let mut insts = inner.insts.lock();
            match insts.get(&key) {
                Some(i) => (i.clone(), false),
                None => {
                    let gen_id = inner.next_gen.fetch_add(1, Ordering::Relaxed);
                    let shared = Arc::new(Shared {
                        name: server.name,
                        root: root.clone(),
                        progress: Mutex::default(),
                        message: Mutex::default(),
                        events: inner.events.clone(),
                        gen_id,
                        next_edit: AtomicU64::new(1),
                    });
                    let inst = Arc::new(Inst {
                        server,
                        root: root.clone(),
                        language: language_id.to_string(),
                        gen_id,
                        st: Mutex::new(InstState {
                            phase: Phase::Downloading,
                            docs: vec![],
                            restarts: VecDeque::new(),
                            idle_gen: 0,
                        }),
                        shared,
                        phase_changed: tokio::sync::watch::channel(0).0,
                    });
                    insts.insert(key.clone(), inst.clone());
                    (inst, true)
                }
            }
        };
        {
            let mut st = inst.st.lock();
            st.docs.push(path.to_string());
            st.idle_gen += 1; // cancels a pending idle shutdown
        }
        inner.docs.lock().insert(
            path.to_string(),
            Doc {
                inst: inst.clone(),
                language: language_id.to_string(),
                version,
                text: text.clone(),
            },
        );
        if fresh {
            inner.notify_status();
            let me = inner.clone();
            let i = inst.clone();
            tokio::spawn(async move { me.bring_up(i).await });
        }
        // Wait for the instance to settle (ready or unavailable). The guard never lives
        // across an await: the phase is read into a plain enum first.
        let mut rx = inst.phase_changed.subscribe();
        loop {
            enum Settled {
                Ready(Arc<Live>),
                Missing,
                Crashed,
                Pending,
            }
            let settled = match &inst.st.lock().phase {
                Phase::Ready(live) => Settled::Ready(live.clone()),
                Phase::Missing(_) => Settled::Missing,
                Phase::Crashed(_) => Settled::Crashed,
                Phase::Downloading | Phase::Starting => Settled::Pending,
            };
            match settled {
                Settled::Ready(live) => {
                    // `didOpen` goes out once per connection: bring-up replays documents
                    // registered before ready; this covers a doc opened on a ready server.
                    inner.did_open_if_needed(&inst, path, &live).await;
                    return OpenReply {
                        server: Some(server.name),
                        status: "ready",
                        capabilities: live.capabilities.clone(),
                    };
                }
                Settled::Missing => {
                    return OpenReply {
                        server: None,
                        status: "missing",
                        capabilities: Value::Null,
                    };
                }
                Settled::Crashed => {
                    return OpenReply {
                        server: Some(server.name),
                        status: "crashed",
                        capabilities: Value::Null,
                    };
                }
                Settled::Pending => {}
            }
            if rx.changed().await.is_err() {
                return OpenReply {
                    server: Some(server.name),
                    status: "crashed",
                    capabilities: Value::Null,
                };
            }
        }
    }

    pub async fn change(&self, path: &str, version: i64, changes: Vec<Value>) -> Result<()> {
        let inner = &self.inner;
        let (inst, params, full_text) = {
            let mut docs = inner.docs.lock();
            let doc = docs
                .get_mut(path)
                .ok_or_else(|| anyhow!("document not open: {path}"))?;
            for c in &changes {
                if !text::apply(&mut doc.text, c) {
                    bail!("bad content change");
                }
            }
            doc.version = version;
            (doc.inst.clone(), changes, doc.text.clone())
        };
        let Some(live) = inst.live() else {
            return Ok(()); // the shadow copy is current; didOpen replays it when ready
        };
        let uri = caps::uri_from_path(path);
        let content_changes = match sync_kind(&live.capabilities) {
            DocSync::None => return Ok(()),
            DocSync::Incremental => params,
            DocSync::Full => vec![json!({"text": full_text})],
        };
        live.peer
            .notify(
                "textDocument/didChange",
                json!({"textDocument": {"uri": uri, "version": version}, "contentChanges": content_changes}),
            )
            .await;
        Ok(())
    }

    pub async fn save(&self, path: &str, text: Option<String>) -> Result<()> {
        let inst = {
            let mut docs = self.inner.docs.lock();
            let doc = docs
                .get_mut(path)
                .ok_or_else(|| anyhow!("document not open: {path}"))?;
            if let Some(t) = &text {
                doc.text = t.clone();
            }
            doc.inst.clone()
        };
        let Some(live) = inst.live() else {
            return Ok(());
        };
        let mut params = json!({"textDocument": {"uri": caps::uri_from_path(path)}});
        if wants_save_text(&live.capabilities) {
            params["text"] = json!(
                self.inner
                    .docs
                    .lock()
                    .get(path)
                    .map(|d| d.text.clone())
                    .unwrap_or_default()
            );
        }
        live.peer.notify("textDocument/didSave", params).await;
        Ok(())
    }

    pub async fn close(&self, path: &str) {
        self.close_inner(path, true).await;
    }

    async fn close_inner(&self, path: &str, arm_idle: bool) {
        let inner = &self.inner;
        let Some(doc) = inner.docs.lock().remove(path) else {
            return;
        };
        let inst = doc.inst;
        if let Some(live) = inst.live() {
            live.opened.lock().remove(path);
            live.peer
                .notify(
                    "textDocument/didClose",
                    json!({"textDocument": {"uri": caps::uri_from_path(path)}}),
                )
                .await;
        }
        let empty = {
            let mut st = inst.st.lock();
            st.docs.retain(|d| d != path);
            st.docs.is_empty()
        };
        // Stale diagnostics of a closed doc must not linger in the client.
        let _ = inner.push.try_send(Push::Diagnostics {
            path: path.to_string(),
            version: None,
            diagnostics: json!([]),
        });
        if empty && arm_idle {
            inner.arm_idle(inst);
        }
    }

    /// Forward an LSP request for `path`'s server. `rid` lets the client cancel it later.
    pub async fn request(
        &self,
        path: &str,
        method: &str,
        params: Value,
        rid: Option<String>,
    ) -> Result<Value, RpcError> {
        let inst = self
            .inner
            .docs
            .lock()
            .get(path)
            .map(|d| d.inst.clone())
            .ok_or_else(|| RpcError::new(-32602, format!("document not open: {path}")))?;
        let live = inst
            .live()
            .ok_or_else(|| RpcError::new(-32002, "language server not ready"))?;
        if method == "$/capabilities" {
            return Ok(live.capabilities.clone());
        }
        let (id, rx) = live.peer.request_with_id(method, params).await;
        if let Some(r) = &rid {
            self.inner
                .cancels
                .lock()
                .insert(r.clone(), (live.peer.clone(), id));
        }
        let res = tokio::time::timeout(self.inner.cfg.request_timeout, rx).await;
        if let Some(r) = &rid {
            self.inner.cancels.lock().remove(r);
        }
        match res {
            Ok(r) => r.unwrap_or_else(|_| Err(RpcError::closed())),
            Err(_) => {
                live.peer.cancel(id).await;
                Err(RpcError::new(-32001, "language server request timed out"))
            }
        }
    }

    pub async fn cancel(&self, rid: &str) {
        let hit = self.inner.cancels.lock().remove(rid);
        if let Some((peer, id)) = hit {
            peer.cancel(id).await;
        }
    }

    /// The client's answer to a pushed `lsp_apply_edit`.
    pub fn apply_edit_result(&self, id: &str, applied: bool) {
        if let Some(tx) = self.inner.edit_acks.lock().remove(id) {
            let _ = tx.send(applied);
        }
    }

    /// Stop every server (hostd shutdown). Process groups are killed; nothing is handed off
    /// on `upgrade`: clients re-send `lsp_open` after reconnecting.
    pub async fn shutdown(&self) {
        self.inner
            .closed
            .store(true, std::sync::atomic::Ordering::Release);
        let insts: Vec<_> = self.inner.insts.lock().drain().map(|(_, v)| v).collect();
        self.inner.docs.lock().clear();
        let mut set = tokio::task::JoinSet::new();
        for i in insts {
            set.spawn(async move {
                i.st.lock().idle_gen += 1;
                if let Some(live) = i.live() {
                    server::shutdown(&live).await;
                }
                i.set_phase(Phase::Crashed("shut down".into()));
            });
        }
        set.join_all().await;
    }

    /// Live server instances (tests, `lsp_status`).
    pub fn instance_count(&self) -> usize {
        self.inner.insts.lock().len()
    }

    pub fn open_doc_count(&self) -> usize {
        self.inner.docs.lock().len()
    }

    /// OS pids of ready servers (tests).
    pub fn pids(&self) -> Vec<u32> {
        self.inner
            .insts
            .lock()
            .values()
            .filter_map(|i| i.live().and_then(|l| l.pid))
            .collect()
    }
}

impl Inner {
    fn statuses(&self) -> Vec<ServerStatus> {
        let mut v: Vec<_> = self.insts.lock().values().map(|i| i.status()).collect();
        v.sort_by(|a, b| (&a.name, &a.root).cmp(&(&b.name, &b.root)));
        v
    }

    fn notify_status(&self) {
        let _ = self.push.try_send(Push::Status(self.statuses()));
    }

    /// Resolve → start → replay open docs. Also the restart path (after a crash).
    async fn bring_up(self: Arc<Self>, inst: Arc<Inst>) {
        inst.set_phase(Phase::Downloading);
        self.notify_status();
        let me = self.clone();
        let i2 = inst.clone();
        let progress = move |m: &str| {
            *i2.shared.progress.lock() =
                HashMap::from([("install".to_string(), (m.to_string(), String::new()))]);
            me.notify_status();
        };
        let launch = match self.resolver.resolve(inst.server, &progress).await {
            Ok(l) => l,
            Err(e) => {
                inst.shared.progress.lock().clear();
                inst.set_phase(Phase::Missing(format!("{e:#}")));
                self.notify_status();
                return;
            }
        };
        inst.shared.progress.lock().clear();
        inst.set_phase(Phase::Starting);
        self.notify_status();
        let log = install::log_dir(&self.base).join(format!("{}.log", inst.server.name));
        match server::start(&launch, inst.shared.clone(), &log, self.cfg.init_timeout).await {
            Ok(live) => {
                let live = Arc::new(live);
                // Replay documents under the lock-free snapshot, then flip to ready; a doc
                // opened concurrently sees Ready and sends its own didOpen (dedup below).
                inst.set_phase(Phase::Ready(live.clone()));
                let paths = inst.st.lock().docs.clone();
                for p in paths {
                    self.did_open_if_needed(&inst, &p, &live).await;
                }
                self.notify_status();
            }
            Err(e) => {
                inst.set_phase(Phase::Crashed(format!("{e:#}")));
                self.notify_status();
            }
        }
    }

    /// Send `didOpen` for `path` once per (live connection). Tracked by version-0 sentinel
    /// in `opened`, keyed by peer identity.
    async fn did_open_if_needed(&self, inst: &Arc<Inst>, path: &str, live: &Arc<Live>) {
        let (language, version, text) = {
            let docs = self.docs.lock();
            let Some(d) = docs.get(path) else { return };
            if !Arc::ptr_eq(&d.inst, inst) {
                return;
            }
            (d.language.clone(), d.version, d.text.clone())
        };
        if !live.opened.lock().insert(path.to_string()) {
            return;
        }
        live.peer
            .notify(
                "textDocument/didOpen",
                json!({"textDocument": {
                    "uri": caps::uri_from_path(path),
                    "languageId": language,
                    "version": version,
                    "text": text,
                }}),
            )
            .await;
    }

    fn arm_idle(self: &Arc<Self>, inst: Arc<Inst>) {
        let gen_at = {
            let mut st = inst.st.lock();
            st.idle_gen += 1;
            st.idle_gen
        };
        let me = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(me.cfg.idle_shutdown).await;
            let still_idle = {
                let st = inst.st.lock();
                st.idle_gen == gen_at && st.docs.is_empty()
            };
            if !still_idle || me.closed.load(Ordering::Acquire) {
                return;
            }
            me.insts
                .lock()
                .remove(&(inst.server.name.to_string(), inst.root.clone()));
            if let Some(live) = inst.live() {
                server::shutdown(&live).await;
            }
            inst.set_phase(Phase::Crashed("idle".into()));
            me.notify_status();
        });
    }

    /// The server process went away. Restart if documents are open and the budget allows.
    async fn on_exit(self: Arc<Self>, inst: Arc<Inst>) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let was_ready = inst.live();
        if let Some(l) = &was_ready {
            // Reap: the group may still hold helpers.
            server::kill_group(l.pid);
        }
        let (retry, has_docs) = {
            let mut st = inst.st.lock();
            if st.docs.is_empty() {
                (false, false)
            } else {
                let now = Instant::now();
                while st
                    .restarts
                    .front()
                    .is_some_and(|t| now.duration_since(*t) > self.cfg.restart_window)
                {
                    st.restarts.pop_front();
                }
                let ok = st.restarts.len() < self.cfg.max_restarts;
                if ok {
                    st.restarts.push_back(now);
                }
                (ok, true)
            }
        };
        // Diagnostics from the dead process are stale.
        let docs: Vec<String> = inst.st.lock().docs.clone();
        for p in docs {
            let _ = self.push.try_send(Push::Diagnostics {
                path: p,
                version: None,
                diagnostics: json!([]),
            });
        }
        if !has_docs {
            self.insts
                .lock()
                .remove(&(inst.server.name.to_string(), inst.root.clone()));
            inst.set_phase(Phase::Crashed("exited".into()));
            self.notify_status();
        } else if retry {
            inst.set_phase(Phase::Starting);
            inst.shared.progress.lock().clear();
            self.notify_status();
            let backoff = self.cfg.restart_backoff
                * u32::try_from(inst.st.lock().restarts.len())
                    .unwrap_or(1)
                    .max(1);
            tokio::time::sleep(backoff).await;
            self.bring_up(inst).await;
        } else {
            inst.set_phase(Phase::Crashed(format!(
                "{} crashed repeatedly; reopen the file to retry",
                inst.server.name
            )));
            self.notify_status();
        }
    }
}

async fn event_loop(inner: std::sync::Weak<Inner>, mut rx: mpsc::Receiver<(u64, Event)>) {
    while let Some((gen_id, ev)) = rx.recv().await {
        let Some(inner) = inner.upgrade() else { return };
        let inst = inner
            .insts
            .lock()
            .values()
            .find(|i| i.gen_id == gen_id)
            .cloned();
        match ev {
            Event::Diagnostics {
                path,
                version,
                diagnostics,
            } => {
                let _ = inner.push.try_send(Push::Diagnostics {
                    path,
                    version,
                    diagnostics,
                });
            }
            Event::Status => inner.notify_status(),
            Event::ApplyEdit { id, edit, reply } => {
                inner.edit_acks.lock().insert(id.clone(), reply);
                if inner
                    .push
                    .try_send(Push::ApplyEdit {
                        id: id.clone(),
                        edit,
                    })
                    .is_err()
                {
                    // No client could take it: refuse instead of waiting out the timeout.
                    if let Some(tx) = inner.edit_acks.lock().remove(&id) {
                        let _ = tx.send(false);
                    }
                }
            }
            Event::Exited => {
                if let Some(inst) = inst {
                    // Only the current process generation counts; a replaced one is ignored.
                    if inst.live().is_some_and(|l| l.peer.is_dead()) {
                        tokio::spawn(inner.clone().on_exit(inst));
                    }
                }
            }
        }
    }
}
