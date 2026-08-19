// child.rs — the warm cbm MCP child. Spawns the pinned upstream binary once (no args =>
// cbm's own MCP stdio mode) and keeps it warm, remapping every tools/call onto the proxy's
// own JSON-RPC id space, enforcing a per-call timeout, and respawning within a bounded budget
// after a crash. A near-literal port of server.mjs lines 334-487.
//
// Environment is inherited wholesale: CBM_CACHE_DIR is never set/rewritten (that is cbm's own
// graph root), and CBM_BUNDLE_CACHE is never injected for the child (it is the plugin's, not
// cbm's).

use crate::consts::{
    CHILD_MAX_RESTARTS, DEFAULT_PROTOCOL, HOOK_CALL_TIMEOUT_MS, SERVER_NAME, SERVER_VERSION,
};
use crate::log;
use crate::provision::Provisioner;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child as OsChild, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Monotonic JSON-RPC id source for child calls. Ids are ALWAYS the proxy's own; the harness's
/// id is restored by the caller.
pub struct IdAllocator(AtomicU64);

impl IdAllocator {
    pub fn new() -> Self {
        IdAllocator(AtomicU64::new(1))
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}

impl Default for IdAllocator {
    fn default() -> Self {
        Self::new()
    }
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

/// A live connection to a spawned child process. Shared behind an `Arc`; the reader thread
/// keeps its own clones of `pending` and `alive` so it never needs the manager lock.
struct ChildConn {
    stdin: Mutex<std::process::ChildStdin>,
    pending: Pending,
    proc: Mutex<OsChild>,
    alive: Arc<AtomicBool>,
}

struct Inner {
    conn: Option<Arc<ChildConn>>,
    starts: u32,
}

/// Owns the warm child and the restart budget. Lazily spawns on the first call and respawns
/// (up to `CHILD_MAX_RESTARTS` total spawns per process) after the child dies.
pub struct ChildManager {
    provisioner: Arc<Provisioner>,
    ids: IdAllocator,
    inner: Mutex<Inner>,
}

impl ChildManager {
    pub fn new(provisioner: Arc<Provisioner>) -> Self {
        ChildManager {
            provisioner,
            ids: IdAllocator::new(),
            inner: Mutex::new(Inner {
                conn: None,
                starts: 0,
            }),
        }
    }

    /// One tools/call-shaped request to the child. `timeout_ms == 0` means no timeout
    /// (passthrough). On any error the connection is left for the next call to respawn.
    pub fn call(&self, name: &str, args: Value, timeout_ms: u64) -> Result<Value, String> {
        let conn = self.get_child()?;
        let arguments = if args.is_null() { json!({}) } else { args };
        self.send_child(
            &conn,
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
            timeout_ms,
        )
    }

    /// Return the live connection, spawning (and handshaking) a fresh child if none is alive.
    /// Holds the manager lock across spawn+handshake so at most one child is ever created per
    /// gap — the single-flight guarantee the Node `childPromise` gave.
    fn get_child(&self) -> Result<Arc<ChildConn>, String> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(conn) = &inner.conn {
            if conn.alive.load(Ordering::SeqCst) {
                return Ok(conn.clone());
            }
            inner.conn = None;
        }
        if !self.provisioner.ensure_binary() {
            return Err("pinned binary unavailable".to_string());
        }
        if inner.starts >= CHILD_MAX_RESTARTS {
            return Err("child restart budget exhausted".to_string());
        }
        inner.starts += 1;
        let conn = self.spawn_and_handshake()?;
        inner.conn = Some(conn.clone());
        Ok(conn)
    }

    fn spawn_and_handshake(&self) -> Result<Arc<ChildConn>, String> {
        // Env inherited wholesale — never set CBM_CACHE_DIR, never inject CBM_BUNDLE_CACHE.
        let mut proc = Command::new(self.provisioner.cached_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("child spawn error: {}", e))?;
        let stdin = proc
            .stdin
            .take()
            .ok_or_else(|| "child stdin unavailable".to_string())?;
        let stdout = proc
            .stdout
            .take()
            .ok_or_else(|| "child stdout unavailable".to_string())?;
        let stderr = proc
            .stderr
            .take()
            .ok_or_else(|| "child stderr unavailable".to_string())?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // Reader thread: match child stdout lines to pending waiters by id. On EOF, abandon —
        // reject every pending waiter and mark the connection dead so the next call respawns.
        let r_pending = pending.clone();
        let r_alive = alive.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(_) => break,
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue, // the child's stdout is parsed, never echoed
                };
                let id = match msg.get("id").and_then(Value::as_u64) {
                    Some(i) => i,
                    None => continue,
                };
                let waiter = r_pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                if let Some(tx) = waiter {
                    if let Some(err) = msg.get("error") {
                        let m = err
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("child returned an error")
                            .to_string();
                        let _ = tx.send(Err(m));
                    } else {
                        let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                    }
                }
            }
            log("child exited");
            r_alive.store(false, Ordering::SeqCst);
            let mut p = r_pending.lock().unwrap_or_else(|e| e.into_inner());
            for (_, tx) in p.drain() {
                let _ = tx.send(Err("child exited".to_string()));
            }
        });

        // stderr pump: forward the child's stderr to this process's stderr verbatim.
        std::thread::spawn(move || {
            let mut stderr = stderr;
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let out = std::io::stderr();
                        let mut h = out.lock();
                        let _ = h.write_all(&buf[..n]);
                        let _ = h.flush();
                    }
                    Err(_) => break,
                }
            }
        });

        let conn = Arc::new(ChildConn {
            stdin: Mutex::new(stdin),
            pending,
            proc: Mutex::new(proc),
            alive,
        });

        // Handshake. On failure, kill the spawned child so it is never orphaned (its exit/error
        // handling only fires on its own termination), then propagate the error.
        if let Err(e) = self.send_child(
            &conn,
            "initialize",
            json!({
                "protocolVersion": DEFAULT_PROTOCOL,
                "capabilities": {},
                "clientInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
            }),
            HOOK_CALL_TIMEOUT_MS * 2,
        ) {
            let _ = conn.proc.lock().unwrap_or_else(|x| x.into_inner()).kill();
            conn.alive.store(false, Ordering::SeqCst);
            return Err(format!("child initialize failed: {}", e));
        }
        self.notify_child(&conn, "notifications/initialized");
        Ok(conn)
    }

    /// Write a request and wait for its matching response. A write to a dead child's stdin
    /// returns `Err` (BrokenPipe), never panics.
    fn send_child(
        &self,
        conn: &ChildConn,
        method: &str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, String> {
        let id = self.ids.next();
        let (tx, rx) = channel();
        conn.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);

        let mut frame =
            serde_json::to_string(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
                .unwrap_or_default();
        frame.push('\n');
        {
            let mut stdin = conn.stdin.lock().unwrap_or_else(|e| e.into_inner());
            if let Err(e) = stdin.write_all(frame.as_bytes()).and_then(|_| stdin.flush()) {
                conn.pending
                    .lock()
                    .unwrap_or_else(|x| x.into_inner())
                    .remove(&id);
                return Err(format!("child write failed: {}", e));
            }
        }

        if timeout_ms > 0 {
            match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
                Ok(result) => result,
                Err(_) => {
                    conn.pending
                        .lock()
                        .unwrap_or_else(|x| x.into_inner())
                        .remove(&id);
                    Err(format!("child timeout after {} ms on {}", timeout_ms, method))
                }
            }
        } else {
            match rx.recv() {
                Ok(result) => result,
                Err(_) => {
                    conn.pending
                        .lock()
                        .unwrap_or_else(|x| x.into_inner())
                        .remove(&id);
                    Err("child connection closed".to_string())
                }
            }
        }
    }

    fn notify_child(&self, conn: &ChildConn, method: &str) {
        let mut frame =
            serde_json::to_string(&json!({ "jsonrpc": "2.0", "method": method })).unwrap_or_default();
        frame.push('\n');
        let mut stdin = conn.stdin.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = stdin.write_all(frame.as_bytes()).and_then(|_| stdin.flush()) {
            log(&format!("child notify failed: {}", e));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_allocator_is_monotonic_from_one() {
        let a = IdAllocator::new();
        assert_eq!(a.next(), 1);
        assert_eq!(a.next(), 2);
        assert_eq!(a.next(), 3);
    }
}
