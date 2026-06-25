// inproc-hooks.mjs — run context-mode's Claude Code hook WORK in-process against the
// vendored copy. No fd-0/stdout/exit: each fn takes `input`, returns the response object
// (the same JSON the vendored hook script would print), and performs capture as a side effect.
//
// PostToolUse / UserPromptSubmit both return null (no hookSpecificOutput) — the vendored
// bodies call runHook(async () => { ...capture... }) which writes nothing to stdout, so the
// old spawn delegate returned null on empty stdout. Parity = null.
//
// PreToolUse / PreCompact are stubs (→ null) until Task 4.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { contextModeEnv } from "./context-mode-env.mjs";

// Resolve a path inside the vendored hooks directory.
const H = (p) => fileURLToPath(new URL(`../bin/context-mode/hooks/${p}`, import.meta.url));

// ── Lazy SessionDB cache ──────────────────────────────────────────────────────
// Keyed by resolved dbPath so each unique project gets its own handle, and
// node --test (which runs all tests in one process) doesn't silently reuse a
// handle that points at a prior test's temp dir.
// We do NOT call db.close() per-event; the SessionDB bundle registers a
// process-exit checkpoint. The handle stays open for reuse across back-to-back
// PostToolUse events for the same project.
const _dbCache = new Map(); // dbPath → SessionDB instance

async function openDb(dbPath) {
  if (_dbCache.has(dbPath)) return _dbCache.get(dbPath);
  const { SessionDB } = await import(H("session-db.bundle.mjs"));
  const db = new SessionDB({ dbPath });
  _dbCache.set(dbPath, db);
  return db;
}

// ── Shared env setup ──────────────────────────────────────────────────────────
// The vendored hooks ran as CLI processes that inherited their cwd from the spawn
// env (contextModeEnv sets CONTEXT_MODE_DIR). In-process we MUST set the env vars
// explicitly before the session-helpers resolve paths, or the server's own cwd
// becomes the project root (silently wrong).
function applyInputEnv(input) {
  // Apply CONTEXT_MODE_DIR from the shared env helper (only when not already set).
  const env = contextModeEnv();
  if (env.CONTEXT_MODE_DIR && !process.env.CONTEXT_MODE_DIR) {
    process.env.CONTEXT_MODE_DIR = env.CONTEXT_MODE_DIR;
  }
  // Root the session DB to input.cwd so it matches what the CLI spawn would have
  // produced (the CLI was launched with cwd=input.cwd via the hook event).
  if (typeof input?.cwd === "string" && input.cwd) {
    process.env.CONTEXT_MODE_PROJECT_DIR = input.cwd;
    process.env.CLAUDE_PROJECT_DIR = input.cwd;
  }
}

// ── PostToolUse ───────────────────────────────────────────────────────────────
// Replicates bin/context-mode/hooks/posttooluse.mjs body (lines 34–184):
//   - resolves projectDir / sessionId via session-helpers
//   - calls extractEvents → attributeAndInsertEvents (main capture)
//   - handles the three tmpdir marker blocks (rejected / redirect / latency)
// Returns null (parity with the vendored body which writes nothing to stdout).
export async function postToolUse(input) {
  applyInputEnv(input);

  const { getSessionDBPath, getSessionId, getInputProjectDir } = await import(H("session-helpers.mjs"));
  const { createSessionLoaders, attributeAndInsertEvents } = await import(H("session-loaders.mjs"));

  const HOOK_DIR = fileURLToPath(new URL("../bin/context-mode/hooks", import.meta.url));
  const { loadSessionDB, loadExtract, loadProjectAttribution } = createSessionLoaders(HOOK_DIR);

  const projectDir = getInputProjectDir(input);
  const { extractEvents } = await loadExtract();
  const { resolveProjectAttributions } = await loadProjectAttribution();
  // SessionDB resolved via openDb() below (uses session-db.bundle.mjs directly);

  const dbPath = getSessionDBPath();
  const db = await openDb(dbPath);
  const sessionId = getSessionId(input);

  // Ensure session meta exists
  db.ensureSession(sessionId, projectDir);

  // Extract and store events (mirrors posttooluse.mjs lines 51–60)
  const events = extractEvents({
    tool_name: input.tool_name,
    tool_input: input.tool_input ?? {},
    tool_response: typeof input.tool_response === "string"
      ? input.tool_response
      : JSON.stringify(input.tool_response ?? ""),
    tool_output: input.tool_output,
  });

  attributeAndInsertEvents(db, sessionId, events, input, projectDir, "PostToolUse", resolveProjectAttributions);

  // ─── Category 18: Rejected-approach — read PreToolUse marker (lines 63–92) ───
  try {
    const rejectedPath = resolve(tmpdir(), `context-mode-rejected-${sessionId}.txt`);
    let rejectedData;
    try {
      rejectedData = readFileSync(rejectedPath, "utf-8").trim();
      unlinkSync(rejectedPath);
    } catch { /* no marker */ }
    if (rejectedData) {
      const colonIdx = rejectedData.indexOf(":");
      const rejTool = colonIdx > 0 ? rejectedData.slice(0, colonIdx) : rejectedData;
      const rejReason = colonIdx > 0 ? rejectedData.slice(colonIdx + 1) : "denied";
      attributeAndInsertEvents(
        db,
        sessionId,
        [{
          type: "rejected",
          category: "rejected-approach",
          data: `${rejTool}: ${rejReason}`,
          priority: 2,
        }],
        input,
        projectDir,
        "PreToolUse",
        resolveProjectAttributions,
      );
    }
  } catch { /* best-effort */ }

  // ─── D2 PRD Phase 3/4: redirect marker (lines 95–144) ───
  try {
    const redirectPath = resolve(tmpdir(), `context-mode-redirect-${sessionId}.txt`);
    let redirectData;
    try {
      redirectData = readFileSync(redirectPath, "utf-8").trim();
      unlinkSync(redirectPath);
    } catch { /* no marker — phantom-event guard */ }

    if (redirectData) {
      const i1 = redirectData.indexOf(":");
      const i2 = i1 >= 0 ? redirectData.indexOf(":", i1 + 1) : -1;
      const i3 = i2 >= 0 ? redirectData.indexOf(":", i2 + 1) : -1;
      if (i1 > 0 && i2 > i1 && i3 > i2) {
        const tool = redirectData.slice(0, i1);
        const type = redirectData.slice(i1 + 1, i2);
        const bytesRaw = redirectData.slice(i2 + 1, i3);
        const summary = redirectData.slice(i3 + 1);
        const bytesAvoided = Number.parseInt(bytesRaw, 10);
        if (Number.isFinite(bytesAvoided) && bytesAvoided > 0) {
          attributeAndInsertEvents(
            db,
            sessionId,
            [{
              type,
              category: "redirect",
              data: `${tool}: ${summary}`,
              priority: 2,
              bytes_avoided: bytesAvoided,
            }],
            input,
            projectDir,
            "PreToolUse",
            resolveProjectAttributions,
          );
        }
      }
    }
  } catch { /* best-effort — never block hook */ }

  // ─── Category 27: Latency — read cross-hook marker (lines 147–179) ───
  try {
    const toolName = input.tool_name ?? "";
    if (toolName) {
      const markerPath = resolve(tmpdir(), `context-mode-latency-${sessionId}-${toolName}.txt`);
      let startTime;
      try {
        startTime = parseInt(readFileSync(markerPath, "utf-8").trim(), 10);
        unlinkSync(markerPath);
      } catch { /* no marker */ }
      if (startTime && !isNaN(startTime)) {
        const duration = Date.now() - startTime;
        if (duration > 5000) {
          attributeAndInsertEvents(
            db,
            sessionId,
            [{
              type: "tool_latency",
              category: "latency",
              data: `${toolName}: ${duration}ms`,
              priority: 3,
            }],
            input,
            projectDir,
            "PostToolUse",
            resolveProjectAttributions,
          );
        }
      }
    }
  } catch { /* latency tracking is best-effort */ }

  // PostToolUse hooks don't need hookSpecificOutput — parity with vendored body
  return null;
}

// ── UserPromptSubmit ──────────────────────────────────────────────────────────
// Replicates bin/context-mode/hooks/userpromptsubmit.mjs body (lines 31–107):
//   - skips system-generated messages
//   - saves raw prompt + features
//   - extracts user events (decision/role/intent/data)
// Returns null (parity with the vendored body which writes nothing to stdout).
export async function userPromptSubmit(input) {
  applyInputEnv(input);

  const prompt = input.prompt ?? input.message ?? "";
  const trimmed = (prompt || "").trim();

  // Skip system-generated messages — only capture genuine user prompts
  const isSystemMessage = trimmed.startsWith("<task-notification>")
    || trimmed.startsWith("<system-reminder>")
    || trimmed.startsWith("<context_guidance>")
    || trimmed.startsWith("<tool-result>");

  if (trimmed.length > 0 && !isSystemMessage) {
    const { getSessionDBPath, getSessionId, getInputProjectDir } = await import(H("session-helpers.mjs"));
    const { createSessionLoaders, attributeAndInsertEvents } = await import(H("session-loaders.mjs"));

    const HOOK_DIR = fileURLToPath(new URL("../bin/context-mode/hooks", import.meta.url));
    const { loadSessionDB, loadExtract, loadProjectAttribution } = createSessionLoaders(HOOK_DIR);

    const projectDir = getInputProjectDir(input);
    // SessionDB resolved via openDb() below (uses session-db.bundle.mjs directly);
    const { extractUserEvents, extractUserPromptFeatures } = await loadExtract();
    const { resolveProjectAttributions } = await loadProjectAttribution();
    const dbPath = getSessionDBPath();
    const db = await openDb(dbPath);
    const sessionId = getSessionId(input);

    db.ensureSession(sessionId, projectDir);

    // 1. Always save the raw prompt with F1 §2 features attached (lines 56–71)
    const promptFeatures = typeof extractUserPromptFeatures === "function"
      ? extractUserPromptFeatures(trimmed)
      : {};
    const promptEvent = {
      type: "user_prompt",
      category: "user-prompt",
      data: prompt,
      priority: 1,
      ...promptFeatures,
    };
    const promptAttributions = attributeAndInsertEvents(
      db, sessionId, [promptEvent], input, projectDir, "UserPromptSubmit", resolveProjectAttributions,
    );

    // 2. Extract decision/role/intent/data from user message (lines 74–101)
    const userEvents = extractUserEvents(trimmed);
    const savedLastKnown = promptAttributions[0]?.projectDir || null;
    const sessionStats = db.getSessionStats(sessionId);
    const lastKnownProjectDir = typeof db.getLatestAttributedProjectDir === "function"
      ? db.getLatestAttributedProjectDir(sessionId)
      : null;
    const userAttributions = resolveProjectAttributions(userEvents, {
      sessionOriginDir: sessionStats?.project_dir || projectDir,
      inputProjectDir: projectDir,
      workspaceRoots: Array.isArray(input.workspace_roots) ? input.workspace_roots : [],
      lastKnownProjectDir: savedLastKnown || lastKnownProjectDir,
    });
    if (userEvents.length > 0) {
      attributeAndInsertEvents(
        db,
        sessionId,
        userEvents,
        input,
        projectDir,
        "UserPromptSubmit",
        resolveProjectAttributions,
      );
    }
  }

  // UserPromptSubmit hooks don't need hookSpecificOutput — parity with vendored body
  return null;
}

// ── PreToolUse ──────────────────────────────────────────────────────────────────
// Replicates the ROUTING + marker-write portion of bin/context-mode/hooks/pretooluse.mjs
// (lines 157–222). DELIBERATELY SKIPS the self-heal/self-install block (lines 44–155):
// that mutates the user's installed_plugins.json / settings.json to point at context-mode
// and is gated to context-mode's own plugin-cache dir — wrong + harmful to run from
// cave-context (which vendors context-mode and has its own hooks/settings).
// Capture is done via tmpdir marker files that postToolUse() reads (same indirection as
// the vendored body — PreToolUse deliberately does not touch the DB directly), so the
// captured-data behavior is byte-identical. Returns the formatted routing decision (which
// handlers.mjs surfaces via fromDelegate); null when routing has no decision.
let _securityInited = false;
export async function preToolUse(input) {
  applyInputEnv(input);

  const { routePreToolUse, initSecurity } = await import(H("core/routing.mjs"));
  const { formatDecision } = await import(H("core/formatters.mjs"));
  const { getSessionId } = await import(H("session-helpers.mjs"));

  // Initialise the security classifier from the vendored build/ (once per process).
  if (!_securityInited) {
    try {
      const buildDir = fileURLToPath(new URL("../bin/context-mode/build", import.meta.url));
      await initSecurity(buildDir);
    } catch { /* best-effort — routing still functions without the classifier */ }
    _securityInited = true;
  }

  const tool = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};
  const sessionId = getSessionId(input);

  const decision = routePreToolUse(tool, toolInput, process.env.CLAUDE_PROJECT_DIR, "claude-code", sessionId);
  const response = formatDecision("claude-code", decision);

  // Latency-start marker (Category 27) — postToolUse() reads it to compute duration.
  try {
    if (tool) {
      const markerPath = resolve(tmpdir(), `context-mode-latency-${sessionId}-${tool}.txt`);
      writeFileSync(markerPath, String(Date.now()), "utf-8");
    }
  } catch { /* best-effort — never block hook */ }

  // Rejected-approach marker — postToolUse() turns it into a category=rejected-approach event.
  if (decision && (decision.action === "deny" || decision.action === "modify")) {
    try {
      const reason = decision.action === "deny" ? (decision.reason || "denied") : "Redirected to context-mode sandbox";
      const markerPath = resolve(tmpdir(), `context-mode-rejected-${sessionId}.txt`);
      writeFileSync(markerPath, `${tool}:${reason}`, "utf-8");
    } catch { /* best-effort — never block hook */ }
  }

  // Redirect marker (D2 byte-accounting) — postToolUse() emits a category=redirect event.
  if (decision && decision.redirectMeta) {
    try {
      const meta = decision.redirectMeta;
      const summary = String(meta.commandSummary ?? "").slice(0, 200);
      const markerPath = resolve(tmpdir(), `context-mode-redirect-${sessionId}.txt`);
      // tool:type:bytesAvoided:commandSummary — summary may contain ':' (URLs); postToolUse
      // parses only the first 3 colons and treats the rest as data.
      writeFileSync(markerPath, `${meta.tool}:${meta.type}:${meta.bytesAvoided}:${summary}`, "utf-8");
    } catch { /* best-effort — never block hook */ }
  }

  // Parity: the vendored body writes JSON only when response !== null.
  return response ?? null;
}

// ── PreCompact ──────────────────────────────────────────────────────────────────
// Replicates bin/context-mode/hooks/precompact.mjs body (lines 33–99): build a
// priority-sorted resume snapshot from captured events, persist it (upsertResume +
// incrementCompactCount), and record compaction lifecycle events. Uses the shared cached
// SessionDB handle (no per-call close, unlike the vendored body — the handle is reused and
// the bundle's process-exit checkpoint flushes WAL). Returns {} (parity with the body's
// `console.log(JSON.stringify({}))`).
export async function preCompact(input) {
  applyInputEnv(input);

  const { getSessionDBPath, getSessionId, getInputProjectDir } = await import(H("session-helpers.mjs"));
  const { createSessionLoaders, attributeAndInsertEvents } = await import(H("session-loaders.mjs"));

  const HOOK_DIR = fileURLToPath(new URL("../bin/context-mode/hooks", import.meta.url));
  const { loadSnapshot, loadProjectAttribution } = createSessionLoaders(HOOK_DIR);

  const dbPath = getSessionDBPath();
  const db = await openDb(dbPath);
  const sessionId = getSessionId(input);

  const events = db.getEvents(sessionId);
  if (events.length > 0) {
    const { buildResumeSnapshot } = await loadSnapshot();
    const stats = db.getSessionStats(sessionId);
    const snapshot = buildResumeSnapshot(events, { compactCount: (stats?.compact_count ?? 0) + 1 });

    db.upsertResume(sessionId, snapshot, events.length);
    db.incrementCompactCount(sessionId);

    // Route compaction lifecycle events (dashboard compact widget joins on category='compaction').
    try {
      const fileEvents = events.filter((e) => e.category === "file");
      const projectDirCompact = getInputProjectDir(input);
      const { resolveProjectAttributions } = await loadProjectAttribution();
      attributeAndInsertEvents(
        db,
        sessionId,
        [
          {
            type: "compaction_summary",
            category: "compaction",
            data: `Session compacted. ${events.length} events, ${fileEvents.length} files touched.`,
            priority: 1,
          },
          {
            type: "snapshot-built",
            category: "compaction",
            data: `Snapshot built. ${snapshot.length} bytes for ${events.length} events.`,
            priority: 1,
            bytes_avoided: snapshot.length,
          },
        ],
        input,
        projectDirCompact,
        "PreCompact",
        resolveProjectAttributions,
      );
    } catch { /* best-effort — never block PreCompact */ }
  }

  // Parity with the vendored body: writes JSON.stringify({}).
  return {};
}
