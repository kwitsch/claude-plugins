#!/usr/bin/env node
// refresh.mjs — deterministic plumbing for the update-cc-references skill.
// Subcommands:
//   plan [<target>] [<scratch>]   resolve target files from sources.json, curl every mapped doc
//                                 (<url>.md, HTML check, one altUrls retry), write plan.json + workflow.js
//   gate <scratch> <name>         revert unsourced-version hunks, label line-changing hunks for the validator
//   finish <scratch> <name> [--keep h1,h2]  authoritative, fail-closed: revert every line-changing hunk not
//                                 kept, then stamp the verified date or restore the file from HEAD
//   release <scratch>             guarded patch bump, description date suffix
// Writes: <scratch>/{plan.json,workflow.js,docs/,diffs/}, the target reference files,
// plugins/cc-knowledge/.claude-plugin/plugin.json and test/cc-knowledge/test.bats.
// Fail-closed: an unverified line change never survives finish.
// stdout carries exactly one JSON object; diagnostics go to stderr.
// Exit codes: 0 ok, 1 usage/invalid input, 2 fetch failure, 3 git failure.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = ["skills", "agents", "hooks", "commands", "mcp", "plugins", "memory", "settings", "all"];
const DATE_RE = /(verified:?\s+)(\d{4}-\d{2}-\d{2})/i;
const VERSION_RE = /\bv?\d+\.\d+\.\d+\b/g;
const HTML_RE = /^\s*<(!doctype|html)/i;

let SOURCES;

class Exit extends Error {
  constructor(code, payload) {
    super(String(payload.error));
    this.code = code;
    this.payload = payload;
  }
}

function fail(code, error, extra = {}) {
  throw new Exit(code, { ok: false, error, ...extra });
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  return { status: typeof r.status === "number" ? r.status : 1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function git(args, cwd) {
  const r = run("git", args, { cwd });
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    fail(3, `git ${args[0]} failed (exit ${r.status})`);
  }
  return r.stdout;
}

function repoRoot() {
  const r = run("git", ["rev-parse", "--show-toplevel"]);
  if (r.status !== 0) fail(1, "not inside a git repository");
  return r.stdout.trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function docPath(scratch, url) {
  const u = new URL(url);
  return join(scratch, "docs", `${u.host}${u.pathname.replace(/\//g, "_")}.md`);
}

// true = clean markdown landed at `out`; false = curl failure, empty file or HTML fallback page.
function fetchDoc(url, out) {
  const r = run("curl", ["-sSL", "--fail", "--connect-timeout", "10", "--max-time", "60", "-o", out, `${url}.md`]);
  if (r.status !== 0) {
    process.stderr.write(`curl ${url}.md failed (exit ${r.status}) ${r.stderr}\n`);
    return false;
  }
  const text = readFileSync(out, "utf8");
  if (text.length === 0) return false;
  if (HTML_RE.test(text.split("\n", 1)[0])) {
    process.stderr.write(`curl ${url}.md returned HTML, not markdown\n`);
    return false;
  }
  return true;
}

function cmdPlan(args) {
  const target = args[0] || "all";
  if (!TARGETS.includes(target)) fail(1, `unknown target: ${target} (expected one of ${TARGETS.join(" ")})`);
  const root = repoRoot();
  let scratch;
  if (args[1]) scratch = resolve(args[1]);
  else if (process.env.CLAUDE_JOB_DIR) scratch = join(process.env.CLAUDE_JOB_DIR, "tmp", "docs");
  else scratch = mkdtempSync(join(tmpdir(), "update-cc-references-"));
  mkdirSync(join(scratch, "docs"), { recursive: true });
  mkdirSync(join(scratch, "diffs"), { recursive: true });

  const files = [...new Set(target === "all" ? Object.values(SOURCES.targets).flat() : SOURCES.targets[target])];
  for (const f of files) if (!SOURCES.files[f]) fail(1, `sources.json has no files entry for ${f}`);
  const urls = [...new Set(files.flatMap((f) => SOURCES.files[f].docs))];
  const failed = [];
  for (const url of urls) {
    const out = docPath(scratch, url);
    if (fetchDoc(url, out)) continue;
    const alt = SOURCES.altUrls[url];
    if (alt && fetchDoc(alt, out)) continue;
    failed.push(url);
  }
  if (failed.length) fail(2, "doc fetch failed", { failed });

  const plan = {
    date: today(),
    scratch,
    repoRoot: root,
    script: fileURLToPath(import.meta.url),
    targets: files.map((f) => ({
      name: f.replace(/\.md$/, ""),
      file: join(root, SOURCES.refsDir, f),
      docs: SOURCES.files[f].docs.map((url) => ({ url, path: docPath(scratch, url) })),
      note: SOURCES.files[f].note,
    })),
  };
  writeFileSync(join(scratch, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  const template = readFileSync(new URL("./workflow.template.js", import.meta.url), "utf8");
  const workflowScript = join(scratch, "workflow.js");
  writeFileSync(workflowScript, template.replace("__PLAN__", () => JSON.stringify(plan)));
  return { ok: true, scratch, date: plan.date, targets: plan.targets.map((t) => t.name), workflowScript };
}

function loadPlan(scratch) {
  if (!scratch) fail(1, "missing <scratch> argument");
  const p = join(resolve(scratch), "plan.json");
  if (!existsSync(p)) fail(1, `missing ${p} (run plan first)`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function findTarget(plan, name) {
  const t = plan.targets.find((x) => x.name === name);
  if (!t) fail(1, `unknown name: ${name}`);
  return t;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// x.y.z tokens of the given lines, leading "v" stripped.
function versions(lines) {
  return lines.flatMap((l) => l.match(VERSION_RE) || []).map((v) => v.replace(/^v/, ""));
}

// `git diff -U0 HEAD -- <file>` split into header lines and hunks { head, body, removed, added }.
function diffFile(plan, t) {
  const out = git(["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U0", "HEAD", "--", t.file], plan.repoRoot);
  const lines = out.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const header = [];
  const hunks = [];
  for (const line of lines) {
    if (line.startsWith("@@")) hunks.push({ head: line, body: [] });
    else if (hunks.length) hunks.at(-1).body.push(line);
    else header.push(line);
  }
  for (const h of hunks) {
    h.removed = h.body.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
    h.added = h.body.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  }
  return { header, hunks };
}

function isDateHunk(h) {
  const mask = (l) => l.replace(DATE_RE, "$1<date>");
  return h.removed.length === 1 && h.added.length === 1 && DATE_RE.test(h.removed[0]) && mask(h.removed[0]) === mask(h.added[0]);
}

// Boundary-anchored: "2.1.18" must not match inside "2.1.180" or "12.1.18".
function hasVersion(text, v) {
  return new RegExp(`(?<![\\d.])v?${v.replace(/\./g, "\\.")}(?![\\d]|\\.\\d)`).test(text);
}

// Date hunks dropped; unsourced = adds an x.y.z found neither in its own removed lines nor in the docs;
// changing = other hunks removing >= 1 line (ids h1..hN in diff order); additive = the rest (count).
function analyze(plan, t) {
  const docsText = t.docs.map((d) => (existsSync(d.path) ? readFileSync(d.path, "utf8") : "")).join("\n");
  const { header, hunks } = diffFile(plan, t);
  const unsourced = [];
  const changing = [];
  let additive = 0;
  for (const h of hunks) {
    if (isDateHunk(h)) continue;
    const carried = new Set(versions(h.removed));
    const bad = [...new Set(versions(h.added))].filter((v) => !carried.has(v) && !hasVersion(docsText, v));
    if (bad.length) unsourced.push({ ...h, versions: bad });
    else if (h.removed.length) changing.push({ ...h, id: `h${changing.length + 1}` });
    else additive++;
  }
  return { header, unsourced, changing, additive };
}

function newStart(h) {
  return Number(/\+(\d+)/.exec(h.head)?.[1] ?? 0);
}

function revertHunks(plan, t, header, hunks) {
  if (!hunks.length) return;
  const before = readFileSync(t.file);
  const patch = join(plan.scratch, "diffs", `${t.name}.revert.patch`);
  // One hunk per apply, bottom-up: -U0 hunks carry no context to re-anchor on, so reverting from the end
  // keeps every earlier hunk's line numbers valid. The snapshot keeps the whole revert all-or-nothing.
  const ordered = [...hunks].sort((a, b) => newStart(b) - newStart(a));
  for (const h of ordered) {
    writeFileSync(patch, [...header, h.head, ...h.body].join("\n") + "\n");
    const r = run("git", ["apply", "-R", "--unidiff-zero", patch], { cwd: plan.repoRoot });
    if (r.status !== 0) {
      writeFileSync(t.file, before);
      process.stderr.write(r.stderr);
      fail(3, `git apply -R failed for ${t.name}`, { name: t.name });
    }
  }
}

function stampDate(file, date) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    if (!DATE_RE.test(lines[i])) continue;
    const next = lines[i].replace(DATE_RE, `$1${date}`);
    if (next !== lines[i]) {
      lines[i] = next;
      writeFileSync(file, lines.join("\n"));
    }
    return true;
  }
  return false;
}

const autoReport = (hunks) => hunks.map((h) => ({ versions: h.versions, header: h.head }));

function cmdGate(args) {
  const plan = loadPlan(args[0]);
  const t = findTarget(plan, args[1]);
  let a = analyze(plan, t);
  const autoReverted = autoReport(a.unsourced);
  if (a.unsourced.length) {
    revertHunks(plan, t, a.header, a.unsourced);
    a = analyze(plan, t);
  }
  let diffPath = null;
  if (a.changing.length) {
    diffPath = join(plan.scratch, "diffs", `${t.name}.diff`);
    writeFileSync(diffPath, [...a.header, ...a.changing.flatMap((h) => [`${h.head} ${h.id}`, ...h.body])].join("\n") + "\n");
  }
  const state = { sha256: sha256(t.file), ids: a.changing.map((h) => h.id) };
  writeFileSync(join(plan.scratch, "diffs", `${t.name}.state.json`), JSON.stringify(state) + "\n");
  return { name: t.name, additive: a.additive, changing: state.ids, diffPath, autoReverted };
}

function cmdFinish(args) {
  const plan = loadPlan(args[0]);
  const t = findTarget(plan, args[1]);
  const k = args.indexOf("--keep");
  const requested = k >= 0 && args[k + 1] ? args[k + 1].split(",").map((s) => s.trim()).filter((s) => /^h\d+$/.test(s)) : [];
  const statePath = join(plan.scratch, "diffs", `${t.name}.state.json`);
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  // Fail-closed: without a matching gate snapshot no line change can be kept.
  const stale = !state || state.sha256 !== sha256(t.file);
  const keep = new Set(stale ? [] : requested.filter((id) => state.ids.includes(id)));
  const a = analyze(plan, t);
  const drop = a.changing.filter((h) => !keep.has(h.id));
  revertHunks(plan, t, a.header, [...a.unsourced, ...drop]);
  const rest = diffFile(plan, t).hunks.filter((h) => !isDateHunk(h));
  let status;
  let stamped = null;
  if (!rest.length) {
    git(["checkout", "HEAD", "--", t.file], plan.repoRoot);
    status = "unchanged";
  } else {
    stamped = stampDate(t.file, plan.date);
    status = "updated";
  }
  return {
    name: t.name,
    status,
    kept: a.changing.filter((h) => keep.has(h.id)).map((h) => h.id),
    reverted: drop.map((h) => h.id),
    autoReverted: autoReport(a.unsourced),
    stale,
    stamped,
  };
}

const PLUGIN_JSON = "plugins/cc-knowledge/.claude-plugin/plugin.json";
const SUFFIX_RE = / \(CC docs read: \d{4}-\d{2}-\d{2}\)$/;

function cmdRelease(args) {
  const plan = loadPlan(args[0]);
  const root = plan.repoRoot;
  const porcelain = git(["status", "--porcelain", "--", ...plan.targets.map((t) => t.file)], root);
  const files = porcelain.split("\n").filter(Boolean).map((l) => l.slice(3));
  if (!files.length) return { changed: false };

  const pluginPath = join(root, PLUGIN_JSON);
  const raw = readFileSync(pluginPath, "utf8");
  const obj = JSON.parse(raw);
  const current = obj.version;
  if (typeof current !== "string" || !/^\d+\.\d+\.\d+$/.test(current)) fail(1, `malformed version in ${PLUGIN_JSON}: ${current}`);
  const shown = run("git", ["show", `origin/main:${PLUGIN_JSON}`], { cwd: root });
  let base = null;
  if (shown.status === 0) {
    try {
      base = JSON.parse(shown.stdout).version ?? null;
    } catch {
      base = null;
    }
  }
  if (base === null) fail(3, `cannot read ${PLUGIN_JSON} from origin/main (fetch it first)`);
  // Bump once per unreleased branch: a version already ahead of origin/main stays.
  const bumped = current === base;
  if (bumped) {
    const [a, b, c] = current.split(".").map(Number);
    obj.version = `${a}.${b}.${c + 1}`;
  }
  const suffix = ` (CC docs read: ${plan.date})`;
  if (typeof obj.description !== "string") fail(1, `missing description in ${PLUGIN_JSON}`);
  obj.description = SUFFIX_RE.test(obj.description) ? obj.description.replace(SUFFIX_RE, () => suffix) : obj.description + suffix;
  const next = JSON.stringify(obj, null, 2) + "\n";
  if (next !== raw) writeFileSync(pluginPath, next);
  return { changed: true, files, previousVersion: current, version: obj.version, bumped, date: plan.date };
}

const COMMANDS = { plan: cmdPlan, gate: cmdGate, finish: cmdFinish, release: cmdRelease };

function main() {
  SOURCES = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));
  const [cmd, ...args] = process.argv.slice(2);
  const fn = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!fn) fail(1, `usage: node refresh.mjs <${Object.keys(COMMANDS).join("|")}> ...`);
  return fn(args);
}

try {
  process.stdout.write(JSON.stringify(main()) + "\n");
} catch (e) {
  if (e instanceof Exit) {
    process.stdout.write(JSON.stringify(e.payload) + "\n");
    process.exitCode = e.code;
  } else {
    process.stderr.write(`${(e && e.stack) || e}\n`);
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }) + "\n");
    process.exitCode = 1;
  }
}
