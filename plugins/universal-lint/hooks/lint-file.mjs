#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { json } from "node:stream/consumers";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
function createHash(algorithm) {
	return (process.getBuiltinModule?.("node:crypto") ?? createRequire(import.meta.url)("node:crypto")).createHash(algorithm);
}
const SPAWN_TIMEOUT_MS = 3e4;
const NPX_SPAWN_TIMEOUT_MS = 55e3;
const NPX_REFRESH_MS = 24 * 60 * 60 * 1e3;
const PROBE_MISS_TTL_MS = 10 * 60 * 1e3;
const MAX_CONTEXT_CHARS = 4e3;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const TSC_SPAWN_TIMEOUT_MS = 45e3;
const CARGO_SPAWN_TIMEOUT_MS = 45e3;
const KILL_GRACE_MS = 1e3;
const BATCH_MAX_FILES = 100;
export const WATCH_LIMIT = 5e3;
const GIT_TIMEOUT_MS = 1e4;
const HOOK_TIMEOUT_MS = 9e4;
const FILE_CHANGED_BUDGET_MS = HOOK_TIMEOUT_MS - 5e3;
export const FILE_CHANGED_SLOTS = Math.max(2, Math.floor(availableParallelism() / 4));
const TYPE_CHECK_EXTS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts"
]);
const EXT_MAP = {
	".sh": "shell",
	".bash": "shell",
	".java": "java",
	".kt": "kotlin",
	".kts": "kotlin",
	".js": "jsts",
	".jsx": "jsts",
	".mjs": "jsts",
	".cjs": "jsts",
	".ts": "jsts",
	".tsx": "jsts",
	".mts": "jsts",
	".cts": "jsts",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".yaml": "yaml",
	".yml": "yaml",
	".md": "markdown",
	".css": "css",
	".scss": "css",
	".php": "php",
	".rs": "rust"
};
export const REGISTRY = {
	shell: { chain: [{
		name: "shellcheck",
		args: []
	}] },
	java: { chain: [{
		name: "checkstyle",
		args: [],
		classify: "output",
		needsCheckstyleConfig: true
	}] },
	kotlin: { chain: [{
		name: "ktlint",
		args: []
	}] },
	jsts: { chain: [{
		name: "eslint",
		args: [],
		npmSpec: "eslint"
	}] },
	oxlint: { chain: [{
		name: "oxlint",
		args: ["--no-error-on-unmatched-pattern"],
		npmSpec: "oxlint"
	}] },
	python: { chain: [{
		name: "ruff",
		args: ["check", "--force-exclude"]
	}] },
	go: { chain: [{
		name: "golangci-lint",
		args: ["run"],
		targetsDir: true
	}, {
		name: "go",
		args: ["vet"],
		targetsDir: true
	}] },
	yaml: { chain: [{
		name: "yamllint",
		args: [],
		guardYamlLineLength: true
	}] },
	markdown: { chain: [{
		name: "markdownlint-cli2",
		args: ["--no-globs"],
		npmSpec: "markdownlint-cli2",
		guardMarkdownLineLength: true
	}, {
		name: "markdownlint",
		args: [],
		npmSpec: "markdownlint-cli",
		guardMarkdownLineLength: true
	}] },
	css: { chain: [{
		name: "stylelint",
		args: [],
		npmSpec: "stylelint"
	}] },
	php: { chain: [{
		name: "phpstan",
		args: ["analyse"]
	}, {
		name: "psalm",
		args: []
	}] },
	rust: { chain: [{
		name: "cargo-clippy",
		args: [
			"--",
			"-D",
			"warnings"
		],
		manifestPath: true,
		spawnAs: {
			name: "cargo",
			args: ["clippy"]
		}
	}, {
		name: "cargo",
		args: ["check"],
		manifestPath: true
	}] }
};
const probeCache = new Map();
let probeStore = null;
function probeFilePath() {
	return path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), `probe-${hashPath(process.env.PATH || "")}.json`);
}
function loadProbeStore(file) {
	const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	try {
		const s = JSON.parse(readFileSync(file, "utf8"));
		if (isObject(s) && isObject(s?.hits) && isObject(s?.misses)) return s;
	} catch {}
	return {
		hits: {},
		misses: {}
	};
}
function saveProbeStore(file, store) {
	try {
		mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify(store));
		renameSync(tmp, file);
	} catch {}
}
function isExecutableFile(p) {
	try {
		accessSync(p, fsConstants.X_OK);
	} catch {
		return false;
	}
	return isFile(p);
}
function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}
function onPath(tool) {
	const cached = probeCache.get(tool);
	if (cached !== undefined) return cached;
	const file = probeFilePath();
	probeStore ??= loadProbeStore(file);
	const known = probeStore.hits[tool];
	if (typeof known === "string" && path.isAbsolute(known)) {
		if (isExecutableFile(path.join(known, tool))) {
			probeCache.set(tool, true);
			return true;
		}
	}
	const at = probeStore.misses[tool];
	if (typeof at === "number") {
		const age = Date.now() - at;
		if (age >= 0 && age < PROBE_MISS_TTL_MS) {
			probeCache.set(tool, false);
			return false;
		}
	}
	let foundDir = null;
	for (const dir of (process.env.PATH || "").split(path.delimiter)) {
		if (!dir) continue;
		if (isExecutableFile(path.join(dir, tool))) {
			foundDir = dir;
			break;
		}
	}
	if (foundDir === null || path.isAbsolute(foundDir)) {
		Reflect.deleteProperty(probeStore.hits, tool);
		Reflect.deleteProperty(probeStore.misses, tool);
		if (foundDir === null) probeStore.misses[tool] = Date.now();
		else probeStore.hits[tool] = foundDir;
		saveProbeStore(file, probeStore);
	}
	const found = foundDir !== null;
	probeCache.set(tool, found);
	return found;
}
export function isToolAvailable(tool, toolOnPath, npxOnPath) {
	return toolOnPath || !!tool.npmSpec && npxOnPath;
}
const GROUP_KILL_SIGNALS = [
	"SIGTERM",
	"SIGINT",
	"SIGHUP"
];
const liveGroups = new Set();
let groupSignalHandlerInstalled = false;
function killGroup(pgid, sig) {
	try {
		process.kill(-pgid, sig);
	} catch {}
}
function installSignalHandler() {
	if (groupSignalHandlerInstalled) return;
	groupSignalHandlerInstalled = true;
	const onSignal = (sig) => {
		for (const pgid of liveGroups) killGroup(pgid, "SIGKILL");
		liveGroups.clear();
		for (const s of GROUP_KILL_SIGNALS) process.removeListener(s, onSignal);
		process.kill(process.pid, sig);
	};
	for (const s of GROUP_KILL_SIGNALS) process.on(s, onSignal);
}
export function spawnGroup(cmd, argv, opts) {
	installSignalHandler();
	const maxBuffer = opts.maxBuffer ?? MAX_BUFFER_BYTES;
	const timeout = opts.timeout ?? SPAWN_TIMEOUT_MS;
	return new Promise((resolve) => {
		let error;
		let done = false;
		let killTimer;
		let child;
		try {
			child = spawn(cmd, [...argv], {
				cwd: opts.cwd,
				env: opts.env,
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				detached: true
			});
		} catch (e) {
			error = e instanceof Error ? e : new Error(String(e));
			resolve({
				pid: 0,
				output: [
					null,
					"",
					""
				],
				stdout: "",
				stderr: "",
				status: null,
				signal: null,
				error
			});
			return;
		}
		const pid = child.pid;
		if (pid !== undefined) liveGroups.add(pid);
		const kill = () => {
			if (pid === undefined || killTimer) return;
			killGroup(pid, "SIGTERM");
			killTimer = setTimeout(() => killGroup(pid, "SIGKILL"), KILL_GRACE_MS);
		};
		const fail = (code) => {
			error ??= Object.assign(new Error(`spawnGroup ${cmd}: ${code}`), { code });
			kill();
		};
		const timer = setTimeout(() => fail("ETIMEDOUT"), timeout);
		const out = [];
		const err = [];
		const collect = (chunks) => {
			let total = 0;
			return (chunk) => {
				if (total > maxBuffer) return;
				total += chunk.length;
				if (total > maxBuffer) fail("ENOBUFS");
				else chunks.push(chunk);
			};
		};
		child.stdout?.on("data", collect(out));
		child.stderr?.on("data", collect(err));
		const finish = (status, signal, stdout, stderr) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			if (pid !== undefined) liveGroups.delete(pid);
			resolve({
				pid: pid ?? 0,
				output: [
					null,
					stdout,
					stderr
				],
				stdout,
				stderr,
				status,
				signal,
				error
			});
		};
		child.on("error", (e) => {
			error = e;
			finish(null, null, "", "");
		});
		child.on("close", (status, signal) => finish(status, signal, Buffer.concat(out).toString("utf8"), Buffer.concat(err).toString("utf8")));
	});
}
async function spawnBin(bin, argv, spawnOpts) {
	const PATH = process.env.PATH ? path.dirname(bin) + path.delimiter + process.env.PATH : path.dirname(bin);
	const result = await spawnGroup(bin, argv, {
		...spawnOpts,
		env: {
			...process.env,
			PATH
		}
	});
	const code = result.error && "code" in result.error ? result.error.code : undefined;
	return code === "ENOENT" || code === "EACCES" ? null : result;
}
async function runNpx(name, npmSpec, argv, spawnOpts, failed) {
	const npx = () => spawnGroup("npx", [
		"--yes",
		npmSpec,
		...argv
	], {
		...spawnOpts,
		timeout: NPX_SPAWN_TIMEOUT_MS,
		env: {
			...spawnOpts.env ?? process.env,
			npm_config_update_notifier: "false",
			npm_config_fund: "false",
			npm_config_audit: "false"
		}
	});
	const rel = path.join("node_modules", ".bin", name);
	if (walkToRoot(String(spawnOpts.cwd), (d) => path.join(d, rel) !== failed && configExists(d, rel))) return npx();
	const key = createHash("sha512").update(npmSpec).digest("hex").slice(0, 16);
	const dir = path.join(process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || path.join(homedir(), ".npm"), "_npx", key);
	const stamp = path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), `npx-refreshed-${key}`);
	let fresh = false;
	try {
		const age = Date.now() - lstatSync(stamp).mtimeMs;
		fresh = age >= 0 && age < NPX_REFRESH_MS;
	} catch {}
	if (fresh && !existsSync(path.join(dir, "concurrency.lock"))) {
		const cached = await spawnBin(path.join(dir, rel), argv, {
			...spawnOpts,
			timeout: NPX_SPAWN_TIMEOUT_MS
		});
		if (cached) return cached;
	}
	const result = await npx();
	if (!result.error) {
		try {
			mkdirSync(path.dirname(stamp), { recursive: true });
			writeFileSync(stamp, "");
		} catch {}
	}
	return result;
}
async function runLintTool(tool, argv, spawnOpts, local) {
	const viaLocal = local ? await spawnBin(local, argv, spawnOpts) : null;
	if (viaLocal) return viaLocal;
	if (tool.npmSpec && !onPath(tool.name)) return runNpx(tool.name, tool.npmSpec, argv, spawnOpts, local);
	const spawnName = tool.spawnAs?.name ?? tool.name;
	const spawnArgv = tool.spawnAs ? [...tool.spawnAs.args, ...argv] : argv;
	return spawnGroup(spawnName, spawnArgv, spawnOpts);
}
const dirEntries = new Map();
export function configExists(dir, name, prefilter = dir.startsWith("/mnt/")) {
	if (prefilter) {
		let names = dirEntries.get(dir);
		if (names === undefined) {
			try {
				names = new Set(readdirSync(dir).map((n) => n.toUpperCase()));
			} catch {
				names = null;
			}
			dirEntries.set(dir, names);
		}
		if (names && !names.has(name.split("/", 1)[0].toUpperCase())) return false;
	}
	return existsSync(path.join(dir, name));
}
function anyConfigExists(dir, names) {
	return names.some((n) => configExists(dir, n));
}
function walkUpToCwd(fileDir, cwd, checkDir) {
	let dir = fileDir;
	for (;;) {
		const found = checkDir(dir);
		if (found) return found;
		if (dir === cwd) break;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}
function localBin(name, fileDir, cwd) {
	const rel = path.join("node_modules", ".bin", name);
	return walkUpToCwd(fileDir, cwd, (dir) => !outside(path.relative(cwd, dir)) && configExists(dir, rel) ? path.join(dir, rel) : null);
}
export function resolveCheckstyleConfig(fileDir, cwd) {
	const candidates = [
		"checkstyle.xml",
		".checkstyle.xml",
		path.join("config", "checkstyle", "checkstyle.xml")
	];
	return walkUpToCwd(fileDir, cwd, (dir) => {
		for (const rel of candidates) {
			if (configExists(dir, rel)) return path.join(dir, rel);
		}
		return null;
	});
}
export function resolveCargoManifest(fileDir, cwd) {
	return walkUpToCwd(fileDir, cwd, (dir) => {
		const p = path.join(dir, "Cargo.toml");
		return configExists(dir, "Cargo.toml") ? p : null;
	});
}
export function resolveTsconfig(fileDir, cwd) {
	return walkUpToCwd(fileDir, cwd, (dir) => {
		const p = path.join(dir, "tsconfig.json");
		if (!configExists(dir, "tsconfig.json")) return null;
		let text;
		try {
			text = readFileSync(p, "utf8");
		} catch {
			return null;
		}
		return !looksLikeSolutionStyleTsconfig(text) ? p : null;
	});
}
const ESLINT_CONFIG_FILENAMES = [
	"eslint.config.js",
	"eslint.config.mjs",
	"eslint.config.cjs",
	"eslint.config.ts",
	"eslint.config.mts",
	"eslint.config.cts",
	".eslintrc",
	".eslintrc.js",
	".eslintrc.cjs",
	".eslintrc.json",
	".eslintrc.yaml",
	".eslintrc.yml"
];
const OXLINT_CONFIG_FILENAMES = [
	".oxlintrc.json",
	".oxlintrc.jsonc",
	"oxlint.config.ts"
];
export function resolveOxlintConfig(fileDir, cwd) {
	const hit = walkUpToCwd(fileDir, cwd, (dir) => {
		for (const n of [...OXLINT_CONFIG_FILENAMES, ...ESLINT_CONFIG_FILENAMES]) {
			if (configExists(dir, n)) return path.join(dir, n);
		}
		return null;
	});
	return hit && OXLINT_CONFIG_FILENAMES.includes(path.basename(hit)) ? hit : null;
}
export function oxlintConfigTypeChecks(configPath) {
	if (!configPath.endsWith(".json") && !configPath.endsWith(".jsonc")) return false;
	try {
		const text = stripTrailingCommas(stripJsonComments(readFileSync(configPath, "utf8")));
		const cfg = JSON.parse(text);
		return cfg?.options?.typeCheck === true;
	} catch {
		return false;
	}
}
function stripJsonComments(text) {
	let out = "";
	let i = 0;
	let inString = false;
	while (i < text.length) {
		const c = text[i];
		if (inString) {
			if (c === "\\") {
				out += c + (text[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (c === "\"") inString = false;
			out += c;
			i++;
			continue;
		}
		if (c === "\"") {
			inString = true;
			out += c;
			i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
			out += " ";
			continue;
		}
		out += c;
		i++;
	}
	return out;
}
export function stripTrailingCommas(text) {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === "\\") {
				out += c + (text[i + 1] ?? "");
				i++;
				continue;
			}
			if (c === "\"") inString = false;
		} else if (c === "\"") {
			inString = true;
		} else if (c === ",") {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j])) j++;
			if (text[j] === "}" || text[j] === "]") continue;
		}
		out += c;
	}
	return out;
}
export function looksLikeSolutionStyleTsconfig(text) {
	const stripped = stripJsonComments(text);
	const hasReferences = /"references"\s*:/.test(stripped);
	if (!hasReferences) return false;
	const hasInclude = /"include"\s*:/.test(stripped);
	if (hasInclude) return false;
	const filesMatch = stripped.match(/"files"\s*:\s*\[([^\]]*)\]/);
	return !!filesMatch && filesMatch[1].trim() === "";
}
export function hashPath(p) {
	return createHash("sha256").update(p).digest("hex");
}
export function tsBuildInfoPathFor(tsconfigPath) {
	let resolved;
	try {
		resolved = realpathSync(tsconfigPath);
	} catch {
		resolved = path.resolve(tsconfigPath);
	}
	const hash = hashPath(resolved).slice(0, 8);
	const dataDir = process.env.CLAUDE_PLUGIN_DATA || tmpdir();
	return path.resolve(dataDir, `tsc-buildinfo-${hash}.json`);
}
const YAMLLINT_CONFIG_FILENAMES = [
	".yamllint",
	".yamllint.yaml",
	".yamllint.yml"
];
export function hasProjectYamllintConfig(cwd) {
	let dir = path.resolve(cwd);
	try {
		dir = realpathSync(dir);
	} catch {}
	const home = path.resolve(homedir());
	for (;;) {
		if (anyConfigExists(dir, YAMLLINT_CONFIG_FILENAMES)) return true;
		if (dir === home) return false;
		const parent = path.dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}
export function hasUserGlobalYamllintConfig() {
	const env = process.env;
	const p = env.YAMLLINT_CONFIG_FILE !== undefined ? env.YAMLLINT_CONFIG_FILE.replace(/^~(?=$|\/)/, homedir()) : path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "yamllint", "config");
	return isFile(p);
}
const YAMLLINT_NO_LINE_LENGTH_CONFIG_DATA = "{extends: default, rules: {line-length: disable}}";
const MARKDOWNLINT_CONFIG_FILENAMES = [
	".markdownlint-cli2.jsonc",
	".markdownlint-cli2.yaml",
	".markdownlint-cli2.cjs",
	".markdownlint-cli2.mjs",
	".markdownlint.jsonc",
	".markdownlint.json",
	".markdownlint.yaml",
	".markdownlint.yml",
	".markdownlint.cjs",
	".markdownlint.mjs"
];
function walkToRoot(dir, checkDir) {
	for (;;) {
		if (checkDir(dir)) return true;
		const parent = path.dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}
export function hasProjectMarkdownlintConfig(fileDir) {
	return walkToRoot(fileDir, (dir) => anyConfigExists(dir, MARKDOWNLINT_CONFIG_FILENAMES));
}
const MARKDOWNLINT_CLASSIC_CONFIG_FILENAMES = [
	".markdownlint.jsonc",
	".markdownlint.json",
	".markdownlint.yaml",
	".markdownlint.yml"
];
function hasMarkdownlintRc(spawnCwd) {
	let real = spawnCwd;
	try {
		real = realpathSync(spawnCwd);
	} catch {}
	if (anyConfigExists(real, MARKDOWNLINT_CLASSIC_CONFIG_FILENAMES) || walkToRoot(real, (d) => configExists(d, ".markdownlintrc"))) return true;
	const home = homedir();
	const env = process.env.markdownlint_config;
	return [
		...env ? [path.resolve(real, env)] : [],
		path.join(home, ".config", "markdownlint", "config"),
		path.join(home, ".config", "markdownlint"),
		path.join(home, ".markdownlint", "config"),
		path.join(home, ".markdownlintrc"),
		"/etc/markdownlint/config",
		"/etc/markdownlintrc"
	].some(isFile);
}
const STYLELINT_CONFIG_FILENAMES = [
	".stylelintrc",
	".stylelintrc.json",
	".stylelintrc.yaml",
	".stylelintrc.yml",
	".stylelintrc.js",
	".stylelintrc.ts",
	".stylelintrc.cjs",
	".stylelintrc.mjs",
	".config/stylelintrc",
	".config/stylelintrc.json",
	".config/stylelintrc.yaml",
	".config/stylelintrc.yml",
	".config/stylelintrc.js",
	".config/stylelintrc.ts",
	".config/stylelintrc.cjs",
	".config/stylelintrc.mjs",
	"stylelint.config.js",
	"stylelint.config.ts",
	"stylelint.config.cjs",
	"stylelint.config.mjs"
];
function hasStylelintConfig(fileDir, cwd) {
	const hasKey = (dir) => {
		if (!configExists(dir, "package.json")) return false;
		const pkg = path.join(dir, "package.json");
		try {
			return JSON.parse(readFileSync(pkg, "utf8"))?.stylelint != null;
		} catch {
			return true;
		}
	};
	const found = (d) => anyConfigExists(d, STYLELINT_CONFIG_FILENAMES) || hasKey(d);
	if (walkToRoot(fileDir, found) || walkToRoot(cwd, found)) return true;
	const home = homedir();
	return [process.env.XDG_CONFIG_HOME || path.join(home, ".config"), path.join(home, "Library", "Preferences")].some((d) => existsSync(path.join(d, "stylelint")));
}
const MARKDOWNLINT_NO_LINE_LENGTH_CONFIG_NAME = "markdownlint-no-line-length.json";
const MARKDOWNLINT_NO_LINE_LENGTH_CONFIG = "{\n  \"MD013\": false\n}\n";
function markdownlintNoLineLengthConfigPath() {
	const file = path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), MARKDOWNLINT_NO_LINE_LENGTH_CONFIG_NAME);
	try {
		if (readFileSync(file, "utf8") === MARKDOWNLINT_NO_LINE_LENGTH_CONFIG) return file;
	} catch {}
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, MARKDOWNLINT_NO_LINE_LENGTH_CONFIG);
	renameSync(tmp, file);
	return file;
}
export function buildArgv(tool, resolvedFile, cwd, manifest, spawnCwd = cwd) {
	const dir = path.dirname(resolvedFile);
	const argv = tool.args.slice();
	if (tool.needsCheckstyleConfig) {
		argv.push("-c", resolveCheckstyleConfig(dir, cwd) ?? "/google_checks.xml");
	}
	if (tool.guardYamlLineLength && !hasProjectYamllintConfig(cwd) && !hasUserGlobalYamllintConfig()) {
		argv.push("-d", YAMLLINT_NO_LINE_LENGTH_CONFIG_DATA);
	}
	if (tool.guardMarkdownLineLength && !(tool.name === "markdownlint" ? hasMarkdownlintRc(spawnCwd) : hasProjectMarkdownlintConfig(dir))) {
		argv.push("--config", markdownlintNoLineLengthConfigPath());
	}
	if (tool.manifestPath) {
		const resolved = manifest !== undefined ? manifest : resolveCargoManifest(dir, cwd);
		if (resolved) {
			const sep = argv.indexOf("--");
			argv.splice(sep === -1 ? argv.length : sep, 0, "--manifest-path", resolved);
		}
		return argv;
	}
	argv.push(tool.targetsDir ? dir : fileArg(tool, resolvedFile, spawnCwd));
	return argv;
}
function fileArg(tool, fp, spawnCwd) {
	if (tool.name === "yamllint") return `./${path.relative(spawnCwd, fp)}`;
	return tool.name === "markdownlint-cli2" ? `:${fp}` : fp;
}
export function classifyExit(toolName, status) {
	if (status === null) return "skip";
	switch (toolName) {
		case "shellcheck":
		case "ktlint":
		case "eslint":
		case "oxlint":
		case "ruff":
		case "golangci-lint":
		case "yamllint":
		case "markdownlint-cli2":
		case "markdownlint":
			if (status === 0) return "clean";
			if (status === 1) return "issues";
			return "skip";
		case "go": return status === 0 ? "clean" : "issues";
		case "stylelint":
			if (status === 0) return "clean";
			if (status === 2) return "issues";
			return "skip";
		case "tsc":
			if (status === 0) return "clean";
			if (status === 1 || status === 2) return "issues";
			return "skip";
		case "phpstan": return status === 0 ? "clean" : "issues";
		case "psalm":
			if (status === 0) return "clean";
			if (status === 2) return "issues";
			return "skip";
		case "cargo-clippy":
		case "cargo": return status === 0 ? "clean" : "issues";
		default: return "skip";
	}
}
export function classifyCheckstyleOutput(stdout) {
	const lines = String(stdout ?? "").split(/\r?\n/);
	let lastIdx = lines.length - 1;
	while (lastIdx >= 0 && lines[lastIdx].trim() === "") lastIdx--;
	if (lastIdx < 0 || lines[lastIdx].trim() !== "Audit done.") return {
		status: "skip",
		text: ""
	};
	let firstIdx = 0;
	while (firstIdx < lines.length && lines[firstIdx].trim() === "") firstIdx++;
	const skipFirst = firstIdx < lines.length && lines[firstIdx].trim() === "Starting audit...";
	const body = lines.slice(skipFirst ? firstIdx + 1 : firstIdx, lastIdx).join("\n").trim();
	return body ? {
		status: "issues",
		text: body
	} : {
		status: "clean",
		text: ""
	};
}
export function truncate(text, max = MAX_CONTEXT_CHARS) {
	const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
	if (collapsed.length <= max) return collapsed;
	return collapsed.slice(0, max) + "\n… (truncated)";
}
function selectLintTool(chain, fileDir, cwd) {
	for (const tool of chain) {
		if (onPath(tool.name)) return {
			tool,
			local: null
		};
	}
	for (const tool of chain) {
		const local = tool.npmSpec ? localBin(tool.name, fileDir, cwd) : null;
		if (local) return {
			tool,
			local
		};
	}
	if (!onPath("npx")) return null;
	for (const tool of chain) {
		if (tool.npmSpec) return {
			tool,
			local: null
		};
	}
	return null;
}
function buildSpawnOpts(cwd, timeout) {
	return {
		cwd,
		timeout,
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		maxBuffer: MAX_BUFFER_BYTES
	};
}
function isFileScoped(tool) {
	return !tool.targetsDir && !tool.manifestPath;
}
function chainTarget(tool, manifest, cwd, fp) {
	return tool.targetsDir ? path.relative(cwd, path.dirname(fp)) || "." : manifest ? path.relative(cwd, path.dirname(manifest)) || "." : path.relative(cwd, fp);
}
function planChainLint(lang, resolved, cwd) {
	const sel = selectLintTool(lang.chain, path.dirname(resolved), cwd);
	if (!sel) return null;
	const { tool } = sel;
	let manifest = null;
	if (tool.manifestPath) {
		manifest = resolveCargoManifest(path.dirname(resolved), cwd);
		if (!manifest) return null;
	}
	const spawnCwd = sel.local ? path.join(sel.local, "../../..") : cwd;
	const argv = buildArgv(tool, resolved, cwd, manifest, spawnCwd);
	const timeout = tool.manifestPath ? CARGO_SPAWN_TIMEOUT_MS : SPAWN_TIMEOUT_MS;
	return {
		tool,
		local: sel.local,
		argv,
		spawnCwd,
		timeout,
		manifest
	};
}
const CLIPPY_MISSING_RE = /'cargo-clippy' is not installed for/;
async function runPlan(plan, argv, resolved, cwd) {
	const spawnOpts = buildSpawnOpts(plan.spawnCwd, plan.timeout);
	const result = await runLintTool(plan.tool, argv, spawnOpts, plan.local);
	const next = REGISTRY.rust.chain[REGISTRY.rust.chain.indexOf(plan.tool) + 1];
	if (plan.tool.name !== "cargo-clippy" || !next || result.error || result.signal || result.status === 0 || !CLIPPY_MISSING_RE.test(result.stderr ?? "") || !onPath(next.name)) return {
		tool: plan.tool,
		result
	};
	return {
		tool: next,
		result: await runLintTool(next, buildArgv(next, resolved, cwd, plan.manifest, plan.spawnCwd), spawnOpts, null)
	};
}
function chainOutcome(tool, result) {
	if (!result || result.error || result.signal) return null;
	let verdict;
	let text;
	if (tool.classify === "output") {
		const out = classifyCheckstyleOutput(result.stdout);
		verdict = out.status;
		text = out.text;
	} else {
		verdict = classifyExit(tool.name, result.status);
		text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	}
	return {
		verdict,
		text
	};
}
async function runChainLint(lang, resolved, cwd, rel, coalesce = false, session = "") {
	const none = NO_CHAIN;
	const plan = planChainLint(lang, resolved, cwd);
	if (!plan) return none;
	const { argv, timeout, spawnCwd, manifest } = plan;
	let tool = plan.tool;
	const spawnTool = async () => {
		const ran = await runPlan(plan, argv, resolved, cwd);
		tool = ran.tool;
		return ran.result;
	};
	const key = coalesce ? tool.targetsDir ? hashPath(`${tool.name}:${path.dirname(resolved)}`) : manifest ? hashPath(`${tool.name}:${manifest}`) : null : null;
	const result = key ? await coalesceProjectCheck(key, resolved, timeout, spawnTool, session) : await spawnTool();
	const outcome = chainOutcome(tool, result);
	if (!outcome) return none;
	const target = chainTarget(tool, manifest, cwd, resolved);
	const { verdict, text } = outcome;
	if (verdict === "skip") return none;
	const base = manifest ? path.dirname(manifest) : tool.targetsDir ? path.dirname(resolved) : spawnCwd;
	return {
		ran: true,
		finding: verdict === "issues" ? {
			tool: tool.name,
			target,
			text,
			base
		} : null
	};
}
const TSC_SOURCE_DIAGNOSTIC_RE = /\.(?:ts|tsx|mts|cts)[:(]\d+/;
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;
export function tscOutputHasSourceDiagnostic(text) {
	const plain = text.replace(ANSI_SGR_RE, "");
	return TSC_SOURCE_DIAGNOSTIC_RE.test(plain);
}
async function runTypeCheck(resolved, cwd, coalesce = false, session = "") {
	const tsconfigPath = resolveTsconfig(path.dirname(resolved), cwd);
	if (!tsconfigPath) return null;
	const cachePath = tsBuildInfoPathFor(tsconfigPath);
	try {
		mkdirSync(path.dirname(cachePath), { recursive: true });
	} catch {
		return null;
	}
	const localTsc = path.join(cwd, "node_modules", ".bin", "tsc");
	const bin = onPath("tsc") ? "tsc" : existsSync(localTsc) ? localTsc : null;
	if (!bin) return null;
	const spawnTsc = () => spawnGroup(bin, [
		"--noEmit",
		"--incremental",
		"--tsBuildInfoFile",
		cachePath,
		"-p",
		tsconfigPath
	], buildSpawnOpts(cwd, TSC_SPAWN_TIMEOUT_MS));
	const result = coalesce ? await coalesceProjectCheck(hashPath(`tsc:${tsconfigPath}`), resolved, TSC_SPAWN_TIMEOUT_MS, spawnTsc, session) : await spawnTsc();
	if (!result || result.error || result.signal) return null;
	if (classifyExit("tsc", result.status) !== "issues") return null;
	const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	if (result.status === 1 && !tscOutputHasSourceDiagnostic(text)) return null;
	return {
		tool: "tsc",
		target: path.relative(cwd, path.dirname(tsconfigPath)) || ".",
		text,
		base: cwd
	};
}
export function isExcludedPath(rel) {
	const segments = rel.split(path.sep);
	if (segments.some((s) => s === "node_modules" || s === "vendor" || s === ".git")) return true;
	if (segments.some((s, i) => s === ".claude" && (segments[i + 1] === "worktrees" || segments[i + 1] === "agent-memory"))) return true;
	return segments[segments.length - 1].includes(".local.");
}
function realish(p) {
	try {
		return realpathSync(p);
	} catch (e) {
		if (e.code !== "ENOENT") throw e;
		try {
			lstatSync(p);
		} catch {
			const dir = path.dirname(p);
			return dir === p ? p : path.join(realish(dir), path.basename(p));
		}
		throw e;
	}
}
function scratchpadOf(args) {
	return typeof args.scratchpad_dir === "string" ? args.scratchpad_dir : undefined;
}
function outside(rel) {
	return rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
}
export function scopedTarget(cwd, file, scratchpad, roots) {
	try {
		const fp = path.resolve(cwd, file);
		const ext = path.extname(fp).toLowerCase();
		if (!EXT_MAP[ext] && !TYPE_CHECK_EXTS.has(ext)) return null;
		let real;
		if (roots?.dirs) {
			const st = lstatSync(fp, { throwIfNoEntry: false });
			if (!st) return null;
			if (st.isSymbolicLink()) {
				real = realish(fp);
			} else {
				const dir = path.dirname(fp);
				let dirReal = roots.dirs.get(dir);
				if (dirReal === undefined) {
					dirReal = realish(dir);
					roots.dirs.set(dir, dirReal);
				}
				real = path.join(dirReal, path.basename(fp));
			}
		} else {
			real = realish(fp);
		}
		const rel = path.relative(roots?.cwd ?? realish(cwd), real);
		if (rel === "" || outside(rel) || isExcludedPath(rel)) return null;
		if (scratchpad) {
			const rs = roots ? roots.scratchpad ?? realish(scratchpad) : realish(scratchpad);
			if (real === rs || real.startsWith(rs + path.sep)) return null;
		}
		if (!roots?.dirs && !existsSync(fp)) return null;
		return {
			fp,
			real
		};
	} catch {
		return null;
	}
}
function postToolScope(args) {
	try {
		if (args?.tool_response?.success === false) return null;
		const cwd = typeof args?.cwd === "string" ? args.cwd : "";
		const fp = args?.tool_input?.file_path;
		if (!cwd || typeof fp !== "string" || !fp) return null;
		return scopedTarget(cwd, fp, scratchpadOf(args));
	} catch {
		return null;
	}
}
export function resolveLintTarget(args) {
	return postToolScope(args)?.fp ?? null;
}
export function editRanges(args) {
	const patch = args?.tool_response?.structuredPatch;
	if (args?.tool_name !== "Edit" || !Array.isArray(patch)) return null;
	const ranges = [];
	for (const h of patch) {
		if (typeof h?.newStart !== "number" || !Array.isArray(h.lines)) return null;
		let cur = h.newStart - 1;
		let start = -1;
		let deleted = false;
		const flush = () => {
			if (start !== -1) ranges.push([start, cur - 1]);
			else if (deleted) ranges.push([Math.max(cur - 1, 0), Math.max(cur, 0)]);
			start = -1;
			deleted = false;
		};
		for (const l of h.lines) {
			const c = typeof l === "string" ? l[0] : " ";
			if (c === "+") {
				if (start === -1) start = cur;
				cur++;
			} else if (c === "-") deleted = true;
			else if (c !== "\\") {
				flush();
				cur++;
			}
		}
		flush();
	}
	return ranges;
}
export const SETTLE_MS = 5e3;
export function settleWaitMs(uptimeMs = process.uptime() * 1e3) {
	const raw = process.env.UNIVERSAL_LINT_SETTLE_MS;
	const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
	const base = Number.isFinite(n) && n >= 0 ? n : SETTLE_MS;
	return Math.max(0, Math.min(base, HOOK_TIMEOUT_MS - 1e3 - uptimeMs));
}
export function editHunks(args) {
	const patch = args?.tool_response?.structuredPatch;
	if (args?.tool_name !== "Edit" || !Array.isArray(patch)) return null;
	const hunks = [];
	for (const h of patch) {
		if (typeof h?.oldStart !== "number" || typeof h.newStart !== "number" || !Array.isArray(h.lines)) return null;
		const map = [];
		let next = h.newStart - 1;
		for (const l of h.lines) {
			const c = typeof l === "string" ? l[0] : " ";
			if (c === "\\") continue;
			if (c === "-") map.push(-1);
			else if (c === "+") next++;
			else map.push(next++);
		}
		hunks.push({
			oldStart: h.oldStart,
			oldLines: map.length,
			newStart: h.newStart,
			newLines: next - (h.newStart - 1),
			map
		});
	}
	return hunks;
}
export function carryLine(line, hunks) {
	let shift = 0;
	for (const h of hunks) {
		const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
		if (line < start) break;
		if (line < start + h.oldLines) {
			const n = h.map[line - start];
			return n < 0 ? null : n;
		}
		shift += h.newLines - h.oldLines;
	}
	return line + shift;
}
const LOC_PATH_RE = /(?<![^\s:()[\]'"])(?<path>[^\s:()[\]'"]+\.[A-Za-z0-9]+)[:(](?<line>\d+)(?:[:,]\d+)?/;
const LOC_ROW_RE = /^\s*(?<line>\d+):\d+\s/;
const LOC_SHELLCHECK_RE = /^In .+ line (?<line>\d+):/;
const SHELLCHECK_GCC_RE = /:\d+:\d+: (?:error|warning|info|style|note): /;
const CODE_FRAME_RE = /^\s*\d*\s*[|│]/;
const PARSE_ERROR_RE = /pars(?:e|ing) error|syntax ?error|unexpected (?:token|end|eof|character|indent)|unterminated|unclosed|end of (?:file|input)|\berror: expected\b|\b(?:TS1|SC1)\d{3}\b/i;
export function gateFinding(finding, ranges, resolved, keepParseErrors = true) {
	const seen = new Map();
	const exists = (abs) => {
		let found = seen.get(abs);
		if (found === undefined) {
			found = existsSync(abs);
			seen.set(abs, found);
		}
		return found;
	};
	const hit = (line) => ranges === null || (typeof ranges === "function" ? ranges(line - 1) : ranges.some(([s, e]) => s <= line - 1 && line - 1 <= e)) ? "hit" : "miss";
	const classify = (raw) => {
		const plain = raw.replace(ANSI_SGR_RE, "");
		if (finding.tool === "shellcheck" && !SHELLCHECK_GCC_RE.test(plain)) {
			const sc = LOC_SHELLCHECK_RE.exec(plain);
			return sc?.groups ? hit(Number(sc.groups.line)) : null;
		}
		if (CODE_FRAME_RE.test(plain)) return null;
		const row = LOC_ROW_RE.exec(plain);
		if (row?.groups) return hit(Number(row.groups.line));
		const a = LOC_PATH_RE.exec(plain);
		if (a?.groups) {
			const p = path.normalize(a.groups.path);
			const abs = path.resolve(finding.base, p);
			const own = abs === resolved || !path.isAbsolute(p) && resolved.endsWith(path.sep + p) && !exists(abs);
			return own ? hit(Number(a.groups.line)) : "foreign";
		}
		const b = LOC_SHELLCHECK_RE.exec(plain);
		return b?.groups ? hit(Number(b.groups.line)) : null;
	};
	let located = false;
	let reportable = false;
	const kept = [];
	for (const para of finding.text.split(/\n\s*\n/)) {
		const lines = para.split("\n");
		const kinds = lines.map(classify);
		const starts = kinds.flatMap((k, i) => k === null ? [] : [i]);
		if (starts.length === 0) {
			kept.push(para);
			continue;
		}
		located = true;
		const out = lines.slice(0, starts[0]);
		let any = false;
		const preambleParse = PARSE_ERROR_RE.test(out.join("\n"));
		starts.forEach((start, n) => {
			const seg = lines.slice(start, starts[n + 1] ?? lines.length);
			const parse = preambleParse || PARSE_ERROR_RE.test(seg.join("\n"));
			if (keepParseErrors === "drop" && parse && kinds[start] !== "foreign") return;
			if (kinds[start] === "miss" && !(keepParseErrors === true && parse)) return;
			out.push(...seg);
			any = true;
		});
		if (any) {
			kept.push(out.join("\n"));
			reportable = true;
		}
	}
	if (!located) return finding;
	return reportable ? {
		...finding,
		text: kept.join("\n\n")
	} : null;
}
function writtenDigestPath(real) {
	return path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), "written", hashPath(real));
}
function fileDigest(fp) {
	return digest(readFileSync(fp));
}
function digest(data) {
	return createHash("sha256").update(data).digest("base64");
}
export function writtenContent(args) {
	if (args?.tool_name === "Write") return typeof args.tool_input?.content === "string" ? args.tool_input.content : null;
	const original = args?.tool_response?.originalFile;
	const patch = args?.tool_response?.structuredPatch;
	if (args?.tool_name !== "Edit" || typeof original !== "string" || !Array.isArray(patch)) return null;
	const src = original.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	let out = "";
	let i = 0;
	for (const h of patch) {
		if (typeof h?.oldStart !== "number" || !Array.isArray(h.lines) || !h.lines.every((l) => typeof l === "string")) return null;
		const lines = h.lines;
		const old = lines.filter((l) => l[0] === " " || l[0] === "-").length;
		const start = old === 0 ? h.oldStart : h.oldStart - 1;
		if (start < i || start + old > src.length) return null;
		out += src.slice(i, start).join("");
		i = start;
		lines.forEach((l, k) => {
			if (l[0] === " ") out += src[i++];
			else if (l[0] === "-") i++;
			else if (l[0] === "+") out += l.slice(1) + (lines[k + 1]?.startsWith("\\") ? "" : "\n");
		});
	}
	return out + src.slice(i).join("");
}
export function recordWritten(real, content) {
	try {
		const file = writtenDigestPath(real);
		if (content === null) {
			rmSync(file, { force: true });
			return;
		}
		mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, digest(content));
		renameSync(tmp, file);
	} catch {}
}
function recordWrittenFor(s, args) {
	if (s) recordWritten(s.real, writtenContent(args));
}
function digestOrNull(fp) {
	try {
		return fileDigest(fp);
	} catch {
		return null;
	}
}
function hasForeignLineBreak(fp) {
	try {
		return /\r(?!\n)|[\u0085\u2028\u2029]/.test(readFileSync(fp, "utf8"));
	} catch {
		return true;
	}
}
function settleDir() {
	return path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), "settle");
}
export function recordEdit(fp, real, hunks, before, written) {
	try {
		const dir = settleDir();
		mkdirSync(dir, { recursive: true });
		const now = Date.now();
		for (const n of readdirSync(dir)) if (Math.abs(now - Number(n.split("-")[1])) > HOOK_TIMEOUT_MS) rmSync(path.join(dir, n), { force: true });
		const key = hashPath(real);
		const name = `${key}-${String(now).padStart(15, "0")}-${process.pid}.json`;
		const tmp = path.join(dir, `${name}.tmp`);
		writeFileSync(tmp, JSON.stringify({
			hunks,
			digest: written === undefined ? fileDigest(fp) : written,
			before: before ?? null
		}));
		renameSync(tmp, path.join(dir, name));
		return {
			key,
			name
		};
	} catch {
		return null;
	}
}
function journalTail(rec) {
	if (!rec) return null;
	try {
		return readdirSync(settleDir()).filter((n) => n.startsWith(`${rec.key}-`) && n.endsWith(".json")).sort().at(-1) ?? null;
	} catch {
		return null;
	}
}
export async function settleFindings(findings, resolved, rec, d0, d1) {
	if (findings.length === 0 || !rec || d0 === null || d0 !== d1) return findings;
	try {
		if (findings.every((f) => gateFinding(f, () => false, resolved, "drop")?.text === f.text)) return findings;
	} catch {}
	const wait = settleWaitMs();
	if (wait > 0) await sleep(wait);
	let later;
	try {
		const dir = settleDir();
		const recs = readdirSync(dir).filter((n) => n.startsWith(`${rec.key}-`) && n.endsWith(".json")).sort().map((n) => ({
			name: n,
			...JSON.parse(readFileSync(path.join(dir, n), "utf8"))
		}));
		if (recs.some((r) => r.hunks !== null && !Array.isArray(r.hunks))) return findings;
		let at = -1;
		recs.forEach((r, i) => {
			if (r.digest === d0) at = i;
		});
		if (at === -1) return findings;
		const after = recs.slice(at + 1).filter((r) => r.name !== rec.name);
		if (after.length === 0) return findings;
		let prev = recs[at].digest;
		for (const r of after) {
			if (r.hunks !== null && r.before !== prev) return findings;
			prev = r.digest;
		}
		later = after.map((r) => r.hunks);
	} catch {
		return findings;
	}
	const survives = (line0) => {
		let l = line0;
		for (const h of later) {
			if (h === null) return false;
			const n = carryLine(l, h);
			if (n === null) return false;
			l = n;
		}
		return true;
	};
	try {
		return findings.flatMap((f) => {
			const g = gateFinding(f, survives, resolved, "drop");
			return g ? [g] : [];
		});
	} catch {
		return findings;
	}
}
function chainEntryFor(resolved, cwd) {
	const ext = path.extname(resolved).toLowerCase();
	const lang = EXT_MAP[ext];
	const oxlintConfig = lang === "jsts" ? resolveOxlintConfig(path.dirname(resolved), cwd) : null;
	const noJstsConfig = lang === "jsts" && !oxlintConfig && !walkToRoot(path.dirname(resolved), (d) => anyConfigExists(d, ESLINT_CONFIG_FILENAMES));
	const noCssConfig = lang === "css" && !hasStylelintConfig(path.dirname(resolved), cwd);
	if (!lang || noJstsConfig || noCssConfig) return {
		entry: null,
		oxlintConfig
	};
	const entry = oxlintConfig ? { chain: REGISTRY.oxlint.chain.map((t) => ({
		...t,
		args: [
			...t.args,
			"-c",
			oxlintConfig
		]
	})) } : REGISTRY[lang];
	return {
		entry,
		oxlintConfig
	};
}
const NO_CHAIN = {
	ran: false,
	finding: null
};
function tscNeeded(typeCheckEligible, oxlintConfig, chainRan) {
	return typeCheckEligible && !(oxlintConfig !== null && chainRan && oxlintConfigTypeChecks(oxlintConfig));
}
async function lintResolved(resolved, cwd, ranges, hookEventName, session = "") {
	const rel = path.relative(cwd, resolved);
	const coalesce = hookEventName === "FileChanged";
	const ext = path.extname(resolved).toLowerCase();
	const typeCheckEligible = TYPE_CHECK_EXTS.has(ext);
	const { entry, oxlintConfig } = chainEntryFor(resolved, cwd);
	const chainP = entry ? runChainLint(entry, resolved, cwd, rel, coalesce, session) : Promise.resolve(NO_CHAIN);
	let chain;
	let tsResult = null;
	if (tscNeeded(typeCheckEligible, oxlintConfig, true)) {
		[chain, tsResult] = await Promise.all([chainP, runTypeCheck(resolved, cwd, coalesce, session)]);
	} else {
		chain = await chainP;
		if (tscNeeded(typeCheckEligible, oxlintConfig, chain.ran)) tsResult = await runTypeCheck(resolved, cwd, coalesce, session);
	}
	const findings = [];
	if (chain.finding) findings.push(chain.finding);
	if (tsResult) findings.push(tsResult);
	return findings.flatMap((f) => {
		const g = gateFinding(f, ranges, resolved);
		return g ? [g] : [];
	});
}
function formatFindings(kept, hookEventName, label) {
	if (kept.length === 0) return {};
	const blocks = kept.map((f) => `${f.tool} found issues in ${f.target}:\n${truncate(f.text)}`);
	return { hookSpecificOutput: {
		hookEventName,
		additionalContext: `${label}: ${truncate(blocks.join("\n\n"))}`
	} };
}
export async function lintFileHandler(args, scoped = postToolScope(args)) {
	try {
		const resolved = scoped?.fp;
		if (!scoped || !resolved) return {};
		const ranges = editRanges(args);
		if (ranges?.length === 0) return {};
		const original = args.tool_response?.originalFile;
		const before = typeof original === "string" ? digest(original) : null;
		const wc = writtenContent(args);
		const rec = recordEdit(resolved, scoped.real, editHunks(args), before, wc === null ? null : digest(wc));
		const odd = hasForeignLineBreak(resolved);
		const d0 = digestOrNull(resolved);
		const t0 = journalTail(rec);
		const kept = await lintResolved(resolved, args.cwd, odd ? null : ranges, "PostToolUse");
		const d1 = kept.length > 0 && journalTail(rec) === t0 ? digestOrNull(resolved) : null;
		return formatFindings(await settleFindings(kept, resolved, odd ? null : rec, d0, d1), "PostToolUse", "universal-lint");
	} catch {
		return {};
	}
}
export async function lintFilesHandler(cwd, files) {
	let roots;
	try {
		roots = { cwd: realish(cwd) };
	} catch {
		return [];
	}
	const scoped = new Set();
	for (const file of files) {
		const s = scopedTarget(cwd, file, undefined, roots);
		if (s) scoped.add(s.fp);
	}
	const oxlintConfigs = new Map();
	const groups = new Map();
	for (const fp of scoped) {
		try {
			const { entry, oxlintConfig } = chainEntryFor(fp, cwd);
			const plan = entry ? planChainLint(entry, fp, cwd) : null;
			oxlintConfigs.set(fp, oxlintConfig);
			if (!plan) continue;
			const fileScoped = isFileScoped(plan.tool);
			const key = [
				plan.tool.name,
				plan.local ?? "",
				plan.spawnCwd,
				...fileScoped ? plan.argv.slice(0, -1) : plan.argv
			].join("\0");
			const group = groups.get(key);
			if (group) group.push({
				fp,
				plan
			});
			else groups.set(key, [{
				fp,
				plan
			}]);
		} catch {}
	}
	const ran = new Set();
	const chainBlocks = [];
	const spawnPlan = async (plan, argv, fp) => {
		const { tool, result } = await runPlan(plan, argv, fp, cwd);
		const out = chainOutcome(tool, result);
		return out && {
			...out,
			tool
		};
	};
	const record = (members, out) => {
		if (!out || out.verdict === "skip") return;
		for (const m of members) ran.add(m.fp);
		if (out.verdict !== "issues") return;
		const { tool } = out;
		const { manifest } = members[0].plan;
		const targets = new Set(members.map(({ fp }) => chainTarget(tool, manifest, cwd, fp)));
		chainBlocks.push(`universal-lint: ${tool.name} found issues in ${[...targets].join(", ")}:\n${truncate(out.text, MAX_CONTEXT_CHARS * members.length)}`);
	};
	for (const group of groups.values()) {
		const { plan } = group[0];
		const fileScoped = isFileScoped(plan.tool);
		const step = fileScoped ? BATCH_MAX_FILES : group.length;
		for (let i = 0; i < group.length; i += step) {
			const chunk = group.slice(i, i + step);
			try {
				const argv = fileScoped ? [...plan.argv.slice(0, -1), ...chunk.map((m) => fileArg(plan.tool, m.fp, plan.spawnCwd))] : plan.argv;
				const out = await spawnPlan(plan, argv, chunk[0].fp);
				if ((!out || out.verdict === "skip") && fileScoped && chunk.length > 1) {
					for (const m of chunk) {
						try {
							record([m], await spawnPlan(m.plan, m.plan.argv, m.fp));
						} catch {}
					}
				} else {
					record(chunk, out);
				}
			} catch {}
		}
	}
	const tsFirst = new Map();
	for (const [fp, oxlintConfig] of oxlintConfigs) {
		try {
			if (!tscNeeded(TYPE_CHECK_EXTS.has(path.extname(fp).toLowerCase()), oxlintConfig, ran.has(fp))) continue;
			const tsconfig = resolveTsconfig(path.dirname(fp), cwd);
			if (tsconfig && !tsFirst.has(tsconfig)) tsFirst.set(tsconfig, fp);
		} catch {}
	}
	const tscBlocks = [];
	for (const fp of tsFirst.values()) {
		try {
			const f = await runTypeCheck(fp, cwd);
			if (f) tscBlocks.push(`universal-lint: ${f.tool} found issues in ${f.target}:\n${truncate(f.text)}`);
		} catch {}
	}
	return [...chainBlocks, ...tscBlocks];
}
function slotStale(slot) {
	try {
		if (Math.abs(Date.now() - lstatSync(slot).mtimeMs) >= HOOK_TIMEOUT_MS) return true;
		const pid = Number(readFileSync(slot, "utf8"));
		if (Number.isInteger(pid) && pid > 0) process.kill(pid, 0);
		return false;
	} catch (e) {
		return e.code === "ESRCH";
	}
}
function claimFile(file) {
	if (slotStale(file)) rmSync(file, { force: true });
	try {
		writeFileSync(file, String(process.pid), { flag: "wx" });
		return true;
	} catch (e) {
		if (e.code !== "EEXIST") throw e;
		return false;
	}
}
function sleep100() {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}
export function acquireSlot(untilMs) {
	const dir = path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), "fc-slots");
	mkdirSync(dir, { recursive: true });
	for (;;) {
		for (let i = 0; i < FILE_CHANGED_SLOTS; i++) {
			const slot = path.join(dir, String(i));
			if (claimFile(slot)) return slot;
		}
		if (process.uptime() * 1e3 >= untilMs) return null;
		sleep100();
	}
}
export async function coalesceProjectCheck(key, file, reserveMs, run, session = "") {
	const dir = path.resolve(process.env.CLAUDE_PLUGIN_DATA || tmpdir(), "fc-locks");
	const lock = path.join(dir, `${key}.lock`);
	const last = path.join(dir, `${key}-${hashPath(session)}.last`);
	let changed;
	try {
		changed = statSync(file).ctimeMs;
	} catch {
		return await run();
	}
	const covered = () => {
		try {
			const t = Number(readFileSync(last, "utf8"));
			return t > changed && t <= Date.now();
		} catch {
			return false;
		}
	};
	for (;;) {
		if (covered()) return null;
		try {
			mkdirSync(dir, { recursive: true });
			if (claimFile(lock)) break;
		} catch {
			return await run();
		}
		if (process.uptime() * 1e3 >= FILE_CHANGED_BUDGET_MS - reserveMs) return await run();
		await sleep(100);
	}
	try {
		if (covered()) return null;
		const start = Date.now();
		const r = await run();
		if (!r.error && !r.signal) {
			try {
				writeFileSync(last, String(start));
			} catch {}
		}
		return r;
	} finally {
		try {
			rmSync(lock, { force: true });
		} catch {}
	}
}
export function slotDeadlineMs(ext) {
	return FILE_CHANGED_BUDGET_MS - (EXT_MAP[ext] === "rust" ? CARGO_SPAWN_TIMEOUT_MS : SPAWN_TIMEOUT_MS) - (TYPE_CHECK_EXTS.has(ext) ? TSC_SPAWN_TIMEOUT_MS : 0);
}
export async function fileChangedHandler(args) {
	try {
		if (args?.event === "unlink") return {};
		const cwd = args?.cwd;
		const file = args?.file_path;
		if (typeof cwd !== "string" || !cwd || typeof file !== "string" || !file) return {};
		const s = scopedTarget(cwd, file, scratchpadOf(args));
		if (!s) return {};
		let recorded = null;
		try {
			recorded = readFileSync(writtenDigestPath(s.real), "utf8");
		} catch {}
		if (recorded !== null) {
			if (recorded === fileDigest(s.fp)) return {};
			try {
				rmSync(writtenDigestPath(s.real), { force: true });
			} catch {}
		}
		const rec = recordEdit(s.fp, s.real, null);
		try {
			const status = execFileSync("git", [
				"--no-optional-locks",
				"--literal-pathspecs",
				"status",
				"--porcelain",
				"--untracked-files=normal",
				"--ignored=matching",
				"--",
				s.real
			], {
				cwd: path.dirname(s.real),
				encoding: "utf8",
				timeout: GIT_TIMEOUT_MS,
				stdio: [
					"ignore",
					"pipe",
					"ignore"
				]
			});
			if (status === "" || status.startsWith("!!")) return {};
		} catch {}
		let slot;
		try {
			slot = acquireSlot(slotDeadlineMs(path.extname(s.fp).toLowerCase()));
		} catch {}
		if (slot === null) {
			process.stderr.write(`universal-lint: FileChanged: no lint slot free in time, ${s.fp} not linted\n`);
			return {};
		}
		let kept = [];
		let d0 = null;
		let d1 = null;
		let odd = false;
		try {
			odd = hasForeignLineBreak(s.fp);
			d0 = digestOrNull(s.fp);
			const t0 = journalTail(rec);
			kept = await lintResolved(s.fp, cwd, null, "FileChanged", typeof args.session_id === "string" ? args.session_id : "");
			if (kept.length > 0 && journalTail(rec) === t0) d1 = digestOrNull(s.fp);
		} finally {
			try {
				if (slot) rmSync(slot, { force: true });
			} catch {}
		}
		return formatFindings(await settleFindings(kept, s.fp, odd ? null : rec, d0, d1), "FileChanged", "universal-lint (changed outside Write/Edit)");
	} catch {
		return {};
	}
}
export function watchList(cwd, scratchpad) {
	let out;
	try {
		out = execFileSync("git", [
			"ls-files",
			"-co",
			"--exclude-standard",
			"-z"
		], {
			cwd,
			encoding: "utf8",
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: MAX_BUFFER_BYTES,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		});
	} catch {
		return [];
	}
	let roots;
	try {
		roots = {
			cwd: realish(cwd),
			scratchpad: scratchpad ? realish(scratchpad) : undefined,
			dirs: new Map()
		};
	} catch {
		return [];
	}
	const list = new Set();
	for (const rel of out.split("\0")) {
		if (!rel) continue;
		const fp = scopedTarget(cwd, rel, scratchpad, roots)?.fp;
		if (fp) list.add(fp);
		if (list.size > WATCH_LIMIT) {
			process.stderr.write(`universal-lint: watch list: more than ${WATCH_LIMIT} files, FileChanged linting off for this cwd\n`);
			return [];
		}
	}
	return [...list];
}
export function watchPathsHandler(args) {
	try {
		const ev = typeof args?.hook_event_name === "string" ? args.hook_event_name : "";
		if (ev !== "SessionStart" && ev !== "CwdChanged") return {};
		const cwd = typeof args.new_cwd === "string" && args.new_cwd ? args.new_cwd : args.cwd;
		if (typeof cwd !== "string" || !cwd) return {};
		const list = watchList(cwd, scratchpadOf(args));
		return list.length > 0 ? { hookSpecificOutput: {
			hookEventName: ev,
			watchPaths: list
		} } : {};
	} catch {
		return {};
	}
}
function isMainModule() {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}
async function main() {
	try {
		const input = await json(process.stdin);
		const ev = input?.hook_event_name;
		if (ev === "SessionStart" || ev === "CwdChanged") {
			const r = watchPathsHandler(input);
			if (r.hookSpecificOutput) process.stdout.write(JSON.stringify(r));
			return;
		}
		let ctx;
		if (ev === "FileChanged") ctx = (await fileChangedHandler(input)).hookSpecificOutput?.additionalContext;
		else {
			const scoped = postToolScope(input);
			recordWrittenFor(scoped, input);
			ctx = (await lintFileHandler(input, scoped)).hookSpecificOutput?.additionalContext;
		}
		if (ctx) {
			process.stderr.write(ctx + "\n");
			process.exitCode = 2;
		}
	} catch {}
}
if (isMainModule()) void main();
