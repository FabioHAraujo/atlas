//! `Content-Length` framing of JSON-RPC messages (LSP base protocol).

use std::io;

use serde_json::Value;
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt,
};

/// Largest body accepted from a server; a bigger frame is a protocol error, not an allocation.
pub const MAX_BODY: usize = 256 * 1024 * 1024;
const MAX_HEADER_LINE: usize = 8 * 1024;

/// Serialize `msg` as one frame.
pub fn encode(msg: &Value) -> Vec<u8> {
    let body = msg.to_string();
    let mut out = Vec::with_capacity(body.len() + 32);
    out.extend_from_slice(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes());
    out.extend_from_slice(body.as_bytes());
    out
}

pub async fn write<W: AsyncWrite + Unpin>(w: &mut W, msg: &Value) -> io::Result<()> {
    w.write_all(&encode(msg)).await?;
    w.flush().await
}

/// Read one frame. `Ok(None)` is a clean EOF between frames; EOF inside a frame is an error.
/// Unknown headers (`Content-Type`) are ignored; bodies are JSON in UTF-8.
pub async fn read<R: AsyncBufRead + AsyncRead + Unpin>(r: &mut R) -> io::Result<Option<Value>> {
    let mut len: Option<usize> = None;
    let mut line = String::new();
    let mut first = true;
    loop {
        line.clear();
        let n = (&mut *r)
            .take(MAX_HEADER_LINE as u64)
            .read_line(&mut line)
            .await?;
        if n == 0 {
            return if first {
                Ok(None)
            } else {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "eof in frame header",
                ))
            };
        }
        first = false;
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':')
            && k.trim().eq_ignore_ascii_case("content-length")
        {
            len =
                Some(v.trim().parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "bad Content-Length")
                })?);
        }
    }
    let len = len.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no Content-Length"))?;
    if len > MAX_BODY {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncWriteExt, BufReader};

    #[tokio::test]
    async fn merged_frames_are_split() {
        let a = json!({"jsonrpc":"2.0","id":1,"result":null});
        let b = json!({"jsonrpc":"2.0","method":"x","params":{"k":[1,2,3]}});
        let mut bytes = encode(&a);
        bytes.extend(encode(&b));
        let mut r = BufReader::new(&bytes[..]);
        assert_eq!(read(&mut r).await.unwrap().unwrap(), a);
        assert_eq!(read(&mut r).await.unwrap().unwrap(), b);
        assert!(read(&mut r).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn frame_split_across_reads_byte_by_byte() {
        let msg = json!({"jsonrpc":"2.0","id":7,"result":{"text":"héllo 🦀 世界"}});
        let bytes = encode(&msg);
        let (mut tx, rx) = tokio::io::duplex(4);
        let writer = tokio::spawn(async move {
            for b in bytes {
                tx.write_all(&[b]).await.unwrap();
                tx.flush().await.unwrap();
            }
        });
        let mut r = BufReader::new(rx);
        assert_eq!(read(&mut r).await.unwrap().unwrap(), msg);
        writer.await.unwrap();
        assert!(read(&mut r).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn content_length_counts_bytes_not_chars() {
        let msg = json!({"s": "日本語🦀"});
        let bytes = encode(&msg);
        let head = String::from_utf8_lossy(&bytes);
        let want = msg.to_string().len();
        assert!(head.starts_with(&format!("Content-Length: {want}\r\n\r\n")));
        assert!(want > msg.to_string().chars().count());
    }

    #[tokio::test]
    async fn extra_headers_and_case_are_tolerated() {
        let body = r#"{"a":1}"#;
        let raw = format!(
            "content-type: application/vscode-jsonrpc; charset=utf-8\r\nCONTENT-LENGTH: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let mut r = BufReader::new(raw.as_bytes());
        assert_eq!(read(&mut r).await.unwrap().unwrap(), json!({"a":1}));
    }

    #[tokio::test]
    async fn truncated_body_and_garbage_are_errors() {
        let mut r = BufReader::new(&b"Content-Length: 10\r\n\r\n{\"a\""[..]);
        assert!(read(&mut r).await.is_err());
        let mut r = BufReader::new(&b"Content-Length: nope\r\n\r\n"[..]);
        assert!(read(&mut r).await.is_err());
        let mut r = BufReader::new(&b"X: 1\r\n\r\n{}"[..]);
        assert!(read(&mut r).await.is_err());
        let mut r = BufReader::new(&b"Content-Length: 4\r\n\r\nnull"[..]);
        assert_eq!(read(&mut r).await.unwrap().unwrap(), Value::Null);
        let mut r = BufReader::new(&b"Content-Length: 3\r\n\r\n{x}"[..]);
        assert!(read(&mut r).await.is_err());
    }
}
