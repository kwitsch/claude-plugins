#!/usr/bin/env node
// refresh.mjs — deterministic plumbing for the update-cc-references skill.
// Subcommands:
//   plan [<target>] [<scratch>]   resolve target files from sources.json, curl every mapped doc
//                                 (<url>.md, HTML check, one altUrls retry), write plan.json + workflow.js
//   gate <scratch> <name>         revert unsourced-version hunks, label line-changing hunks for the validator
//   finish <scratch> <name> [--keep h1,h2]  authoritative, fail-closed: revert every line-changing hunk not
//                                 kept, then stamp the verified date or restore the file from HEAD
//   release <scratch>             guarded patch bump, description date suffix, rolling version-pin test
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
const SOURCES = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

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
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function docPath(scratch, url) {
  const u = new URL(url);
  return join(scratch, "docs", `${u.host}${u.pathname.replace(/\//g, "_")}.md`);
}

// true = clean markdown landed at `out`; false = curl failure, empty file or HTML fallback page.
function fetchDoc(url, out) {
  const r = run("curl", ["-sSL", "--fail", "-o", out, `${url}.md`]);
  if (r.status !== 0) {
    process.stderr.write(`curl ${url}.md failed (exit ${r.status}) ${r.stderr}\n`);
    return false;
  }
  if (!existsSync(out)) return false;
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

const COMMANDS = { plan: cmdPlan };

function main() {
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
