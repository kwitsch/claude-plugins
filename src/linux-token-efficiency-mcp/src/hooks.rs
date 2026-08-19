// hooks.rs — the five fail-open hook tools plus the one-shot --session-start-hook CLI. A
// near-literal port of server.mjs lines 489-581 and 767-799, plus hooks/webfetch-steer.mjs
// lines 30-50. Every handler returns a plain JSON value; any failure path collapses to `{}`
// (never an isError, never a decision) — except hook_webfetch_steer, whose success shape is a
// PreToolUse deny. Nothing here writes stdout except run_session_start_hook.

use crate::consts::{
    HOOK_CALL_TIMEOUT_MS, HOOK_COVERAGE_CONTEXT_NAME, HOOK_SESSION_CONTEXT_NAME,
    HOOK_SUBAGENT_CONTEXT_NAME, HOOK_SYMBOL_CONTEXT_NAME, HOOK_TOOL_NAMES,
    HOOK_WEBFETCH_STEER_NAME, SYMBOL_LIMIT,
};
use crate::context::{
    build_output, format_coverage_context, format_session_context, format_subagent_context,
    format_symbol_context, graph_query_from_tool_input, is_cbm_enabled, pick_project_entry,
    read_project_cache, relative_to_project, resolve_project_cache_dir, unwrap_tool_result,
    usable_path, write_project_cache, ProjectEntry, RealEnv,
};
use crate::log;
use crate::rpc::ServerState;
use serde_json::{json, Value};

/// Which of the five hook handlers a `HookTool` invokes. One tool per event, so the
/// hookEventName each handler stamps can never be wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookKind {
    SessionContext,
    SubagentContext,
    SymbolContext,
    CoverageContext,
    WebfetchSteer,
}

/// A hook tool: its wire metadata plus the handler it maps to. `tools/list` renders the first
/// three fields; `tools/call` routes to `handler`.
pub struct HookTool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub handler: HookKind,
}

/// The five hook tools, in wire order. Names/descriptions/schemas are a byte-for-byte contract
/// with the Node implementation (server.mjs lines 585-649) plus the ported webfetch steer.
pub fn hook_tools() -> Vec<HookTool> {
    vec![
        HookTool {
            name: HOOK_SESSION_CONTEXT_NAME,
            description: "SessionStart hook: inject the codebase-memory graph project covering this repository and its index state.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true,
                "required": ["cwd"],
                "properties": { "cwd": { "type": "string" } },
            }),
            handler: HookKind::SessionContext,
        },
        HookTool {
            name: HOOK_SUBAGENT_CONTEXT_NAME,
            description: "SubagentStart hook: inject the codebase-memory graph project and index state for a delegated agent.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true,
                "required": ["cwd"],
                "properties": { "cwd": { "type": "string" } },
            }),
            handler: HookKind::SubagentContext,
        },
        HookTool {
            name: HOOK_SYMBOL_CONTEXT_NAME,
            description: "PreToolUse(Grep|Glob) hook: inject matching graph symbols for the search pattern.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true,
                "required": ["cwd"],
                "properties": {
                    "cwd": { "type": "string" },
                    "tool_name": { "type": "string" },
                    "tool_input": {
                        "type": "object",
                        "properties": { "pattern": { "type": "string" } },
                        "additionalProperties": true,
                    },
                },
            }),
            handler: HookKind::SymbolContext,
        },
        HookTool {
            name: HOOK_COVERAGE_CONTEXT_NAME,
            description: "PostToolUse(Read) hook: warn when the graph's coverage of the read file is incomplete.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true,
                "required": ["cwd"],
                "properties": {
                    "cwd": { "type": "string" },
                    "tool_input": {
                        "type": "object",
                        "properties": { "file_path": { "type": "string" } },
                        "additionalProperties": true,
                    },
                },
            }),
            handler: HookKind::CoverageContext,
        },
        HookTool {
            name: HOOK_WEBFETCH_STEER_NAME,
            description: "PreToolUse(WebFetch) hook: steer a WebFetch URL to context-mode's ctx_fetch_and_index + ctx_search.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true,
                "required": ["tool_input"],
                "properties": {
                    "tool_input": {
                        "type": "object",
                        "properties": { "url": { "type": "string" } },
                        "additionalProperties": true,
                    },
                },
            }),
            handler: HookKind::WebfetchSteer,
        },
    ]
}

/// True when `name` is one of the five hook-tool names (never forwarded to the child).
pub fn hook_tool_names_include(name: &str) -> bool {
    HOOK_TOOL_NAMES.contains(&name)
}

/// Dispatch a hook tool by name. `Some(result)` when `name` is a hook tool (the `{}`-or-output
/// value the caller wraps), `None` when it is a passthrough. No handler ever returns an error.
pub fn dispatch(name: &str, args: &Value, state: &ServerState) -> Option<Value> {
    if !hook_tool_names_include(name) {
        return None;
    }
    let kind = state
        .hook_tools
        .iter()
        .find(|t| t.name == name)
        .map(|t| t.handler)?;
    let result = match kind {
        HookKind::SessionContext => project_status_handler(state, args, "SessionStart"),
        HookKind::SubagentContext => project_status_handler(state, args, "SubagentStart"),
        HookKind::SymbolContext => symbol_context_handler(state, args),
        HookKind::CoverageContext => coverage_context_handler(state, args),
        HookKind::WebfetchSteer => webfetch_steer_handler(args),
    };
    Some(result)
}

// ------------------------------------------------------------------- shared hook preamble

/// Defence in depth (the process already exited if disabled) plus the never-wait rule: a
/// download still in flight means silence, never a stalled hook.
fn hook_ready(state: &ServerState) -> bool {
    if !is_cbm_enabled(
        std::env::var("CLAUDE_PLUGIN_OPTION_CBM_ENABLED")
            .ok()
            .as_deref(),
    ) {
        return false;
    }
    state.provisioner.binary_ready()
}

/// The usable, trimmed `cwd` from the hook args, or None.
fn hook_cwd(args: &Value) -> Option<String> {
    let cwd = args.get("cwd").and_then(Value::as_str)?;
    if usable_path(Some(cwd)) {
        Some(cwd.trim().to_string())
    } else {
        None
    }
}

/// The graph project covering `cwd`, from the on-disk per-cwd cache (10-minute TTL) or one
/// list_projects read. Returns None on any miss or child error (fail-open silence).
fn resolve_project(state: &ServerState, cwd: &str) -> Option<ProjectEntry> {
    let cache_dir = resolve_project_cache_dir(&RealEnv);
    if let Some(cached) = read_project_cache(&cache_dir, cwd) {
        return Some(cached);
    }
    let listed = state
        .child
        .call("list_projects", json!({}), HOOK_CALL_TIMEOUT_MS)
        .ok()?;
    let payload = unwrap_tool_result(&listed).unwrap_or(Value::Null);
    let entry = pick_project_entry(&payload, cwd)?;
    write_project_cache(&cache_dir, cwd, &entry);
    Some(entry)
}

/// The shared preamble: bail (fail-open, `{}`) unless cbm is ready, `cwd` is usable, and it
/// resolves to a known graph project. Returns (cwd, project) on success.
fn resolve_hook_project(state: &ServerState, args: &Value) -> Option<(String, ProjectEntry)> {
    if !hook_ready(state) {
        return None;
    }
    let cwd = hook_cwd(args)?;
    let project = resolve_project(state, &cwd)?;
    Some((cwd, project))
}

// --------------------------------------------------------------------------- handlers

/// SessionStart / SubagentStart: inject the project name and index state, or `{}`.
fn project_status_handler(state: &ServerState, args: &Value, event: &str) -> Value {
    let (_, project) = match resolve_hook_project(state, args) {
        Some(r) => r,
        None => return json!({}),
    };
    // A child throw (timeout/dead) is silence; a resolved-but-empty payload still yields a
    // context string (the project name alone is enough), matching the Node null-tolerant path.
    let status = match state
        .child
        .call("index_status", json!({ "project": project.name }), HOOK_CALL_TIMEOUT_MS)
    {
        Ok(r) => r,
        Err(_) => return json!({}),
    };
    let payload = unwrap_tool_result(&status).unwrap_or(Value::Null);
    let context = if event == "SessionStart" {
        format_session_context(&project.name, &payload)
    } else {
        format_subagent_context(&project.name, &payload)
    };
    match context {
        Some(c) if !c.is_empty() => build_output(event, &c),
        _ => json!({}),
    }
}

/// PreToolUse(Grep|Glob): inject matching graph symbols for the search pattern, or `{}`.
fn symbol_context_handler(state: &ServerState, args: &Value) -> Value {
    if !hook_ready(state) {
        return json!({});
    }
    let cwd = match hook_cwd(args) {
        Some(c) => c,
        None => return json!({}),
    };
    let tool_name = args.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let tool_input = args.get("tool_input").cloned().unwrap_or(Value::Null);
    let query = match graph_query_from_tool_input(tool_name, &tool_input) {
        Some(q) => q,
        None => return json!({}),
    };
    let project = match resolve_project(state, &cwd) {
        Some(p) => p,
        None => return json!({}),
    };
    let mut call_args = json!({ "project": project.name, "limit": SYMBOL_LIMIT, "format": "json" });
    call_args[query.arg] = json!(query.value);
    let found = match state
        .child
        .call("search_graph", call_args, HOOK_CALL_TIMEOUT_MS)
    {
        Ok(r) => r,
        Err(_) => return json!({}),
    };
    let payload = unwrap_tool_result(&found).unwrap_or(Value::Null);
    match format_symbol_context(&payload, SYMBOL_LIMIT) {
        Some(c) if !c.is_empty() => build_output("PreToolUse", &c),
        _ => json!({}),
    }
}

/// PostToolUse(Read): warn only when the graph's coverage of the read file is incomplete.
fn coverage_context_handler(state: &ServerState, args: &Value) -> Value {
    let (cwd, project) = match resolve_hook_project(state, args) {
        Some(r) => r,
        None => return json!({}),
    };
    let raw = args
        .get("tool_input")
        .and_then(|t| t.get("file_path"))
        .and_then(Value::as_str)
        .map(|s| s.trim())
        .unwrap_or("");
    if !usable_path(Some(raw)) {
        return json!({});
    }
    let relative = match relative_to_project(&project.root, raw, Some(&cwd)) {
        Some(r) => r,
        None => return json!({}),
    };
    let coverage = match state.child.call(
        "check_index_coverage",
        json!({ "project": project.name, "paths": [relative] }),
        HOOK_CALL_TIMEOUT_MS,
    ) {
        Ok(r) => r,
        Err(_) => return json!({}),
    };
    let payload = unwrap_tool_result(&coverage).unwrap_or(Value::Null);
    match format_coverage_context(&payload, &relative) {
        Some(c) if !c.is_empty() => build_output("PostToolUse", &c),
        _ => json!({}),
    }
}

// ------------------------------------------------------------------ webfetch steer

/// The steer toggle, fail-open: only the trimmed literal "false" disables (mirrors
/// isSteerEnabled in rtk-rewrite.mjs).
pub fn is_steer_enabled(value: Option<&str>) -> bool {
    value.unwrap_or("").trim() != "false"
}

const CTX_TOOL_PREFIX: &str = "mcp__plugin_linux-token-efficiency_context-mode__";

/// The hostname of an http(s)-style URL, lowercased, or None when it does not parse. A small
/// lexical parser (no external crate): scheme "://" authority, minus userinfo and port.
fn url_hostname(url: &str) -> Option<String> {
    let idx = url.find("://")?;
    let scheme = &url[..idx];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.') {
        return None;
    }
    let after = &url[idx + 3..];
    let end = after
        .find(['/', '?', '#'])
        .unwrap_or(after.len());
    let authority = &after[..end];
    let hostport = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(rest) = hostport.strip_prefix('[') {
        // IPv6 literal: keep the bracketed form, drop any :port after it.
        match rest.split_once(']') {
            Some((inner, _)) => format!("[{}]", inner),
            None => hostport.to_string(),
        }
    } else {
        hostport.split(':').next().unwrap_or(hostport).to_string()
    };
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

/// The PreToolUse deny result steering one WebFetch URL to ctx_fetch_and_index. The reason is
/// a complete replacement call plus an explicit "do not retry WebFetch" so the model cannot
/// loop on the denial. A byte-for-byte port of buildWebFetchDeny (webfetch-steer.mjs).
pub fn build_webfetch_deny(url: &str) -> Value {
    let source = url_hostname(url).unwrap_or_else(|| "web".to_string());
    let url_json = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".to_string());
    let source_json = serde_json::to_string(&source).unwrap_or_else(|_| "\"\"".to_string());
    let reason = format!(
        "context-mode steer: WebFetch is routed through the context-mode MCP server. \
Do not retry WebFetch for this URL. Call ctx_fetch_and_index ({prefix}ctx_fetch_and_index) with \
{{\"url\": {url_json}, \"source\": {source_json}}}, then ctx_search(queries: [...]) \
to read the indexed content — the raw page never enters the context window. \
(Set the linux-token-efficiency plugin option steer_enabled to false to disable this routing.)",
        prefix = CTX_TOOL_PREFIX,
    );
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    })
}

/// PreToolUse(WebFetch): pure classification — steer only when steer_enabled and a usable url,
/// else fail-open `{}`. Unlike the four cbm tools it needs no graph project or warm binary.
fn webfetch_steer_handler(args: &Value) -> Value {
    if !is_steer_enabled(
        std::env::var("CLAUDE_PLUGIN_OPTION_STEER_ENABLED")
            .ok()
            .as_deref(),
    ) {
        return json!({});
    }
    let url = args
        .get("tool_input")
        .and_then(|t| t.get("url"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.is_empty() {
        return json!({});
    }
    build_webfetch_deny(url)
}

// --------------------------------------------------------------- --session-start-hook CLI

/// One-shot CLI mode for the SessionStart command hook (see hooks.json): SessionStart fires
/// before any MCP server connects, so a `mcp_tool` hook hard-errors there rather than failing
/// open. This reuses project_status_handler unchanged — same env/cache/child machinery — just
/// invoked directly instead of over the JSON-RPC loop, and exits instead of staying warm. Any
/// error is logged to stderr; the caller exits 0 unconditionally.
pub fn run_session_start_hook(state: &ServerState) {
    let raw = std::io::read_to_string(std::io::stdin()).unwrap_or_default();
    let args: Value = if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
    };
    state.provisioner.ensure_binary();
    let result = project_status_handler(state, &args, "SessionStart");
    // Match process.stdout.write(JSON.stringify(result)) — no trailing newline.
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    if let Err(e) = out
        .write_all(result.to_string().as_bytes())
        .and_then(|_| out.flush())
    {
        log(&format!("session-start hook stdout failed: {}", e));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_tools_has_five_named_entries_with_object_schema() {
        let tools = hook_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            vec![
                "hook_session_context",
                "hook_subagent_context",
                "hook_symbol_context",
                "hook_coverage_context",
                "hook_webfetch_steer"
            ]
        );
        assert!(tools
            .iter()
            .all(|t| t.input_schema["type"] == "object" && !t.description.is_empty()));
    }

    #[test]
    fn hook_tool_names_include_matches_the_five() {
        for name in [
            "hook_session_context",
            "hook_subagent_context",
            "hook_symbol_context",
            "hook_coverage_context",
            "hook_webfetch_steer",
        ] {
            assert!(hook_tool_names_include(name));
        }
        assert!(!hook_tool_names_include("search_graph"));
        assert!(!hook_tool_names_include(""));
    }

    #[test]
    fn is_steer_enabled_only_trimmed_false_disables() {
        assert!(!is_steer_enabled(Some("false")));
        assert!(!is_steer_enabled(Some("  false  ")));
        assert!(is_steer_enabled(None));
        assert!(is_steer_enabled(Some("")));
        assert!(is_steer_enabled(Some("true")));
        assert!(is_steer_enabled(Some("${user_config.steer_enabled}")));
    }

    #[test]
    fn webfetch_deny_reason_is_byte_exact() {
        let out = build_webfetch_deny("https://example.com/docs/page");
        let r = out["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap();
        assert!(r.contains("mcp__plugin_linux-token-efficiency_context-mode__ctx_fetch_and_index"));
        assert!(r.contains("\"url\": \"https://example.com/docs/page\""));
        assert!(r.contains("\"source\": \"example.com\""));
        assert!(r.contains("Do not retry WebFetch for this URL."));
        assert!(r.contains("steer_enabled to false to disable this routing."));
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
    }

    #[test]
    fn webfetch_deny_unparseable_url_uses_web_label() {
        let out = build_webfetch_deny("not a real url");
        let r = out["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap();
        assert!(r.contains("\"source\": \"web\""));
    }
}
