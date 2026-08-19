// main.rs — argv dispatch and server startup for the linux-token-efficiency proxy MCP server.
// Transport: newline-delimited JSON-RPC 2.0. stdout carries JSON-RPC frames EXCLUSIVELY; every
// diagnostic goes to stderr via `log`, prefixed `[codebase-memory]`.

mod child;
mod consts;
mod context;
mod provision;
mod rpc;
mod transport;

use std::sync::Arc;

/// stderr diagnostic, prefixed exactly as the Node implementation.
pub(crate) fn log(message: &str) {
    eprintln!("[codebase-memory] {}", message);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("{}", consts::SERVER_VERSION);
        return;
    }
    // The --session-start-hook CLI branch is added in Task 4.
    run_server();
}

fn run_server() {
    use context::{is_cbm_enabled, EnvLookup, RealEnv};
    let env = RealEnv;

    // Startup guards — each is a silent exit(0), never a stdout write.
    if !is_cbm_enabled(env.get("CLAUDE_PLUGIN_OPTION_CBM_ENABLED").as_deref()) {
        log("disabled by the cbm_enabled plugin option; not starting codebase-memory-mcp");
        std::process::exit(0);
    }
    if !(cfg!(target_os = "linux") && cfg!(target_arch = "x86_64")) {
        log(&format!(
            "codebase-memory-mcp is Linux x86_64 only (host: {}/{})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        std::process::exit(0);
    }
    let server_dir = match std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    {
        Some(d) => d,
        None => std::process::exit(0),
    };
    let pin = match provision::read_pin(&server_dir) {
        Some(p) => p,
        None => std::process::exit(0),
    };
    let passthrough = provision::read_tool_snapshot(&server_dir, &pin.cbm_version);

    let provisioner = Arc::new(provision::Provisioner::new(pin, &env));
    let child = Arc::new(child::ChildManager::new(provisioner.clone()));
    let state = Arc::new(rpc::ServerState {
        passthrough,
        provisioner: provisioner.clone(),
        child,
        hook_tools: Vec::new(),
    });

    // The stdin loop comes up FIRST so initialize answers immediately; then the first-run
    // download is fired on a detached thread without blocking the transport. A warm cache is
    // ready before the first hook call, but a cold download never stalls a JSON-RPC frame.
    let prov_bg = provisioner;
    std::thread::spawn(move || {
        prov_bg.ensure_binary();
    });

    let loop_state = state;
    transport::run_stdin_loop(move |msg| {
        // initialize/ping/tools/list/notifications answer synchronously (no I/O) — exactly as
        // the Node event loop ran those arms to completion before the next line. A tools/call
        // that reaches the warm child may block, so only that path runs on its own thread,
        // keeping a slow call from stalling later frames while matching the Node fire-and-forget
        // concurrency. A tools/call with an empty name is a synchronous -32602 in Node (it never
        // reaches an await), so it stays inline and cannot be lost to a same-tick stdin close.
        let method = msg.get("method").and_then(|v| v.as_str());
        let has_tool_name = msg
            .get("params")
            .and_then(|p| p.get("name"))
            .and_then(|v| v.as_str())
            .is_some_and(|n| !n.is_empty());
        let offload = method == Some("tools/call") && has_tool_name;
        if offload {
            let s = loop_state.clone();
            std::thread::spawn(move || {
                rpc::handle(&msg, &s);
            });
        } else {
            rpc::handle(&msg, &loop_state);
        }
    });
}
