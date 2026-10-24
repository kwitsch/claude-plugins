#!/usr/bin/env node
// init-dprint skill helper: locate dprint (first executable on PATH, else
// ~/.dprint/bin/dprint), read `dprint --version`, compare it numerically
// against MIN_VERSION. Prints exactly one
// `status=<ok|missing|outdated|error> version=<X.Y.Z|-> min=<MIN> path=<abs|->`
// line; exit codes per check-dprint.reference.md. Read-only: never installs.
import { accessSync, statSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const MIN_VERSION = "0.50.0";
/** true when p is a regular file executable by this user */
function isExecutableFile(p) {
    try {
        accessSync(p, constants.X_OK);
        return statSync(p).isFile();
    }
    catch {
        return false;
    }
}
/** absolute path of the dprint to use, or null */
function findDprint() {
    for (const dir of (process.env.PATH ?? "").split(":")) {
        if (!dir)
            continue;
        const p = resolve(dir, "dprint");
        if (isExecutableFile(p))
            return p;
    }
    const fallback = join(homedir(), ".dprint", "bin", "dprint");
    return isExecutableFile(fallback) ? fallback : null;
}
/** negative if version < MIN_VERSION, 0 if equal, positive if greater */
function compareToMin(version) {
    const a = version.split(".").map(Number);
    const b = MIN_VERSION.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i])
            return a[i] - b[i];
    }
    return 0;
}
/** args = command-line arguments after the script path */
function check(args) {
    if (args.length > 0) {
        process.stderr.write("usage: node check-dprint.mjs (takes no arguments)\n");
        return { code: 2, status: "error", version: "-", path: "-" };
    }
    const path = findDprint();
    if (path === null)
        return { code: 10, status: "missing", version: "-", path: "-" };
    let out;
    try {
        out = String(execFileSync(path, ["--version"], {
            encoding: "utf8",
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"],
        }));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`check-dprint: '${path} --version' failed: ${msg}\n`);
        return { code: 2, status: "error", version: "-", path };
    }
    const m = /^dprint (\d+)\.(\d+)\.(\d+)(-\S+)?/.exec(out.trim());
    if (!m) {
        process.stderr.write(`check-dprint: unparseable '${path} --version' output: ${JSON.stringify(out.trim())}\n`);
        return { code: 2, status: "error", version: "-", path };
    }
    const version = `${m[1]}.${m[2]}.${m[3]}`;
    // a prerelease of MIN_VERSION sorts below it
    const cmp = compareToMin(version) || (m[4] ? -1 : 0);
    return cmp >= 0 ? { code: 0, status: "ok", version, path } : { code: 11, status: "outdated", version, path };
}
const r = check(process.argv.slice(2));
process.stdout.write(`status=${r.status} version=${r.version} min=${MIN_VERSION} path=${r.path}\n`);
process.exit(r.code);
