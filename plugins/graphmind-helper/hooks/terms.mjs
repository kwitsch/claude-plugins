const MAX_CHARS = 9e3;
export const SETUP_SCRIPTS = [
	"graphmind-session.sh",
	"graphmind-prompt.sh",
	"graphmind-search.sh"
];
export const NUDGE = "⚡ This project is graphmind-indexed. Use /gm <query> for code exploration (symbols, callers, deps, outlines). Grep only for string literals/config values.";
const STOPWORDS = new Set("comment how where what who why which show montre explique explain trace parcour fonctionne marche does is me moi la le les the this that these those a an de du des un une et ou en au pour avec sur dans qui que ce ca il elle nous vous ils sont est ont fait faire peut doit from to in of and or but not for with on at by all each can will would should could may might just also very too here there now then be been have has had do it its i you we they je tu ne pas plus aussi bien tout rien encore deja toujours jamais trop peu maintenant ici oui non ok go fais veux peux dois bump version commit push test build run check fix add remove update change make create delete set get put u ur pls please need want like use using see know think sure yes any some into about after before again still done let lets did was were are am our your my their them him her his she he one two other more most much many out up down off over only same than if else so because thing things way good better best new old".split(" "));
const NOT_TYPED = [
	"<task-notification",
	"<cross-session-message",
	"<command-",
	"<local-command",
	"<system-reminder"
];
const CODE_PROMPT = /comment (fonctionne|marche)|how does|where is|où est|show me|montre|architecture|structure|schema|diagram|explique|explain|what does|qui appelle|who calls|trace|flow|parcour|find|cherche|search|look|refactor|implement|ajoute|^(?=(?<a>.*?add))\k<a>.*to|modify|^(?=(?<c>.*?change))\k<c>.*in|^(?=(?<f>.*?fix))\k<f>.*in|debug|implémente|créer|create/im;
const SEG = String.raw`(^|&&|\|\||;)\s*(rtk\s+)?`;
const GRAPHMIND_CMD = new RegExp(`${SEG}graphmind\\b`, "m");
const SEARCH_CMD = new RegExp(`${SEG}(grep|egrep|rg|ag|ugrep|find|fd|bfs)\\b`, "m");
export function isRecallable(prompt) {
	return prompt.length >= 10 && !NOT_TYPED.some((p) => prompt.startsWith(p));
}
export function isCodePrompt(prompt) {
	return CODE_PROMPT.test(prompt);
}
export function searchTerms(prompt) {
	const text = prompt.replace(/[A-Za-z0-9_.]{200,}/g, " ");
	const idents = (text.match(/[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+|[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+|[A-Za-z][A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*/g) ?? []).map((w) => w.toLowerCase());
	const words = text.toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(" ").filter((w) => /^[a-z_][a-z0-9_]{2,}$/.test(w) && !STOPWORDS.has(w));
	return [...new Set([...idents, ...words])].slice(0, 5).join(" ");
}
function str(v) {
	return typeof v === "string" ? v : "";
}
export function shouldNudge(call) {
	const command = str(call.command);
	const check = `${command} ${str(call.description)}`;
	let search = false;
	if (call.tool === "Grep" || call.tool === "Glob") search = true;
	else if (call.tool === "Bash") search = !GRAPHMIND_CMD.test(command) && SEARCH_CMD.test(command);
	else if (call.tool === "Agent") search = call.subagent_type === "Explore" || /search|find|explore|locate|where is|which file/i.test(str(call.prompt));
	if (!search) return false;
	if (/all (usages|occurrences|references|instances)|find all|list all|exhaustive/i.test(check)) return false;
	return !/\s-[a-zA-Z]*c|\|\s*wc\s|\|\s*sort\s|\|\s*uniq\s/.test(check);
}
export function entryId(line) {
	return /^[\s★]*([0-9a-f]{8})(?![0-9a-zA-Z])/.exec(line)?.[1];
}
export function listing(out) {
	return out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith(">>"));
}
export function fit(head, blocks, max = MAX_CHARS) {
	let text = head;
	const whole = new Set();
	for (const b of blocks) {
		const body = b.lines.join("\n").trimEnd();
		if (!body) continue;
		const block = b.title ? `${b.title}\n${body}\n\n` : `${body}\n\n`;
		const room = max - text.length;
		if (block.length <= room) {
			text += block;
			for (const l of b.lines) whole.add(l);
		} else if (room > 300) {
			const kept = block.slice(0, room - 60).replace(/[\uD800-\uDBFF]$/, "");
			let end = b.title ? b.title.length + 1 : 0;
			for (const l of b.lines) {
				end += l.length;
				if (end <= kept.length) whole.add(l);
				end += 1;
			}
			text += `${kept}\n[graphmind: cut to fit the hook output limit]\n`;
		}
	}
	return {
		text,
		whole
	};
}
export function resolveTools(tools) {
	const find = (suffix) => {
		const hits = tools.map((t) => t.name).filter((n) => /^mcp__.*graphmind.*__gm_/.test(n) && n.endsWith(`__gm_${suffix}`));
		return hits.find((n) => n.includes("plugin_graphmind-helper")) ?? hits[0];
	};
	const status = find("status");
	const map = find("map");
	const memoryList = find("memory_list");
	const search = find("search");
	return status && map && memoryList && search ? {
		status,
		map,
		memoryList,
		search
	} : undefined;
}
export function binaryDirs(pathVar, home, delimiter = ":") {
	const dirs = (pathVar ?? "").split(delimiter).filter((d) => d.startsWith("/"));
	if (home) dirs.push(`${home}/.graphmind/bin`, `${home}/.local/bin`);
	dirs.push("/usr/local/bin");
	return dirs.map((d) => d.replace(/(.)\/+$/, "$1"));
}
