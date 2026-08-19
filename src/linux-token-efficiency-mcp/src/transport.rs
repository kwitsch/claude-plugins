// transport.rs — newline-delimited JSON-RPC 2.0 over stdin/stdout. stdout carries JSON-RPC
// frames EXCLUSIVELY; every diagnostic goes to stderr via crate::log. A near-literal port of
// server.mjs's send/ok/fail and the readline loop (lines 651-664, 736-756).

use crate::log;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// Serialize `v` and write it as one complete `<json>\n` frame under a single stdout lock, so
/// concurrent handler threads never interleave partial frames on stdout.
pub fn send(v: &Value) {
    let mut frame = serde_json::to_string(v).unwrap_or_else(|_| "null".to_string());
    frame.push('\n');
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    let _ = handle.write_all(frame.as_bytes());
    let _ = handle.flush();
}

/// `{ jsonrpc: "2.0", id, result }`.
pub fn ok(id: &Value, result: Value) {
    send(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

/// `{ jsonrpc: "2.0", id, error: { code, message } }`.
pub fn fail(id: &Value, code: i64, message: &str) {
    send(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }));
}

/// Read newline-delimited JSON from stdin, calling `on_line` per parsed message. Blank lines
/// are skipped; a non-JSON line logs `non-JSON line ignored` (stderr) and is dropped. On stdin
/// close the process exits 0 (mirrors the Node `rl.on("close")` handler).
pub fn run_stdin_loop(mut on_line: impl FnMut(Value)) {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(trimmed) {
            Ok(msg) => on_line(msg),
            Err(_) => log("non-JSON line ignored"),
        }
    }
    std::process::exit(0);
}
