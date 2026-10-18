// hooks/policy.mjs -- npm-automations: the pure decision logic behind hooks/register.ts.
// Zero-dep and side-effect free: no `node:` import and no reference to the mods `$`
// (the engine rejects both in a file the hooks module imports). Every file system,
// environment and process access happens in register.ts and is handed in here as data.

export const INSTALL_TIMEOUT_MS = 300000; // the old async command hooks' own `timeout: 300`
const MAX_CONTEXT_CHARS = 4000; // same cap as universal-lint's lint-file.mjs
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/** @typedef {{ name: string, lockfile: string, ciArgs: string[] }} PackageManager */

// Lockfile presence selects the package manager, checked in this order so a project
// mid-migration (several lockfiles briefly coexisting) prefers the newer lockfile over
// npm's. `ciArgs` is each manager's lockfile-frozen equivalent of `npm ci`: pnpm's
// `--frozen-lockfile` and yarn classic's `--frozen-lockfile` (yarn berry only
// deprecated it in favor of `--immutable`, it did not remove it).
/** @type {readonly PackageManager[]} */
export const PACKAGE_MANAGERS = [
  { name: "pnpm", lockfile: "pnpm-lock.yaml", ciArgs: ["install", "--frozen-lockfile"] },
  { name: "yarn", lockfile: "yarn.lock", ciArgs: ["install", "--frozen-lockfile"] },
  { name: "npm", lockfile: "package-lock.json", ciArgs: ["ci"] },
];
// The install hook's manager when no lockfile exists yet (first-ever install).
export const DEFAULT_MANAGER = PACKAGE_MANAGERS[2];

/** @param {Iterable<string>} names the directory's entry names @returns {PackageManager | null} */
export function detectPackageManager(names) {
  const present = new Set(names);
  return PACKAGE_MANAGERS.find((pm) => present.has(pm.lockfile)) ?? null;
}

// Standalone/corepack pnpm and yarn installs land in ~/.local/bin, which the session's
// PATH may lack. APPENDED, never prepended: the inherited PATH wins, so a stale
// ~/.local/bin binary can never shadow a canonical one.
// shortcut: POSIX separators only (":" and "/"); a native-Windows host needs ";" and "\\".
/** @param {string | undefined} current the session's PATH @param {string | undefined} home @returns {string} "" when both are unset */
export function pathWithLocalBin(current, home) {
  return [current, home ? `${home}/.local/bin` : ""].filter(Boolean).join(":");
}

// Fail-open: only a literal `false` (boolean or string) disables -- a deliberate
// exception to plugin-userconfig.md's state-creating-toggle default; see hooks/CLAUDE.md.
/** @param {unknown} value @returns {boolean} */
export function isEnabled(value) {
  return value !== false && value !== "false";
}

/** @param {string} text @returns {string} */
export function truncate(text) {
  const t = text.trim();
  return t.length > MAX_CONTEXT_CHARS ? `${t.slice(0, MAX_CONTEXT_CHARS)}\n... (truncated)` : t;
}

/** @param {string} filePath @returns {boolean} a package.json outside node_modules */
export function isPackageJson(filePath) {
  return /(^|[\\/])package\.json$/.test(filePath) && !/[\\/]node_modules[\\/]/.test(filePath);
}

/** @param {string} filePath @returns {string} */
export function dirname(filePath) {
  const cut = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return cut < 0 ? "." : cut === 0 ? filePath[0] : filePath.slice(0, cut);
}

// pnpm/yarn use `add <spec>...` to install/update specific specs (both verified to
// update an existing entry in place, same as npm) and bare `install` to reconcile from
// the current package.json, same as npm's bare `install`.
/** @param {string} managerName @param {string[] | null} specs @returns {string[]} */
export function installArgsFor(managerName, specs) {
  if (specs === null) return ["install"];
  return managerName === "npm" ? ["install", ...specs] : ["add", ...specs];
}

/** @param {string} haystack @param {string} needle @returns {number} */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// Rebuilds the pre-edit content from the Edit tool's own old_string/new_string. Null
// when that is not safely possible: Write carries no prior content; an Edit whose
// new_string is not unique post-edit (e.g. replace_all) cannot pin the occurrence.
/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {string} newContent @returns {string | null} */
export function reconstructOld(toolName, toolInput, newContent) {
  if (toolName !== "Edit") return null;
  const oldString = toolInput?.old_string;
  const newString = toolInput?.new_string;
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  if (countOccurrences(newContent, newString) !== 1) return null;
  return newContent.replace(newString, () => oldString);
}

// The `name@range` specs new or changed in DEP_FIELDS; removed entries are ignored
// (no uninstall -- out of scope). peerDependencies are deliberately left out.
/** @param {Record<string, any>} oldPkg @param {Record<string, any>} newPkg @returns {string[]} */
export function collectChangedSpecs(oldPkg, newPkg) {
  const specs = [];
  for (const field of DEP_FIELDS) {
    const newDeps = newPkg?.[field] ?? {};
    const oldDeps = oldPkg?.[field] ?? {};
    for (const [name, range] of Object.entries(newDeps)) {
      if (oldDeps[name] !== range) specs.push(`${name}@${range}`);
    }
  }
  return specs;
}

// What a Write/Edit of a package.json asks for: null = nothing (invalid post-edit
// JSON, or no dependency change, e.g. a version-only edit); `{ specs: null }` = a bare
// install (Write, or an Edit that cannot be reconstructed); `{ specs }` = targeted.
/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {string} newContent @returns {{ specs: string[] | null } | null} */
export function planInstall(toolName, toolInput, newContent) {
  let newPkg;
  try {
    newPkg = JSON.parse(newContent);
  } catch {
    return null;
  }
  const oldContent = reconstructOld(toolName, toolInput, newContent);
  if (oldContent === null) return { specs: null };
  let oldPkg;
  try {
    oldPkg = JSON.parse(oldContent);
  } catch {
    return { specs: null };
  }
  const specs = collectChangedSpecs(oldPkg, newPkg);
  return specs.length > 0 ? { specs } : null;
}

// The context line one finished install leaves for the model, or null to stay silent
// (clean exit, or our own timeout kill). `outcome` is `$.process.run`'s result, or
// `{ error }` with the text of its rejection: "... failed to start: <CODE>: ..." when
// the binary could not start, "... aborted: still running after <N>ms" on the timeout.
/**
 * @param {string} hook @param {string} bin @param {string} command @param {string} cwd
 * @param {{ exitCode: number, stdout: string, stderr: string } | { error: string }} outcome
 * @returns {string | null}
 */
export function outcomeMessage(hook, bin, command, cwd, outcome) {
  let reason;
  let output = "";
  if ("error" in outcome) {
    if (/aborted: still running after/.test(outcome.error)) return null;
    const code = /failed to start: ([A-Z0-9_]+)/.exec(outcome.error)?.[1];
    if (code === "ENOENT") return `${hook}: ${bin} not found on PATH, skipped in ${cwd}`;
    reason = `spawn error ${code ?? outcome.error}`;
  } else {
    if (outcome.exitCode === 0) return null;
    reason = `exit code ${outcome.exitCode}`;
    // each stream truncated on its own before joining, as before
    output = `${truncate(outcome.stdout)}\n${truncate(outcome.stderr)}`;
  }
  return `${hook}: \`${command}\` failed in ${cwd} (${reason}):\n${truncate(output)}`;
}
