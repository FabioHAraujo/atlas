//! JSON-RPC 2.0 peer over LSP framing: request/response correlation, cancellation,
//! notifications, and server→client requests answered by a [`Handler`].

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::io::{AsyncBufRead, AsyncRead, AsyncWrite, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::framing;

/// Outgoing queue depth: writes beyond this apply backpressure instead of growing memory.
const OUT_QUEUE: usize = 256;
/// LSP `RequestCancelled`.
pub const REQUEST_CANCELLED: i64 = -32800;

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn cancelled() -> Self {
        Self::new(REQUEST_CANCELLED, "cancelled")
    }
    pub fn closed() -> Self {
        Self::new(-32099, "language server connection closed")
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (code {})", self.message, self.code)
    }
}

impl std::error::Error for RpcError {}

type Fut<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Receives everything the server initiates.
pub trait Handler: Send + Sync + 'static {
    fn notification(&self, method: &str, params: Value);
    /// Answer a server→client request. `Err` is sent as a JSON-RPC error.
    fn request(&self, method: String, params: Value) -> Fut<Result<Value, RpcError>>;
    /// The connection ended (EOF or protocol error). Called once, after pending requests failed.
    fn closed(&self);
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>>;

/// A live connection. Cloning shares it; the tasks stop when the transport closes or on
/// [`Peer::shutdown`].
#[derive(Clone)]
pub struct Peer {
    out: mpsc::Sender<Value>,
    pending: Pending,
    next: Arc<AtomicI64>,
    dead: Arc<AtomicBool>,
}

impl Peer {
    pub fn spawn<R, W>(r: R, w: W, handler: Arc<dyn Handler>) -> Peer
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (out, rx) = mpsc::channel::<Value>(OUT_QUEUE);
        let pending: Pending = Arc::default();
        let dead = Arc::new(AtomicBool::new(false));
        let peer = Peer {
            out,
            pending: pending.clone(),
            next: Arc::new(AtomicI64::new(1)),
            dead: dead.clone(),
        };
        tokio::spawn(write_loop(w, rx));
        tokio::spawn(read_loop(
            BufReader::new(r),
            peer.clone(),
            handler,
            pending,
            dead,
        ));
        peer
    }

    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Acquire)
    }

    /// Start a request; returns its id (for [`Peer::cancel`]) and the response future.
    pub async fn request_with_id(
        &self,
        method: &str,
        params: Value,
    ) -> (i64, oneshot::Receiver<Result<Value, RpcError>>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        if self.is_dead() {
            let _ = tx.send(Err(RpcError::closed()));
            return (id, rx);
        }
        self.pending.lock().insert(id, tx);
        let msg = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
        if self.out.send(msg).await.is_err()
            && let Some(tx) = self.pending.lock().remove(&id)
        {
            let _ = tx.send(Err(RpcError::closed()));
        }
        (id, rx)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let (_, rx) = self.request_with_id(method, params).await;
        rx.await.unwrap_or_else(|_| Err(RpcError::closed()))
    }

    pub async fn notify(&self, method: &str, params: Value) {
        let _ = self
            .out
            .send(json!({"jsonrpc":"2.0","method":method,"params":params}))
            .await;
    }

    /// Cancel request `id`: tell the server (`$/cancelRequest`) and fail the waiter now, so a
    /// slow server cannot hold the caller. The late response is dropped.
    pub async fn cancel(&self, id: i64) {
        let tx = self.pending.lock().remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(Err(RpcError::cancelled()));
            self.notify("$/cancelRequest", json!({"id": id})).await;
        }
    }

    pub fn pending_len(&self) -> usize {
        self.pending.lock().len()
    }

    async fn respond(&self, id: Value, res: Result<Value, RpcError>) {
        let msg = match res {
            Ok(v) => json!({"jsonrpc":"2.0","id":id,"result":v}),
            Err(e) => {
                json!({"jsonrpc":"2.0","id":id,"error":{"code":e.code,"message":e.message}})
            }
        };
        let _ = self.out.send(msg).await;
    }
}

async fn write_loop<W: AsyncWrite + Unpin>(mut w: W, mut rx: mpsc::Receiver<Value>) {
    while let Some(msg) = rx.recv().await {
        if framing::write(&mut w, &msg).await.is_err() {
            break;
        }
    }
}

async fn read_loop<R: AsyncBufRead + AsyncRead + Unpin>(
    mut r: R,
    peer: Peer,
    handler: Arc<dyn Handler>,
    pending: Pending,
    dead: Arc<AtomicBool>,
) {
    loop {
        let msg = match framing::read(&mut r).await {
            Ok(Some(m)) => m,
            Ok(None) | Err(_) => break,
        };
        let method = msg.get("method").and_then(Value::as_str).map(str::to_owned);
        match (method, msg.get("id").cloned()) {
            (Some(m), Some(id)) => {
                // Server→client request: answer off the read loop so a slow handler
                // (applyEdit waits for the UI) cannot stall responses.
                let (peer, handler) = (peer.clone(), handler.clone());
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                tokio::spawn(async move {
                    let res = handler.request(m, params).await;
                    peer.respond(id, res).await;
                });
            }
            (Some(m), None) => {
                handler.notification(&m, msg.get("params").cloned().unwrap_or(Value::Null));
            }
            (None, Some(id)) => {
                let Some(id) = id.as_i64() else { continue };
                let Some(tx) = pending.lock().remove(&id) else {
                    continue; // cancelled or unknown
                };
                let res = match msg.get("error") {
                    Some(e) if !e.is_null() => Err(RpcError::new(
                        e.get("code").and_then(Value::as_i64).unwrap_or(-32603),
                        e.get("message").and_then(Value::as_str).unwrap_or("error"),
                    )),
                    _ => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = tx.send(res);
            }
            (None, None) => {}
        }
    }
    dead.store(true, Ordering::Release);
    let drained: Vec<_> = pending.lock().drain().collect();
    for (_, tx) in drained {
        let _ = tx.send(Err(RpcError::closed()));
    }
    handler.closed();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use tokio::io::{AsyncWriteExt, BufReader as TokioBufReader, duplex};

    #[derive(Default)]
    struct Rec {
        notes: Mutex<Vec<(String, Value)>>,
        closed: AtomicUsize,
    }
    impl Handler for Rec {
        fn notification(&self, method: &str, params: Value) {
            self.notes.lock().push((method.to_string(), params));
        }
        fn request(&self, method: String, params: Value) -> Fut<Result<Value, RpcError>> {
            Box::pin(async move {
                if method == "boom" {
                    Err(RpcError::new(-32601, "nope"))
                } else {
                    Ok(json!({"echo": params}))
                }
            })
        }
        fn closed(&self) {
            self.closed.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// A peer wired to an in-memory "server" end we drive by hand.
    fn pair() -> (
        Peer,
        Arc<Rec>,
        TokioBufReader<tokio::io::DuplexStream>,
        tokio::io::DuplexStream,
    ) {
        let (c_to_s_w, c_to_s_r) = duplex(1 << 16);
        let (s_to_c_w, s_to_c_r) = duplex(1 << 16);
        let rec = Arc::new(Rec::default());
        let peer = Peer::spawn(s_to_c_r, c_to_s_w, rec.clone());
        (peer, rec, TokioBufReader::new(c_to_s_r), s_to_c_w)
    }

    #[tokio::test]
    async fn responses_correlate_out_of_order() {
        let (peer, _rec, mut from_client, mut to_client) = pair();
        let (id1, rx1) = peer.request_with_id("a", json!(1)).await;
        let (id2, rx2) = peer.request_with_id("b", json!(2)).await;
        let m1 = framing::read(&mut from_client).await.unwrap().unwrap();
        let m2 = framing::read(&mut from_client).await.unwrap().unwrap();
        assert_eq!(m1["id"], id1);
        assert_eq!(m2["method"], "b");
        // answer the second first
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":id2,"result":"B"}),
        )
        .await
        .unwrap();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":id1,"result":"A"}),
        )
        .await
        .unwrap();
        assert_eq!(rx2.await.unwrap().unwrap(), json!("B"));
        assert_eq!(rx1.await.unwrap().unwrap(), json!("A"));
        assert_eq!(peer.pending_len(), 0);
    }

    #[tokio::test]
    async fn error_responses_surface_code_and_message() {
        let (peer, _rec, mut from_client, mut to_client) = pair();
        let (id, rx) = peer.request_with_id("x", Value::Null).await;
        framing::read(&mut from_client).await.unwrap();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32801,"message":"content modified"}}),
        )
        .await
        .unwrap();
        let e = rx.await.unwrap().unwrap_err();
        assert_eq!((e.code, e.message.as_str()), (-32801, "content modified"));
    }

    #[tokio::test]
    async fn cancel_fails_waiter_notifies_server_and_drops_late_reply() {
        let (peer, _rec, mut from_client, mut to_client) = pair();
        let (id, rx) = peer.request_with_id("slow", Value::Null).await;
        framing::read(&mut from_client).await.unwrap();
        peer.cancel(id).await;
        assert_eq!(rx.await.unwrap().unwrap_err().code, REQUEST_CANCELLED);
        let n = framing::read(&mut from_client).await.unwrap().unwrap();
        assert_eq!(n["method"], "$/cancelRequest");
        assert_eq!(n["params"]["id"], id);
        // the late reply must not break anything, and a following request still works
        framing::write(&mut to_client, &json!({"jsonrpc":"2.0","id":id,"result":1}))
            .await
            .unwrap();
        let (id2, rx2) = peer.request_with_id("next", Value::Null).await;
        framing::read(&mut from_client).await.unwrap();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":id2,"result":2}),
        )
        .await
        .unwrap();
        assert_eq!(rx2.await.unwrap().unwrap(), json!(2));
        // cancelling an already-finished id sends nothing
        peer.cancel(id2).await;
        assert_eq!(peer.pending_len(), 0);
    }

    #[tokio::test]
    async fn server_requests_are_answered_and_notifications_delivered() {
        let (_peer, rec, mut from_client, mut to_client) = pair();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":"s1","method":"workspace/configuration","params":{"k":1}}),
        )
        .await
        .unwrap();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","id":9,"method":"boom"}),
        )
        .await
        .unwrap();
        framing::write(
            &mut to_client,
            &json!({"jsonrpc":"2.0","method":"window/logMessage","params":{"m":"hi"}}),
        )
        .await
        .unwrap();
        let mut got = HashMap::new();
        for _ in 0..2 {
            let r = framing::read(&mut from_client).await.unwrap().unwrap();
            got.insert(r["id"].to_string(), r);
        }
        assert_eq!(got["\"s1\""]["result"]["echo"]["k"], 1);
        assert_eq!(got["9"]["error"]["code"], -32601);
        for _ in 0..50 {
            if !rec.notes.lock().is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(rec.notes.lock()[0].0, "window/logMessage");
    }

    #[tokio::test]
    async fn eof_fails_pending_marks_dead_and_calls_closed_once() {
        let (peer, rec, mut from_client, mut to_client) = pair();
        let (_, rx) = peer.request_with_id("x", Value::Null).await;
        framing::read(&mut from_client).await.unwrap();
        to_client.shutdown().await.unwrap();
        drop(to_client);
        assert_eq!(rx.await.unwrap().unwrap_err(), RpcError::closed());
        for _ in 0..50 {
            if peer.is_dead() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(peer.is_dead());
        assert_eq!(rec.closed.load(Ordering::SeqCst), 1);
        assert_eq!(
            peer.request("late", Value::Null).await.unwrap_err(),
            RpcError::closed()
        );
    }
}
