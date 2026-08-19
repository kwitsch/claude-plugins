// provision.rs — pin/snapshot read plus content-addressed provisioning of the pinned
// upstream codebase-memory-mcp binary. This is the ONLY component permitted to download or
// extract that binary; the asset and the extracted binary are BOTH sha256-verified against
// cbm-bundle.json before anything enters the cache, which is populated by atomic rename
// only. A near-literal port of server.mjs lines 80-332. Every failure path returns
// false/None, logs a `[codebase-memory] ...` line to stderr, and never writes stdout.

use crate::consts::{BINARY_NAME, DEFAULT_DOWNLOAD_BASE_URL, DOWNLOAD_TIMEOUT_MS, HOOK_TOOL_NAMES};
use crate::context::{resolve_bundle_cache, usable_path, EnvLookup};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// stderr diagnostic, prefixed exactly as the Node implementation.
fn log(message: &str) {
    eprintln!("[codebase-memory] {}", message);
}

/// The machine-owned version pin, read from cbm-bundle.json. Exactly one binaries[] entry
/// is required; both sha256 fields must match `^[0-9a-f]{64}$`.
#[derive(Debug, Clone)]
pub struct Pin {
    pub cbm_version: String,
    pub release_tag: String,
    pub asset: String,
    pub asset_sha256: String,
    pub binary_sha256: String,
}

/// One entry of the committed upstream tool-list snapshot (cbm-tools.json).
#[derive(Debug, Clone)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// True for a lowercase-hex sha256 digest string (`^[0-9a-f]{64}$`).
fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Read and validate the pin. Reads `<server_dir>/../cbm-bundle.json`. Any failure logs and
/// returns None (a fail-closed startup error, mirroring the "exactly one entry" rule).
pub fn read_pin(server_dir: &Path) -> Option<Pin> {
    let file = server_dir.join("..").join("cbm-bundle.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) => {
            log(&format!("unusable cbm-bundle.json ({}): {}", file.display(), e));
            return None;
        }
    };
    let parsed: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            log(&format!("unusable cbm-bundle.json ({}): {}", file.display(), e));
            return None;
        }
    };
    let binaries = parsed.get("binaries").and_then(Value::as_array);
    let len = binaries.map(|a| a.len()).unwrap_or(0);
    if len != 1 {
        log(&format!(
            "cbm-bundle.json must list exactly one binaries[] entry, found {}",
            len
        ));
        return None;
    }
    let entry = &binaries.unwrap()[0];
    let str_field = |v: &Value, k: &str| -> String {
        v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    };
    let pin = Pin {
        cbm_version: str_field(&parsed, "cbmVersion"),
        release_tag: str_field(&parsed, "releaseTag"),
        asset: str_field(entry, "asset"),
        asset_sha256: str_field(entry, "assetSha256"),
        binary_sha256: str_field(entry, "binarySha256"),
    };
    if pin.cbm_version.is_empty()
        || pin.release_tag.is_empty()
        || pin.asset.is_empty()
        || !is_sha256(&pin.asset_sha256)
        || !is_sha256(&pin.binary_sha256)
    {
        log("cbm-bundle.json is missing cbmVersion/releaseTag/asset/assetSha256/binarySha256");
        return None;
    }
    Some(pin)
}

/// Read the committed upstream tool-list snapshot. Reads `<server_dir>/../cbm-tools.json`. A
/// missing, unparsable or version-mismatched snapshot degrades to `[]` (hook tools only).
/// Names colliding with this proxy's own hook tools are dropped (collision guard).
pub fn read_tool_snapshot(server_dir: &Path, cbm_version: &str) -> Vec<ToolSpec> {
    let file = server_dir.join("..").join("cbm-tools.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) => {
            log(&format!(
                "unusable cbm-tools.json ({}): {}; advertising hook tools only",
                file.display(),
                e
            ));
            return Vec::new();
        }
    };
    let parsed: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            log(&format!(
                "unusable cbm-tools.json ({}): {}; advertising hook tools only",
                file.display(),
                e
            ));
            return Vec::new();
        }
    };
    let pinned = parsed.get("cbmVersion").and_then(Value::as_str);
    if pinned != Some(cbm_version) {
        log(&format!(
            "cbm-tools.json pins {} but cbm-bundle.json pins {}; advertising hook tools only",
            pinned.map(|s| s.to_string()).unwrap_or_else(|| "null".to_string()),
            cbm_version
        ));
        return Vec::new();
    }
    let tools = match parsed.get("tools").and_then(Value::as_array) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for tool in tools {
        let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        if HOOK_TOOL_NAMES.contains(&name) {
            log(&format!(
                "cbm-tools.json advertises a name that collides with a hook tool ({}); dropping it",
                name
            ));
            continue;
        }
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or(name)
            .to_string();
        let input_schema = tool
            .get("inputSchema")
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object", "additionalProperties": true }));
        out.push(ToolSpec {
            name: name.to_string(),
            description,
            input_schema,
        });
    }
    out
}

/// Content-addressed cache location for the verified binary:
/// `<bundle-cache-root>/<binarySha256[0:16]>/codebase-memory-mcp`.
pub fn cached_binary_path(env: &dyn EnvLookup, pin: &Pin) -> PathBuf {
    resolve_bundle_cache(env)
        .join(&pin.binary_sha256[..16])
        .join(BINARY_NAME)
}

/// Every `codebase-memory-mcp` regular file under `dir` (recursive). The archive also ships
/// install.sh, LICENSE and THIRD_PARTY_NOTICES.md; 0 or >1 matches must fail closed.
pub fn find_binaries(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    walk(dir, &mut found);
    found
}

fn walk(current: &Path, found: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let full = entry.path();
        if ft.is_dir() {
            walk(&full, found);
        } else if ft.is_file() && entry.file_name().to_str() == Some(BINARY_NAME) {
            found.push(full);
        }
    }
}

/// True when `p` doesn't exist yet, or exists and is owned by this process's uid and is not
/// a symlink. The cache path is derived from a committed (public) hash, so on a shared host
/// with the TMPDIR fallback active the path is predictable to any local user — ownership,
/// not mere existence, gates the fast path.
pub fn is_owned_by_us(p: &Path) -> bool {
    match std::fs::symlink_metadata(p) {
        Ok(md) => {
            let uid = rustix::process::getuid().as_raw();
            !md.file_type().is_symlink() && md.uid() == uid
        }
        Err(_) => true, // doesn't exist — nothing to distrust
    }
}

/// Streaming sha256 of a file's contents, as lowercase hex.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(to_hex(&hasher.finalize()))
}

/// Removes a directory tree on drop — the `finally { rmSync(tmp) }` of the Node port.
struct TmpDirGuard(PathBuf);
impl Drop for TmpDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Create a fresh, uniquely named `.tmp.*` subdirectory (mode 0700) inside `root`.
fn mkdtemp_in(root: &Path) -> std::io::Result<PathBuf> {
    for _ in 0..1000 {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let candidate = root.join(format!(".tmp.{}.{}", std::process::id(), nanos));
        match std::fs::DirBuilder::new().mode(0o700).create(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "could not create a unique temp dir",
    ))
}

/// Download `url` to `dest`, sha256-hashing the byte stream in one pass. Returns the hex
/// digest on success; on non-2xx or transport/IO error logs and returns Err.
fn download_and_hash(url: &str, dest: &Path) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(DOWNLOAD_TIMEOUT_MS))
        .build();
    let resp = match agent.get(url).call() {
        Ok(r) => r,
        Err(e) => return Err(format!("download failed: {}: {}", url, e)),
    };
    let mut reader = resp.into_reader();
    let mut file = match File::create(dest) {
        Ok(f) => f,
        Err(e) => return Err(format!("cannot write {}: {}", dest.display(), e)),
    };
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = match reader.read(&mut buf) {
            Ok(n) => n,
            Err(e) => return Err(format!("download read error: {}: {}", url, e)),
        };
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        if let Err(e) = file.write_all(&buf[..n]) {
            return Err(format!("cannot write {}: {}", dest.display(), e));
        }
    }
    Ok(to_hex(&hasher.finalize()))
}

/// Extract a `.tar.gz` archive into `dir` using flate2 + tar (no external `tar` process).
fn extract_targz(archive: &Path, dir: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("cannot open {}: {}", archive.display(), e))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut ar = tar::Archive::new(gz);
    ar.unpack(dir).map_err(|e| format!("{}", e))
}

/// Single-flight provisioner. The first `ensure_binary()` caller runs the cold path; later
/// callers observe the memoized result. At most one download attempt per process — a failure
/// marks not-ready permanently; reconnecting the server (a new process) is the retry.
pub struct Provisioner {
    pin: Pin,
    cached_path: PathBuf,
    cache_root: PathBuf,
    base_url: String,
    state: Mutex<Option<bool>>,
    ready: AtomicBool,
}

impl Provisioner {
    pub fn new(pin: Pin, env: &dyn EnvLookup) -> Self {
        let cached_path = cached_binary_path(env, &pin);
        let cache_root = resolve_bundle_cache(env);
        let base_env = env.get("CBM_DOWNLOAD_BASE_URL");
        let base_url = if usable_path(base_env.as_deref()) {
            base_env.unwrap().trim().to_string()
        } else {
            DEFAULT_DOWNLOAD_BASE_URL.to_string()
        };
        Provisioner {
            pin,
            cached_path,
            cache_root,
            base_url,
            state: Mutex::new(None),
            ready: AtomicBool::new(false),
        }
    }

    /// Idempotent, memoized. Concurrent callers serialize on the memo lock, so at most one
    /// `prepare_binary()` ever runs. Returns whether the verified binary is cached.
    pub fn ensure_binary(&self) -> bool {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(v) = *guard {
            return v;
        }
        let ok = self.prepare_binary();
        *guard = Some(ok);
        self.ready.store(ok, Ordering::SeqCst);
        ok
    }

    /// Lock-free readiness check for hook handlers — never waits on an in-flight download.
    pub fn binary_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub fn cached_path(&self) -> PathBuf {
        self.cached_path.clone()
    }

    /// The cold path. Fast-path a warm, owned cache; otherwise download, verify the asset
    /// hash, extract, verify the extracted binary hash, and atomically rename into place.
    fn prepare_binary(&self) -> bool {
        let target = &self.cached_path;
        // Fast path: warm cache, executable and owned by us — never re-hash 279.6 MiB.
        if let Ok(md) = std::fs::metadata(target) {
            let executable = md.permissions().mode() & 0o111 != 0;
            if executable {
                if is_owned_by_us(target) {
                    return true;
                }
                log(&format!(
                    "cached binary at {} is not owned by this process; refusing to trust it, re-verifying",
                    target.display()
                ));
            }
        }
        if let Err(e) = std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.cache_root)
        {
            log(&format!(
                "cannot create cache root {}: {}",
                self.cache_root.display(),
                e
            ));
            return false;
        }
        let tmp = match mkdtemp_in(&self.cache_root) {
            Ok(t) => t,
            Err(e) => {
                log(&format!("cannot create temp dir: {}", e));
                return false;
            }
        };
        let _guard = TmpDirGuard(tmp.clone());

        let url = format!("{}/{}/{}", self.base_url, self.pin.release_tag, self.pin.asset);
        let archive = tmp.join(&self.pin.asset);
        log(&format!("fetching {}", url));
        let asset_sha = match download_and_hash(&url, &archive) {
            Ok(s) => s,
            Err(e) => {
                log(&e);
                return false;
            }
        };
        if asset_sha != self.pin.asset_sha256 {
            log(&format!(
                "asset sha256 mismatch for {}; refusing to extract",
                self.pin.asset
            ));
            return false;
        }
        if let Err(e) = extract_targz(&archive, &tmp) {
            log(&format!("failed to extract {}: {}", self.pin.asset, e));
            return false;
        }
        let found = find_binaries(&tmp);
        if found.len() != 1 {
            log(&format!(
                "expected exactly one {} inside {}, found {}",
                BINARY_NAME,
                self.pin.asset,
                found.len()
            ));
            return false;
        }
        let extracted = &found[0];
        if let Err(e) = std::fs::set_permissions(extracted, std::fs::Permissions::from_mode(0o755)) {
            log(&format!("cannot chmod {}: {}", extracted.display(), e));
            return false;
        }
        match hash_file(extracted) {
            Ok(h) if h == self.pin.binary_sha256 => {}
            Ok(_) => {
                log("extracted binary does not match the pin; nothing cached");
                return false;
            }
            Err(e) => {
                log(&format!("cannot hash extracted binary: {}", e));
                return false;
            }
        }
        if let Some(parent) = target.parent() {
            if let Err(e) = std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(parent)
            {
                log(&format!("cannot create {}: {}", parent.display(), e));
                return false;
            }
        }
        // Atomic inside the cache root, so two racing servers converge on the identical
        // verified file.
        if let Err(e) = std::fs::rename(extracted, target) {
            log(&format!("cannot install {}: {}", target.display(), e));
            return false;
        }
        log(&format!("prepared {}", target.display()));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cbm-prov-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_suffix() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn read_pin_requires_exactly_one_valid_entry() {
        let root = tmp();
        let dir = root.join("mcp");
        std::fs::create_dir_all(&dir).unwrap();
        let sha = "a".repeat(64);
        std::fs::write(
            root.join("cbm-bundle.json"),
            format!(
                r#"{{"cbmVersion":"0.10.1","upstreamRepo":"x","releaseTag":"v0.10.1","binaries":[{{"asset":"a.tar.gz","assetSha256":"{sha}","binarySha256":"{sha}"}}]}}"#
            ),
        )
        .unwrap();
        let pin = read_pin(&dir).unwrap();
        assert_eq!(pin.cbm_version, "0.10.1");
        assert_eq!(pin.asset, "a.tar.gz");
        // zero entries -> None
        std::fs::write(
            root.join("cbm-bundle.json"),
            r#"{"cbmVersion":"9","releaseTag":"v9","binaries":[]}"#,
        )
        .unwrap();
        assert!(read_pin(&dir).is_none());
        // bad sha -> None
        std::fs::write(
            root.join("cbm-bundle.json"),
            r#"{"cbmVersion":"9","releaseTag":"v9","binaries":[{"asset":"a","assetSha256":"zz","binarySha256":"zz"}]}"#,
        )
        .unwrap();
        assert!(read_pin(&dir).is_none());
        // missing file -> None
        std::fs::remove_file(root.join("cbm-bundle.json")).unwrap();
        assert!(read_pin(&dir).is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_tool_snapshot_version_gate_and_collision_guard() {
        let root = tmp();
        let dir = root.join("mcp");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            root.join("cbm-tools.json"),
            r#"{"cbmVersion":"0.10.1","tools":[{"name":"search_graph","description":"d","inputSchema":{"type":"object"}},{"name":"hook_session_context","description":"x"},{"name":""}]}"#,
        )
        .unwrap();
        let tools = read_tool_snapshot(&dir, "0.10.1");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "search_graph");
        // version mismatch -> empty
        assert!(read_tool_snapshot(&dir, "9.9.9").is_empty());
        // missing -> empty
        std::fs::remove_file(root.join("cbm-tools.json")).unwrap();
        assert!(read_tool_snapshot(&dir, "0.10.1").is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn find_binaries_counts_only_named_files() {
        let root = tmp();
        std::fs::write(root.join("install.sh"), "x").unwrap();
        std::fs::write(root.join("codebase-memory-mcp"), "x").unwrap();
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("nested/codebase-memory-mcp"), "x").unwrap();
        assert_eq!(find_binaries(&root).len(), 2);
        std::fs::remove_file(root.join("nested/codebase-memory-mcp")).unwrap();
        assert_eq!(find_binaries(&root).len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn hash_file_matches_known_sha256() {
        let root = tmp();
        let f = root.join("f");
        let mut fh = std::fs::File::create(&f).unwrap();
        fh.write_all(b"abc").unwrap();
        drop(fh);
        assert_eq!(
            hash_file(&f).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
