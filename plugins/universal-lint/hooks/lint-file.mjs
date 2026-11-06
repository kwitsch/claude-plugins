#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
const SPAWN_TIMEOUT_MS = 3e4;
const NPX_SPAWN_TIMEOUT_MS = 55e3;
const RTK_NPX_ATTEMPT_TIMEOUT_MS = 5e3;
const MAX_CONTEXT_CHARS = 4e3;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const TSC_SPAWN_TIMEOUT_MS = 45e3;
const CARGO_SPAWN_TIMEOUT_MS = 45e3;
const DEBOUNCE_MS = (() => {
	const raw = process.env.UNIVERSAL_LINT_DEBOUNCE_MS;
	const n = raw ? Number(raw) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : 5e3;
})();
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
	python: { chain: [{
		name: "ruff",
		args: ["check"]
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
		args: [],
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
function onPath(tool) {
	const cached = probeCache.get(tool);
	if (cached !== undefined) return cached;
	let found = false;
	for (const dir of (process.env.PATH || "").split(path.delimiter)) {
		if (!dir) continue;
		try {
			accessSync(path.join(dir, tool), fsConstants.X_OK);
			found = true;
			break;
		} catch {}
	}
	probeCache.set(tool, found);
	return found;
}
export function isToolAvailable(tool, toolOnPath, npxOnPath) {
	return toolOnPath || !!tool.npmSpec && npxOnPath;
}
const RTK_PROBE_TIMEOUT_MS = 5e3;
export function parseRtkPrefix(stdout) {
	const tokens = String(stdout ?? "").trim().split(/\s+/);
	const probeIdx = tokens.indexOf("__RTK_PROBE__");
	if (tokens[0] !== "rtk" || probeIdx < 2) return null;
	return tokens.slice(1, probeIdx);
}
const rtkPrefixCache = new Map();
function getRtkPrefix(tool) {
	const cached = rtkPrefixCache.get(tool.name);
	if (cached !== undefined) return cached;
	const probe = spawnSync("rtk", [
		"rewrite",
		tool.name,
		...tool.args,
		"__RTK_PROBE__"
	], {
		timeout: RTK_PROBE_TIMEOUT_MS,
		encoding: "utf8"
	});
	if (probe.error || probe.signal) return null;
	const prefix = parseRtkPrefix(probe.stdout);
	rtkPrefixCache.set(tool.name, prefix);
	return prefix;
}
function tryRtk(argv, spawnOpts) {
	const result = spawnSync("rtk", argv, spawnOpts);
	if (result.error || result.signal) return null;
	if (result.status !== 0 && !String(result.stdout || "").trim()) return null;
	return result;
}
function runLintTool(tool, argv, spawnOpts) {
	if (tool.npmSpec && !onPath(tool.name)) {
		if (!tool.manifestPath && onPath("rtk")) {
			const rtkPrefix = getRtkPrefix(tool);
			if (rtkPrefix) {
				const rtkResult = tryRtk([...rtkPrefix, ...argv.slice(tool.args.length)], {
					...spawnOpts,
					timeout: RTK_NPX_ATTEMPT_TIMEOUT_MS
				});
				if (rtkResult) return rtkResult;
			}
		}
		return spawnSync("npx", [
			"--yes",
			tool.npmSpec,
			...argv
		], {
			...spawnOpts,
			timeout: NPX_SPAWN_TIMEOUT_MS
		});
	}
	if (!tool.manifestPath && onPath("rtk")) {
		const rtkPrefix = getRtkPrefix(tool);
		if (rtkPrefix) {
			const rtkResult = tryRtk([...rtkPrefix, ...argv.slice(tool.args.length)], spawnOpts);
			if (rtkResult) return rtkResult;
		}
	}
	const spawnName = tool.spawnAs?.name ?? tool.name;
	const spawnArgv = tool.spawnAs ? [...tool.spawnAs.args, ...argv] : argv;
	return spawnSync(spawnName, spawnArgv, spawnOpts);
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
export function resolveCheckstyleConfig(fileDir, cwd) {
	const candidates = [
		"checkstyle.xml",
		".checkstyle.xml",
		path.join("config", "checkstyle", "checkstyle.xml")
	];
	return walkUpToCwd(fileDir, cwd, (dir) => {
		for (const rel of candidates) {
			const p = path.join(dir, rel);
			if (existsSync(p)) return p;
		}
		return null;
	});
}
export function resolveCargoManifest(fileDir, cwd) {
	return walkUpToCwd(fileDir, cwd, (dir) => {
		const p = path.join(dir, "Cargo.toml");
		return existsSync(p) ? p : null;
	});
}
export function resolveTsconfig(fileDir, cwd) {
	return walkUpToCwd(fileDir, cwd, (dir) => {
		const p = path.join(dir, "tsconfig.json");
		if (!existsSync(p)) return null;
		let text;
		try {
			text = readFileSync(p, "utf8");
		} catch {
			return null;
		}
		return !looksLikeSolutionStyleTsconfig(text) ? p : null;
	});
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
export function looksLikeSolutionStyleTsconfig(text) {
	const stripped = stripJsonComments(text);
	const hasReferences = /"references"\s*:/.test(stripped);
	if (!hasReferences) return false;
	const hasInclude = /"include"\s*:/.test(stripped);
	if (hasInclude) return false;
	const filesMatch = stripped.match(/"files"\s*:\s*\[([^\]]*)\]/);
	const hasNonEmptyFiles = !!filesMatch && filesMatch[1].trim() !== "";
	return !hasNonEmptyFiles;
}
function hashPath(p) {
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
	const home = path.resolve(homedir());
	for (;;) {
		if (YAMLLINT_CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name)))) return true;
		if (dir === home) return false;
		const parent = path.dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
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
	return walkToRoot(fileDir, (dir) => MARKDOWNLINT_CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name))));
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
export function buildArgv(tool, resolvedFile, cwd, manifest) {
	const dir = path.dirname(resolvedFile);
	const argv = tool.args.slice();
	if (tool.needsCheckstyleConfig) {
		argv.push("-c", resolveCheckstyleConfig(dir, cwd) ?? "/google_checks.xml");
	}
	if (tool.guardYamlLineLength && !hasProjectYamllintConfig(cwd)) {
		argv.push("-d", YAMLLINT_NO_LINE_LENGTH_CONFIG_DATA);
	}
	if (tool.guardMarkdownLineLength && !hasProjectMarkdownlintConfig(dir)) {
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
	argv.push(tool.targetsDir ? dir : resolvedFile);
	return argv;
}
export function classifyExit(toolName, status) {
	if (status === null) return "skip";
	switch (toolName) {
		case "shellcheck":
		case "ktlint":
		case "eslint":
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
export function truncate(text) {
	const collapsed = text.replace(/\n{3,}/g, "\n\n").trim();
	if (collapsed.length <= MAX_CONTEXT_CHARS) return collapsed;
	return collapsed.slice(0, MAX_CONTEXT_CHARS) + "\n… (truncated)";
}
function selectLintTool(chain) {
	for (const tool of chain) {
		if (onPath(tool.name)) return tool;
	}
	if (!onPath("npx")) return null;
	for (const tool of chain) {
		if (tool.npmSpec) return tool;
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
function runChainLint(lang, resolved, cwd, rel) {
	const tool = selectLintTool(lang.chain);
	if (!tool) return null;
	let manifest = null;
	if (tool.manifestPath) {
		manifest = resolveCargoManifest(path.dirname(resolved), cwd);
		if (!manifest) return null;
	}
	const argv = buildArgv(tool, resolved, cwd, manifest);
	const timeout = tool.manifestPath ? CARGO_SPAWN_TIMEOUT_MS : SPAWN_TIMEOUT_MS;
	const spawnOpts = buildSpawnOpts(cwd, timeout);
	const result = runLintTool(tool, argv, spawnOpts);
	if (result.error || result.signal) return null;
	const target = tool.targetsDir ? path.relative(cwd, path.dirname(resolved)) || "." : manifest ? path.relative(cwd, path.dirname(manifest)) || "." : rel;
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
	if (verdict !== "issues") return null;
	return {
		tool: tool.name,
		target,
		text
	};
}
const TSC_SOURCE_DIAGNOSTIC_RE = /\.(?:ts|tsx|mts|cts)[:(]\d+/;
export function tscOutputHasSourceDiagnostic(text) {
	const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
	return TSC_SOURCE_DIAGNOSTIC_RE.test(plain);
}
function runTypeCheck(resolved, cwd) {
	const tsconfigPath = resolveTsconfig(path.dirname(resolved), cwd);
	if (!tsconfigPath) return null;
	const cachePath = tsBuildInfoPathFor(tsconfigPath);
	try {
		mkdirSync(path.dirname(cachePath), { recursive: true });
	} catch {
		return null;
	}
	const staticArgs = ["--noEmit", "--incremental"];
	const dynamicTail = [
		"--tsBuildInfoFile",
		cachePath,
		"-p",
		tsconfigPath
	];
	const spawnOpts = buildSpawnOpts(cwd, TSC_SPAWN_TIMEOUT_MS);
	let result;
	if (onPath("tsc")) {
		result = runLintTool({
			name: "tsc",
			args: staticArgs
		}, [...staticArgs, ...dynamicTail], spawnOpts);
	} else {
		const localTsc = path.join(cwd, "node_modules", ".bin", "tsc");
		if (!existsSync(localTsc)) return null;
		result = spawnSync(localTsc, [...staticArgs, ...dynamicTail], spawnOpts);
	}
	if (result.error || result.signal) return null;
	if (classifyExit("tsc", result.status) !== "issues") return null;
	const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	if (result.status === 1 && !tscOutputHasSourceDiagnostic(text)) return null;
	return {
		tool: "tsc",
		target: path.relative(cwd, path.dirname(tsconfigPath)) || ".",
		text
	};
}
export function isExcludedPath(rel) {
	const segments = rel.split(path.sep);
	if (segments.some((s) => s === "node_modules" || s === "vendor" || s === ".git")) return true;
	if (segments.some((s, i) => s === ".claude" && (segments[i + 1] === "worktrees" || segments[i + 1] === "agent-memory"))) return true;
	return segments[segments.length - 1].includes(".local.");
}
export function resolveLintTarget(args) {
	try {
		if (args?.tool_response?.success === false) return null;
		const cwd = typeof args?.cwd === "string" ? args.cwd : "";
		const fp = args?.tool_input?.file_path;
		if (!cwd || typeof fp !== "string" || !fp) return null;
		const resolved = path.resolve(cwd, fp);
		if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) return null;
		const rel = path.relative(cwd, resolved);
		if (isExcludedPath(rel)) return null;
		const ext = path.extname(resolved).toLowerCase();
		if (!EXT_MAP[ext] && !TYPE_CHECK_EXTS.has(ext)) return null;
		if (!existsSync(resolved)) return null;
		return resolved;
	} catch {
		return null;
	}
}
export function lintFileHandler(args) {
	try {
		const resolved = resolveLintTarget(args);
		if (!resolved) return {};
		const cwd = args.cwd;
		const rel = path.relative(cwd, resolved);
		const ext = path.extname(resolved).toLowerCase();
		const lang = EXT_MAP[ext];
		const typeCheckEligible = TYPE_CHECK_EXTS.has(ext);
		const findings = [];
		if (lang) {
			const chainResult = runChainLint(REGISTRY[lang], resolved, cwd, rel);
			if (chainResult) findings.push(chainResult);
		}
		if (typeCheckEligible) {
			const tsResult = runTypeCheck(resolved, cwd);
			if (tsResult) findings.push(tsResult);
		}
		if (findings.length === 0) return {};
		const blocks = findings.map((f) => `${f.tool} found issues in ${f.target}:\n${truncate(f.text)}`);
		return { hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: `universal-lint: ${truncate(blocks.join("\n\n"))}`
		} };
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
async function debounceGate(resolved) {
	const token = `${Date.now()}-${process.pid}-${randomBytes(6).toString("hex")}`;
	const dir = path.join(tmpdir(), "universal-lint-debounce");
	const marker = path.join(dir, hashPath(resolved) + ".mark");
	try {
		mkdirSync(dir, { recursive: true });
		const tmp = `${marker}.${token}.tmp`;
		writeFileSync(tmp, token);
		renameSync(tmp, marker);
	} catch {
		return true;
	}
	await sleep(DEBOUNCE_MS);
	try {
		return readFileSync(marker, "utf8").trim() === token;
	} catch {
		return true;
	}
}
async function main() {
	try {
		const input = JSON.parse(readFileSync(0, "utf8"));
		const resolved = resolveLintTarget(input);
		if (!resolved) return;
		if (!await debounceGate(resolved)) return;
		const result = lintFileHandler(input);
		if (result && Object.keys(result).length > 0) {
			process.stdout.write(JSON.stringify(result) + "\n");
		}
	} catch {}
}
if (isMainModule()) void main();
