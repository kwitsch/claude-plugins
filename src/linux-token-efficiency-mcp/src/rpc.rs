// rpc.rs — JSON-RPC method dispatch. Answers initialize/ping/tools/list itself (never
// blocking on I/O), forwards every non-hook tools/call verbatim to the warm child, and mirrors
// only tools capability (never the child's). A near-literal port of server.mjs lines 666-734.

use crate::child::ChildManager;
use crate::consts::{DEFAULT_PROTOCOL, SERVER_NAME, SERVER_VERSION};
use crate::provision::{Provisioner, ToolSpec};
use crate::transport::{fail, ok};
use serde_json::{json, Value};
use std::sync::Arc;

/// Placeholder hook-tool metadata. Task 4 introduces the real hook-tool table (with handlers)
/// in hooks.rs; Task 3 keeps `ServerState.hook_tools` empty, so `tools/call` here handles only
/// passthrough forwarding plus the empty-name and child-error paths.
pub struct HookTool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// Everything a request handler needs. Shared behind an `Arc` across per-message handler
/// threads.
pub struct ServerState {
    pub passthrough: Vec<ToolSpec>,
    pub provisioner: Arc<Provisioner>,
    pub child: Arc<ChildManager>,
    pub hook_tools: Vec<HookTool>,
}

/// Dispatch a single parsed JSON-RPC message.
pub fn handle(msg: &Value, state: &ServerState) {
    let null = Value::Null;
    let id = msg.get("id");
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "initialize" => {
            // Tools only: the child's capabilities are deliberately not mirrored, so the
            // harness never asks us for resources/prompts we do not proxy.
            let proto = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_PROTOCOL);
            ok(
                id.unwrap_or(&null),
                json!({
                    "protocolVersion": proto,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
                }),
            );
        }
        "notifications/initialized" | "notifications/cancelled" => {}
        "ping" => ok(id.unwrap_or(&null), json!({})),
        "tools/list" => {
            let mut tools: Vec<Value> = state
                .hook_tools
                .iter()
                .map(|h| json!({ "name": h.name, "description": h.description, "inputSchema": h.input_schema }))
                .collect();
            for t in &state.passthrough {
                tools.push(json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                }));
            }
            ok(id.unwrap_or(&null), json!({ "tools": tools }));
        }
        "tools/call" => handle_tool_call(id.unwrap_or(&null), &params, state),
        _ => {
            // No id => a notification; nothing to answer.
            if let Some(idv) = id {
                fail(idv, -32601, &format!("method not found: {}", method));
            }
        }
    }
}

fn handle_tool_call(id: &Value, params: &Value, state: &ServerState) {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    // Task 4 wires hook-tool dispatch here; with an empty hook_tools table it never matches.

    if name.is_empty() {
        return fail(id, -32602, "tools/call requires a tool name");
    }

    // Forward verbatim; the child is the source of truth at call time. isError/content/
    // structuredContent reach Claude unchanged. Passthrough uses no timeout.
    match state.child.call(name, args, 0) {
        Ok(result) => ok(id, result),
        Err(e) => ok(
            id,
            json!({
                "content": [{ "type": "text", "text": format!("codebase-memory unavailable: {}", e) }],
                "isError": true,
            }),
        ),
    }
}
