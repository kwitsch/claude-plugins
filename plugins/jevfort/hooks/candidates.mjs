export const MAX_READS = 8;
const MAX_SEARCHES = 3;
export const SAFE_SCRIPT = /^(test|tests|lint|build|typecheck|type-check|check|test:[\w:-]+|lint:[\w:-]+)$/;
export const BUILTIN_COMMANDS = new Set(("add-dir agents bug clear compact config context cost diff doctor exit export help hooks ide init " + "install-github-app login logout mcp memory model permissions plugin pr-comments release-notes resume " + "review rewind status statusline terminal-setup theme upgrade usage vim").split(" "));
export const SKILL_BLOCKLIST_KEY = "skillBlocklist";
export const SAFE_MAKE = /^(test|tests|check|lint|build|typecheck)$/;
const PATH = /(?:^|[\s`'"([])((?:~|\.{1,2})?\/?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s`'"),:;\]])/g;
const QUOTED = /`([^`\n]{3,60})`|"([^"\n]{3,60})"/g;
export function mentionedPaths(texts) {
	const seen = new Set();
	for (const text of texts) {
		for (const m of text.matchAll(PATH)) {
			const p = m[1];
			if (/^\d/.test(p) || /^https?:/.test(p) || p.includes("..")) continue;
			seen.add(p);
		}
	}
	return [...seen];
}
export function quotedTerms(text) {
	const seen = new Set();
	for (const m of text.matchAll(QUOTED)) {
		const term = (m[1] ?? m[2] ?? "").trim();
		if (term.length >= 3 && !term.includes("'") && !/^[\w./@~-]+\.[A-Za-z]{1,8}$/.test(term)) seen.add(term);
	}
	return [...seen].slice(0, MAX_SEARCHES);
}
const UNSAFE_PATH = /(^|\/)(tmp|private\/tmp|private\/var\/folders|var\/folders)\/|\/\.claude\/|\/tasks\/[^/]+\.output$|\.output$|\.jsonl$/;
const TRANSCRIPT = /\/tasks\/[^/]+\.output$|\.output$|\.jsonl$/;
export const isSafeToOffer = (file, cwd) => cwd && file.startsWith(`${cwd}/`) ? !TRANSCRIPT.test(file) : !UNSAFE_PATH.test(file);
export const absolute = (cwd, p) => p.startsWith("/") ? p : `${cwd}/${p.replace(/^\.\//, "")}`;
export function sameCall(a, b) {
	if (a.tool !== b.tool) return false;
	if (a.tool === "Read") return a.input.file_path === b.input.file_path;
	if (a.tool === "Bash") return String(a.input.command).trim() === String(b.input.command).trim();
	if (a.tool === "Skill") return a.input.skill === b.input.skill;
	if (a.tool === "ToolSearch") return a.input.query === b.input.query;
	return false;
}
export function commandKey(command) {
	const parts = new Set();
	for (const raw of command.split(/&&|\|\||;|\n/)) {
		const seg = raw.split(/(?<!\|)\|(?!\|)/)[0].replace(/\d?>&\d|\d?>\s*\/dev\/null/g, "").trim();
		if (!seg || /^(cd|echo|printf|set|export)\b/.test(seg)) continue;
		const tokens = seg.split(/\s+/);
		const words = [tokens[0], ...tokens.slice(1).filter((t) => /^[a-z][\w:-]*$/.test(t))];
		parts.add(words.slice(0, words[1] === "run" || words[1] === "exec" ? 3 : 2).join(" "));
	}
	return [...parts].sort().join("|");
}
export function equivalentCall(a, b) {
	if (sameCall(a, b)) return true;
	if (a.tool !== "Bash" || b.tool !== "Bash") return false;
	const ka = commandKey(commandOf(a));
	return ka !== "" && ka === commandKey(commandOf(b));
}
const commandOf = (c) => typeof c.input.command === "string" ? c.input.command : "";
export function coversStep(claude, jev) {
	return claude.length === 1 && equivalentCall(claude[0], jev);
}
export const bash = (command, description) => ({
	key: `run ${command}`,
	description,
	tool: "Bash",
	input: {
		command,
		description
	}
});
export const AUTH_TOOL = /__(authenticate|complete_authentication)$/;
const MAX_RELATED = 8;
const STOPWORDS = new Set(("the and for with this that these those when what which where how why who any all can could would should will " + "you your use used using user users from into onto about over than then them they its it's are was were has have " + "had not but also only just some more most very like want need make made create new get set show see one two " + "file files read run runs tool tools skill skills command commands claude code project before after first step " + "please let lets now ok okay yes here there out other each every such via per our we me my is be to of in on at " + "an a or do does did done if so as by up no").split(" "));
export function words(text) {
	const out = new Set();
	for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
		const stem = w.replace(/(ing|ed|es|e|s)$/, "");
		out.add(stem.length >= 3 && !w.endsWith("ss") ? stem : w);
	}
	return out;
}
export function relevant(prompt, items) {
	const want = words(prompt);
	if (!want.size) return [];
	const scored = items.map((item) => {
		const name = words(item.name.replace(/^mcp__/, "").replace(/[_:]+/g, " "));
		const desc = words(item.description);
		let score = 0;
		for (const w of name) if (want.has(w)) score += 2;
		for (const w of desc) if (want.has(w) && !name.has(w)) score += 1;
		return {
			item,
			score
		};
	});
	return scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score).slice(0, MAX_RELATED).map((s) => s.item);
}
export function dedupeSkills(skills) {
	const base = (n) => n.slice(n.lastIndexOf(":") + 1);
	const byBase = new Map();
	for (const s of skills) {
		const kept = byBase.get(base(s.name));
		if (!kept || kept.name.includes(":") && !s.name.includes(":")) byBase.set(base(s.name), s);
	}
	return skills.filter((s) => byBase.get(base(s.name)) === s);
}
export const clipScript = (s) => s.length > 80 ? `${s.slice(0, 80)}…` : s;
