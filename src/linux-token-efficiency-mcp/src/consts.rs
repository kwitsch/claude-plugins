// consts.rs — every preserved constant for the linux-token-efficiency cbm proxy MCP
// server. These literals are a contract: server name/info, protocol, timeouts, budgets,
// URLs, char limits and hook-tool names must match the Node implementation byte-for-byte.

pub const SERVER_NAME: &str = "codebase-memory";
pub const SERVER_VERSION: &str = match option_env!("LTE_MCP_VERSION") {
    Some(v) => v,
    None => "0.6.0",
};
pub const DEFAULT_PROTOCOL: &str = "2025-11-25";
pub const BINARY_NAME: &str = "codebase-memory-mcp";
pub const HOOK_CALL_TIMEOUT_MS: u64 = 4000;
pub const DOWNLOAD_TIMEOUT_MS: u64 = 300000;
pub const CHILD_MAX_RESTARTS: u32 = 3;
pub const DEFAULT_DOWNLOAD_BASE_URL: &str =
    "https://github.com/DeusData/codebase-memory-mcp/releases/download";
pub const CONTEXT_CHAR_LIMIT: usize = 1500;
pub const SYMBOL_LIMIT: usize = 10;
pub const PATTERN_CHAR_LIMIT: usize = 200;
pub const PROJECT_CACHE_TTL_MS: u128 = 600000;
pub const HOOK_SESSION_CONTEXT_NAME: &str = "hook_session_context";
pub const HOOK_SUBAGENT_CONTEXT_NAME: &str = "hook_subagent_context";
pub const HOOK_SYMBOL_CONTEXT_NAME: &str = "hook_symbol_context";
pub const HOOK_COVERAGE_CONTEXT_NAME: &str = "hook_coverage_context";
pub const HOOK_WEBFETCH_STEER_NAME: &str = "hook_webfetch_steer";
pub const HOOK_TOOL_NAMES: [&str; 5] = [
    HOOK_SESSION_CONTEXT_NAME,
    HOOK_SUBAGENT_CONTEXT_NAME,
    HOOK_SYMBOL_CONTEXT_NAME,
    HOOK_COVERAGE_CONTEXT_NAME,
    HOOK_WEBFETCH_STEER_NAME,
];
