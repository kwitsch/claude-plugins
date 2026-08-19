// context.rs — pure port of mcp/cbm-context.mjs. Every formatter returns a non-empty
// context string (Some) or None ("nothing to say"); nothing here writes to stdout. An
// unrecognized payload is always silence, never a guess. The two project-cache functions
// do file I/O and swallow all errors.

use crate::consts::{CONTEXT_CHAR_LIMIT, PATTERN_CHAR_LIMIT, PROJECT_CACHE_TTL_MS, SYMBOL_LIMIT};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// A resolved cwd -> project mapping: the graph project name and its recorded repo root.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectEntry {
    pub name: String,
    pub root: String,
}

/// The read-only search_graph query a Grep/Glob call maps to (MCP argument name + value).
#[derive(Debug, Clone, PartialEq)]
pub struct GraphQuery {
    pub arg: &'static str,
    pub value: String,
}

/// Environment lookup abstraction so tests can inject a map instead of the real process env.
pub trait EnvLookup {
    fn get(&self, key: &str) -> Option<String>;
}

/// Reads the real process environment.
pub struct RealEnv;
impl EnvLookup for RealEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

/// Milliseconds since the Unix epoch (mirrors JS `Date.now()`).
pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn coverage_gap_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::RegexBuilder::new(
            r"not[_ -]?indexed|skipped|exclud|partial|unsupported|stale|source_newer|reindex",
        )
        .case_insensitive(true)
        .build()
        .unwrap()
    })
}

fn digit_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\d+").unwrap())
}

/// First non-empty, trimmed string value among the given keys.
fn first_string(rec: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(Value::String(s)) = rec.get(*key) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// First finite number value (as a `Value`) among the given keys.
fn first_number_value<'a>(rec: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(v) = rec.get(*key) {
            if let Some(n) = v.as_f64() {
                if n.is_finite() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// First finite number value among the given keys, as f64.
fn first_number(rec: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    first_number_value(rec, keys).and_then(|v| v.as_f64())
}

/// Render a finite JSON number the way JS stringifies it (integers without a decimal point).
fn js_number(v: &Value) -> String {
    if let Some(n) = v.as_i64() {
        return n.to_string();
    }
    if let Some(n) = v.as_u64() {
        return n.to_string();
    }
    if let Some(f) = v.as_f64() {
        if f.fract() == 0.0 && f.is_finite() {
            return format!("{}", f as i64);
        }
        return format!("{}", f);
    }
    String::new()
}

/// Peel the common inner envelopes a payload may still be wrapped in. Bounded to 4 levels.
fn unwrap_envelope(payload: &Value) -> &Value {
    let mut current = payload;
    for _ in 0..4 {
        let rec = match current.as_object() {
            Some(r) => r,
            None => return current,
        };
        // Mirror JS `rec.result ?? rec.data ?? rec.payload` + `next === undefined` guard.
        let next = {
            let mut found: Option<&Value> = None;
            for k in ["result", "data"] {
                if let Some(v) = rec.get(k) {
                    if !v.is_null() {
                        found = Some(v);
                        break;
                    }
                }
            }
            match found {
                Some(v) => Some(v),
                None => rec.get("payload"),
            }
        };
        match next {
            None => return current,
            Some(n) => current = n,
        }
    }
    current
}

/// The first array found at the payload root or under one of the given keys.
fn collect_array<'a>(payload: &'a Value, keys: &[&str]) -> Vec<&'a Value> {
    let root = unwrap_envelope(payload);
    if let Some(arr) = root.as_array() {
        return arr.iter().collect();
    }
    if let Some(rec) = root.as_object() {
        for key in keys {
            if let Some(Value::Array(arr)) = rec.get(*key) {
                return arr.iter().collect();
            }
        }
    }
    Vec::new()
}

/// Cap a string at CONTEXT_CHAR_LIMIT Unicode scalar values; trims first, appends '…' on a cut.
fn truncate(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= CONTEXT_CHAR_LIMIT {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(CONTEXT_CHAR_LIMIT - 1).collect();
    format!("{}…", cut)
}

/// Lexically resolve `p` (against `base`, else cwd) mimicking Node `path.resolve` — no disk I/O.
fn lexical_absolute(p: &str, base: Option<&str>) -> PathBuf {
    let combined: String = if p.starts_with('/') {
        p.to_string()
    } else {
        let b = match base {
            Some(b) if b.starts_with('/') => b.to_string(),
            Some(b) => {
                let cwd = std::env::current_dir().unwrap_or_default();
                format!("{}/{}", cwd.to_string_lossy(), b)
            }
            None => std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        };
        format!("{}/{}", b, p)
    };
    normalize(&combined)
}

/// Normalize an absolute path lexically: drop "." and empty segments, pop on "..".
fn normalize(path: &str) -> PathBuf {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    let mut result = String::from("/");
    result.push_str(&out.join("/"));
    PathBuf::from(result)
}

/// Is the already-resolved `target` the same as `base` or below it?
fn path_contains(base: &str, target: &str) -> bool {
    if target == base {
        return true;
    }
    let prefix = if base.ends_with('/') {
        base.to_string()
    } else {
        format!("{}/", base)
    };
    target.starts_with(&prefix)
}

/// Is `target` the same directory as `base`, or below it? Both resolved lexically.
fn is_same_or_ancestor(base: &str, target: &str) -> bool {
    let b = lexical_absolute(base, None);
    let t = lexical_absolute(target, None);
    path_contains(&b.to_string_lossy(), &t.to_string_lossy())
}

/// A string is usable as a path only when non-empty (trimmed) and free of an `${` placeholder.
pub fn usable_path(value: Option<&str>) -> bool {
    match value {
        Some(v) => !v.trim().is_empty() && !v.contains("${"),
        None => false,
    }
}

/// userConfig toggle, fail-open: only the trimmed literal "false" disables.
pub fn is_cbm_enabled(value: Option<&str>) -> bool {
    value.unwrap_or("").trim() != "false"
}

/// The plugin's own extraction-cache root (never cbm's CBM_CACHE_DIR graph root).
pub fn resolve_bundle_cache(env: &dyn EnvLookup) -> PathBuf {
    let cbm = env.get("CBM_BUNDLE_CACHE");
    if usable_path(cbm.as_deref()) {
        return PathBuf::from(cbm.unwrap().trim());
    }
    let pd = env.get("CLAUDE_PLUGIN_DATA");
    if usable_path(pd.as_deref()) {
        return PathBuf::from(pd.unwrap().trim()).join("cbm");
    }
    let tmp_v = env.get("TMPDIR");
    let tmp = if usable_path(tmp_v.as_deref()) {
        tmp_v.unwrap().trim().to_string()
    } else {
        "/tmp".to_string()
    };
    let uid = rustix::process::getuid().as_raw();
    PathBuf::from(tmp).join(format!("claude-cbm-{}", uid))
}

/// Directory holding one small JSON file per resolved cwd -> project mapping.
pub fn resolve_project_cache_dir(env: &dyn EnvLookup) -> PathBuf {
    resolve_bundle_cache(env).join("project-cache")
}

/// Stable, filesystem-safe filename for a cwd: lowercase-hex sha256 of the cwd bytes.
pub fn project_cache_key(cwd: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cwd.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// Read a still-fresh cached {name, root} project entry for `cwd`. None on any miss/error.
pub fn read_project_cache(cache_dir: &Path, cwd: &str) -> Option<ProjectEntry> {
    let raw =
        std::fs::read_to_string(cache_dir.join(format!("{}.json", project_cache_key(cwd)))).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let rec = value.as_object()?;
    let name = first_string(rec, &["project"])?;
    let root = first_string(rec, &["root"])?;
    let cached_at = first_number(rec, &["cachedAt"])?;
    if now_ms() as i128 - cached_at as i128 > PROJECT_CACHE_TTL_MS as i128 {
        return None;
    }
    Some(ProjectEntry { name, root })
}

/// Best-effort cache write: temp file + atomic rename. Any failure is swallowed.
pub fn write_project_cache(cache_dir: &Path, cwd: &str, entry: &ProjectEntry) {
    let _ = write_project_cache_inner(cache_dir, cwd, entry);
}

fn write_project_cache_inner(
    cache_dir: &Path,
    cwd: &str,
    entry: &ProjectEntry,
) -> std::io::Result<()> {
    let name = entry.name.trim();
    let root = entry.root.trim();
    if name.is_empty() || root.is_empty() {
        return Ok(());
    }
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(cache_dir)?;
    let key = project_cache_key(cwd);
    let tmp = cache_dir.join(format!(".{}.{}.tmp", key, std::process::id()));
    let payload = json!({ "project": name, "root": root, "cachedAt": now_ms() as u64 });
    std::fs::write(&tmp, serde_json::to_string(&payload)?)?;
    std::fs::rename(&tmp, cache_dir.join(format!("{}.json", key)))?;
    Ok(())
}

/// Peel cbm's MCP tool-result envelope. None on isError, non-object, missing/unparsable text.
pub fn unwrap_tool_result(result: &Value) -> Option<Value> {
    let rec = result.as_object()?;
    if rec.get("isError") == Some(&Value::Bool(true)) {
        return None;
    }
    if let Some(structured) = rec.get("structuredContent") {
        if structured.is_array() || structured.is_object() {
            return Some(structured.clone());
        }
    }
    let first = rec
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_object())?;
    let text = first.get("text").and_then(|t| t.as_str())?;
    serde_json::from_str::<Value>(text).ok()
}

/// The graph project whose recorded repo path equals, or is the nearest ancestor of, `cwd`.
pub fn pick_project_entry(payload: &Value, cwd: &str) -> Option<ProjectEntry> {
    if cwd.trim().is_empty() {
        return None;
    }
    let mut best: Option<ProjectEntry> = None;
    let mut best_len = 0usize;
    for item in collect_array(payload, &["projects", "items", "entries"]) {
        let rec = match item.as_object() {
            Some(r) => r,
            None => continue,
        };
        let name = first_string(rec, &["name", "project", "project_name", "projectName", "id"]);
        let root = first_string(
            rec,
            &[
                "path", "root", "repo_path", "repoPath", "root_path", "rootPath", "directory",
            ],
        );
        let (name, root) = match (name, root) {
            (Some(n), Some(r)) => (n, r),
            _ => continue,
        };
        if !is_same_or_ancestor(&root, cwd) {
            continue;
        }
        let len = lexical_absolute(&root, None).to_string_lossy().len();
        if best.is_none() || len > best_len {
            best_len = len;
            best = Some(ProjectEntry { name, root });
        }
    }
    best
}

/// The read-only search_graph query a Grep/Glob call maps to, as MCP argument names.
pub fn graph_query_from_tool_input(tool_name: &str, tool_input: &Value) -> Option<GraphQuery> {
    let arg = match tool_name {
        "Grep" => "name_pattern",
        "Glob" => "file_pattern",
        _ => return None,
    };
    let rec = tool_input.as_object()?;
    let value = first_string(rec, &["pattern"])?;
    if value.encode_utf16().count() > PATTERN_CHAR_LIMIT {
        return None;
    }
    Some(GraphQuery { arg, value })
}

/// Human-readable index state, or None when the payload says nothing recognizable.
fn describe_index_status(payload: &Value) -> Option<String> {
    let root = unwrap_envelope(payload);
    let rec = root.as_object()?;
    let mut parts: Vec<String> = Vec::new();
    if let Some(state) = first_string(rec, &["status", "state", "index_status", "indexStatus"]) {
        parts.push(format!("index {}", state));
    }
    if let Some(files) = first_number_value(
        rec,
        &["files", "file_count", "fileCount", "indexed_files", "indexedFiles"],
    ) {
        parts.push(format!("{} indexed files", js_number(files)));
    }
    if let Some(symbols) = first_number_value(rec, &["symbols", "symbol_count", "symbolCount"]) {
        parts.push(format!("{} symbols", js_number(symbols)));
    }
    if rec.get("stale") == Some(&Value::Bool(true))
        || rec.get("is_stale") == Some(&Value::Bool(true))
        || rec.get("isStale") == Some(&Value::Bool(true))
    {
        parts.push("index stale".to_string());
    }
    if let Some(last) = first_string(rec, &["last_indexed", "lastIndexed", "updated_at", "updatedAt"])
    {
        parts.push(format!("last indexed {}", last));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

fn format_project_context(
    project: &str,
    status: &Value,
    head_clause: &str,
    tail_sentence: &str,
) -> Option<String> {
    if project.trim().is_empty() {
        return None;
    }
    let suffix = match describe_index_status(status) {
        Some(state) => format!(" ({})", state),
        None => String::new(),
    };
    Some(truncate(&format!(
        "codebase-memory graph project \"{}\"{}{}. {}",
        project.trim(),
        head_clause,
        suffix,
        tail_sentence
    )))
}

/// SessionStart context: project, index freshness, and the steer towards the graph tools.
pub fn format_session_context(project: &str, status: &Value) -> Option<String> {
    format_project_context(
        project,
        status,
        " covers this repository",
        "Prefer the mcp__plugin_linux-token-efficiency_codebase-memory__* graph tools over plain text search when locating symbols, definitions or callers here.",
    )
}

/// SubagentStart context: the same facts, shorter, plus the delegation instruction.
pub fn format_subagent_context(project: &str, status: &Value) -> Option<String> {
    format_project_context(
        project,
        status,
        "",
        "Pass qualified symbol names and file paths through when delegating further.",
    )
}

/// The first line number a search_graph `lines` cell mentions, rendered ":<n>", else "".
fn first_line_suffix(value: &Value) -> String {
    match value {
        Value::Number(_) => {
            if let Some(n) = value.as_f64() {
                if n.is_finite() {
                    return format!(":{}", n.trunc() as i64);
                }
            }
            String::new()
        }
        Value::Array(arr) => {
            for v in arr {
                if let Some(n) = v.as_f64() {
                    if n.is_finite() {
                        return format!(":{}", n.trunc() as i64);
                    }
                }
            }
            String::new()
        }
        Value::String(s) => match digit_re().find(s) {
            Some(m) => format!(":{}", m.as_str()),
            None => String::new(),
        },
        _ => String::new(),
    }
}

/// PreToolUse context: at most `limit` qualified symbols with their files.
pub fn format_symbol_context(payload: &Value, limit: usize) -> Option<String> {
    let max = if limit > 0 { limit } else { SYMBOL_LIMIT };
    let root = unwrap_envelope(payload);
    let rec = root.as_object()?;
    let cols: Vec<String> = rec
        .get("cols")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .map(|c| c.as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default();
    let name_idx = cols.iter().position(|c| c == "name")?;
    let lines_idx = cols.iter().position(|c| c == "lines");
    let mut lines: Vec<String> = Vec::new();
    if let Some(groups) = rec.get("groups").and_then(|g| g.as_array()) {
        for group in groups {
            if lines.len() >= max {
                break;
            }
            let g = match group.as_object() {
                Some(g) => g,
                None => continue,
            };
            let prefix = g.get("qn_prefix").and_then(|v| v.as_str()).unwrap_or("");
            let file = g
                .get("file")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .unwrap_or("");
            if let Some(rows) = g.get("rows").and_then(|r| r.as_array()) {
                for row in rows {
                    if lines.len() >= max {
                        break;
                    }
                    let row = match row.as_array() {
                        Some(r) => r,
                        None => continue,
                    };
                    let name = row
                        .get(name_idx)
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    let where_ = if file.is_empty() {
                        String::new()
                    } else {
                        let suffix = match lines_idx {
                            Some(li) => row.get(li).map(first_line_suffix).unwrap_or_default(),
                            None => String::new(),
                        };
                        format!(" — {}{}", file, suffix)
                    };
                    lines.push(format!("- {}{}{}", prefix, name, where_));
                }
            }
        }
    }
    if lines.is_empty() {
        return None;
    }
    let mut out = vec!["codebase-memory graph matches for this search:".to_string()];
    out.extend(lines);
    out.push("Use mcp__plugin_linux-token-efficiency_codebase-memory__* on these qualified names instead of widening the text search.".to_string());
    Some(truncate(&out.join("\n")))
}

/// PostToolUse context: a warning ONLY when check_index_coverage reports a real gap.
pub fn format_coverage_context(payload: &Value, file_path: &str) -> Option<String> {
    if file_path.trim().is_empty() {
        return None;
    }
    let root = unwrap_envelope(payload);
    let rec = root.as_object()?;
    let wanted = file_path.trim();
    let mut entry: Option<&Map<String, Value>> = None;
    if let Some(paths) = rec.get("paths").and_then(|p| p.as_array()) {
        for item in paths {
            let candidate = match item.as_object() {
                Some(c) => c,
                None => continue,
            };
            let requested = candidate
                .get("requested_path")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .unwrap_or("");
            let resolved = candidate
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .unwrap_or("");
            if requested == wanted || resolved == wanted {
                entry = Some(candidate);
                break;
            }
        }
    }
    let entry = entry?;
    if entry.get("coverage_lookup") == Some(&Value::String("error".to_string()))
        || entry.get("status") == Some(&Value::String("coverage_unavailable".to_string()))
    {
        return None;
    }
    let mut flagged: Vec<String> = Vec::new();
    for key in ["status", "freshness", "recommended_action"] {
        if let Some(Value::String(s)) = entry.get(key) {
            if coverage_gap_re().is_match(s) {
                flagged.push(s.trim().to_string());
            }
        }
    }
    if entry.get("indexed") == Some(&Value::Bool(false))
        || entry.get("covered") == Some(&Value::Bool(false))
    {
        flagged.push("not indexed".to_string());
    }
    if flagged.is_empty() {
        return None;
    }
    Some(truncate(&format!(
        "codebase-memory graph coverage warning for {}: {}. The graph's view of this file is incomplete — rely on the file's own contents rather than on graph results for it.",
        wanted,
        flagged.join("; ")
    )))
}

/// `file_path` relative to a project `root`, or None when it lies outside that root.
pub fn relative_to_project(root: &str, file_path: &str, base_cwd: Option<&str>) -> Option<String> {
    if root.trim().is_empty() {
        return None;
    }
    if file_path.trim().is_empty() {
        return None;
    }
    let base = lexical_absolute(root.trim(), None);
    let target = match base_cwd {
        Some(b) if !b.trim().is_empty() => lexical_absolute(file_path.trim(), Some(b.trim())),
        _ => lexical_absolute(file_path.trim(), None),
    };
    let bs = base.to_string_lossy();
    let ts = target.to_string_lossy();
    if !path_contains(&bs, &ts) {
        return None;
    }
    if ts == bs {
        return Some(".".to_string());
    }
    let prefix = if bs.ends_with('/') {
        bs.to_string()
    } else {
        format!("{}/", bs)
    };
    let rel = ts.strip_prefix(&prefix).unwrap_or("");
    Some(if rel.is_empty() {
        ".".to_string()
    } else {
        rel.to_string()
    })
}

/// The only output shape the four hook tools ever return besides `{}`.
pub fn build_output(hook_event_name: &str, additional_context: &str) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": hook_event_name,
            "additionalContext": additional_context,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    struct MapEnv(HashMap<String, String>);
    impl EnvLookup for MapEnv {
        fn get(&self, k: &str) -> Option<String> {
            self.0.get(k).cloned()
        }
    }
    fn env(pairs: &[(&str, &str)]) -> MapEnv {
        MapEnv(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
    }

    #[test]
    fn is_cbm_enabled_only_trimmed_false_disables() {
        assert!(!is_cbm_enabled(Some("false")));
        assert!(!is_cbm_enabled(Some("  false  ")));
        assert!(is_cbm_enabled(None));
        assert!(is_cbm_enabled(Some("")));
        assert!(is_cbm_enabled(Some("true")));
        assert!(is_cbm_enabled(Some("FALSE")));
        assert!(is_cbm_enabled(Some("${user_config.cbm_enabled}")));
    }

    #[test]
    fn resolve_bundle_cache_precedence() {
        assert_eq!(
            resolve_bundle_cache(&env(&[("CBM_BUNDLE_CACHE", "/data/cbm")])),
            std::path::PathBuf::from("/data/cbm")
        );
        assert_eq!(
            resolve_bundle_cache(&env(&[("CBM_BUNDLE_CACHE", ""), ("CLAUDE_PLUGIN_DATA", "/pd")])),
            std::path::PathBuf::from("/pd/cbm")
        );
        let out = resolve_bundle_cache(&env(&[
            ("CBM_BUNDLE_CACHE", "${CLAUDE_PLUGIN_DATA}/cbm"),
            ("CLAUDE_PLUGIN_DATA", "${CLAUDE_PLUGIN_DATA}"),
            ("TMPDIR", "/tmpdir"),
        ]));
        assert!(!out.to_string_lossy().contains("${"));
        assert!(out.to_string_lossy().starts_with("/tmpdir/claude-cbm-"));
        assert!(resolve_bundle_cache(&env(&[]))
            .to_string_lossy()
            .starts_with("/tmp/claude-cbm-"));
    }

    #[test]
    fn resolve_project_cache_dir_is_subdir() {
        assert_eq!(
            resolve_project_cache_dir(&env(&[("CBM_BUNDLE_CACHE", "/data/cbm")])),
            std::path::PathBuf::from("/data/cbm/project-cache")
        );
    }

    #[test]
    fn project_cache_key_stable_and_hex() {
        assert_eq!(project_cache_key("/repos/app"), project_cache_key("/repos/app"));
        assert_ne!(project_cache_key("/repos/app"), project_cache_key("/repos/other"));
        let k = project_cache_key("/repos/app");
        assert_eq!(k.len(), 64);
        assert!(k.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn project_cache_roundtrip_miss_expiry_corruption() {
        assert_eq!(PROJECT_CACHE_TTL_MS, 600_000);
        let dir = std::env::temp_dir().join(format!("cbm-pc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_project_cache(&dir, "/repos/app").is_none());
        write_project_cache(
            &dir,
            "/repos/app",
            &ProjectEntry { name: "app-project".into(), root: "/repos/app".into() },
        );
        let got = read_project_cache(&dir, "/repos/app").unwrap();
        assert_eq!(got.name, "app-project");
        assert_eq!(got.root, "/repos/app");
        assert!(read_project_cache(&dir, "/repos/other").is_none());
        let file = dir.join(format!("{}.json", project_cache_key("/repos/app")));
        std::fs::write(
            &file,
            format!(
                r#"{{"project":"app-project","root":"/repos/app","cachedAt":{}}}"#,
                now_ms() - PROJECT_CACHE_TTL_MS - 1
            ),
        )
        .unwrap();
        assert!(read_project_cache(&dir, "/repos/app").is_none()); // expired
        std::fs::write(
            &file,
            format!(r#"{{"project":"app-project","cachedAt":{}}}"#, now_ms()),
        )
        .unwrap();
        assert!(read_project_cache(&dir, "/repos/app").is_none()); // no root
        std::fs::write(&file, "not json").unwrap();
        assert!(read_project_cache(&dir, "/repos/app").is_none()); // corrupt
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unwrap_tool_result_peels_envelope() {
        let payload = json!({"projects":[{"name":"app","path":"/repos/app"}]});
        assert_eq!(
            unwrap_tool_result(
                &json!({"content":[{"type":"text","text":payload.to_string()}],"isError":false})
            ),
            Some(payload.clone())
        );
        assert_eq!(
            unwrap_tool_result(
                &json!({"content":[{"type":"text","text":"{}"}],"structuredContent":payload.clone()})
            ),
            Some(payload.clone())
        );
        assert_eq!(
            unwrap_tool_result(
                &json!({"content":[{"type":"text","text":payload.to_string()}],"isError":true})
            ),
            None
        );
        assert_eq!(
            unwrap_tool_result(&json!({"content":[{"type":"text","text":"not json"}]})),
            None
        );
        assert_eq!(unwrap_tool_result(&json!({"content":[]})), None);
        assert_eq!(unwrap_tool_result(&Value::Null), None);
        assert_eq!(unwrap_tool_result(&json!("garbage")), None);
    }

    #[test]
    fn pick_project_entry_nearest_ancestor_and_aliases() {
        let payload = json!({"projects":[
            {"name":"outer","path":"/repos"},
            {"name":"inner","path":"/repos/app"},
            {"name":"other","path":"/elsewhere"}]});
        assert_eq!(pick_project_entry(&payload, "/repos/app").unwrap().name, "inner");
        assert_eq!(pick_project_entry(&payload, "/repos/app/src/deep").unwrap().name, "inner");
        assert_eq!(pick_project_entry(&payload, "/repos/other-app").unwrap().name, "outer");
        assert!(pick_project_entry(&payload, "/nowhere").is_none());
        assert!(pick_project_entry(&json!({"unexpected":true}), "/repos/app").is_none());
        assert!(pick_project_entry(&payload, "").is_none());
        let alias = json!([{"project_name":"graph","repo_path":"/repos/app"}]);
        let e = pick_project_entry(&alias, "/repos/app/lib").unwrap();
        assert_eq!((e.name.as_str(), e.root.as_str()), ("graph", "/repos/app"));
    }

    #[test]
    fn graph_query_argument_names() {
        let g = graph_query_from_tool_input("Grep", &json!({"pattern":"handleRequest"})).unwrap();
        assert_eq!((g.arg, g.value.as_str()), ("name_pattern", "handleRequest"));
        let g = graph_query_from_tool_input("Glob", &json!({"pattern":"**/*.mjs"})).unwrap();
        assert_eq!((g.arg, g.value.as_str()), ("file_pattern", "**/*.mjs"));
        assert!(graph_query_from_tool_input("Grep", &json!({"pattern":""})).is_none());
        assert!(graph_query_from_tool_input("Grep", &json!({"pattern":"   "})).is_none());
        assert!(graph_query_from_tool_input("Grep", &json!({"pattern":"x".repeat(201)})).is_none());
        assert!(graph_query_from_tool_input("Grep", &json!({})).is_none());
        assert!(graph_query_from_tool_input("Read", &json!({"pattern":"x"})).is_none());
        assert!(graph_query_from_tool_input("Grep", &Value::Null).is_none());
    }

    #[test]
    fn session_and_subagent_context() {
        let ctx = format_session_context("app", &json!({"status":"ready","files":42})).unwrap();
        assert!(ctx.contains("app") && ctx.contains("ready"));
        assert!(ctx.contains("mcp__plugin_linux-token-efficiency_codebase-memory__"));
        assert!(format_session_context("", &json!({"status":"ready"})).is_none());
        assert!(format_session_context("app", &json!("garbage")).is_some());
        let sub = format_subagent_context("app", &json!({"status":"ready"})).unwrap();
        assert!(sub.contains("app"));
        assert!(sub.len() <= format_session_context("app", &json!({"status":"ready"})).unwrap().len());
        assert!(format_subagent_context("", &json!({})).is_none());
    }

    #[test]
    fn symbol_context_reads_cols_groups_rows() {
        let search = json!({"total":2,"count":2,"cols":["name","label","lines","in","out"],
            "groups":[{"qn_prefix":"app.","file":"src/server.mjs","rows":[["handleRequest","function","12-40",1,2]]},
                      {"qn_prefix":"app.util.","file":"src/util.mjs","rows":[["slugify","function","7-9",0,1]]}],"has_more":false});
        let ctx = format_symbol_context(&search, 10).unwrap();
        assert!(ctx.contains("- app.handleRequest — src/server.mjs:12"));
        assert!(ctx.contains("- app.util.slugify — src/util.mjs:7"));
        assert!(ctx.contains("mcp__plugin_linux-token-efficiency_codebase-memory__"));
        let one = format_symbol_context(&search, 1).unwrap();
        assert_eq!(one.lines().filter(|l| l.starts_with("- ")).count(), 1);
        let mut empty = search.clone();
        empty["groups"] = json!([]);
        assert!(format_symbol_context(&empty, 10).is_none());
        assert!(format_symbol_context(
            &json!({"total":0,"count":0,"groups":[{"qn_prefix":"","file":"a","rows":[["x"]]}]}),
            10
        )
        .is_none());
        assert!(format_symbol_context(&json!({"results":[{"qualified_name":"old.shape"}]}), 10).is_none());
        assert!(format_symbol_context(&Value::Null, 10).is_none());
    }

    #[test]
    fn symbol_context_truncates_on_char_boundary() {
        let rows: Vec<Value> = (0..10)
            .map(|i| json!([format!("{}{}", "S".repeat(300), i), "function", format!("{}-{}", i + 1, i + 9), 0, 0]))
            .collect();
        let ctx = format_symbol_context(
            &json!({"cols":["name","label","lines","in","out"],
            "groups":[{"qn_prefix":"pkg.","file":format!("src/{}/f.mjs", "d".repeat(300)),"rows":rows}]}),
            10,
        )
        .unwrap();
        assert!(ctx.chars().count() <= CONTEXT_CHAR_LIMIT);
        let pairs = "𝌆".repeat(CONTEXT_CHAR_LIMIT);
        let ctx2 = format_symbol_context(
            &json!({"cols":["name","label","lines","in","out"],
            "groups":[{"qn_prefix":"","file":"","rows":[[pairs,"function","1-1",0,0]]}]}),
            10,
        )
        .unwrap();
        assert!(ctx2.chars().count() <= CONTEXT_CHAR_LIMIT);
    }

    #[test]
    fn coverage_context_warns_and_stays_silent() {
        let gap = json!({"project":"app","signal":"ok","paths":[{"requested_path":"src/server.mjs","path":"src/server.mjs","coverage_lookup":"ok","status":"not_indexed","freshness":"unknown","recommended_action":"reindex","coverage":[]}]});
        let warn = format_coverage_context(&gap, "src/server.mjs").unwrap();
        assert!(warn.contains("src/server.mjs") && warn.contains("not_indexed"));
        let unavailable = json!({"project":"app","paths":[{"requested_path":"src/server.mjs","path":"src/server.mjs","coverage_lookup":"error","status":"coverage_unavailable"}]});
        assert!(format_coverage_context(&unavailable, "src/server.mjs").is_none());
        assert!(format_coverage_context(
            &json!({"paths":[{"requested_path":"src/server.mjs","coverage_lookup":"ok","status":"indexed","freshness":"current","recommended_action":"none"}]}),
            "src/server.mjs"
        )
        .is_none());
        assert!(format_coverage_context(
            &json!({"paths":[{"path":"src/server.mjs","coverage_lookup":"ok","indexed":false}]}),
            "src/server.mjs"
        )
        .is_some());
        assert!(format_coverage_context(&gap, "src/other.mjs").is_none());
        assert!(format_coverage_context(&gap, "").is_none());
        assert!(format_coverage_context(&json!({"status":"skipped"}), "src/server.mjs").is_none());
        assert!(format_coverage_context(&json!("garbage"), "src/server.mjs").is_none());
    }

    #[test]
    fn relative_to_project_inside_root_outside_and_basecwd() {
        assert_eq!(
            relative_to_project("/repos/app", "/repos/app/src/server.mjs", None).as_deref(),
            Some("src/server.mjs")
        );
        assert_eq!(relative_to_project("/repos/app", "/repos/app", None).as_deref(), Some("."));
        assert!(relative_to_project("/repos/app", "/repos/other/a.mjs", None).is_none());
        assert!(relative_to_project("", "/repos/app/a.mjs", None).is_none());
        assert!(relative_to_project("/repos/app", "", None).is_none());
        assert_eq!(
            relative_to_project("/repos/app", "src/server.mjs", Some("/repos/app")).as_deref(),
            Some("src/server.mjs")
        );
        assert!(relative_to_project("/repos/app", "../server.mjs", Some("/repos/app")).is_none());
        assert!(relative_to_project("/repos/app", "src/server.mjs", Some("/repos/other")).is_none());
    }

    #[test]
    fn build_output_exact_shape() {
        let out = build_output("SessionStart", "ctx");
        assert_eq!(
            out,
            json!({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"ctx"}})
        );
    }
}
