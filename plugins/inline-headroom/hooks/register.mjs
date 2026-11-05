import { cacheHitRatio, CELL_WIDTHS, crushQuery, dayKey, foldPending, isCacheDrop, isOwnStorageCall, isToolError, pct, resetCorpus, RETAIN_DAYS, RETRIEVE_NAME, RETRIEVE_TOOL, retrieveKey, rewriteToolResults, ROWS, statsTables, stepEffort, storeOffloaded, tableText, toCount, wantsQuery, windowStart, zeroCounters } from "./policy.mjs";
let toolErrored = false;
const agentErrored = new Set();
const subagents = {
	steps: 0,
	clamped: 0
};
const crush = {
	dropped: 0,
	saved: 0
};
const dedup = {
	spans: 0,
	saved: 0
};
const elide = {
	lines: 0,
	saved: 0
};
const compact = {
	arrays: 0,
	saved: 0
};
const config = {
	texts: 0,
	saved: 0
};
const extract = {
	pages: 0,
	saved: 0
};
const log = {
	texts: 0,
	saved: 0
};
const search = {
	texts: 0,
	saved: 0
};
const diff = {
	texts: 0,
	saved: 0
};
const textcrush = {
	texts: 0,
	saved: 0
};
const split = {
	texts: 0,
	saved: 0
};
const dedupStates = new Map();
const dropCorpus = (key) => {
	const st = dedupStates.get(key);
	if (st) resetCorpus(st);
};
let retrieveReady = false;
const offloaded = new Map();
const folded = new Map();
const session = zeroCounters();
let lastHit;
const WRITER = Math.random().toString(36).slice(2).padEnd(8, "0");
const pending = zeroCounters();
const days = {};
let flushing = Promise.resolve();
let sums;
let loading;
let poll;
let stale = false;
let paneOpen = false;
const PANE = "headroom";
const message = (err) => err instanceof Error ? err.message : String(err);
const RETRIEVE_SPEC = {
	name: RETRIEVE_NAME,
	description: "Retrieve original uncompressed content that was compressed to save tokens. Use this when you need more data than what's shown in compressed tool results. The hash is in compression markers like <<ccr:abc123def456 40_rows_offloaded>> or hash=abc123def456.",
	inputSchema: {
		type: "object",
		properties: { hash: {
			type: "string",
			description: "Hash key from the compression marker (e.g. 'abc123def456' from <<ccr:abc123def456 40_rows_offloaded>> or hash=abc123def456)"
		} },
		required: ["hash"]
	}
};
const retrieve = (hash) => {
	const key = retrieveKey(hash);
	const original = key === undefined ? undefined : offloaded.get(key) ?? folded.get(key);
	return original === undefined ? { deny: `headroom_retrieve: no stored content under hash ${String(hash)} (evicted, or the mod reloaded)` } : { result: original };
};
const count = (k, n = 1) => {
	session[k] += n;
	pending[k] += n;
};
const callStorage = async ($, tool, args) => {
	const c = await $.mcp.connect("storage");
	if (!c.isConnected) throw new Error(c.message);
	const r = await $.mcp.call(c.server, tool, args);
	if (r.isError) throw new Error(r.content[0]?.text ?? "storage call failed");
	return r.structuredContent ?? JSON.parse(r.content[0]?.text ?? "null");
};
const loadSums = async ($) => {
	let fetched;
	try {
		const today = dayKey(await $.clock.now());
		const totals = await Promise.all(ROWS.filter((r) => r.days > 0).map((r) => callStorage($, "stats_sum", { since: windowStart(today, r.days) })));
		fetched = { data: totals };
	} catch (err) {
		fetched = {
			data: sums?.data,
			error: message(err)
		};
	}
	const same = JSON.stringify(fetched) === JSON.stringify(sums);
	sums = fetched;
	if (same) return;
	try {
		$.ui.invalidate("ui.render");
	} catch {}
};
const refresh = ($) => loading ??= loadSums($).finally(() => loading = undefined);
const arm = ($) => {
	if (poll !== undefined) return;
	poll = $.clock.every(1e4, () => {
		stale = true;
		$.ui.invalidate("ui.render");
	});
};
const disarm = () => {
	poll?.cancel();
	poll = undefined;
};
export const register = (on, options) => {
	const effortOn = options.effort_routing_enabled !== false;
	const subOn = effortOn && options.subagent_effort_routing_enabled !== false;
	const cacheOn = options.cache_aligner_enabled !== false;
	const crusherOn = options.smart_crusher_enabled !== false;
	const compactOn = options.lossless_compaction_enabled !== false;
	const dedupOn = options.cross_turn_dedup_enabled !== false;
	const elideOn = options.dense_line_elider_enabled !== false;
	const configOn = options.config_compressor_enabled !== false;
	const htmlOn = options.html_extractor_enabled !== false;
	const logOn = options.log_compressor_enabled !== false;
	const searchOn = options.search_compressor_enabled !== false;
	const diffOn = options.diff_compressor_enabled !== false;
	const textOn = options.text_crusher_enabled !== false;
	const splitOn = options.relevance_split_enabled !== false;
	const tagsOn = options.tag_protector_enabled !== false;
	const shown = [
		effortOn,
		cacheOn,
		crusherOn,
		dedupOn,
		elideOn,
		compactOn,
		configOn,
		htmlOn,
		logOn,
		searchOn,
		diffOn,
		textOn,
		splitOn
	];
	const compressOn = shown.slice(2).some(Boolean);
	const subCompressOn = compressOn && options.subagent_compression_enabled !== false;
	const storageOn = options.storage_enabled !== false;
	on("session.start", async ($, e, next) => {
		await $.command.register({
			name: "headroom",
			description: "inline-headroom stats: effort clamps, cache-hit drops, compression savings"
		});
		if (compressOn) {
			try {
				retrieveReady ||= (await $.tool.register(RETRIEVE_SPEC)).tool === RETRIEVE_TOOL;
			} catch {}
		}
		return next(e);
	});
	const storageTables = effortOn || cacheOn;
	const rowsShown = storageOn && storageTables;
	const note = () => !storageTables ? undefined : !storageOn ? "storage is off (storage_enabled is not true): only the session row is kept" : sums?.error === undefined ? undefined : `storage unavailable: ${sums.error}`;
	const tables = () => statsTables([{
		...session,
		hit: lastHit
	}, ...sums?.data ?? []], note() === undefined ? "…" : "–", {
		subagents: subOn ? subagents : undefined,
		crush,
		dedup,
		elide,
		compact,
		config,
		extract,
		log,
		search,
		diff,
		textcrush,
		split
	}).filter((_, i) => shown[i]);
	const idle = effortOn || cacheOn || compressOn ? undefined : "effort routing, cache aligner, smart crusher, lossless compaction, cross-turn dedup, dense line elider, config compressor, HTML extractor, log compressor, search compressor, diff compressor, text crusher and relevance split are off: nothing to show";
	const paneRows = () => {
		if (idle !== undefined) return 1;
		const blocks = [...tables().map((t) => t.length), ...storageTables ? [1] : []];
		return blocks.reduce((a, b) => a + b, 0) + blocks.length - 1;
	};
	on("command.run", { command: "headroom" }, async ($) => {
		const r = await $.ui.open({
			id: PANE,
			title: "Headroom",
			focus: true,
			closeOnEscape: true,
			rows: paneRows()
		});
		if (r.isPlaced) {
			if (rowsShown) {
				disarm();
				arm($);
				await refresh($);
			}
			return {};
		}
		if (idle !== undefined) return { text: idle };
		if (rowsShown) await refresh($);
		const n = note();
		return { text: [tables().map(tableText).join("\n\n"), ...n === undefined ? [] : [n]].join("\n") };
	});
	on("ui.render", {
		component: "Pane",
		requestId: PANE
	}, async ($, e) => {
		paneOpen = true;
		if (rowsShown) {
			arm($);
			if (stale || sums === undefined) {
				stale = false;
				await refresh($);
			}
		}
		const { Box, Text } = $.ui.resolve(e);
		const table = (rows) => Box({
			flexDirection: "column",
			children: rows.map((row, j) => Box({
				flexDirection: "row",
				children: row.map((s, i) => Box({
					width: CELL_WIDTHS[i],
					justifyContent: i ? "flex-end" : "flex-start",
					children: [Text({
						bold: j === 0,
						children: [s]
					})]
				}))
			}))
		});
		if (idle !== undefined) return Box({
			flexDirection: "column",
			children: [Text({
				dimColor: true,
				children: [idle]
			})]
		});
		const n = note();
		return Box({
			flexDirection: "column",
			gap: 1,
			children: [...tables().map((t) => table(t)), ...n === undefined ? [] : [Text({
				dimColor: true,
				children: [n]
			})]]
		});
	});
	on("ui.close", { id: PANE }, async (_$, e, next) => {
		const r = await next(e);
		if (r.deny === undefined) {
			paneOpen = false;
			disarm();
			sums = undefined;
		}
		return r;
	});
	if (effortOn || compressOn) {
		const failed = (agentId) => {
			if (!effortOn) return;
			if (!agentId) toolErrored = true;
			else if (subOn) agentErrored.add(agentId);
		};
		on("tool.call", async (_$, e, next) => {
			let r;
			try {
				r = e.tool === RETRIEVE_TOOL ? retrieve(e.hash) : await next(e);
			} catch (err) {
				failed(e.agentId);
				throw err;
			}
			if (isToolError(r)) failed(e.agentId);
			return r;
		});
	}
	if (compressOn) {
		const baseLevers = {
			crush: crusherOn,
			compact: compactOn,
			elide: elideOn,
			config: configOn,
			extract: htmlOn,
			log: logOn,
			search: searchOn,
			diff: diffOn,
			textcrush: textOn,
			split: splitOn,
			tags: tagsOn
		};
		on("session.append", { door: "tool-result" }, async ($, e, next) => {
			if (!retrieveReady || e.origin.kind !== "tool" || e.agentId && !subCompressOn) return next(e);
			const tool = e.origin.tool;
			let rw;
			try {
				const levers = {
					...baseLevers,
					dedup: dedupOn ? {
						states: dedupStates,
						key: e.agentId ?? ""
					} : undefined
				};
				let query = "";
				if (wantsQuery(e.message.content, tool, levers)) {
					try {
						const m = e.agentId ? await $.session.messages({ agentId: e.agentId }) : await $.session.messages();
						if (Array.isArray(m)) query = crushQuery(m);
					} catch {}
				}
				rw = rewriteToolResults(e.message.content, tool, levers, query);
			} catch {
				rw = undefined;
			}
			if (!rw) return next(e);
			storeOffloaded(offloaded, rw.offloaded);
			storeOffloaded(folded, rw.folded);
			crush.dropped += rw.crush.dropped;
			crush.saved += rw.crush.saved;
			dedup.spans += rw.dedup.spans;
			dedup.saved += rw.dedup.saved;
			elide.lines += rw.elide.lines;
			elide.saved += rw.elide.saved;
			compact.arrays += rw.compact.arrays;
			compact.saved += rw.compact.saved;
			config.texts += rw.config.texts;
			config.saved += rw.config.saved;
			extract.pages += rw.extract.pages;
			extract.saved += rw.extract.saved;
			log.texts += rw.log.texts;
			log.saved += rw.log.saved;
			search.texts += rw.search.texts;
			search.saved += rw.search.saved;
			diff.texts += rw.diff.texts;
			diff.saved += rw.diff.saved;
			textcrush.texts += rw.textcrush.texts;
			textcrush.saved += rw.textcrush.saved;
			split.texts += rw.split.texts;
			split.saved += rw.split.saved;
			if (paneOpen) {
				try {
					$.ui.invalidate("ui.render");
				} catch {}
			}
			try {
				return await next({
					...e,
					message: {
						...e.message,
						content: rw.content
					}
				});
			} catch (err) {
				dropCorpus(e.agentId ?? "");
				throw err;
			}
		});
	}
	if (dedupOn) {
		on("session.compact", async (_$, e, next) => {
			const r = await next(e);
			if (r.skip === undefined && e.trigger !== "precompute") dropCorpus(e.agentId ?? "");
			return r;
		});
	}
	on("turn.step", async function* ($, e, next) {
		const id = e.agentId;
		if (id) {
			if (!subOn) return yield* next(e);
			subagents.steps++;
			pending.steps++;
			const to = stepEffort(e.index, agentErrored.has(id), e.effort);
			if (to !== undefined) {
				subagents.clamped++;
				pending.clamped++;
			}
			agentErrored.delete(id);
			if (paneOpen) {
				try {
					$.ui.invalidate("ui.render");
				} catch {}
			}
			return yield* next(to === undefined ? e : {
				...e,
				effort: to
			});
		}
		count("steps");
		try {
			let ev = e;
			const to = effortOn ? stepEffort(e.index, toolErrored, e.effort) : undefined;
			if (to !== undefined) {
				ev = {
					...e,
					effort: to
				};
				count("clamped");
			}
			toolErrored = false;
			const result = yield* next(ev);
			if (cacheOn && result?.usage) {
				const u = result.usage;
				count("input_tokens", toCount(u.input_tokens));
				count("cache_read_input_tokens", toCount(u.cache_read_input_tokens));
				count("cache_creation_input_tokens", toCount(u.cache_creation_input_tokens));
				const hit = cacheHitRatio(result.usage);
				if (hit !== undefined) {
					if (isCacheDrop(lastHit, hit)) {
						count("cache_drops");
						$.ui.log(`cache drop ${pct(lastHit)} → ${pct(hit)} (wrote ${result.usage.cache_creation_input_tokens} tok)`);
					}
					lastHit = hit;
				}
			}
			return result;
		} finally {
			try {
				$.ui.invalidate("ui.render");
			} catch {}
		}
	});
	if (storageOn) {
		on("tool.check", async (_$, e, next) => isOwnStorageCall(next.origin.plugin, e.tool) ? {
			decision: "allow",
			reason: "inline-headroom's own /headroom storage call"
		} : next(e));
	}
	if (storageOn || subOn || dedupOn) {
		on("turn.complete", async ($, e, next) => {
			if (e.agentId) {
				agentErrored.delete(e.agentId);
				dropCorpus(e.agentId);
			}
			const r = await next(e);
			if (!storageOn) return r;
			let today;
			let purgeBefore;
			let rows;
			try {
				today = dayKey(await $.clock.now());
				purgeBefore = windowStart(today, RETAIN_DAYS);
				rows = foldPending(days, pending, today, purgeBefore);
			} catch {
				return r;
			}
			flushing = flushing.then(async () => {
				try {
					await callStorage($, "stats_put", {
						writer: WRITER,
						rows,
						purgeBefore
					});
				} catch {
					return;
				}
				for (const d of Object.keys(days)) if (d < today) delete days[d];
				if (poll !== undefined) await refresh($);
			}).catch(() => {});
			await flushing;
			return r;
		});
	}
	on("session.end", async ($, e, next) => {
		Object.assign(session, zeroCounters());
		Object.assign(subagents, {
			steps: 0,
			clamped: 0
		});
		Object.assign(crush, {
			dropped: 0,
			saved: 0
		});
		Object.assign(dedup, {
			spans: 0,
			saved: 0
		});
		Object.assign(elide, {
			lines: 0,
			saved: 0
		});
		Object.assign(compact, {
			arrays: 0,
			saved: 0
		});
		Object.assign(config, {
			texts: 0,
			saved: 0
		});
		Object.assign(extract, {
			pages: 0,
			saved: 0
		});
		Object.assign(log, {
			texts: 0,
			saved: 0
		});
		Object.assign(search, {
			texts: 0,
			saved: 0
		});
		Object.assign(diff, {
			texts: 0,
			saved: 0
		});
		Object.assign(textcrush, {
			texts: 0,
			saved: 0
		});
		Object.assign(split, {
			texts: 0,
			saved: 0
		});
		dedupStates.clear();
		agentErrored.clear();
		lastHit = undefined;
		try {
			$.ui.invalidate("ui.render");
		} catch {}
		const r = await next(e);
		await flushing;
		return r;
	});
};
