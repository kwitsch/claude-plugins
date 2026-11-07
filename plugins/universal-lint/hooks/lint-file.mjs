#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const SPAWN_TIMEOUT_MS = 3e4;
const NPX_SPAWN_TIMEOUT_MS = 55e3;
const RTK_NPX_ATTEMPT_TIMEOUT_MS = 5e3;
const MAX_CONTEXT_CHARS = 4e3;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const TSC_SPAWN_TIMEOUT_MS = 45e3;
const CARGO_SPAWN_TIMEOUT_MS = 45e3;
export const WATCH_LIMIT = 5e3;
const GIT_TIMEOUT_MS = 1e4;
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
			const p = path.join(dir, n);
			if (existsSync(p)) return p;
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
	const hasNonEmptyFiles = !!filesMatch && filesMatch[1].trim() !== "";
	return !hasNonEmptyFiles;
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
	const none = {
		ran: false,
		finding: null
	};
	const tool = selectLintTool(lang.chain);
	if (!tool) return none;
	let manifest = null;
	if (tool.manifestPath) {
		manifest = resolveCargoManifest(path.dirname(resolved), cwd);
		if (!manifest) return none;
	}
	const argv = buildArgv(tool, resolved, cwd, manifest);
	const timeout = tool.manifestPath ? CARGO_SPAWN_TIMEOUT_MS : SPAWN_TIMEOUT_MS;
	const spawnOpts = buildSpawnOpts(cwd, timeout);
	const result = runLintTool(tool, argv, spawnOpts);
	if (result.error || result.signal) return none;
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
	if (verdict === "skip") return none;
	const base = manifest ? path.dirname(manifest) : tool.targetsDir ? path.dirname(resolved) : cwd;
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
export function scopedTarget(cwd, file, scratchpad, roots) {
	try {
		const fp = path.resolve(cwd, file);
		const real = realish(fp);
		const outside = (rel) => rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
		const rel = path.relative(roots?.cwd ?? realish(cwd), real);
		if (rel === "" || outside(rel) || isExcludedPath(rel)) return null;
		if (scratchpad) {
			const rs = roots ? roots.scratchpad ?? realish(scratchpad) : realish(scratchpad);
			if (real === rs || real.startsWith(rs + path.sep)) return null;
		}
		const ext = path.extname(fp).toLowerCase();
		if (!EXT_MAP[ext] && !TYPE_CHECK_EXTS.has(ext)) return null;
		if (!existsSync(fp)) return null;
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
const LOC_PATH_RE = /(?<path>[^\s:()[\]'"]+\.[A-Za-z0-9]+)[:(](?<line>\d+)(?:[:,]\d+)?/;
const LOC_ROW_RE = /^\s*(?<line>\d+):\d+\s/;
const LOC_SHELLCHECK_RE = /^In .+ line (?<line>\d+):/;
const PARSE_ERROR_RE = /pars(?:e|ing) error|syntax ?error|unexpected (?:token|end|eof|character|indent)|unterminated|unclosed|end of (?:file|input)|\bexpected [`'"]|\b(?:TS1|SC1)\d{3}\b/i;
export function gateFinding(finding, ranges, resolved) {
	const hit = (line) => ranges === null || ranges.some(([s, e]) => s <= line - 1 && line - 1 <= e) ? "hit" : "miss";
	const classify = (raw) => {
		const plain = raw.replace(ANSI_SGR_RE, "");
		const row = LOC_ROW_RE.exec(plain);
		if (row?.groups) return hit(Number(row.groups.line));
		const a = LOC_PATH_RE.exec(plain);
		if (a?.groups) {
			const p = path.normalize(a.groups.path);
			const abs = path.resolve(finding.base, p);
			const own = abs === resolved || !path.isAbsolute(p) && !existsSync(abs) && resolved.endsWith(path.sep + p);
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
			if (kinds[start] === "miss" && !preambleParse && !PARSE_ERROR_RE.test(seg.join("\n"))) return;
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
	return createHash("sha256").update(readFileSync(fp)).digest("base64");
}
export function recordWritten(fp, real) {
	try {
		const file = writtenDigestPath(real);
		mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, fileDigest(fp));
		renameSync(tmp, file);
	} catch {}
}
function recordWrittenFor(s) {
	if (s) recordWritten(s.fp, s.real);
}
function lintResolved(resolved, cwd, ranges, hookEventName, label) {
	const rel = path.relative(cwd, resolved);
	const ext = path.extname(resolved).toLowerCase();
	const lang = EXT_MAP[ext];
	const typeCheckEligible = TYPE_CHECK_EXTS.has(ext);
	const oxlintConfig = lang === "jsts" ? resolveOxlintConfig(path.dirname(resolved), cwd) : null;
	const findings = [];
	let oxlintRan = false;
	if (lang) {
		const entry = oxlintConfig ? { chain: REGISTRY.oxlint.chain.map((t) => ({
			...t,
			args: [
				...t.args,
				"-c",
				oxlintConfig
			]
		})) } : REGISTRY[lang];
		const chain = runChainLint(entry, resolved, cwd, rel);
		if (chain.finding) findings.push(chain.finding);
		oxlintRan = oxlintConfig !== null && chain.ran;
	}
	if (typeCheckEligible && !(oxlintRan && oxlintConfig && oxlintConfigTypeChecks(oxlintConfig))) {
		const tsResult = runTypeCheck(resolved, cwd);
		if (tsResult) findings.push(tsResult);
	}
	const kept = findings.flatMap((f) => {
		const g = gateFinding(f, ranges, resolved);
		return g ? [g] : [];
	});
	if (kept.length === 0) return {};
	const blocks = kept.map((f) => `${f.tool} found issues in ${f.target}:\n${truncate(f.text)}`);
	return { hookSpecificOutput: {
		hookEventName,
		additionalContext: `${label}: ${truncate(blocks.join("\n\n"))}`
	} };
}
export function lintFileHandler(args, scoped = postToolScope(args)) {
	try {
		const resolved = scoped?.fp;
		if (!resolved) return {};
		const ranges = editRanges(args);
		if (ranges?.length === 0) return {};
		return lintResolved(resolved, args.cwd, ranges, "PostToolUse", "universal-lint");
	} catch {
		return {};
	}
}
export function fileChangedHandler(args) {
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
			rmSync(writtenDigestPath(s.real), { force: true });
		}
		try {
			const status = execFileSync("git", [
				"--no-optional-locks",
				"status",
				"--porcelain",
				"--untracked-files=normal",
				"--ignored=matching",
				"--",
				s.fp
			], {
				cwd: path.dirname(s.fp),
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
		return lintResolved(s.fp, cwd, null, "FileChanged", "universal-lint (changed outside Write/Edit)");
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
			scratchpad: scratchpad ? realish(scratchpad) : undefined
		};
	} catch {
		return [];
	}
	const list = [...new Set(out.split("\0").filter(Boolean).flatMap((rel) => {
		const fp = scopedTarget(cwd, rel, scratchpad, roots)?.fp;
		return fp ? [fp] : [];
	}))];
	if (list.length > WATCH_LIMIT) {
		process.stderr.write(`universal-lint: watch list: ${list.length} files above ${WATCH_LIMIT}, FileChanged linting off for this cwd\n`);
		return [];
	}
	return list;
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
function main() {
	try {
		const input = JSON.parse(readFileSync(0, "utf8"));
		const ev = input?.hook_event_name;
		if (ev === "SessionStart" || ev === "CwdChanged") {
			const r = watchPathsHandler(input);
			if (r.hookSpecificOutput) process.stdout.write(JSON.stringify(r));
			return;
		}
		let ctx;
		if (ev === "FileChanged") ctx = fileChangedHandler(input).hookSpecificOutput?.additionalContext;
		else {
			const scoped = postToolScope(input);
			recordWrittenFor(scoped);
			ctx = lintFileHandler(input, scoped).hookSpecificOutput?.additionalContext;
		}
		if (ctx) {
			process.stderr.write(ctx + "\n");
			process.exitCode = 2;
		}
	} catch {}
}
if (isMainModule()) main();
