#!/usr/bin/env node
// mcp/server.mjs — linux-token-efficiency: proxy MCP server for codebase-memory-mcp (cbm).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node, mode 100755, node-only,
// no wrapper). Transport: newline-delimited JSON-RPC 2.0. stdout carries JSON-RPC frames
// EXCLUSIVELY; every diagnostic goes to stderr.
//
// What it is: the single `codebase-memory` server. It answers initialize/ping/tools/list
// itself (never blocking on I/O), serves four purpose-built hook tools, and forwards every
// other tools/call verbatim to the real cbm binary, which it spawns once (no args => cbm's
// own MCP stdio mode) and keeps warm. Tool names are never renamed, so Claude keeps seeing
// mcp__codebase-memory__<upstream tool>.
//
// It is the ONLY component permitted to download or extract the pinned upstream binary
// (asset + extracted binary both sha256-verified against cbm-bundle.json before anything
// enters the cache, populated by atomic rename only). It NEVER sets CBM_CACHE_DIR — that is
// cbm's own graph-database root; the plugin owns only CBM_BUNDLE_CACHE.
import process from "node:process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accessSync, chmodSync, constants as fsConstants, createReadStream, createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  SYMBOL_LIMIT,
  isCbmEnabled,
  resolveBundleCache,
  resolveProjectCacheDir,
  readProjectCache,
  writeProjectCache,
  unwrapToolResult,
  pickProjectEntry,
  graphQueryFromToolInput,
  formatSessionContext,
  formatSubagentContext,
  formatSymbolContext,
  formatCoverageContext,
  relativeToProject,
  buildOutput,
  usablePath,
} from "./cbm-context.mjs";

const SERVER_NAME = "codebase-memory"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // what the pinned v0.10.1 binary itself reports
const BINARY_NAME = "codebase-memory-mcp";
/** Per-child-call bound for hook tools: two of these plus margin is hooks.json's timeout 12. */
const HOOK_CALL_TIMEOUT_MS = 4000;
/** One bounded download attempt per server process — no retry storm on an offline host. */
const DOWNLOAD_TIMEOUT_MS = 300000;
const CHILD_MAX_RESTARTS = 3;
/** Identical name, shape and default as update-cbm-bundle.sh: the value already contains
 *  the repo path and the releases/download segment, and is joined as
 *  ${base}/${releaseTag}/${asset}. Never reconstructed from a bare host. */
const DEFAULT_DOWNLOAD_BASE_URL = "https://github.com/DeusData/codebase-memory-mcp/releases/download";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} message @returns {void} */
function log(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/** @param {any} error @returns {string} */
function describe(error) {
  return String(error && error.message ? error.message : error);
}

// ---------------------------------------------------------------- pin and tool snapshot

/**
 * The machine-owned version pin. Exactly one binaries[] entry is required — 0 or >1 is a
 * fail-closed startup error, mirroring the deleted shell-script launcher's "exactly one entry" rule.
 * @returns {{cbmVersion: string, releaseTag: string, asset: string, assetSha256: string, binarySha256: string}|null}
 */
function readPin() {
  const file = path.join(SERVER_DIR, "..", "cbm-bundle.json");
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    log(`unusable cbm-bundle.json (${file}): ${describe(e)}`);
    return null;
  }
  const binaries = Array.isArray(parsed?.binaries) ? parsed.binaries : [];
  if (binaries.length !== 1) {
    log(`cbm-bundle.json must list exactly one binaries[] entry, found ${binaries.length}`);
    return null;
  }
  const entry = binaries[0] ?? {};
  const pin = {
    cbmVersion: typeof parsed?.cbmVersion === "string" ? parsed.cbmVersion : "",
    releaseTag: typeof parsed?.releaseTag === "string" ? parsed.releaseTag : "",
    asset: typeof entry.asset === "string" ? entry.asset : "",
    assetSha256: typeof entry.assetSha256 === "string" ? entry.assetSha256 : "",
    binarySha256: typeof entry.binarySha256 === "string" ? entry.binarySha256 : "",
  };
  if (pin.cbmVersion === "" || pin.releaseTag === "" || pin.asset === "" || !/^[0-9a-f]{64}$/.test(pin.assetSha256) || !/^[0-9a-f]{64}$/.test(pin.binarySha256)) {
    log("cbm-bundle.json is missing cbmVersion/releaseTag/asset/assetSha256/binarySha256");
    return null;
  }
  return pin;
}

// This proxy's own tool names — the single source of truth for the collision guard in
// readToolSnapshot() below, and reused verbatim as each HOOK_TOOLS entry's `name` further
// down. Never re-derive via a naming convention (e.g. a "hook_" prefix check).
const HOOK_SESSION_CONTEXT_NAME = "hook_session_context";
const HOOK_SUBAGENT_CONTEXT_NAME = "hook_subagent_context";
const HOOK_SYMBOL_CONTEXT_NAME = "hook_symbol_context";
const HOOK_COVERAGE_CONTEXT_NAME = "hook_coverage_context";
const HOOK_TOOL_NAMES = [HOOK_SESSION_CONTEXT_NAME, HOOK_SUBAGENT_CONTEXT_NAME, HOOK_SYMBOL_CONTEXT_NAME, HOOK_COVERAGE_CONTEXT_NAME];

/**
 * The committed upstream tool-list snapshot, pinned to the same release as the binary. A
 * missing, unparsable or version-mismatched snapshot degrades to hook tools only — never a
 * startup failure, because call-time forwarding is name-agnostic anyway.
 * @param {string} cbmVersion
 * @returns {{name: string, description: string, inputSchema: any}[]}
 */
function readToolSnapshot(cbmVersion) {
  const file = path.join(SERVER_DIR, "..", "cbm-tools.json");
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    log(`unusable cbm-tools.json (${file}): ${describe(e)}; advertising hook tools only`);
    return [];
  }
  if (parsed?.cbmVersion !== cbmVersion) {
    log(`cbm-tools.json pins ${String(parsed?.cbmVersion)} but cbm-bundle.json pins ${cbmVersion}; advertising hook tools only`);
    return [];
  }
  const tools = Array.isArray(parsed?.tools) ? parsed.tools : [];
  /** @type {{name: string, description: string, inputSchema: any}[]} */
  const out = [];
  for (const tool of tools) {
    const name = typeof tool?.name === "string" ? tool.name : "";
    if (name === "") continue;
    if (HOOK_TOOL_NAMES.includes(name)) {
      // Collision guard: this name belongs to one of this proxy's own hook tools.
      log(`cbm-tools.json advertises a name that collides with a hook tool (${name}); dropping it`);
      continue;
    }
    out.push({
      name,
      description: typeof tool?.description === "string" ? tool.description : name,
      inputSchema: tool?.inputSchema ?? {
        type: "object",
        additionalProperties: true,
      },
    });
  }
  return out;
}

// -------------------------------------------------------------------- startup guards

if (!isCbmEnabled(process.env.CLAUDE_PLUGIN_OPTION_CBM_ENABLED)) {
  log("disabled by the cbm_enabled plugin option; not starting codebase-memory-mcp");
  process.exit(0);
}
if (os.platform() !== "linux" || os.arch() !== "x64") {
  log(`codebase-memory-mcp is Linux x86_64 only (host: ${os.platform()}/${os.arch()})`);
  process.exit(0);
}
const MAYBE_PIN = readPin();
if (MAYBE_PIN === null) process.exit(0);
// process.exit() is typed `any` here (no @types/node), so tsc cannot narrow MAYBE_PIN on
// its own — the cast records what the guard above already proved.
const PIN = /** @type {NonNullable<typeof MAYBE_PIN>} */ (MAYBE_PIN);
const PASSTHROUGH_TOOLS = readToolSnapshot(PIN.cbmVersion);

// ------------------------------------------------------------------- binary provisioning

/** @type {Promise<boolean>|null} */
let binaryPromise = null;
/** Only ever true after both hashes verified and the atomic rename landed. */
let binaryReady = false;

/** @returns {string} */
function cachedBinaryPath() {
  return path.join(resolveBundleCache(process.env), PIN.binarySha256.slice(0, 16), BINARY_NAME);
}

/**
 * Idempotent, memoized to a single promise per process. At most ONE download attempt per
 * process: a failure marks not-ready permanently here, and reconnecting the server (a new
 * process) is the retry.
 * @returns {Promise<boolean>}
 */
function ensureBinary() {
  if (binaryPromise === null) {
    binaryPromise = prepareBinary()
      .then((ok) => {
        binaryReady = ok;
        return ok;
      })
      .catch((e) => {
        log(`binary preparation failed: ${describe(e)}`);
        binaryReady = false;
        return false;
      });
  }
  return binaryPromise;
}

/** @param {string} file @returns {Promise<string>} */
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** @param {string} url @param {string} dest @returns {Promise<string>} */
async function downloadToFile(url, dest) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || response.body === null) throw new Error(`download failed (${response.status}): ${url}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (/** @type {any} */ source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(dest),
  );
  return hash.digest("hex");
}

/**
 * Every `codebase-memory-mcp` file under `dir` — the archive also ships install.sh,
 * LICENSE and THIRD_PARTY_NOTICES.md, and 0 or >1 matches must fail closed.
 * @param {string} dir
 * @returns {string[]}
 */
function findBinaries(dir) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} current @returns {void} */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === BINARY_NAME) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** @returns {Promise<boolean>} */
async function prepareBinary() {
  const target = cachedBinaryPath();
  try {
    // Fast path: the path is derived from the verified hash and only ever created after
    // verification, so a warm start never re-hashes 279.6 MiB.
    accessSync(target, fsConstants.X_OK);
    return true;
  } catch {
    // cold cache — fall through to the download path
  }
  const cacheRoot = resolveBundleCache(process.env);
  mkdirSync(cacheRoot, { recursive: true });
  const tmp = mkdtempSync(path.join(cacheRoot, ".tmp."));
  try {
    const base = process.env.CBM_DOWNLOAD_BASE_URL || DEFAULT_DOWNLOAD_BASE_URL;
    const url = `${base}/${PIN.releaseTag}/${PIN.asset}`;
    const archive = path.join(tmp, PIN.asset);
    log(`fetching ${url}`);
    const assetSha = await downloadToFile(url, archive);
    if (assetSha !== PIN.assetSha256) {
      log(`asset sha256 mismatch for ${PIN.asset}; refusing to extract`);
      return false;
    }
    try {
      execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "ignore" });
    } catch (e) {
      log(`failed to extract ${PIN.asset}: ${describe(e)}`);
      return false;
    }
    const found = findBinaries(tmp);
    if (found.length !== 1) {
      log(`expected exactly one ${BINARY_NAME} inside ${PIN.asset}, found ${found.length}`);
      return false;
    }
    chmodSync(found[0], 0o755);
    if ((await hashFile(found[0])) !== PIN.binarySha256) {
      log("extracted binary does not match the pin; nothing cached");
      return false;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    // Atomic inside the cache root, so two racing servers converge on the identical
    // verified file.
    renameSync(found[0], target);
    log(`prepared ${target}`);
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------- warm cbm MCP child

/** @typedef {{proc: any, pending: Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>}} ChildConn */

/** @type {ChildConn|null} */
let child = null;
/** @type {Promise<ChildConn>|null} */
let childPromise = null;
let childStarts = 0;
let nextChildId = 1;

/**
 * One tools/call-shaped request to the child. Ids are ALWAYS the proxy's own; the harness's
 * id is restored by the caller. timeoutMs <= 0 means no timeout (passthrough).
 * @param {ChildConn} conn @param {string} method @param {any} params @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function sendChild(conn, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextChildId;
    nextChildId += 1;
    /** @type {any} */
    let timer = null;
    const settle = {
      /** @param {any} value @returns {void} */
      resolve: (value) => {
        if (timer !== null) clearTimeout(timer);
        resolve(value);
      },
      /** @param {Error} error @returns {void} */
      reject: (error) => {
        if (timer !== null) clearTimeout(timer);
        reject(error);
      },
    };
    conn.pending.set(id, settle);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`child timeout after ${timeoutMs} ms on ${method}`));
      }, timeoutMs);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
    try {
      conn.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    } catch (e) {
      conn.pending.delete(id);
      settle.reject(new Error(`child write failed: ${describe(e)}`));
    }
  });
}

/** @param {ChildConn} conn @param {string} method @returns {void} */
function notifyChild(conn, method) {
  try {
    conn.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  } catch (e) {
    log(`child notify failed: ${describe(e)}`);
  }
}

/** @returns {Promise<ChildConn>} */
async function startChild() {
  const ready = await ensureBinary();
  if (!ready) throw new Error("pinned binary unavailable");
  if (childStarts >= CHILD_MAX_RESTARTS) throw new Error("child restart budget exhausted");
  childStarts += 1;
  // No CBM_CACHE_DIR (cbm's own graph root stays upstream's default) and no reinterpretation
  // of CBM_BUNDLE_CACHE for the child: it is ours, not cbm's.
  const proc = spawn(cachedBinaryPath(), [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  /** @type {ChildConn} */
  const conn = { proc, pending: new Map() };
  // A write to a closed/crashed child's stdin fails asynchronously with EPIPE, not
  // synchronously — without this listener Node treats it as an unhandled 'error' and crashes
  // the whole proxy process. sendChild()/notifyChild()'s try/catch only covers the synchronous
  // write() call itself.
  proc.stdin.on("error", (/** @type {any} */ e) => log(`child stdin error: ${describe(e)}`));
  proc.stderr.on("data", (/** @type {any} */ chunk) => process.stderr.write(chunk));
  const childRl = readline.createInterface({ input: proc.stdout });
  childRl.on("line", (/** @type {string} */ line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // the child's stdout is parsed, never echoed
    }
    if (typeof msg?.id !== "number") return;
    const waiter = conn.pending.get(msg.id);
    if (waiter === undefined) return;
    conn.pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(typeof msg.error?.message === "string" ? msg.error.message : "child returned an error"));
    else waiter.resolve(msg.result);
  });
  /** @param {string} reason @returns {void} */
  const abandon = (reason) => {
    for (const waiter of conn.pending.values()) waiter.reject(new Error(reason));
    conn.pending.clear();
    if (child === conn) child = null;
    childPromise = null;
  };
  proc.on("exit", (/** @type {any} */ code, /** @type {any} */ signal) => {
    log(`child exited (code=${String(code)} signal=${String(signal)})`);
    abandon("child exited");
  });
  proc.on("error", (/** @type {any} */ e) => {
    log(`child spawn error: ${describe(e)}`);
    abandon("child spawn error");
  });
  child = conn;
  try {
    await sendChild(
      conn,
      "initialize",
      {
        protocolVersion: DEFAULT_PROTOCOL,
        capabilities: {},
        clientInfo: { name: SERVER_NAME, version: SERVER_INFO.version },
      },
      HOOK_CALL_TIMEOUT_MS * 2,
    );
  } catch (e) {
    // The handshake itself timed out/rejected: the spawned process is otherwise never
    // cleaned up (its 'exit'/'error' handlers only fire on its own termination), so it
    // would leak as an orphaned process for the lifetime of the parent server otherwise.
    abandon("child initialize failed");
    proc.kill();
    throw e;
  }
  notifyChild(conn, "notifications/initialized");
  return conn;
}

/** @returns {Promise<ChildConn>} */
function getChild() {
  if (childPromise === null) {
    childPromise = startChild().catch((e) => {
      childPromise = null;
      throw e;
    });
  }
  return childPromise;
}

/** @param {string} name @param {any} args @param {number} timeoutMs @returns {Promise<any>} */
async function callChild(name, args, timeoutMs) {
  const conn = await getChild();
  return await sendChild(conn, "tools/call", { name, arguments: args ?? {} }, timeoutMs);
}

// ------------------------------------------------------------------------- hook tools

/**
 * Defence in depth (the process already exited if disabled) plus the never-wait rule: a
 * download still in flight means silence, never a stalled hook.
 * @returns {boolean}
 */
function hookReady() {
  if (!isCbmEnabled(process.env.CLAUDE_PLUGIN_OPTION_CBM_ENABLED)) return false;
  return binaryReady === true;
}

/** @param {any} args @returns {string|null} */
function hookCwd(args) {
  const cwd = typeof args?.cwd === "string" ? args.cwd : "";
  return usablePath(cwd) ? cwd.trim() : null;
}

/**
 * The graph project covering `cwd`, from the on-disk per-cwd cache (10-minute TTL) or one
 * list_projects read. The cache survives server restarts, so no in-memory layer is added.
 * @param {string} cwd
 * @returns {Promise<{name: string, root: string}|null>}
 */
async function resolveProject(cwd) {
  const cacheDir = resolveProjectCacheDir(process.env);
  const cached = readProjectCache(cacheDir, cwd);
  if (cached !== null) return cached;
  const entry = pickProjectEntry(unwrapToolResult(await callChild("list_projects", {}, HOOK_CALL_TIMEOUT_MS)), cwd);
  if (entry === null) return null;
  writeProjectCache(cacheDir, cwd, entry);
  return entry;
}

/**
 * The shared preamble every hook tool starts with: bail (fail-open, `{}`-shaped by the
 * caller) unless cbm is ready, `cwd` is a usable path, and it resolves to a known graph
 * project. Factored out so a future guard-order change only has to be made once.
 * @param {any} args
 * @returns {Promise<{cwd: string, project: {name: string, root: string}}|null>}
 */
async function resolveHookProject(args) {
  if (!hookReady()) return null;
  const cwd = hookCwd(args);
  if (cwd === null) return null;
  const project = await resolveProject(cwd);
  if (project === null) return null;
  return { cwd, project };
}

/** @param {any} args @param {"SessionStart"|"SubagentStart"} event @returns {Promise<HookResult>} */
async function projectStatusHandler(args, event) {
  const resolved = await resolveHookProject(args);
  if (resolved === null) return {};
  const { project } = resolved;
  const status = unwrapToolResult(await callChild("index_status", { project: project.name }, HOOK_CALL_TIMEOUT_MS));
  const context = event === "SessionStart" ? formatSessionContext(project.name, status) : formatSubagentContext(project.name, status);
  if (context === null || context === "") return {};
  return buildOutput(event, context);
}

/** @param {any} args @returns {Promise<HookResult>} */
async function symbolContextHandler(args) {
  if (!hookReady()) return {};
  const cwd = hookCwd(args);
  if (cwd === null) return {};
  const query = graphQueryFromToolInput(typeof args?.tool_name === "string" ? args.tool_name : "", args?.tool_input);
  if (query === null) return {};
  const project = await resolveProject(cwd);
  if (project === null) return {};
  /** @type {Record<string, unknown>} */
  const callArgs = { project: project.name, limit: SYMBOL_LIMIT, format: "json" };
  callArgs[query.arg] = query.value;
  const found = unwrapToolResult(await callChild("search_graph", callArgs, HOOK_CALL_TIMEOUT_MS));
  const context = formatSymbolContext(found, SYMBOL_LIMIT);
  if (context === null || context === "") return {};
  return buildOutput("PreToolUse", context);
}

/** @param {any} args @returns {Promise<HookResult>} */
async function coverageContextHandler(args) {
  const resolved = await resolveHookProject(args);
  if (resolved === null) return {};
  const { cwd, project } = resolved;
  const raw = typeof args?.tool_input?.file_path === "string" ? args.tool_input.file_path.trim() : "";
  if (!usablePath(raw)) return {};
  const relative = relativeToProject(project.root, raw, cwd);
  if (relative === null) return {};
  const coverage = unwrapToolResult(await callChild("check_index_coverage", { project: project.name, paths: [relative] }, HOOK_CALL_TIMEOUT_MS));
  const context = formatCoverageContext(coverage, relative);
  if (context === null || context === "") return {};
  return buildOutput("PostToolUse", context);
}

// hookEventName is hardcoded per tool (one tool per event) rather than substituted, so it
// can never be wrong. Every failure path returns {} — never isError, never a decision.
const HOOK_TOOLS = [
  {
    name: HOOK_SESSION_CONTEXT_NAME,
    description: "SessionStart hook: inject the codebase-memory graph project covering this repository and its index state.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["cwd"],
      properties: { cwd: { type: "string" } },
    },
    /** @param {any} args @returns {Promise<HookResult>} */
    handler: (args) => projectStatusHandler(args, "SessionStart"),
  },
  {
    name: HOOK_SUBAGENT_CONTEXT_NAME,
    description: "SubagentStart hook: inject the codebase-memory graph project and index state for a delegated agent.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["cwd"],
      properties: { cwd: { type: "string" } },
    },
    /** @param {any} args @returns {Promise<HookResult>} */
    handler: (args) => projectStatusHandler(args, "SubagentStart"),
  },
  {
    name: HOOK_SYMBOL_CONTEXT_NAME,
    description: "PreToolUse(Grep|Glob) hook: inject matching graph symbols for the search pattern.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["cwd"],
      properties: {
        cwd: { type: "string" },
        tool_name: { type: "string" },
        tool_input: {
          type: "object",
          properties: { pattern: { type: "string" } },
          additionalProperties: true,
        },
      },
    },
    /** @param {any} args @returns {Promise<HookResult>} */
    handler: (args) => symbolContextHandler(args),
  },
  {
    name: HOOK_COVERAGE_CONTEXT_NAME,
    description: "PostToolUse(Read) hook: warn when the graph's coverage of the read file is incomplete.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["cwd"],
      properties: {
        cwd: { type: "string" },
        tool_input: {
          type: "object",
          properties: { file_path: { type: "string" } },
          additionalProperties: true,
        },
      },
    },
    /** @param {any} args @returns {Promise<HookResult>} */
    handler: (args) => coverageContextHandler(args),
  },
];

// ------------------------------------------------------------------------ JSON-RPC loop

/** @param {any} msg @returns {void} */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
/** @param {any} id @param {any} result @returns {void} */
function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
/** @param {any} id @param {number} code @param {string} message @returns {void} */
function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

/** @param {any} id @param {any} params @returns {Promise<void>} */
async function handleToolCall(id, params) {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = params?.arguments ?? {};
  if (process.env.MCP_HOOK_DEBUG) log(`tools/call ${name} args=${JSON.stringify(args)}`);
  const hook = HOOK_TOOLS.find((tool) => tool.name === name);
  if (hook !== undefined) {
    /** @type {HookResult} */
    let result;
    try {
      result = await hook.handler(args);
    } catch (e) {
      log(`${name} failed: ${describe(e)}`); // a hook failure is silence, never an error
      result = {};
    }
    return ok(id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  }
  if (name === "") return fail(id, -32602, "tools/call requires a tool name");
  try {
    // Forward verbatim; the child is the source of truth at call time, so the name need
    // not appear in the snapshot. isError/content/structuredContent reach Claude unchanged.
    return ok(id, await callChild(name, args, 0));
  } catch (e) {
    // A model-initiated call deserves a visible error, unlike a hook.
    return ok(id, {
      content: [{ type: "text", text: `codebase-memory unavailable: ${describe(e)}` }],
      isError: true,
    });
  }
}

/** @param {any} msg @returns {Promise<void>} */
async function handle(msg) {
  const { id, method, params } = msg ?? {};
  switch (method) {
    case "initialize":
      // Tools only: the child's capabilities are deliberately not mirrored, so the harness
      // never asks us for resources/prompts we do not proxy.
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: [
          ...HOOK_TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
          ...PASSTHROUGH_TOOLS,
        ],
      });
    case "tools/call":
      return await handleToolCall(id, params);
    default:
      if (id === undefined) return;
      return fail(id, -32601, `method not found: ${String(method)}`);
  }
}

/** @returns {void} */
function startServer() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (/** @type {string} */ line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log("non-JSON line ignored");
      return;
    }
    handle(msg).catch((e) => {
      log(`handler crash: ${describe(e)}`);
      if (msg?.id !== undefined) fail(msg.id, -32603, `internal error: ${describe(e)}`);
    });
  });
  rl.on("close", () => process.exit(0));
}

// The readline loop comes up FIRST so initialize answers immediately, then the first-run
// download is fired without awaiting — the same latency placement the launcher had for
// extraction. The warm path resolves before any stdin line is processed (it returns before
// its first await), so a warm cache is ready for the very first hook call.
startServer();
void ensureBinary();
