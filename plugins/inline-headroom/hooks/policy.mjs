// Pure policy for inline-headroom. Never reference the mods `$` here: the
// engine's validation rejects passing the mods API into functions imported
// from another file. All `$` use lives inside hooks in register.ts. No clock
// reads either: time comes in as arguments.

/** @typedef {'low'|'medium'|'high'|'xhigh'|'max'} Effort */
/** @typedef {'uuid'|'iso8601'|'jwt'|'hex_hash'} VolatileKind */
/** @typedef {{id: string, kind: VolatileKind, sample: string}} VolatileFinding */
/** @typedef {{steps: number, clamped: number, cache_drops: number, input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number}} Counters */
/** @typedef {Counters & {hit?: number}} Row hit: the ratio to show in place of the token-weighted one (the session row shows its last step's) */
/** @typedef {{ role: 'user'|'assistant', text: string, toolUses: readonly { input: Record<string, unknown> }[] }} QueryMessage the SessionMessage fields crushQuery reads */
/**
 * A crushed document: compact text, rows and items lost, arrays rendered losslessly and the characters those tables saved,
 * [hash, original text (a crushed array's JSON, an elided block, a folded span)] per crushed array.
 * @typedef {{ text: string, rowsDropped: number, compacted: number, compactSaved: number, offloaded: [string, string][] }} CrushOutcome
 */
/** @typedef {{ rowsDropped: number, compacted: number, compactSaved: number, offloaded: [string, string][] }} CrushAcc processValue's running totals, mutated */
/** @typedef {{ lossy: boolean, lossless: boolean }} CrushModes which SmartCrusher stages run: the lossy row drop, the lossless table */
/** @typedef {{ name: string, type: string, nullable: boolean }} FieldSpec one compaction column (upstream FieldSpec) */
/**
 * One compaction cell (upstream CellValue without OpaqueRef): a scalar (any JSON value), a missing key, or a nested compaction.
 * @typedef {{ s: unknown } | { m: true } | { n: Compaction }} Cell
 */
/** @typedef {{ key: string, fields: FieldSpec[], rows: Cell[][] }} Bucket one bucket of a heterogeneous array: its discriminator value and its table */
/**
 * The compaction IR (upstream Compaction without OpaqueRef): a table, buckets split by a discriminator, or the items untouched.
 * @typedef {{ kind: "table", fields: FieldSpec[], rows: Cell[][] } | { kind: "buckets", disc: string, buckets: Bucket[] } | { kind: "untouched", value: unknown }} Compaction
 */
/** @typedef {{ left: number }} WorkBudget a scan's remaining work units, mutated; below 0 means exhausted */
/** @typedef {{ text: string, lines: number, offloaded: [string, string][] }} Elision a dense-line-elided text: the shortened text, the lines elided, [hash, original text] */
/**
 * One conversation's dedup corpus: the last ordinal handed out, each indexed block's verbatim lines (null where folded) by
 * ordinal, the anchor index (match key → [ordinal, line] first-seen, at most 16), and the indexed characters.
 * @typedef {{ turn: number, corpus: Map<number, (string|null)[]>, index: Map<string, [number, number][]>, chars: number }} DedupState
 */
/** @typedef {{ text: string, spans: number, offloaded: [string, string][] }} Fold a deduplicated text: the text with pointers, the runs folded, [hash, run text] per run */
/** @typedef {{ type: string } & Record<string, unknown>} ContentBlock one Messages-API content block, as session.append hands it */
/**
 * Upstream ContentType tags (as_str); 'tabular' is git status here, 'structured_config' is Python's (Rust has no such tag).
 * @typedef {'json_array'|'diff'|'html'|'tabular'|'search'|'build'|'structured_config'|'source_code'|'text'} ContentType
 */
/**
 * A compression step a content type's route may run: a lever, or (logfold, searchfold, difffold, textfold) a compressor's
 * lossless fold, which belongs to that compressor's lever.
 * @typedef {'crush'|'config'|'extract'|'elide'|'split'|'logfold'|'log'|'searchfold'|'search'|'difffold'|'diff'|'textfold'|'textcrush'} RouteStep
 */
/** @typedef {{ close: boolean, nameEnd: number, end: number, selfClosing: boolean }} TagToken one `<name …>` or `</name>` tag: its kind, where its name ends, where it ends */
/** @typedef {'yaml'|'toml'|'ini'} ConfigFlavor a structured config's dialect */
/**
 * Which levers rewrite this row; dedup names the conversations map and this row's key ("" main, else agentId).
 * The log, search and diff compressors, the text crusher and the relevance split are off when omitted.
 * @typedef {{
 *   crush: boolean, compact?: boolean, elide: boolean, config?: boolean, extract?: boolean,
 *   log?: boolean, search?: boolean, diff?: boolean, textcrush?: boolean, split?: boolean,
 *   tags?: boolean, dedup?: { states: Map<string, DedupState>, key: string }
 * }} Levers
 */
/**
 * A rewritten tool-result row: its blocks, the originals for the CCR store (`offloaded`: the crusher's and the elider's sole copies;
 * `folded`: dedup runs, which a pointer's earlier result still holds), and each lever's savings.
 * @typedef {object} RowRewrite
 * @property {ContentBlock[]} content
 * @property {[string, string][]} offloaded
 * @property {[string, string][]} folded
 * @property {{ dropped: number, saved: number }} crush
 * @property {{ arrays: number, saved: number }} compact
 * @property {{ texts: number, saved: number }} config
 * @property {{ pages: number, saved: number }} extract
 * @property {{ lines: number, saved: number }} elide
 * @property {{ spans: number, saved: number }} dedup
 * @property {{ texts: number, saved: number }} log the log compressor's rewrites, its lossless fold's included
 * @property {{ texts: number, saved: number }} search the search compressor's rewrites, its lossless fold's included
 * @property {{ texts: number, saved: number }} diff the diff compressor's rewrites, its index-line strip's included
 * @property {{ texts: number, saved: number }} textcrush the text crusher's rewrites, its lossless fold's included
 * @property {{ texts: number, saved: number }} split the relevance split's rewrites
 */
/**
 * The in-memory, session-only /headroom counters (statsTables' `memory`).
 * @typedef {object} StatsMemory
 * @property {{ steps: number, clamped: number }} [subagents]
 * @property {{ dropped: number, saved: number }} [crush]
 * @property {{ spans: number, saved: number }} [dedup]
 * @property {{ lines: number, saved: number }} [elide]
 * @property {{ arrays: number, saved: number }} [compact]
 * @property {{ texts: number, saved: number }} [config]
 * @property {{ pages: number, saved: number }} [extract]
 * @property {{ texts: number, saved: number }} [log]
 * @property {{ texts: number, saved: number }} [search]
 * @property {{ texts: number, saved: number }} [diff]
 * @property {{ texts: number, saved: number }} [textcrush]
 * @property {{ texts: number, saved: number }} [split]
 */
/**
 * One dict-array field (upstream FieldStats); the numeric statistics are absent when not finite.
 * @typedef {{ name: string, type: string, unique: number, ratio: number, min?: number, max?: number, mean?: number, variance?: number, changePoints: number[], avgLen?: number }} FieldStats
 */
/**
 * A dict array's analysis: fields sorted by name, the planner (or skip), and the rows no plan drops.
 * @typedef {{ fields: FieldStats[], strategy: 'skip'|'time_series'|'cluster'|'top_n'|'smart_sample', errors: number[], outliers: Set<number>, anomalies: Set<number> }} Analysis
 */
/**
 * One dict array's planning inputs: rows, their compact and sorted-key JSON, the analysis, the query and the row budget K.
 * @typedef {{ items: Record<string, unknown>[], strings: string[], canon: string[], analysis: Analysis, query: string, max: number }} CrushPlan
 */

export const EFFORT_ORDER = /** @type {const} */ (["low", "medium", "high", "xhigh", "max"]);
export const CACHE_DROP_THRESHOLD = 0.6;
export const MAX_FINDINGS = 10;
/** The /headroom table rows, top to bottom. `days`: the rolling window, today included; 0 = this session, in memory. */
export const ROWS = /** @type {const} */ ([
  { label: "session", days: 0 },
  { label: "today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
]);
/** Table column widths in cells: the row label, then each value column. */
export const CELL_WIDTHS = /** @type {const} */ ([16, 8, 8]);
/** Persisted days kept: the longest row's window, never less. */
export const RETAIN_DAYS = 30;
/** The name register.ts registers the retrieval tool under. */
export const RETRIEVE_NAME = "headroom_retrieve";
/** This plugin's name, as `next.origin.plugin` reads it for the mod's own `$` calls. */
export const PLUGIN = "inline-headroom";
/** headroom_retrieve's full name: the tool.register op serves a mod tool as `mcp__<plugin>__<name>`. */
export const RETRIEVE_TOOL = `mcp__${PLUGIN}__${RETRIEVE_NAME}`;
/** A JSON document is crushed only above this many characters (upstream min_tokens_to_crush 200 × 4 chars per token: the mod has no tokenizer). */
export const CRUSH_MIN_CHARS = 800;
/** Characters of assistant tool-call input JSON the crusher's query keeps in all, newest first (a deviation: upstream has no cap). */
export const CRUSH_QUERY_INPUT_CHARS = 16_384;
/** Offloaded originals kept for headroom_retrieve, oldest evicted first (upstream CCR DEFAULT_CAPACITY). */
export const CCR_CAPACITY = 1000;
/** Characters of offloaded originals kept in all (about 32 MB as UTF-16), oldest evicted first. Deviation: upstream caps by count only. */
export const CCR_MAX_CHARS = 16_000_000;
/** Upstream ERROR_KEYWORDS: a row whose lowercased JSON holds one is never dropped. */
export const ERROR_KEYWORDS = /** @type {const} */ (["error", "exception", "failed", "failure", "critical", "fatal", "crash", "panic", "abort", "timeout", "denied", "rejected"]);

const TOKEN_SPLIT = /[\s"'`()<>[\]{},;]+/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*)?$/;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_RE = /^[0-9a-f]+$/i;
const HEX_LENGTHS = new Set([32, 40, 64]);
// The persisted counters in mcp/server.mjs STATS_KEYS order. That file stays import-free, so the list is
// repeated on purpose; test/inline-headroom/storage.test.mjs pins both orders.
const COUNTER_KEYS = /** @type {const} */ (["steps", "clamped", "cache_drops", "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]);
const DAY_MS = 86400000;
// SmartCrusher defaults: upstream SmartCrusherConfig::default() and compute_optimal_k's min_k.
const MAX_ITEMS_AFTER_CRUSH = 15;
const MIN_K = 3;
// CJK code point ranges (kana, ideographs, Hangul), as upstream's is_cjk_char.
const CJK_RANGES = [
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
];
const MIN_ITEMS_TO_ANALYZE = 5;
const VARIANCE_THRESHOLD = 2.0;
const RELEVANCE_THRESHOLD = 0.3;
const MAX_PROCESS_DEPTH = 50;
// Lossless compaction: upstream SmartCrusherConfig::default() (lossless_min_savings_ratio) and CompactConfig::default().
const LOSSLESS_MIN_SAVINGS = 0.15;
const COMPACT_MIN_ITEMS = 2;
const COMPACT_CORE_FIELD_FRACTION = 0.8;
const COMPACT_HETEROGENEOUS_CORE_RATIO = 0.6;
const COMPACT_MAX_FLATTEN_INNER_KEYS = 6;
const COMPACT_MIN_BUCKETS = 2;
const COMPACT_MAX_BUCKETS = 8;
const COMPACT_MAX_DISCRIMINATOR_RATIO = 0.7;
// Deviation: a column name holding one of these would make the `[N]{name:type,…}` header undecodable (upstream leaves names unescaped).
const COMPACT_BAD_NAME_RE = /[,:{}?\n\r]/;
// String, number and mixed-array crushers: upstream SmartCrusherConfig::default() first_fraction and last_fraction.
const K_FIRST_FRACTION = 0.3;
const K_LAST_FRACTION = 0.15;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// shortcut: Python int() also takes `_` digit separators; add them if a payload needs it.
const PY_INT_RE = /^\s*[+-]?\d+\s*$/;
// Anchor weights (front, middle, back) per planner, from upstream AnchorConfig::default(). The search pattern's
// weights are left out: the top_n planner selects no anchors.
const ANCHOR_WEIGHTS = {
  smart_sample: [0.5, 0.1, 0.4],
  cluster: [0.15, 1 - 0.15 - 0.75, 0.75],
  time_series: [0.45, 0.1, 0.45],
};
const RECENCY_WORDS = ["latest", "recent", "last", "newest", "current", "now"];
const HISTORICAL_WORDS = ["first", "oldest", "earliest", "original", "initial", "beginning"];
// Query anchors (upstream anchors.rs); JS \b is ASCII-only where Rust's is Unicode.
const ANCHOR_UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const ANCHOR_NUMBER_RE = /\b\d{4,}\b/g;
const ANCHOR_HOST_RE = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})?\b/g;
const ANCHOR_QUOTED_RE = /['"]([^'"]{1,50})['"]/g;
const ANCHOR_EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const BM25_TOKEN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{4,}\b|[a-z0-9_]+/g;
// The mod's own storage tools are never crushed: a kv_get → edit → kv_set would write the row loss back to storage.db.
const OWN_STORAGE_PREFIX = `mcp__plugin_${PLUGIN}_storage__`;
const RETRIEVE_SUFFIX = `__${RETRIEVE_NAME}`;
// Dense line elider: upstream dense_line_elider.py.
const DENSE_MIN_LINE_CHARS = 300;
const DENSE_MAX_SPACE_RATIO = 0.06;
const DENSE_MIN_TOTAL_CHARS = 2000;
const DENSE_HEAD_CHARS = 160;
const DENSE_TAIL_CHARS = 80;
// JSON span scan work budget: upstream recursive_json.py.
const SCAN_BUDGET_PER_CHAR = 4;
const SCAN_BUDGET_FLOOR = 4096;
// Cross-turn dedup: upstream cross_turn_dedup.py.
const DEDUP_MIN_LINES = 3;
const DEDUP_MIN_CHARS = 40;
const DEDUP_MAX_ANCHOR_CANDIDATES = 16;
const DEDUP_LINENO_RE = /^([1-9]\d*)(:|\t)([\s\S]*)$/;
const DEDUP_TRIVIAL = new Set(["return", "pass", "else:", "try:", "except:", "finally:", "break", "continue", "});", "})", "],", "),", '"""', "'''", "..."]);
// shortcut: about a 1M-token context at 4 chars per token; older content has left the model's window. Raise it if long sessions stop folding.
/** Indexed dedup characters kept across all conversations, least recently appended conversation dropped first. Deviation: upstream rebuilds per request and needs no cap. */
export const DEDUP_MAX_CHARS = 4_000_000;
// Content detector: upstream content_detector.py, branch order of content_detector.rs (read 2026-10-11 at 976aa71).
const JSON_MIN_BULK_FRACTION = 0.6;
const DETECT_MAX_LINE_CHARS = 1000;
const DIFF_HEADER_RE = /^(?:diff --git|diff --combined |diff --cc |--- a\/|@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@|@@@+\s+-\d+(?:,\d+)?\s+(?:-\d+(?:,\d+)?\s+)+\+\d+(?:,\d+)?\s+@@@+)/;
const DIFF_CHANGE_RE = /^[+-][^+-]/;
const HTML_DOCTYPE_RE = /^\s*<!doctype\s+html/i;
const HTML_TAG_RE = /<html[\s>]/i;
const HTML_HEAD_RE = /<head[\s>]/i;
const HTML_BODY_RE = /<body[\s>]/i;
// Global, so only ever used through String.prototype.match, which resets lastIndex.
const HTML_STRUCTURAL_RE = /<(?:div|span|script|style|link|meta|nav|header|footer|aside|article|section|main)[\s>]/gi;
const GIT_STATUS_HEADERS = new Set(["Changes to be committed:", "Changes not staged for commit:", "Untracked files:", "Unmerged paths:"]);
const GIT_STATUS_ENTRY_RE = /^\s+(?:new file|modified|deleted|renamed|copied|typechange|both modified|both added|both deleted|added by us|deleted by us|added by them|deleted by them):\s+\S/;
// The separators of Python's str.splitlines(), used by git status only.
// eslint-disable-next-line no-control-regex -- \x1c-\x1e are splitlines() separators, matched on purpose
const LINE_BREAK_RE = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u{2028}\u{2029}]/u;
// Upstream lossless_compaction.py _TIMESTAMP_ROW_RE: a timestamped log row is never a grep line.
const TIMESTAMP_ROW_RE = /^\s*\[?(?:\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}|\d{2}\/\d{2}\/\d{2,4}[ T]\d{1,2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}|\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?:\s|\]|$))/;
const SEARCH_LINE_RE = /^[^\s:]+:\d+:/;
const GREP_COLON_DASH_RE = /^[^\s:]+:\d+-/;
const GREP_CONTEXT_RE = /^([^\s:]+?)-\d+-/;
// Structured config: upstream content_detector.py _CONFIG_*/_TOML_*/_YAML_* patterns (_INI_ASSIGN_RE is the isIniAssign scanner).
const CONFIG_SECTION_RE = /^\s*\[\[?[\w.\-"' ]+\]\]?\s*$/;
const TOML_ASSIGN_RE = /^\s*(?:[\w.-]+|"[^"]+"|'[^']+')\s*=\s*\S/;
const TOML_KEY_RE = /^\s*(?:[\w.-]+|"[^"]+"|'[^']+')\s*=/;
const YAML_KEY_RE = /^\s*(?:-\s+)?(?:[\w./-]+|"[^"]+"|'[^']+')\s*:(?:\s|$)/;
const YAML_LIST_RE = /^\s*-\s+\S/;
const YAML_DOC_RE = /^---\s*$|^\.\.\.\s*$/;
const CONFIG_COMMENT_RE = /^\s*[#;]/;
const INI_KEY_CHAR_RE = /[\w.\-@ ]/;
// What the TOML flavor check accepts as a value (it stands in for tomllib): strings, numbers, booleans, dates/times, arrays, tables.
const TOML_STRING_RE = /^(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/;
const TOML_NUMBER_RE = /^[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?|0x[\dA-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan)$/;
const TOML_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$|^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const LINE_NUMBERED_RE = /^\s*[1-9]\d*\t/;
const CONFIG_MAX_CHARS = 1_000_000;
// Config compressor: upstream config_compressor.py and lossless_compaction.py (collapse_runs, fold_repeated_blocks).
const YAML_BLOCK_SCALAR_RE = /(?::\s*|^\s*-\s+)[|>][+-]?\d*\s*$/m; // `key: |` or a sequence item `- |`
const TOML_MULTILINE_RE = /"""|'''/;
const RUN_MARKER_RE = /^\.\.\. \(repeated (\d+) times\)$/;
const BLOCK_MARKER_RE = /^\.\.\. \(repeats (\d+) lines from (\d+) lines back\)$/;
const FOLD_MIN_BLOCK = 3;
const FOLD_MAX_BLOCK = 64;
const FOLD_MAX_CANDIDATES = 8;
const FOLD_MAX_LINES = 20_000;
// HTML extractor: a bounded stand-in for upstream html_extractor.py (trafilatura, images and comments off).
// Skipped whole, open tag to close tag: boilerplate and non-text content.
const HTML_DROP = new Set("head script style noscript template svg math iframe object embed canvas audio video picture nav footer aside button select textarea".split(" "));
// A new line at open and close.
const HTML_BLOCK = new Set("p div section article main header ul ol dl dt dd table thead tbody tfoot tr blockquote pre figure figcaption address details summary hgroup search hr".split(" "));
const HTML_HEADING_RE = /^h([1-6])$/;
const HTML_HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const HTML_ENTITY_RE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g;
/** @type {Record<string, string>} */
const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
// One cached `</name\s*>` search per dropped element name (global, so a search starts at lastIndex).
/** @type {Map<string, RegExp>} */
const HTML_CLOSE_RES = new Map();
// Tag protector: upstream tag_protector.rs HTML5_TAGS, element for element; every other tag name is a custom (workflow) tag.
const HTML5_TAGS = new Set(
  (
    "html base head link meta style title body address article aside footer h1 h2 h3 h4 h5 h6 header hgroup main nav section search " +
    "blockquote dd div dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby " +
    "s samp small span strong sub sup time u var wbr area audio img map track video embed iframe object param picture portal source svg " +
    "math canvas noscript script del ins caption col colgroup table tbody td tfoot th thead tr button datalist fieldset form input label " +
    "legend meter optgroup option output progress select textarea details dialog summary slot template"
  ).split(" "),
);
// Upstream _LOG_PATTERNS in order, each tried with search(); indexes 0 and 1 are the error / warn patterns.
const LOG_PATTERNS = [
  /\b(?:ERROR|FAIL|FAILED|FATAL|CRITICAL)\b/i,
  /\b(?:WARN|WARNING)\b/i,
  /\b(?:INFO|DEBUG|TRACE)\b/i,
  /^\s*\d{4}-\d{2}-\d{2}/,
  /^\s*\[\d{2}:\d{2}:\d{2}\]/,
  /^={3,}|^-{3,}/,
  /^\s*PASSED|^\s*FAILED|^\s*SKIPPED/,
  /^npm ERR!|^yarn error|^cargo error/,
  /Traceback \(most recent call last\)/,
  /^\w*(?:Error|Exception):/,
  /^\s*at\s+[\w.$/]+\(/,
  /^\s*at async \S/,
  /^(?:panic|fatal error): /,
  /^goroutine \d+ \[/,
  /^\t\S+\.go:\d+ \+0x/,
  /^thread '[^']*' panicked at/,
  /^stack backtrace:/,
  /^\s+\d+: \S/,
  /^\s+at \S+:\d+:\d+$/,
  /^Unhandled exception\./,
  /^\s*at [\s\S]+\) in [\s\S]+:line \d+/,
  /^Caused by: /,
  /^\s*\.\.\. \d+ more$/,
  /^<!\[LOG\[/,
];
// Upstream _CODE_PATTERNS in dict order. Python calls pattern.match(line), so every pattern is anchored with ^.
/** @type {[string, RegExp[]][]} */
const CODE_PATTERNS = [
  ["python", [/^\s*(?:def|class|import|from|async def)\s+\w+/, /^\s*@\w+/, /^\s*"""/, /^\s*if __name__\s*==/]],
  ["javascript", [/^\s*(?:function|const|let|var|class|import|export)\s+/, /^\s*(?:async\s+function|=>\s*\{)/, /^\s*module\.exports/]],
  ["typescript", [/^\s*(?:interface|type|enum|namespace)\s+\w+/, /^:\s*(?:string|number|boolean|any|void)\b/]],
  ["go", [/^\s*(?:func|type|package|import)\s+/, /^\s*func\s+\([^)]+\)\s+\w+/]],
  ["rust", [/^\s*(?:fn|struct|enum|impl|mod|use|pub)\s+/, /^\s*#\[/]],
  ["java", [/^\s*(?:public|private|protected)\s+(?:class|interface|enum)/, /^\s*@\w+/, /^\s*package\s+[\w.]+;/]],
  [
    "csharp",
    [
      /^\s*using\s+[\w.]+\s*;/,
      /^\s*namespace\s+[\w.]+/,
      /^\s*(?:public|private|protected|internal|sealed|static|abstract|partial)\s+(?:class|struct|record|interface|enum)\b/,
      /^[\s\S]*\b(?:get|set|init);/,
    ],
  ],
  ["php", [/^<\?php\b/, /^\s*namespace\s+[\w\\]+\s*;/, /^\s*use\s+[\w\\]+(?:\s+as\s+\w+)?\s*;/, /^\s*(?:public|private|protected|static|abstract|final)?\s*function\s+\w+\s*\(/, /^\$this->/]],
];

/**
 * Whether a tool.check decides this mod's own storage call: the mods API's `mcp.call` reaches core's permission step as a
 * `tool.call` (live on 2.1.296, although the typings promise no prompt), so without an allow rule a headless
 * session denies every `/headroom` write and an interactive one asks. The model's own storage calls are not covered.
 * @param {string} originPlugin `next.origin.plugin`
 * @param {string} tool
 * @returns {boolean}
 */
export function isOwnStorageCall(originPlugin, tool) {
  return originPlugin === PLUGIN && tool.startsWith(OWN_STORAGE_PREFIX);
}

/**
 * Clamp-only: returns `target` only when `current` is a known effort level
 * strictly above it; otherwise undefined (absent, numeric, unknown, at/below).
 * @param {unknown} current
 * @param {Effort} [target='low']
 * @returns {Effort|undefined}
 */
export function clampEffort(current, target = "low") {
  if (typeof current !== "string") return undefined;
  const c = EFFORT_ORDER.indexOf(/** @type {Effort} */ (current));
  return c > EFFORT_ORDER.indexOf(target) ? target : undefined;
}

/**
 * The routing rule shared by the main loop and every subagent: a mechanical
 * step (after index 0, no tool error since the loop's last step) is clamped.
 * @param {number} index the step's index in its loop (0 = the ask step)
 * @param {boolean} errored a tool error since that loop's last step
 * @param {unknown} effort the step's current effort
 * @returns {Effort|undefined} the lowered effort, or undefined to leave it
 */
export function stepEffort(index, errored, effort) {
  return index > 0 && !errored ? clampEffort(effort) : undefined;
}

/**
 * A tool.call result is a failure when it is errored or denied.
 * @param {Record<string, unknown>} result
 * @returns {boolean}
 */
export function isToolError(result) {
  return result.isError === true || typeof result.deny === "string";
}

/**
 * Anchored per-token classification (upstream CacheAligner's four classes).
 * @param {string} tok
 * @returns {VolatileKind|undefined}
 */
function classify(tok) {
  if (UUID_RE.test(tok)) return "uuid";
  if (ISO_RE.test(tok) && !Number.isNaN(Date.parse(tok))) return "iso8601";
  if (tok.startsWith("eyJ") && JWT_RE.test(tok)) return "jwt";
  if (HEX_LENGTHS.has(tok.length) && HEX_RE.test(tok)) return "hex_hash";
  return undefined;
}

/**
 * Flags volatile values in the cacheable (`shared`) system-prompt sections.
 * @param {readonly {id: string, text: string, scope: 'shared'|'session'}[]} sections
 * @returns {VolatileFinding[]}
 */
export function findVolatile(sections) {
  /** @type {VolatileFinding[]} */
  const out = [];
  for (const s of sections) {
    if (s.scope !== "shared") continue;
    for (const raw of s.text.split(TOKEN_SPLIT)) {
      const tok = raw.replace(/[.:]+$/, "");
      const kind = classify(tok);
      if (kind === undefined) continue;
      out.push({ id: s.id, kind, sample: tok.slice(0, 12) + "…" });
      if (out.length >= MAX_FINDINGS) return out;
    }
  }
  return out;
}

/**
 * @param {{input_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number}} usage
 * @returns {number|undefined}
 */
export function cacheHitRatio(usage) {
  const read = usage.cache_read_input_tokens;
  const total = usage.input_tokens + read + usage.cache_creation_input_tokens;
  return total > 0 ? read / total : undefined;
}

/**
 * A ratio as a whole percentage, "–" when there is none.
 * @param {number|undefined} n
 * @returns {string}
 */
export function pct(n) {
  return n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

/**
 * @param {number|undefined} prev
 * @param {number} hit
 * @returns {boolean}
 */
export function isCacheDrop(prev, hit) {
  return prev !== undefined && prev >= CACHE_DROP_THRESHOLD && hit < CACHE_DROP_THRESHOLD;
}

/**
 * A usage field as a persistable counter delta: a non-negative safe integer, else 0. One missing or
 * odd field (undefined, NaN, a fraction) must not poison the running totals, because the server
 * rejects every stats_put that carries such a row.
 * @param {unknown} n
 * @returns {number}
 */
export function toCount(n) {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** @returns {Counters} all six counters at 0 */
export function zeroCounters() {
  return /** @type {Counters} */ (Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0])));
}

/**
 * Local calendar day of an epoch-ms instant as YYYY-MM-DD.
 * @param {number} ms
 * @param {number} [offsetMin] minutes UTC minus local (Date#getTimezoneOffset); defaults to this runtime's offset at `ms`
 * @returns {string}
 */
export function dayKey(ms, offsetMin = new Date(ms).getTimezoneOffset()) {
  return new Date(ms - offsetMin * 60000).toISOString().slice(0, 10);
}

/**
 * First day of a rolling window of `days` calendar days ending with (and including) `day`.
 * Calendar arithmetic in UTC, so DST never shifts it.
 * @param {string} day YYYY-MM-DD
 * @param {number} days >= 1
 * @returns {string}
 */
export function windowStart(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Adds `pending` to `days[today]` (creating it), zeroes `pending` in place, drops every day outside
 * [purgeBefore, today], and returns each remaining day as a stats_put row (copies, so later folds
 * never change a queued write). Mutates `days` and `pending`.
 * @param {Record<string, Counters>} days
 * @param {Counters} pending
 * @param {string} today YYYY-MM-DD
 * @param {string} purgeBefore YYYY-MM-DD
 * @returns {(Counters & {day: string})[]}
 */
export function foldPending(days, pending, today, purgeBefore) {
  const total = (days[today] ??= zeroCounters());
  for (const k of COUNTER_KEYS) {
    total[k] += pending[k];
    pending[k] = 0; // in place: register.ts holds pending in a const
  }
  // Days after today go too, so a clock moved backwards never grows a stats_put past the window.
  for (const day of Object.keys(days)) if (day < purgeBefore || day > today) delete days[day];
  return Object.entries(days).map(([day, c]) => ({ day, ...c }));
}

/**
 * The /headroom tables as rows of cells. Each table starts with its header row (heading, then the column names), then one row per ROWS entry.
 * A row without counters (still loading, storage off or failing) shows `blank` in every value cell. The in-memory session-only
 * counters add a `subagents` row under effort routing's session row, and the smart crusher, dedup, line elider, compaction,
 * config, html extractor, logs, search, diff, text crusher and relevance split tables, which have only a session row.
 * @param {readonly (Row|undefined)[]} counters one per ROWS entry, in ROWS order
 * @param {string} blank
 * @param {StatsMemory} [memory]
 * @returns {string[][][]} effort routing, cache aligner, smart crusher, dedup, line elider, compaction, config, html extractor,
 *   logs, search, diff, text crusher, relevance split
 */
export function statsTables(counters, blank, memory = {}) {
  const {
    subagents,
    crush = { dropped: 0, saved: 0 },
    dedup = { spans: 0, saved: 0 },
    elide = { lines: 0, saved: 0 },
    compact = { arrays: 0, saved: 0 },
    config = { texts: 0, saved: 0 },
    extract = { pages: 0, saved: 0 },
    log = { texts: 0, saved: 0 },
    search = { texts: 0, saved: 0 },
    diff = { texts: 0, saved: 0 },
    textcrush = { texts: 0, saved: 0 },
    split = { texts: 0, saved: 0 },
  } = memory;
  /**
   * @param {string} heading
   * @param {string[]} columns
   * @param {(c: Row) => string[]} cells
   * @param {string[][]} [underSession] rows right under the session row
   * @returns {string[][]}
   */
  const table = (heading, columns, cells, underSession = []) => [
    [heading, ...columns],
    ...ROWS.flatMap((v, i) => {
      const c = counters[i];
      const row = [v.label, ...(c ? cells(c) : columns.map(() => blank))];
      return v.days === 0 ? [row, ...underSession] : [row];
    }),
  ];
  const session = ROWS.find((v) => v.days === 0)?.label ?? "session";
  return [
    table("effort routing", ["steps", "clamped"], (c) => [String(c.steps), String(c.clamped)], subagents ? [["subagents", String(subagents.steps), String(subagents.clamped)]] : []),
    table("cache aligner", ["hit", "drops"], (c) => [pct(c.hit ?? cacheHitRatio(c)), String(c.cache_drops)]),
    [
      ["smart crusher", "dropped", "saved"],
      [session, String(crush.dropped), String(crush.saved)],
    ],
    [
      ["dedup", "spans", "saved"],
      [session, String(dedup.spans), String(dedup.saved)],
    ],
    [
      ["line elider", "lines", "saved"],
      [session, String(elide.lines), String(elide.saved)],
    ],
    [
      ["compaction", "arrays", "saved"],
      [session, String(compact.arrays), String(compact.saved)],
    ],
    [
      ["config", "texts", "saved"],
      [session, String(config.texts), String(config.saved)],
    ],
    [
      ["html extractor", "pages", "saved"],
      [session, String(extract.pages), String(extract.saved)],
    ],
    [
      ["logs", "texts", "saved"],
      [session, String(log.texts), String(log.saved)],
    ],
    [
      ["search", "texts", "saved"],
      [session, String(search.texts), String(search.saved)],
    ],
    [
      ["diff", "texts", "saved"],
      [session, String(diff.texts), String(diff.saved)],
    ],
    [
      ["text crusher", "texts", "saved"],
      [session, String(textcrush.texts), String(textcrush.saved)],
    ],
    [
      ["relevance split", "texts", "saved"],
      [session, String(split.texts), String(split.saved)],
    ],
  ];
}

/**
 * One table as plain text: the label column padded on the right, the value columns right-aligned.
 * @param {readonly (readonly string[])[]} rows
 * @returns {string}
 */
export function tableText(rows) {
  return rows.map((r) => r.map((s, i) => (i ? s.padStart(CELL_WIDTHS[i]) : s.padEnd(CELL_WIDTHS[i]))).join("")).join("\n");
}

// SmartCrusher: a port of headroom's dict-array lossy path (crates/headroom-core/src/transforms/smart_crusher).

/**
 * Two 32-bit lanes of a cyrb53-style hash over UTF-16 code units: the pure-JS stand-in for upstream's
 * MD5 (simhash grams) and SHA-256 (CCR hash), since a mods module is not known to load node:crypto.
 * @param {string} s
 * @returns {[number, number]} two unsigned 32-bit lanes
 */
function hash64(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/**
 * @param {number} x a 32-bit integer
 * @returns {number} its set bits
 */
function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * Upstream simhash: every lowercased 4-code-point gram (the whole string when it has 3 or fewer) votes ±1 per hash bit.
 * @param {string} text
 * @returns {[number, number]} the 64-bit fingerprint as two 32-bit halves
 */
function simhash(text) {
  const cps = Array.from(text.toLowerCase());
  const votes = new Array(64).fill(0);
  const grams = cps.length <= 3 ? 1 : cps.length - 3;
  for (let i = 0; i < grams; i++) {
    const [a, b] = hash64(cps.slice(i, i + 4).join(""));
    for (let j = 0; j < 32; j++) {
      votes[j] += (a >>> j) & 1 ? 1 : -1;
      votes[j + 32] += (b >>> j) & 1 ? 1 : -1;
    }
  }
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < 32; j++) {
    if (votes[j] > 0) lo |= 1 << j;
    if (votes[j + 32] > 0) hi |= 1 << j;
  }
  return [lo, hi];
}

/**
 * Upstream count_unique_simhash: greedy clusters of fingerprints within Hamming distance 3.
 * @param {readonly string[]} items
 * @param {WorkBudget} [budget] charged 1 per fingerprint comparison
 * @returns {number|undefined} undefined once the budget runs out
 */
function countUniqueSimhash(items, budget = { left: Infinity }) {
  /** @type {[number, number][]} */
  const reps = [];
  for (const s of items) {
    const [lo, hi] = simhash(s);
    let dup = false;
    for (const [a, b] of reps) {
      if (--budget.left < 0) return undefined;
      if (popcount(lo ^ a) + popcount(hi ^ b) <= 3) {
        dup = true;
        break;
      }
    }
    if (!dup) reps.push([lo, hi]);
  }
  return reps.length;
}

/**
 * Upstream compute_unique_bigram_curve: the running count of unique lowercased word bigrams
 * (a lone word pairs with "", a spaceless CJK word yields character bigrams, an empty item counts once).
 * @param {readonly string[]} items
 * @returns {number[]}
 */
function bigramCurve(items) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {readonly string[]} xs */
  const pairs = (xs) => {
    for (let j = 0; j < xs.length - 1; j++) seen.add(JSON.stringify([xs[j], xs[j + 1]]));
  };
  return items.map((item) => {
    const words = item.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 2) pairs(words);
    else if (words.length === 1) {
      const cps = Array.from(words[0]);
      const cjk = cps.some((c) => {
        const x = c.codePointAt(0) ?? 0;
        return CJK_RANGES.some(([lo, hi]) => x >= lo && x <= hi);
      });
      if (cps.length >= 2 && cjk) pairs(cps);
      else seen.add(JSON.stringify([words[0], ""]));
    } else seen.add(JSON.stringify(["", ""]));
    return seen.size;
  });
}

/**
 * Upstream find_knee (Kneedle): 1 + the index farthest above the diagonal; undefined under 0.05 or below 3 points.
 * @param {readonly number[]} curve
 * @returns {number|undefined}
 */
function findKnee(curve) {
  const n = curve.length;
  if (n < 3) return undefined;
  const yMin = curve[0];
  const yRange = curve[n - 1] - yMin;
  if (Math.abs(yRange) < Number.EPSILON) return 1;
  let maxDiff = -1;
  let knee = 0;
  for (let i = 0; i < n; i++) {
    const diff = (curve[i] - yMin) / yRange - i / (n - 1);
    if (diff > maxDiff) {
      maxDiff = diff;
      knee = i;
    }
  }
  return maxDiff < 0.05 ? undefined : knee + 1;
}

/**
 * Upstream compute_optimal_k (bias 1; the crusher's min_k 3, max_k 15 by default): how many items to keep, from simhash
 * diversity and the knee of the items' bigram coverage curve. As upstream, 8 or fewer items keep them all, even above maxK.
 * @param {readonly string[]} itemStrings each item's text (a row's compact JSON, a log line, a search match)
 * @param {number} [minK]
 * @param {number} [maxK]
 * @param {WorkBudget} [budget] charged 1 per simhash comparison; exhausted means maxK
 * @returns {number}
 */
export function computeOptimalK(itemStrings, minK = MIN_K, maxK = MAX_ITEMS_AFTER_CRUSH, budget = undefined) {
  const n = itemStrings.length;
  if (n <= 8) return n;
  const unique = countUniqueSimhash(itemStrings, budget);
  // shortcut: an exhausted budget means many distinct fingerprints (high diversity), where upstream lands on maxK too; count them all if a caller ever needs the knee there.
  if (unique === undefined) return maxK;
  if (unique <= 3) return Math.min(Math.max(minK, unique), maxK);
  const diversity = unique / n;
  const floor = Math.max(minK, Math.floor(n * (0.3 + 0.7 * diversity)));
  let knee = findKnee(bigramCurve(itemStrings));
  if (knee === undefined) knee = floor;
  else if (diversity > 0.7) knee = Math.max(knee, floor);
  // shortcut: upstream's tier 3 (a zlib ratio check that can raise K by 20%) is skipped; add it once a node:zlib import is live-verified in a mods module.
  return Math.max(minK, Math.min(Math.max(minK, knee), maxK));
}

/**
 * Stores offloaded originals for headroom_retrieve: a re-put moves its hash to the newest position, and the
 * oldest entries go while the store holds more than CCR_CAPACITY entries or CCR_MAX_CHARS characters. Never an entry
 * of `entries` itself: the row that carries their markers is stored next, so a batch may leave the store over a cap until
 * the next call with entries. Mutates `store`.
 * shortcut: no idle TTL (upstream: 30 min); add one with a time argument from register.ts if memory becomes a concern.
 * @param {Map<string, string>} store hash → original text (a crushed array's JSON, an elided block, a folded span), oldest first
 * @param {readonly [string, string][]} entries
 * @returns {void}
 */
export function storeOffloaded(store, entries) {
  if (entries.length === 0) return; // nothing to add: skip the O(store) size pass, as most rows carry no entry for one of the two stores
  for (const [hash, json] of entries) {
    store.delete(hash);
    store.set(hash, json);
  }
  let chars = 0;
  for (const json of store.values()) chars += json.length;
  const incoming = new Set(entries.map(([hash]) => hash));
  for (const [hash, json] of store) {
    // The batch is the newest tail of the store: stop there, so a marker this row just carried never names a hash it evicted itself.
    if ((store.size <= CCR_CAPACITY && chars <= CCR_MAX_CHARS) || incoming.has(hash)) break;
    store.delete(hash);
    chars -= json.length;
  }
}

/**
 * The CCR key in what the model passed to headroom_retrieve: the bare hash, or one copied with its marker's `hash=` or
 * `<<ccr:` prefix (the tool's description cites both forms) and, as a pointer or elider line ends in `]` and a CCR
 * marker in `>>`, that closing bracket. Anything else is returned trimmed, as is.
 * @param {unknown} hash
 * @returns {string|undefined} undefined unless `hash` is a string
 */
export function retrieveKey(hash) {
  return typeof hash === "string"
    ? (hash
        .trim()
        .replace(/^(?:hash=|<<ccr:)/, "")
        .split(/\s/)[0]
        ?.replace(/[\]>]+$/, "") ?? "")
    : undefined;
}

/**
 * The crusher's query (upstream _extract_context_from_messages): newest first, the text of the last five
 * user messages with text and each assistant tool call's input JSON. Deviation: upstream counts every user message,
 * but a Claude Code tool result is a user message with empty text, so the real request would age out after five calls.
 * Deviation: the tool-call inputs keep at most CRUSH_QUERY_INPUT_CHARS characters in all, newest first. A subagent has
 * one user message, so the walk would otherwise stringify every input back to its start on each JSON result.
 * @param {readonly QueryMessage[]} messages chronological, as the session.messages op returns them
 * @returns {string}
 */
export function crushQuery(messages) {
  /** @type {string[]} */
  const parts = [];
  let users = 0;
  let budget = CRUSH_QUERY_INPUT_CHARS;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (!m.text) continue;
      parts.push(m.text);
      if (++users >= 5) break;
    } else
      for (const u of m.toolUses) {
        if (budget <= 0) break;
        const input = JSON.stringify(u.input).slice(0, budget);
        budget -= input.length;
        parts.push(input);
      }
  }
  return parts.join(" ");
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>} a JSON object (not an array, not null)
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * An own property only: a row without `constructor` must not read Object.prototype's.
 * @param {Record<string, unknown>} o
 * @param {string} k
 * @returns {unknown}
 */
function own(o, k) {
  return Object.hasOwn(o, k) ? o[k] : undefined;
}

/**
 * Sorted-key compact JSON: the equality key upstream hashes (MD5 of sort_keys JSON) for dedup.
 * @param {unknown} v
 * @returns {string}
 */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * The 12-hex CCR hash of an original array's compact JSON (upstream: a SHA-256 prefix).
 * @param {string} s
 * @returns {string}
 */
function contentHash(s) {
  const [a, b] = hash64(s);
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}

/**
 * Python str() as upstream's analyzer counts distinct values: None/True/False, bare strings, JSON for containers.
 * @param {unknown} v
 * @returns {string}
 */
function pyStr(v) {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v);
}

/**
 * Python repr as upstream's anchors.rs renders a row for query-anchor matching: single-quoted strings, ", " and ": ".
 * @param {unknown} v
 * @returns {string}
 */
function pythonRepr(v) {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return `'${v}'`;
  if (Array.isArray(v)) return `[${v.map(pythonRepr).join(", ")}]`;
  if (isRecord(v))
    return `{${Object.keys(v)
      .map((k) => `'${k}': ${pythonRepr(v[k])}`)
      .join(", ")}}`;
  return String(v);
}

/**
 * Upstream stats_math::mean: undefined when empty or not finite.
 * @param {readonly number[]} xs
 * @returns {number|undefined}
 */
function mean(xs) {
  if (!xs.length) return undefined;
  let sum = 0;
  for (const x of xs) sum += x;
  const m = sum / xs.length;
  return Number.isFinite(m) ? m : undefined;
}

/**
 * Upstream sample_variance (n − 1): undefined below two values or when not finite.
 * @param {readonly number[]} xs
 * @returns {number|undefined}
 */
function sampleVariance(xs) {
  const m = xs.length < 2 ? undefined : mean(xs);
  if (m === undefined) return undefined;
  let sq = 0;
  for (const x of xs) sq += (x - m) * (x - m);
  const v = sq / (xs.length - 1);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Upstream detect_change_points (window 5): where the means of the 5 values before and after differ by more
 * than 2σ, each kept point more than 5 past the previous one.
 * @param {readonly number[]} xs
 * @returns {number[]} indices into `xs`
 */
function changePoints(xs) {
  const w = 5;
  const v = xs.length < 2 * w ? undefined : sampleVariance(xs);
  if (v === undefined || !(Math.sqrt(v) > 0)) return [];
  const threshold = VARIANCE_THRESHOLD * Math.sqrt(v);
  /** @type {number[]} */
  const out = [];
  for (let i = w; i < xs.length - w; i++) {
    const shift = Math.abs((mean(xs.slice(i, i + w)) ?? 0) - (mean(xs.slice(i - w, i)) ?? 0));
    if (shift > threshold && (!out.length || i - out[out.length - 1] > w)) out.push(i);
  }
  return out;
}

/**
 * Upstream analyze_field: type from the first non-null value, distinct values over all rows (a missing key is
 * null), numeric min/max/mean/variance/change points, and a string field's mean length in code points.
 * @param {string} name
 * @param {readonly Record<string, unknown>[]} items
 * @returns {FieldStats}
 */
function analyzeField(name, items) {
  const values = items.map((o) => own(o, name) ?? null);
  const nonNull = values.filter((v) => v !== null);
  /** @type {FieldStats} */
  const f = { name, type: "null", unique: 0, ratio: 0, changePoints: [] };
  if (!nonNull.length) return f;
  const first = nonNull[0];
  f.type = typeof first === "boolean" ? "boolean" : typeof first === "number" ? "numeric" : typeof first === "string" ? "string" : Array.isArray(first) ? "array" : "object";
  f.unique = new Set(values.map(pyStr)).size;
  f.ratio = f.unique / values.length;
  if (f.type === "numeric") {
    /** @type {number[]} */
    const nums = [];
    /** @type {number[]} */
    const rows = [];
    values.forEach((v, i) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        nums.push(v);
        rows.push(i);
      }
    });
    let min = Infinity;
    let max = -Infinity;
    for (const x of nums) {
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    const m = mean(nums);
    const variance = nums.length > 1 ? sampleVariance(nums) : 0;
    // Upstream resets the whole numeric block when any statistic is not finite. Change points are mapped from
    // `nums` (nulls and non-numbers skipped) back to row indices, which the planners index by.
    if (m !== undefined && variance !== undefined && Number.isFinite(min) && Number.isFinite(max))
      Object.assign(f, { min, max, mean: m, variance, changePoints: changePoints(nums).map((k) => rows[k]) });
    else f.variance = 0;
  } else if (f.type === "string") {
    f.avgLen = mean(/** @type {string[]} */ (nonNull.filter((v) => typeof v === "string")).map((s) => Array.from(s).length));
  }
  return f;
}

/**
 * Upstream detect_sequential_pattern with check_order (both callers pass true): at least 5 numbers (one a real
 * JSON number, plain-integer strings count too) whose sorted gaps average 0.5..2 with over 80% in that range,
 * and over 70% of neighbours ascending in the original order.
 * @param {readonly unknown[]} values
 * @returns {boolean}
 */
function isSequential(values) {
  /** @type {number[]} */
  const nums = [];
  let real = false;
  for (const v of values) {
    if (typeof v === "number") {
      nums.push(v);
      real = true;
    } else if (typeof v === "string" && PY_INT_RE.test(v)) nums.push(Number(v));
  }
  if (nums.length < 5 || !real) return false;
  const sorted = [...nums].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((x, i) => x - sorted[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(avg >= 0.5 && avg <= 2)) return false;
  if (!(gaps.filter((d) => d >= 0.5 && d <= 2).length / gaps.length > 0.8)) return false;
  return nums.slice(1).filter((x, i) => nums[i] <= x).length / (nums.length - 1) > 0.7;
}

/**
 * Upstream calculate_string_entropy: Shannon entropy over code points, normalized to 0..1.
 * @param {string} s
 * @returns {number}
 */
function stringEntropy(s) {
  const cps = Array.from(s);
  if (cps.length < 2) return 0;
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const c of cps) freq.set(c, (freq.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) e -= (n / cps.length) * Math.log2(n / cps.length);
  const maxE = Math.log2(Math.min(freq.size, cps.length));
  return maxE > 0 ? e / maxE : 0;
}

/**
 * Upstream detect_id_field_statistically: the confidence that a field is a row id, 0 when it is not.
 * @param {FieldStats} f
 * @param {readonly unknown[]} values the field per row, a missing key as null
 * @returns {number}
 */
function idConfidence(f, values) {
  if (f.ratio < 0.9) return 0;
  if (f.type === "string") {
    const sample = /** @type {string[]} */ (values.slice(0, 20).filter((v) => typeof v === "string"));
    if (sample.length) {
      if (sample.filter((s) => UUID_RE.test(s)).length / sample.length > 0.8) return 0.95;
      if (sample.reduce((a, s) => a + stringEntropy(s), 0) / sample.length > 0.7 && f.ratio > 0.95) return 0.8;
    }
  }
  if (f.type === "numeric") {
    if (isSequential(values) && f.ratio > 0.95) return 0.9;
    if (f.min !== undefined && f.max !== undefined && f.max - f.min > 0 && f.ratio > 0.95) return 0.85;
  }
  return f.ratio > 0.98 ? 0.7 : 0;
}

/**
 * Upstream detect_score_field_statistically: the confidence (capped at 0.95) that a bounded, non-sequential
 * numeric field ranks the rows, 0 when it is not a score (below 0.4).
 * @param {FieldStats} f
 * @param {readonly Record<string, unknown>[]} items
 * @returns {number}
 */
function scoreConfidence(f, items) {
  if (f.type !== "numeric" || f.min === undefined || f.max === undefined) return 0;
  const { min, max } = f;
  let c;
  if (min >= 0 && min <= 1 && max >= 0 && max <= 1) c = 0.4;
  else if (min >= 0 && min <= 10 && max >= 0 && max <= 10) c = 0.3;
  else if (min >= 0 && min <= 100 && max >= 0 && max <= 100) c = 0.25;
  else if (min >= -1 && max <= 1) c = 0.35;
  else return 0;
  if (
    isSequential(
      items
        .slice(0, 50)
        .filter((o) => Object.hasOwn(o, f.name))
        .map((o) => o[f.name]),
    )
  )
    return 0;
  const nums = /** @type {number[]} */ (items.map((o) => own(o, f.name)).filter((v) => typeof v === "number" && Number.isFinite(v)));
  if (nums.length >= 5 && nums.slice(1).filter((x, i) => nums[i] >= x).length / (nums.length - 1) > 0.7) c += 0.3;
  const first = nums.slice(0, 20);
  if (first.length && first.filter((x) => x !== Math.trunc(x)).length > first.length * 0.3) c += 0.1;
  return c >= 0.4 ? Math.min(c, 0.95) : 0;
}

/**
 * Upstream detect_temporal_field: a string field mostly ISO dates in its first 10 rows, or a numeric field whose
 * minimum looks like epoch seconds or milliseconds.
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {boolean}
 */
function hasTemporalField(fields, items) {
  for (const f of fields) {
    if (f.type === "string") {
      const sample = /** @type {string[]} */ (
        items
          .slice(0, 10)
          .map((o) => own(o, f.name))
          .filter((v) => typeof v === "string")
      );
      if (sample.length && sample.filter((s) => ISO_DATETIME_RE.test(s) || ISO_DATE_RE.test(s)).length / sample.length > 0.5) return true;
    } else if (f.type === "numeric" && f.min !== undefined && ((f.min >= 1e9 && f.min <= 2e9) || (f.min >= 1e12 && f.min <= 2e12))) return true;
  }
  return false;
}

/**
 * Upstream detect_pattern: time_series, logs, search_results or generic.
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {'time_series'|'logs'|'search_results'|'generic'}
 */
function detectPattern(fields, items) {
  if (fields.some((f) => f.type === "numeric" && (f.variance ?? 0) > 0) && hasTemporalField(fields, items)) return "time_series";
  let message = false;
  let level = false;
  for (const f of fields) {
    if (f.type !== "string") continue;
    if (f.ratio > 0.5 && (f.avgLen ?? 0) > 20) message = true;
    else if (f.ratio < 0.1 && f.unique >= 2 && f.unique <= 10) level = true;
  }
  if (message && level) return "logs";
  return fields.some((f) => scoreConfidence(f, items) >= 0.5) ? "search_results" : "generic";
}

/**
 * Upstream detect_rare_status_values for one common field: with 2..50 distinct non-null values, the fewest most
 * frequent values covering 80% of the rows that hold the key; if at most 5 do, the rows holding any other value.
 * @param {readonly Record<string, unknown>[]} items
 * @param {string} name
 * @returns {number[]}
 */
function rareStatusRows(items, name) {
  /** @param {unknown} v */
  const key = (v) => (v === null ? "__none__" : typeof v === "string" ? v : JSON.stringify(v));
  const values = items.filter((o) => Object.hasOwn(o, name)).map((o) => o[name]);
  const distinct = new Set(values.filter((v) => v !== null).map(key)).size;
  if (distinct < 2 || distinct > 50) return [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const v of values) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const need = Math.ceil(values.length * 0.8);
  const top = new Set();
  let covered = 0;
  for (const [v, c] of ranked) {
    covered += c;
    top.add(v);
    if (covered >= need) break;
  }
  if (top.size > 5) return [];
  return items.flatMap((o, i) => (Object.hasOwn(o, name) && !top.has(key(o[name])) ? [i] : []));
}

/**
 * Upstream detect_structural_outliers (5+ rows): rows holding a key present in under 20% of the rows, and rows
 * with a rare value in a key present in at least 80% of them.
 * @param {readonly Record<string, unknown>[]} items
 * @returns {Set<number>}
 */
function structuralOutliers(items) {
  const n = items.length;
  /** @type {Set<number>} */
  const out = new Set();
  if (n < 5) return out;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const o of items) for (const k of Object.keys(o)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const rare = new Set([...counts].filter(([, c]) => c < n * 0.2).map(([k]) => k));
  items.forEach((o, i) => {
    if (Object.keys(o).some((k) => rare.has(k))) out.add(i);
  });
  const common = [...counts].filter(([, c]) => c >= n * 0.8).map(([k]) => k);
  for (const k of common.sort()) for (const i of rareStatusRows(items, k)) out.add(i);
  return out;
}

/**
 * Upstream numeric anomalies: rows more than 2σ from a numeric field's mean (fields with variance > 0).
 * @param {readonly FieldStats[]} fields
 * @param {readonly Record<string, unknown>[]} items
 * @returns {Set<number>}
 */
function anomalyRows(fields, items) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const f of fields) {
    const m = f.mean;
    if (f.type !== "numeric" || m === undefined || !((f.variance ?? 0) > 0)) continue;
    const threshold = VARIANCE_THRESHOLD * Math.sqrt(f.variance ?? 0);
    items.forEach((o, i) => {
      const x = own(o, f.name);
      if (typeof x === "number" && Math.abs(x - m) > threshold) out.add(i);
    });
  }
  return out;
}

/**
 * Upstream analyze_array: field stats, the crushability gate (analyze_crushability) and the strategy
 * (select_strategy). Errors, structural outliers and anomalies are kept for the planners, which recompute the same sets upstream.
 * @param {readonly Record<string, unknown>[]} items
 * @param {readonly string[]} strings each row's compact JSON
 * @returns {Analysis}
 */
function analyzeArray(items, strings) {
  const fields = [...new Set(items.flatMap((o) => Object.keys(o)))].sort().map((k) => analyzeField(k, items));
  const pattern = detectPattern(fields, items);
  const errors = strings.flatMap((s, i) => {
    const l = s.toLowerCase();
    return ERROR_KEYWORDS.some((k) => l.includes(k)) ? [i] : [];
  });
  const outliers = structuralOutliers(items);
  const anomalies = anomalyRows(fields, items);
  const hasChangePoints = fields.some((f) => f.changePoints.length > 0);
  // The best id field (strict >), whatever its confidence; has_id needs 0.7.
  /** @type {string|undefined} */
  let idName;
  let idRatio = 0;
  let idConf = 0;
  for (const f of fields) {
    const c = idConfidence(
      f,
      items.map((o) => own(o, f.name) ?? null),
    );
    if (c > idConf) [idName, idRatio, idConf] = [f.name, f.ratio, c];
  }
  const hasId = idName !== undefined && idConf >= 0.7;
  const signal = fields.some((f) => scoreConfidence(f, items) > 0) || outliers.size > 0 || errors.length > 0 || anomalies.size > 0 || hasChangePoints;
  /** @param {string} type */
  const avgRatio = (type) => mean(fields.filter((f) => f.type === type && f.name !== idName).map((f) => f.ratio)) ?? 0;
  const stringU = avgRatio("string");
  const maxU = Math.max(stringU, idRatio, 0);
  const contentU = Math.max(stringU, avgRatio("numeric"));
  // Upstream's ladder: repetitive content with ids, then low uniqueness, crush; every later case
  // (unique_entities_no_signal, unique_entities_with_signal, medium_uniqueness_*) crushes exactly when a signal is present.
  const crushable = (contentU < 0.1 && hasId) || maxU < 0.3 || signal;
  /** @type {Analysis['strategy']} */
  let strategy = "smart_sample";
  if (!crushable) strategy = "skip";
  else if (pattern === "time_series" && hasChangePoints) strategy = "time_series";
  else if (pattern === "logs" && (fields.find((f) => f.name.toLowerCase().includes("message"))?.ratio ?? 1) < 0.5) strategy = "cluster";
  else if (pattern === "search_results") strategy = "top_n";
  return { fields, strategy, errors, outliers, anomalies };
}

/**
 * Upstream calculate_information_score over a region: 0.4 value rareness + 0.3 relative length + 0.3 structural
 * uniqueness (holding rare keys, missing common ones), clamped to 0..1.
 * @param {Record<string, unknown>} item
 * @param {readonly Record<string, unknown>[]} region
 * @returns {number}
 */
function informationScore(item, region) {
  const n = region.length;
  if (n < 2) return 0.5; // every factor is 0.5 for a one-row region
  /** @param {unknown} v */
  const valueKey = (v) => (typeof v === "string" ? v : canonicalJson(v));
  /** @type {Map<string, Map<string, number>>} */
  const values = new Map();
  /** @type {Map<string, number>} */
  const keys = new Map();
  let minLen = Infinity;
  let maxLen = -Infinity;
  for (const o of region) {
    for (const k of Object.keys(o)) {
      const counts = values.get(k) ?? new Map();
      values.set(k, counts);
      counts.set(valueKey(o[k]), (counts.get(valueKey(o[k])) ?? 0) + 1);
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    const len = JSON.stringify(o).length;
    minLen = Math.min(minLen, len);
    maxLen = Math.max(maxLen, len);
  }
  const rareness = Object.keys(item).flatMap((k) => {
    const c = values.get(k)?.get(valueKey(item[k])) ?? 0;
    return c > 0 ? [1 - c / n] : [];
  });
  const uniqueness = rareness.length ? rareness.reduce((a, b) => a + b, 0) / rareness.length : 0.5;
  const length = maxLen === minLen ? 0.5 : (JSON.stringify(item).length - minLen) / (maxLen - minLen);
  const itemKeys = new Set(Object.keys(item));
  const common = [...keys].filter(([, c]) => c >= n * 0.8).map(([k]) => k);
  const rare = [...keys].filter(([, c]) => c < n * 0.2).map(([k]) => k);
  let structural = 0;
  if (rare.length) structural += 0.5 * (rare.filter((k) => itemKeys.has(k)).length / rare.length);
  if (common.length) structural += 0.5 * (common.filter((k) => !itemKeys.has(k)).length / common.length);
  return Math.min(1, Math.max(0, uniqueness * 0.4 + length * 0.3 + Math.min(structural, 1) * 0.3));
}

/**
 * Upstream AnchorSelector::select_anchors for an array longer than K: position anchors (25% of K, 3..12 slots)
 * split over the front, middle and back by the planner's weights, shifted by recency or history words in the
 * query; the middle picks by information density, and rows with the same content are taken once.
 * @param {CrushPlan} p
 * @param {'smart_sample'|'cluster'|'time_series'} planner
 * @returns {number[]}
 */
function selectAnchors(p, planner) {
  const { items, canon, max, query } = p;
  const n = items.length;
  const budget = Math.min(Math.min(12, Math.max(3, Math.floor(max * 0.25))), n);
  /** @type {(f: number, m: number, b: number) => [number, number, number]} */
  const normalize = (f, m, b) => [f / (f + m + b), m / (f + m + b), b / (f + m + b)];
  let [front, middle, back] = ANCHOR_WEIGHTS[planner];
  const q = query.toLowerCase();
  const recent = RECENCY_WORDS.some((w) => q.includes(w));
  const historical = HISTORICAL_WORDS.some((w) => q.includes(w));
  if (recent !== historical) {
    if (recent) [front, back] = [Math.max(0.1, front - 0.15), Math.min(0.8, back + 0.15)];
    else [front, back] = [Math.min(0.8, front + 0.15), Math.max(0.1, back - 0.15)];
    [front, middle, back] = normalize(front, middle, back);
  }
  const [frontW, , backW] = normalize(front, middle, back); // upstream normalizes a shifted set twice
  const frontSlots = Math.max(1, Math.floor(budget * frontW));
  let backSlots = Math.max(1, Math.floor(budget * backW));
  let middleSlots = Math.max(0, budget - (frontSlots + backSlots));
  // Over budget: the middle gives way first, then the back (down to 1).
  const excess = frontSlots + middleSlots + backSlots - budget;
  if (excess > 0) {
    const cut = Math.min(middleSlots, excess);
    middleSlots -= cut;
    if (excess > cut) backSlots = Math.max(1, backSlots - (excess - cut));
  }
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {(start: number, end: number, slots: number) => number[]} evenly spaced picks; a duplicate tries +1, −1, +2, −2 */
  const region = (start, end, slots) => {
    /** @type {number[]} */
    const picked = [];
    const size = end - start;
    if (slots === 0 || size <= 0) return picked;
    /** @param {number} i */
    const take = (i) => {
      if (seen.has(canon[i])) return false;
      seen.add(canon[i]);
      picked.push(i);
      return true;
    };
    const step = size / (slots + 1);
    if (slots >= size) for (let i = start; i < end; i++) take(i);
    else
      for (let k = 0; k < slots; k++) {
        const i = Math.min(start + Math.floor((k + 1) * step), end - 1);
        if (!take(i)) for (const off of [1, -1, 2, -2]) if (i + off >= start && i + off < end && take(i + off)) break;
      }
    return picked;
  };
  const frontPicks = region(0, Math.min(frontSlots * 2, Math.floor(n / 3)), frontSlots);
  const backPicks = region(Math.max(n - backSlots * 2, Math.floor((2 * n) / 3)), n, backSlots);
  /** @type {number[]} */
  const middlePicks = [];
  const start = frontPicks.length;
  const end = n - backPicks.length;
  if (middleSlots > 0 && end > start) {
    const size = end - start;
    const count = Math.min(middleSlots * 3, size);
    const step = size / (count + 1);
    const area = items.slice(start, end);
    /** @type {[number, number][]} */
    const candidates = [];
    for (let k = 0; k < count; k++) {
      const i = Math.min(start + Math.floor((k + 1) * step), end - 1);
      if (!seen.has(canon[i])) candidates.push([i, informationScore(items[i], area)]);
    }
    candidates.sort((a, b) => b[1] - a[1]); // stable: equal scores keep index order
    for (const [i] of candidates.slice(0, middleSlots))
      if (!seen.has(canon[i])) {
        seen.add(canon[i]);
        middlePicks.push(i);
      }
  }
  return [...frontPicks, ...backPicks, ...middlePicks];
}

/**
 * Upstream extract_query_anchors: UUIDs, 4+ digit numbers, host names, short quoted strings and emails, lowercased.
 * @param {string} text
 * @returns {Set<string>}
 */
function queryAnchors(text) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of text.matchAll(ANCHOR_UUID_RE)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(ANCHOR_NUMBER_RE)) out.add(m[0]);
  for (const m of text.matchAll(ANCHOR_HOST_RE)) if (!["e.g", "i.e", "etc."].includes(m[0].toLowerCase())) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(ANCHOR_QUOTED_RE)) if (m[1].trim().length >= 2) out.add(m[1].toLowerCase());
  for (const m of text.matchAll(ANCHOR_EMAIL_RE)) out.add(m[0].toLowerCase());
  return out;
}

/**
 * Whether a term found in `hits` of `n` rows singles rows out. Deviation: upstream counts any match, so a term in
 * every row (a key name, a shared host) marks every row relevant and the crush degrades to the head rows; here,
 * as where classic BM25's idf turns non-positive, a term in more than half the rows is ignored.
 * @param {number} hits
 * @param {number} n
 * @returns {boolean}
 */
const isSelective = (hits, n) => hits * 2 <= n;

/**
 * Upstream item_matches_anchors: rows whose lowercased Python repr contains a selective query anchor.
 * @param {readonly Record<string, unknown>[]} items
 * @param {string} query
 * @returns {number[]}
 */
function anchorRows(items, query) {
  const anchors = [...queryAnchors(query)];
  if (!anchors.length) return [];
  const hits = items.map((o) => {
    const repr = pythonRepr(o).toLowerCase();
    return anchors.filter((a) => repr.includes(a));
  });
  const selective = new Set(anchors.filter((a) => isSelective(hits.filter((h) => h.includes(a)).length, items.length)));
  return hits.flatMap((h, i) => (h.some((a) => selective.has(a)) ? [i] : []));
}

/**
 * Upstream BM25Scorer.tokenize: TOKEN_PATTERN's matches in the lowercased text.
 * @param {string} s
 * @returns {string[]}
 */
const bm25Tokens = (s) => s.toLowerCase().match(BM25_TOKEN_RE) ?? [];

/**
 * A query's BM25 term counts.
 * @param {string} query
 * @returns {Map<string, number>}
 */
function queryFreq(query) {
  /** @type {Map<string, number>} */
  const qf = new Map();
  for (const t of bm25Tokens(query)) qf.set(t, (qf.get(t) ?? 0) + 1);
  return qf;
}

/**
 * Upstream BM25Scorer.score_batch's core (k1 1.5, b 0.75, ln 2 idf, normalized by 10, +0.3 for a matched term of 8+ chars).
 * A document's matched terms are its unique tokens the query holds, summed in sorted order (upstream's BTreeMap), so the
 * float sums match; no document-frequency work, so it stays linear in the tokens.
 * @param {readonly (readonly string[])[]} all each document's tokens
 * @param {ReadonlyMap<string, number>} qf query term → its count in the query
 * @returns {{ score: number, matched: string[] }[]}
 */
function bm25Batch(all, qf) {
  const avg = all.reduce((a, d) => a + d.length, 0) / Math.max(all.length, 1);
  return all.map((doc) => {
    if (!doc.length || !qf.size) return { score: 0, matched: [] };
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    const matched = [...tf.keys()].filter((t) => qf.has(t)).sort();
    let raw = 0;
    for (const t of matched) {
      const f = tf.get(t) ?? 0;
      raw += ((Math.LN2 * (f * 2.5)) / (f + 1.5 * (1 - 0.75 + (0.75 * doc.length) / (avg > 0 ? avg : doc.length)))) * (qf.get(t) ?? 0);
    }
    let score = Math.min(raw / 10, 1);
    if (matched.some((t) => t.length >= 8)) score = Math.min(score + 0.3, 1);
    return { score, matched };
  });
}

/**
 * Upstream HybridScorer::score_batch without embeddings (bm25Batch), then the BM25-only boost: a match scores at least 0.3,
 * two or more add 0.2. Only selective query tokens (isSelective) count as matches.
 * @param {readonly string[]} docs each row's compact JSON
 * @param {string} query
 * @returns {number[]} one score per row, 0..1
 */
export function relevanceScores(docs, query) {
  const qf = queryFreq(query);
  if (!qf.size) return docs.map(() => 0);
  const all = docs.map(bm25Tokens);
  const selective = new Map([...qf].filter(([t]) => isSelective(all.filter((d) => d.includes(t)).length, docs.length)));
  return bm25Batch(all, selective).map(({ score, matched }) => {
    let s = score;
    if (matched.length) s = Math.max(s, 0.3);
    if (matched.length >= 2) s = Math.min(s + 0.2, 1);
    return s;
  });
}

/**
 * Upstream BM25Scorer.score_batch's plain scores (TextCrusher's and the relevance split's relevance): bm25Batch over every
 * query term, no selective filter and no boost. An empty query scores every document 0.
 * @param {readonly string[]} docs
 * @param {string} query
 * @returns {number[]} one score per document, 0..1
 */
export function bm25Scores(docs, query) {
  const qf = queryFreq(query);
  if (!qf.size) return docs.map(() => 0);
  return bm25Batch(docs.map(bm25Tokens), qf).map((r) => r.score);
}

/**
 * Upstream apply_query_signals: rows matching a query anchor (in their Python repr) or scoring relevance >= 0.3.
 * @param {CrushPlan} p
 * @param {Set<number>} keep mutated
 * @returns {void}
 */
function addQuerySignals(p, keep) {
  if (!p.query) return;
  for (const i of anchorRows(p.items, p.query)) keep.add(i);
  relevanceScores(p.strings, p.query).forEach((s, i) => {
    if (s >= RELEVANCE_THRESHOLD) keep.add(i);
  });
}

/**
 * Upstream prioritize_indices: one row per content (the lowest index), topped up to K by an interleaved stride over
 * the rest; over K, errors, structural outliers and anomalies stay whatever the budget, then the first 3 and last 2
 * rows and the remaining picks in index order fill what is left.
 * @param {CrushPlan} p
 * @param {Set<number>} keep
 * @returns {Set<number>}
 */
function prioritize(p, keep) {
  const { canon, analysis: a, max } = p;
  const n = canon.length;
  /** @type {Map<string, number>} */
  const firstByContent = new Map();
  for (const i of [...keep].sort((x, y) => x - y)) if (!firstByContent.has(canon[i])) firstByContent.set(canon[i], i);
  const current = new Set(firstByContent.values());
  if (current.size < max && current.size < n) {
    const remaining = max - current.size;
    const seen = new Set(firstByContent.keys());
    /** @type {number[]} */
    const candidates = [];
    for (let i = 0; i < n; i++) if (!current.has(i)) candidates.push(i);
    const step = Math.max(1, Math.floor(candidates.length / (remaining + 1)));
    let added = 0;
    for (let s = 0; s < step && added < remaining; s++)
      for (let j = s; j < candidates.length && added < remaining; j += step) {
        const i = candidates[j];
        if (seen.has(canon[i])) continue;
        seen.add(canon[i]);
        current.add(i);
        added++;
      }
  }
  if (current.size <= max) return current;
  const out = new Set([...a.errors, ...a.outliers, ...a.anomalies]);
  let room = Math.max(0, max - out.size);
  /** @param {number} i */
  const fill = (i) => {
    if (room > 0 && !out.has(i)) {
      out.add(i);
      room--;
    }
  };
  for (let i = 0; i < Math.min(3, n); i++) fill(i);
  for (let i = Math.max(0, n - 2); i < n; i++) fill(i);
  for (const i of [...current].sort((x, y) => x - y)) fill(i);
  return out;
}

/**
 * Upstream create_plan and its four planners, as the set of row indices to keep.
 * @param {CrushPlan} p
 * @returns {Set<number>}
 */
function createPlan(p) {
  const { items, analysis: a, max, query } = p;
  const n = items.length;
  /** @type {Set<number>} */
  const keep = new Set();
  /** @param {Iterable<number>} xs */
  const add = (xs) => {
    for (const i of xs) keep.add(i);
  };
  if (a.strategy === "top_n") {
    // The highest-confidence score field (strict >); a top_n strategy implies one.
    let field = "";
    let best = 0;
    for (const f of a.fields) {
      const c = scoreConfidence(f, items);
      if (c > best) [field, best] = [f.name, c];
    }
    /** @param {Record<string, unknown>} o */
    const score = (o) => {
      const v = own(o, field);
      return typeof v === "number" ? v : 0;
    };
    add(
      items
        .map((o, i) => /** @type {[number, number]} */ ([i, score(o)]))
        .sort((x, y) => y[1] - x[1])
        .slice(0, Math.max(max - 3, 0))
        .map(([i]) => i),
    );
    add(a.errors);
    add(a.outliers);
    if (query) {
      add(anchorRows(items, query));
      // At most 3 more rows, and only high-confidence ones.
      const scores = relevanceScores(p.strings, query);
      let added = 0;
      for (let i = 0; i < n && added < 3; i++)
        if (!keep.has(i) && scores[i] >= Math.max(RELEVANCE_THRESHOLD * 2, 0.5)) {
          keep.add(i);
          added++;
        }
    }
    return keep; // no prioritization: top_n may keep more than K, as upstream
  }
  add(selectAnchors(p, a.strategy === "time_series" || a.strategy === "cluster" ? a.strategy : "smart_sample"));
  add(a.errors);
  add(a.outliers);
  /** @param {number} w */
  const aroundChangePoints = (w) => {
    for (const f of a.fields) for (const cp of f.changePoints) for (let i = Math.max(0, cp - w); i <= Math.min(n - 1, cp + w); i++) keep.add(i);
  };
  if (a.strategy === "time_series") aroundChangePoints(2);
  else if (a.strategy === "cluster") {
    // Cluster on the string field with the highest uniqueness above 0.3 (strict >), two rows per 50-code-point prefix.
    let field = "";
    let best = 0;
    for (const f of a.fields) if (f.type === "string" && f.ratio > best && f.ratio > 0.3) [field, best] = [f.name, f.ratio];
    if (best > 0) {
      /** @type {Map<string, number>} */
      const taken = new Map();
      items.forEach((o, i) => {
        const v = own(o, field);
        const prefix = Array.from(typeof v === "string" ? v : "")
          .slice(0, 50)
          .join("");
        const c = taken.get(prefix) ?? 0;
        if (c < 2) {
          taken.set(prefix, c + 1);
          keep.add(i);
        }
      });
    }
  } else {
    add(a.anomalies);
    aroundChangePoints(1);
  }
  addQuerySignals(p, keep);
  return prioritize(p, keep);
}

/**
 * Upstream type_tag_for: a JSON value's compaction type. Deviation: a number is `int` when it is a safe integer, since
 * JSON.parse keeps no lexeme (`1.0` reads `int` here, `float` upstream).
 * @param {unknown} v
 * @returns {string}
 */
function typeTag(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isSafeInteger(v) ? "int" : "float";
  return typeof v === "string" ? "string" : "json";
}

/**
 * Upstream cell_from_value with classify_cell's opaque markers off: an array of 2+ objects nests a compaction, a string
 * holding a JSON object or array (no `<<ccr:` marker in it) is replaced by its parsed value or a nested compaction, and
 * everything else is a scalar. Deviation: a stringified value JSON.parse would not render back the same (isLossy) stays a string.
 * @param {unknown} v
 * @param {WorkBudget} budget
 * @returns {Cell}
 */
function cellFrom(v, budget) {
  if (Array.isArray(v)) return v.length >= 2 && v.every(isRecord) ? { n: compactRows(v, budget) } : { s: v };
  if (typeof v !== "string" || v.includes("<<ccr:") || !/^[{[]/.test(v.trimStart())) return { s: v };
  let parsed;
  try {
    parsed = JSON.parse(v);
  } catch {
    return { s: v };
  }
  if (typeof parsed !== "object" || parsed === null || isLossy(v, parsed)) return { s: v };
  return Array.isArray(parsed) && parsed.length >= 2 && parsed.every(isRecord) ? { n: compactRows(parsed, budget) } : { s: parsed };
}

/**
 * Upstream detect_discriminator: the key present in every row, all its values strings, with 2..8 distinct values and at most
 * 70% of the row count; most buckets wins, the first in key order on ties. Only keys in every row are read (linear work).
 * @param {readonly Record<string, unknown>[]} rows
 * @param {readonly string[]} keys sorted
 * @param {Map<string, number>} freq
 * @returns {string|undefined}
 */
function discriminator(rows, keys, freq) {
  const n = rows.length;
  /** @type {string|undefined} */
  let best;
  let most = 0;
  for (const k of keys) {
    if (freq.get(k) !== n) continue;
    /** @type {Set<string>} */
    const distinct = new Set();
    let ok = true;
    for (const o of rows) {
      const v = o[k];
      if (typeof v !== "string" || distinct.add(v).size > COMPACT_MAX_BUCKETS) {
        ok = false;
        break;
      }
    }
    if (!ok || distinct.size < COMPACT_MIN_BUCKETS || distinct.size / n > COMPACT_MAX_DISCRIMINATOR_RATIO) continue;
    if (distinct.size > most) [best, most] = [k, distinct.size];
  }
  return best;
}

/**
 * Upstream uniform_object_keys: the inner key list (order-sensitive) every present cell of column `col` shares, when each is an
 * object and the column is not already dotted.
 * @param {readonly FieldSpec[]} fields
 * @param {readonly Cell[][]} rows
 * @param {number} col
 * @returns {string[]|undefined}
 */
function uniformObjectKeys(fields, rows, col) {
  if (fields[col].name.includes(".")) return undefined;
  /** @type {string[]|undefined} */
  let canon;
  for (const row of rows) {
    const cell = row[col];
    if ("m" in cell) continue;
    if (!("s" in cell) || !isRecord(cell.s)) return undefined;
    const keys = Object.keys(cell.s);
    if (canon === undefined) canon = keys;
    else if (canon.length !== keys.length || canon.some((k, j) => k !== keys[j])) return undefined;
  }
  return canon;
}

/**
 * Upstream flatten_uniform_nested: a column of objects sharing 1..6 inner keys becomes `parent.key` columns, their types and
 * nullability re-inferred from the cells. Deviation: inner keys holding a header-breaking character keep the column nested.
 * Mutates `fields` and `rows`.
 * @param {FieldSpec[]} fields
 * @param {Cell[][]} rows
 * @returns {void}
 */
function flattenUniformNested(fields, rows) {
  for (let i = 0; i < fields.length;) {
    const inner = uniformObjectKeys(fields, rows, i);
    if (!inner || inner.length === 0 || inner.length > COMPACT_MAX_FLATTEN_INNER_KEYS || inner.some((k) => COMPACT_BAD_NAME_RE.test(k))) {
      i++;
      continue;
    }
    const parent = fields[i].name;
    fields.splice(i, 1, ...inner.map((k) => ({ name: `${parent}.${k}`, type: "string", nullable: false })));
    for (const row of rows) {
      const cell = row[i];
      const obj = "s" in cell && isRecord(cell.s) ? cell.s : undefined;
      row.splice(i, 1, ...inner.map((k) => /** @type {Cell} */ (obj && Object.hasOwn(obj, k) ? { s: obj[k] } : { m: true })));
    }
    for (let off = 0; off < inner.length; off++) {
      let type = "string";
      let saw = false;
      let nullable = false;
      for (const row of rows) {
        const cell = row[i + off];
        if ("m" in cell || ("s" in cell && cell.s === null)) nullable = true;
        else if ("s" in cell) {
          const t = typeTag(cell.s);
          if (!saw) [type, saw] = [t, true];
          else if (t !== type) type = "json";
        } else type = "json";
      }
      Object.assign(fields[i + off], { type, nullable });
    }
    i += inner.length;
  }
}

/**
 * Upstream build_homogeneous_table: columns by descending frequency, then name; a column's type is its first non-null value's
 * (`json` on a conflict, `string` when all null); nullable when a row lacks it or holds null. Charges rows × columns to `budget`.
 * @param {Record<string, unknown>[]} rows
 * @param {readonly string[]} keys sorted
 * @param {Map<string, number>} freq
 * @param {WorkBudget} budget
 * @returns {Compaction}
 */
function homogeneousTable(rows, keys, freq, budget) {
  const n = rows.length;
  budget.left -= n * keys.length;
  if (budget.left < 0) return { kind: "untouched", value: rows };
  const ordered = [...keys].sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  /** @type {FieldSpec[]} */
  const fields = ordered.map((k) => {
    /** @type {string|undefined} */
    let type;
    let nullable = (freq.get(k) ?? 0) < n;
    for (const o of rows) {
      if (!Object.hasOwn(o, k)) continue;
      if (o[k] === null) {
        nullable = true;
        continue;
      }
      const t = typeTag(o[k]);
      if (type === undefined) type = t;
      else if (type !== t) type = "json";
    }
    return { name: k, type: type ?? "string", nullable };
  });
  /** @type {Cell[][]} */
  const cells = rows.map((o) => ordered.map((k) => (Object.hasOwn(o, k) ? cellFrom(o[k], budget) : { m: true })));
  flattenUniformNested(fields, cells);
  return { kind: "table", fields, rows: cells };
}

/**
 * Upstream bucket_by: rows grouped by the discriminator's value in sorted order, each group compacted on its own; a group that
 * is not a table becomes a one-column `value:json` table of its raw rows.
 * @param {Record<string, unknown>[]} rows
 * @param {string} disc
 * @param {WorkBudget} budget
 * @returns {Compaction}
 */
function bucketBy(rows, disc, budget) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const groups = new Map();
  for (const o of rows) {
    const key = String(o[disc]);
    const group = groups.get(key);
    if (group) group.push(o);
    else groups.set(key, [o]);
  }
  /** @type {Bucket[]} */
  const buckets = [...groups.keys()].sort().map((key) => {
    const group = groups.get(key) ?? [];
    const inner = compactRows(group, budget);
    if (inner.kind === "table") return { key, fields: inner.fields, rows: inner.rows };
    budget.left -= group.length;
    return { key, fields: [{ name: "value", type: "json", nullable: false }], rows: group.map((o) => [{ s: o }]) };
  });
  return { kind: "buckets", disc, buckets };
}

/**
 * Upstream compact_inner (TabularCompactor) with opaque markers off: 2+ objects become a table, or buckets when under 60% of
 * the keys are in 80% of the rows and a discriminator splits them; anything else stays untouched. Deviation: a key holding
 * `,` `:` `{` `}` `?` or a line break leaves the items untouched, and an exhausted work budget (key reads plus table cells)
 * does too. Keys sort by UTF-16 code units where upstream's BTreeMap sorts UTF-8 bytes.
 * @param {readonly unknown[]} items
 * @param {WorkBudget} [budget] unbounded when absent
 * @returns {Compaction}
 */
export function compactRows(items, budget = { left: Infinity }) {
  /** @type {Compaction} */
  const untouched = { kind: "untouched", value: items };
  if (items.length < COMPACT_MIN_ITEMS || budget.left < 0 || !items.every(isRecord)) return untouched;
  const rows = /** @type {Record<string, unknown>[]} */ (items);
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const o of rows) {
    const ks = Object.keys(o);
    budget.left -= ks.length;
    for (const k of ks) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const keys = [...freq.keys()].sort();
  if (budget.left < 0 || keys.some((k) => COMPACT_BAD_NAME_RE.test(k))) return untouched;
  const core = keys.filter((k) => (freq.get(k) ?? 0) >= Math.ceil(rows.length * COMPACT_CORE_FIELD_FRACTION)).length;
  if ((keys.length === 0 ? 1 : core / keys.length) < COMPACT_HETEROGENEOUS_CORE_RATIO) {
    const disc = discriminator(rows, keys, freq);
    if (disc !== undefined) return bucketBy(rows, disc, budget);
  }
  return homogeneousTable(rows, keys, freq, budget);
}

/**
 * @param {string} s
 * @returns {string} `s` in double quotes, inner quotes doubled (upstream csv_quote)
 */
const csvQuote = (s) => `"${s.replaceAll('"', '""')}"`;

/**
 * Upstream json_scalar_to_csv: null, booleans and numbers bare; a string quoted when empty, `null` or holding `,` `"` or a line
 * break; an object or array as quoted JSON.
 * @param {unknown} v
 * @returns {string}
 */
function csvScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v === "" || v === "null" || /[,"\n\r]/.test(v) ? csvQuote(v) : v;
  return csvQuote(JSON.stringify(v));
}

/**
 * Upstream is_ambiguous_json_text: JSON could read `s` as something other than the string (after JSON whitespace it starts
 * with `[` `{` `"` `-` or a digit, or is a bare literal Python accepts).
 * @param {string} s
 * @returns {boolean}
 */
function isAmbiguousJsonText(s) {
  let a = 0;
  let b = s.length;
  while (a < b && " \t\n\r".includes(s[a])) a++;
  while (b > a && " \t\n\r".includes(s[b - 1])) b--;
  const t = s.slice(a, b);
  return /^[[{"\-0-9]/.test(t) || ["true", "false", "null", "NaN", "Infinity"].includes(t);
}

/**
 * Upstream format_cell: a missing key is empty, an ambiguous string in a `json` column is a quoted JSON literal, a nested
 * compaction is quoted compactionJson, everything else csvScalar.
 * @param {Cell} cell
 * @param {boolean} jsonColumn
 * @returns {string}
 */
function csvCell(cell, jsonColumn) {
  if ("m" in cell) return "";
  if ("n" in cell) return csvQuote(JSON.stringify(compactionJson(cell.n)));
  return jsonColumn && typeof cell.s === "string" && isAmbiguousJsonText(cell.s) ? csvQuote(JSON.stringify(cell.s)) : csvScalar(cell.s);
}

/**
 * Upstream write_table: `[N]{name:type,name:type?,…}` then one CSV row per record, each line ending in `\n`.
 * @param {readonly FieldSpec[]} fields
 * @param {readonly Cell[][]} rows
 * @returns {string}
 */
function csvTable(fields, rows) {
  const json = fields.map((f) => f.type === "json");
  let out = `[${rows.length}]{${fields.map((f) => `${f.name}:${f.type}${f.nullable ? "?" : ""}`).join(",")}}\n`;
  for (const row of rows) out += `${row.map((cell, i) => csvCell(cell, json[i] ?? false)).join(",")}\n`;
  return out;
}

/**
 * Upstream CsvSchemaFormatter (include_drop_summary false): a table, `__buckets:<disc>` then `__key:<value>` and a table per
 * bucket, or an untouched value as compact JSON. Field names are not escaped (upstream's documented exposure; compactRows
 * refuses the names that would break the header).
 * @param {Compaction} c
 * @returns {string}
 */
export function formatCsvSchema(c) {
  if (c.kind === "table") return csvTable(c.fields, c.rows);
  if (c.kind === "buckets") return `__buckets:${c.disc}\n${c.buckets.map((b) => `__key:${csvScalar(b.key)}\n${csvTable(b.fields, b.rows)}`).join("")}`;
  return JSON.stringify(c.value);
}

/**
 * Upstream compaction_to_json (the JSON a nested cell renders as), key order as upstream: a missing cell reads null.
 * @param {Compaction} c
 * @returns {unknown}
 */
export function compactionJson(c) {
  /** @param {readonly FieldSpec[]} fields */
  const schema = (fields) => fields.map((f) => (f.nullable ? { name: f.name, type: f.type, nullable: true } : { name: f.name, type: f.type }));
  /** @param {readonly Cell[][]} rows */
  const rowsJson = (rows) => rows.map((r) => r.map((cell) => ("m" in cell ? null : "n" in cell ? compactionJson(cell.n) : cell.s)));
  if (c.kind === "table") return { _compaction: "table", _schema: schema(c.fields), _kept: c.rows.length, _total: c.rows.length, _rows: rowsJson(c.rows) };
  if (c.kind === "buckets")
    return {
      _compaction: "buckets",
      _discriminator: c.disc,
      _total: c.buckets.reduce((a, b) => a + b.rows.length, 0),
      _buckets: c.buckets.map((b) => ({ _key: b.key, _schema: schema(b.fields), _rows: rowsJson(b.rows) })),
    };
  return c.value;
}

/**
 * Upstream crush_array_with_source: undefined when the array is within K (the caller recurses into its rows). Then, with
 * `modes.lossless`, the csv-schema table when it saves at least 15% of the array's compact JSON (upstream estimate_array_bytes,
 * in UTF-16 units here); without `modes.lossy`, the array itself (upstream lossless_only); the array itself when the
 * crushability gate skips it; else the kept rows in index order. The compaction's work is charged to a budget of 4 per
 * character of that JSON + 4096 and abandoned when it runs out.
 * @param {Record<string, unknown>[]} items
 * @param {string} query
 * @param {CrushModes} modes
 * @returns {string|Record<string, unknown>[]|undefined}
 */
function crushDictArray(items, query, modes) {
  const strings = items.map((o) => JSON.stringify(o));
  const max = computeOptimalK(strings);
  if (items.length <= max) return undefined;
  if (modes.lossless) {
    let estimate = strings.length + 1; // the n − 1 commas and two brackets around the rows
    for (const s of strings) estimate += s.length;
    /** @type {WorkBudget} */
    const budget = { left: SCAN_BUDGET_PER_CHAR * estimate + SCAN_BUDGET_FLOOR };
    const c = compactRows(items, budget);
    if (c.kind !== "untouched" && budget.left >= 0) {
      const r = formatCsvSchema(c);
      if (1 - r.length / estimate >= LOSSLESS_MIN_SAVINGS) return r;
    }
  }
  if (!modes.lossy) return items;
  const analysis = analyzeArray(items, strings);
  if (analysis.strategy === "skip") return items;
  const keep = createPlan({ items, strings, canon: items.map(canonicalJson), analysis, query, max });
  return [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * Python round / Rust round_ties_even: the nearest integer, a tie going to the even one.
 * @param {number} x
 * @returns {number}
 */
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * Upstream compute_k_split with the BUG #4 clamp: the adaptive K, then the first 30% and the last 15% of it (each at least 1),
 * clamped so first + last never pass K.
 * @param {readonly string[]} strings the items as strings (a string as is, a number as String(n))
 * @returns {[number, number, number]} K, first, last
 */
function kSplit(strings) {
  const kTotal = computeOptimalK(strings);
  const kFirst = Math.min(Math.max(1, roundHalfEven(kTotal * K_FIRST_FRACTION)), kTotal);
  const kLast = Math.min(Math.max(1, roundHalfEven(kTotal * K_LAST_FRACTION)), kTotal - kFirst);
  return [kTotal, kFirst, kLast];
}

/**
 * @param {number} n
 * @param {number} first
 * @param {number} last
 * @returns {number[]} the first `first` and the last `last` indices of `n`
 */
function boundaryIndices(n, first, last) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < Math.min(first, n); i++) out.push(i);
  for (let i = Math.max(0, n - last); i < n; i++) out.push(i);
  return out;
}

/**
 * Upstream crush_string_array: 8 or fewer items pass through; otherwise every error-keyword item, every length anomaly (code
 * points more than 2 sample σ from the mean) and the first and last K items stay, and a stride over the rest tops the kept set up
 * to K plus the errors and anomalies, skipping exact repeats of a kept string. The kept items keep their order.
 * @param {readonly string[]} items
 * @returns {readonly string[]} `items` itself when nothing was dropped
 */
export function crushStringArray(items) {
  const n = items.length;
  if (n <= 8) return items;
  const [kTotal, kFirst, kLast] = kSplit(items);
  /** @type {Set<number>} */
  const errors = new Set();
  items.forEach((s, i) => {
    const l = s.toLowerCase();
    if (ERROR_KEYWORDS.some((k) => l.includes(k))) errors.add(i);
  });
  const lengths = items.map((s) => Array.from(s).length);
  const m = mean(lengths) ?? 0;
  const sd = Math.sqrt(sampleVariance(lengths) ?? 0);
  /** @type {Set<number>} */
  const anomalies = new Set();
  if (sd > 0) lengths.forEach((len, i) => Math.abs(len - m) > VARIANCE_THRESHOLD * sd && anomalies.add(i));
  const keep = new Set([...errors, ...anomalies, ...boundaryIndices(n, kFirst, kLast)]);
  const seen = new Set([...keep].map((i) => items[i]));
  const remaining = kTotal - keep.size;
  if (remaining > 0) {
    const stride = Math.max(1, Math.floor((n - 1) / (remaining + 1)));
    const cap = kTotal + errors.size + anomalies.size;
    for (let i = 0; i < n && keep.size < cap; i += stride)
      if (!keep.has(i) && !seen.has(items[i])) {
        keep.add(i);
        seen.add(items[i]);
      }
  }
  return keep.size === n ? items : [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * Upstream crush_number_array's change points: with more than 10 numbers, each index i in 5..n−6 where the means of the 5 numbers
 * before and the 5 from i differ by more than 2σ (`sd`). Unlike changePoints (the dict analyzer's), no minimum spacing.
 * @param {readonly number[]} items
 * @param {number} sd the sample standard deviation of `items`
 * @returns {number[]}
 */
export function numberChangePoints(items, sd) {
  const w = 5;
  /** @type {number[]} */
  const out = [];
  if (items.length <= 10 || !(sd > 0)) return out;
  for (let i = w; i < items.length - w; i++) {
    const shift = Math.abs((mean(items.slice(i, i + w)) ?? 0) - (mean(items.slice(i - w, i)) ?? 0));
    if (shift > VARIANCE_THRESHOLD * sd) out.push(i);
  }
  return out;
}

/**
 * Upstream crush_number_array without its strategy string: 8 or fewer items pass through; otherwise every outlier (more than 2
 * sample σ from the mean), every change point and the first and last K numbers stay, and a stride tops the kept set up to K plus
 * the outliers. The kept numbers keep their order.
 * @param {readonly number[]} items
 * @returns {readonly number[]} `items` itself when nothing was dropped
 */
export function crushNumberArray(items) {
  const n = items.length;
  if (n <= 8) return items;
  const [kTotal, kFirst, kLast] = kSplit(items.map(String));
  const m = mean(items) ?? 0;
  const sd = Math.sqrt(sampleVariance(items) ?? 0);
  /** @type {Set<number>} */
  const outliers = new Set();
  if (sd > 0) items.forEach((x, i) => Math.abs(x - m) > VARIANCE_THRESHOLD * sd && outliers.add(i));
  const keep = new Set([...outliers, ...numberChangePoints(items, sd), ...boundaryIndices(n, kFirst, kLast)]);
  const remaining = kTotal - keep.size;
  if (remaining > 0) {
    const stride = Math.max(1, Math.floor((n - 1) / (remaining + 1)));
    const cap = kTotal + outliers.size;
    for (let i = 0; i < n && keep.size < cap; i += stride) keep.add(i);
  }
  return keep.size === n ? items : [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * Upstream group_key: the JSON type of a value, as crush_mixed_array groups by it.
 * @param {unknown} v
 * @returns {'dict'|'str'|'bool'|'number'|'list'|'none'}
 */
function jsonType(v) {
  if (v === null) return "none";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return typeof v === "number" ? "number" : "dict";
}

/**
 * Upstream classify_array: a non-empty array of one JSON type is a dict, string or number array; bool-only, nested-only and empty
 * arrays are `other`; any mix, or any null, is `mixed`.
 * @param {readonly unknown[]} v
 * @returns {'dict'|'string'|'number'|'mixed'|'other'}
 */
function classifyArray(v) {
  if (v.length === 0) return "other";
  const types = new Set(v.map(jsonType));
  if (types.size > 1 || types.has("none")) return "mixed";
  return types.has("dict") ? "dict" : types.has("str") ? "string" : types.has("number") ? "number" : "other";
}

/**
 * Upstream crush_mixed_array: 8 or fewer items pass through; otherwise the items are grouped by JSON type (first seen first) and a
 * group of fewer than 5 is kept whole. The dict group goes through crushDictArray with the caller's modes (a winning table, a skip
 * or an array within K keeps it whole; dropped rows are matched back by sorted-key JSON), the string group keeps every item equal
 * to a string crushStringArray kept, the number group keeps its first and last K plus its outliers, and every other group is kept.
 * @param {readonly unknown[]} items
 * @param {string} query
 * @param {CrushModes} modes
 * @returns {readonly unknown[]} `items` itself when nothing was dropped
 */
function crushMixedArray(items, query, modes) {
  if (items.length <= 8) return items;
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  items.forEach((v, i) => {
    const t = jsonType(v);
    const g = groups.get(t);
    if (g) g.push(i);
    else groups.set(t, [i]);
  });
  /** @type {Set<number>} */
  const keep = new Set();
  /** @param {number} i */
  const add = (i) => keep.add(i);
  for (const [type, idx] of groups) {
    const values = idx.map((i) => items[i]);
    if (values.length < MIN_ITEMS_TO_ANALYZE) idx.forEach(add);
    else if (type === "dict") {
      const r = crushDictArray(/** @type {Record<string, unknown>[]} */ (values), query, modes);
      if (r === undefined || typeof r === "string") idx.forEach(add);
      else {
        const kept = new Set(r.map(canonicalJson));
        idx.forEach((i, j) => kept.has(canonicalJson(values[j])) && add(i));
      }
    } else if (type === "str") {
      const kept = new Set(crushStringArray(/** @type {string[]} */ (values)));
      idx.forEach((i, j) => kept.has(/** @type {string} */ (values[j])) && add(i));
    } else if (type === "number") {
      const nums = /** @type {number[]} */ (values);
      const [, kFirst, kLast] = kSplit(nums.map(String));
      for (const j of boundaryIndices(nums.length, kFirst, kLast)) add(idx[j]);
      const m = mean(nums);
      const sd = Math.sqrt(sampleVariance(nums) ?? 0);
      if (m !== undefined && sd > 0) nums.forEach((x, j) => Math.abs(x - m) > VARIANCE_THRESHOLD * sd && add(idx[j]));
    } else idx.forEach(add);
  }
  return keep.size === items.length ? items : [...keep].sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * A number lexeme as sign, significant digits and a power of ten, so two spellings of one decimal compare equal.
 * @param {string} lexeme
 * @returns {string|undefined} undefined when it is not a decimal ("Infinity")
 */
function canonNumber(lexeme) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(lexeme);
  if (!m) return undefined;
  const frac = m[3] ?? "";
  const digits = (m[2] + frac).replace(/^0+/, "");
  const sig = digits.replace(/0+$/, "");
  return sig === "" ? "0" : `${m[1]}${sig}e${Number(m[4] ?? 0) - frac.length + digits.length - sig.length}`;
}

/**
 * @param {unknown} v
 * @returns {number} the object keys at every depth of `v`
 */
function countKeys(v) {
  const children = Array.isArray(v) ? v : isRecord(v) ? Object.values(v) : [];
  let n = isRecord(v) ? Object.keys(v).length : 0;
  for (const c of children) n += countKeys(c);
  return n;
}

/**
 * True when JSON.stringify(value) would not say what `text` says: a number whose double prints as another decimal
 * (more than 17 significant digits, an integer past 2^53, an overflow to Infinity), a -0, or a duplicate object key.
 * @param {string} text valid JSON
 * @param {unknown} value JSON.parse(text)
 * @returns {boolean}
 */
function isLossy(text, value) {
  let keys = 0; // key tokens in the text: more than the parsed objects hold means a later duplicate won
  const token = /"[^"\\]*(?:\\.[^"\\]*)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const colon = /\s*:/y;
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    const lexeme = m[0];
    if (lexeme[0] === '"') {
      colon.lastIndex = token.lastIndex;
      if (colon.test(text)) keys++;
    } else {
      if (lexeme[0] === "-" && Number(lexeme) === 0) return true;
      // Up to 15 characters without an exponent hold at most 15 digits, which survive the decimal -> double -> decimal trip.
      if ((lexeme.length > 15 || /e/i.test(lexeme)) && canonNumber(lexeme) !== canonNumber(String(Number(lexeme)))) return true;
    }
  }
  return keys !== countKeys(value);
}

/**
 * Upstream process_value: crushes each dict array of 5+ rows (a lossless table replaces it as a string; a CCR sentinel
 * closes one that lost rows, and its kept rows are not descended into); with `modes.lossy`, crushes each string, number or mixed
 * array of 5+ items (a `… N more items <<ccr:HASH N_items_offloaded>>` string closes one that lost items), and never descends
 * into such an array either way; recurses into everything else, keeps every object key, and parses stringified JSON
 * containers (process_string, which uses a table string as is). Depth 50 and below is left as is.
 * @param {unknown} v
 * @param {number} depth
 * @param {string} query
 * @param {CrushAcc} acc
 * @param {CrushModes} modes
 * @returns {unknown} `v` itself when nothing below it changed
 */
function processValue(v, depth, query, acc, modes) {
  if (depth >= MAX_PROCESS_DEPTH) return v;
  if (typeof v === "string") {
    // A stringified JSON object or array is crushed too and re-emitted as a string (opaque-blob CCR is deferred).
    if (!/^[{[]/.test(v.trimStart())) return v;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch {
      return v;
    }
    if (typeof parsed !== "object" || parsed === null || isLossy(v, parsed)) return v;
    const out = processValue(parsed, depth + 1, query, acc, modes);
    // A table string is used as is: re-encoding it would double-encode the field (upstream process_string).
    return out === parsed ? v : typeof out === "string" ? out : JSON.stringify(out);
  }
  if (Array.isArray(v)) {
    const shape = v.length >= MIN_ITEMS_TO_ANALYZE ? classifyArray(v) : "other";
    if (shape === "string" || shape === "number" || shape === "mixed") {
      if (!modes.lossy) return v; // upstream lossless_only: no CCR marker without the lossy stage, so the array stays whole
      /** @type {readonly unknown[]} */
      let scalars;
      if (shape === "string") scalars = crushStringArray(/** @type {string[]} */ (v));
      else if (shape === "number") scalars = crushNumberArray(/** @type {number[]} */ (v));
      else scalars = crushMixedArray(v, query, modes);
      const d = v.length - scalars.length;
      if (d === 0) return v;
      const json = JSON.stringify(v);
      const hash = contentHash(json);
      acc.rowsDropped += d;
      acc.offloaded.push([hash, json]);
      return [...scalars, `… ${d} more items <<ccr:${hash} ${d}_items_offloaded>>`]; // upstream append_scalar_drop_sentinel
    }
    const kept = shape === "dict" ? crushDictArray(/** @type {Record<string, unknown>[]} */ (v), query, modes) : undefined;
    if (kept === undefined) {
      const out = v.map((x) => processValue(x, depth + 1, query, acc, modes));
      return out.some((x, i) => x !== v[i]) ? out : v;
    }
    if (typeof kept === "string") {
      acc.compacted++;
      acc.compactSaved += JSON.stringify(v).length - JSON.stringify(kept).length;
      return kept;
    }
    if (kept.length === v.length) return v;
    const json = JSON.stringify(v);
    const hash = contentHash(json);
    const dropped = v.length - kept.length;
    acc.rowsDropped += dropped;
    acc.offloaded.push([hash, json]);
    return [...kept, { _ccr_dropped: `<<ccr:${hash} ${dropped}_rows_offloaded>>` }];
  }
  if (!isRecord(v)) return v;
  const entries = Object.entries(v).map(([k, x]) => /** @type {[string, unknown]} */ ([k, processValue(x, depth + 1, query, acc, modes)]));
  // fromEntries defines own properties, so a "__proto__" key stays data.
  return entries.some(([k, x]) => x !== v[k]) ? Object.fromEntries(entries) : v;
}

/**
 * SmartCrusher over one JSON document (upstream smart_crush_content): with `modes.lossless`, a dict array whose csv-schema
 * table saves 15% becomes that table as a string (a top-level array yields a JSON string literal, upstream's wrapper); with
 * `modes.lossy`, dict arrays lose rows to a `{"_ccr_dropped":"<<ccr:HASH N_rows_offloaded>>"}` sentinel. The result is compact
 * JSON. Undefined means pass the text through: at most CRUSH_MIN_CHARS, not a JSON object or array, a number, -0 or duplicate
 * key JSON.parse cannot keep, nothing changed, or output that is not shorter (a table's `\n` escapes can fail this after it
 * passed the 15% gate, as upstream). Deviation: upstream also minifies a pretty-printed document that lost no rows; here such
 * a result keeps its original bytes.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery), "" for none
 * @param {CrushModes} [modes] the lossy path alone when absent
 * @returns {CrushOutcome|undefined}
 */
export function crushJson(text, query, modes = { lossy: true, lossless: false }) {
  if (text.length <= CRUSH_MIN_CHARS) return undefined;
  let value;
  try {
    value = parseJson(text, true);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || isLossy(text, value)) return undefined;
  /** @type {CrushAcc} */
  const acc = { rowsDropped: 0, compacted: 0, compactSaved: 0, offloaded: [] };
  const out = processValue(value, 0, query, acc, modes);
  if (out === value) return undefined; // nothing dropped: keep the original bytes
  const s = JSON.stringify(out);
  return s.length < text.trim().length ? { text: s, ...acc } : undefined;
}

/**
 * A candidate parses, so a build log that starts with "[" never costs the hook a transcript fetch.
 * @param {string} s
 * @returns {boolean} more than CRUSH_MIN_CHARS and a JSON object or array
 */
function looksLikeJsonDoc(s) {
  if (s.length <= CRUSH_MIN_CHARS || !/^[{[]/.test(s.trimStart())) return false;
  try {
    parseJson(s);
    return true;
  } catch {
    return false;
  }
}

/** @type {{ key: string, ok: boolean, value: unknown, err: unknown } | undefined} */
let lastParse;
const JSON_WS = /^[ \t\n\r]*$/;

/**
 * JSON.parse(text), memoized for the last text: the append path asks wantsQuery, detectContentType and crushJson
 * about the same result, so a large document is parsed once. Keyed by the trimmed text so detectContentType's trimmed
 * form hits too; JSON.parse skips only space, tab, LF and CR around a value, so other trimmed whitespace still throws.
 * shortcut: holds one parsed value until the next text or a `take`; a per-row cache would need the row threaded through.
 * @param {string} text
 * @param {boolean} [take] the caller owns the value (crushJson rewrites from it), so the memo drops it
 * @returns {unknown} the parsed value; throws what JSON.parse throws
 */
function parseJson(text, take = false) {
  const key = text.trim();
  let r = lastParse;
  if (!r || r.key !== key) {
    try {
      r = { key, ok: true, value: JSON.parse(key), err: undefined };
    } catch (err) {
      r = { key, ok: false, value: undefined, err };
    }
  }
  lastParse = take ? undefined : r;
  if (!r.ok) throw r.err;
  if (key.length !== text.length) {
    const lead = text.length - text.trimStart().length;
    const tail = text.length - text.trimEnd().length;
    if (!JSON_WS.test(text.slice(0, lead)) || !JSON_WS.test(text.slice(text.length - tail))) JSON.parse(text); // throws, as an untrimmed parse would
  }
  return r.value;
}

/**
 * @param {unknown} b
 * @returns {b is { type: "text", text: string }} a text content block (an MCP result's or a Messages-API tool_result's)
 */
function isTextBlock(b) {
  return isRecord(b) && b.type === "text" && typeof b.text === "string";
}

// Dense line elider: a port of headroom's dense_line_elider.py and ContentRouter._elide_dense.

/**
 * A cut at `i` would split a surrogate pair: a low surrogate at `i` preceded by a high one.
 * @param {string} s
 * @param {number} i
 * @returns {boolean}
 */
function splitsPair(s, i) {
  if (i <= 0 || i >= s.length) return false;
  const lo = s.charCodeAt(i);
  const hi = s.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff;
}

/**
 * The end of a head cut `s.slice(0, i)` that leaves no lone surrogate (one unit shorter when `i` splits a pair).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function pairSafeEnd(s, i) {
  return splitsPair(s, i) ? i - 1 : i;
}

/**
 * The start of a tail cut `s.slice(i)` that leaves no lone surrogate (one unit later when `i` splits a pair).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function pairSafeStart(s, i) {
  return splitsPair(s, i) ? i + 1 : i;
}

/**
 * Upstream _scan_from: walks one bracket span from `start` outside strings, records every container it pushed
 * in `known` (its end, or null when it never closes) and returns the span's end (or null) and the characters walked.
 * @param {string} text
 * @param {number} start the index of a "[" or "{"
 * @param {Map<number, number|null>} known
 * @returns {[number|null, number]}
 */
function scanFrom(text, start, known) {
  /** @type {number[]} */
  const stack = [];
  let inStr = false;
  let esc = false;
  const n = text.length;
  for (let j = start; j < n; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") stack.push(j);
    else if (ch === "]" || ch === "}") {
      const top = stack.at(-1);
      if (top === undefined || text[top] !== (ch === "}" ? "{" : "[")) {
        for (const p of stack) known.set(p, null);
        return [null, j - start + 1];
      }
      stack.pop();
      known.set(top, j + 1);
      if (stack.length === 0) return [j + 1, j - start + 1];
    }
  }
  for (const p of stack) known.set(p, null);
  return [null, n - start];
}

/**
 * Upstream scan_json_documents read as `complete and not spans`: no balanced bracket span (nested ones included)
 * parses as a JSON object or array. An exhausted walk or parse budget, or a parse failure other than a SyntaxError
 * (upstream: RecursionError), means the scan is incomplete, so false.
 * @param {string} text
 * @returns {boolean}
 */
function noJsonSpans(text) {
  const n = text.length;
  const budget = SCAN_BUDGET_PER_CHAR * n + SCAN_BUDGET_FLOOR;
  /** @type {Map<number, number|null>} */
  const known = new Map();
  let spent = 0;
  let i = 0;
  while (i < n) {
    if (text[i] === "[" || text[i] === "{") {
      /** @type {number|null|undefined} */
      let end;
      if (known.has(i)) end = known.get(i);
      else if (spent >= budget) return false;
      else {
        const [e, walked] = scanFrom(text, i, known);
        end = e;
        spent += walked;
      }
      if (typeof end === "number") {
        i = end;
        continue;
      }
    }
    i++;
  }
  let parsed = 0;
  for (const start of [...known.keys()].sort((a, b) => a - b)) {
    const end = known.get(start);
    if (typeof end !== "number") continue;
    if (parsed + end - start > budget) return false;
    parsed += end - start;
    let v;
    try {
      v = JSON.parse(text.slice(start, end));
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      return false;
    }
    if (typeof v === "object" && v !== null) return false;
  }
  return true;
}

/**
 * Upstream is_dense_line: at least 300 characters, no tab, under 6% spaces (U+0020), not JSON-shaped once trimmed,
 * and holding no JSON document (a label may precede compact JSON, which only the SmartCrusher may rewrite).
 * @param {string} line
 * @returns {boolean}
 */
function isDenseLine(line) {
  const n = line.length;
  if (n < DENSE_MIN_LINE_CHARS || line.includes("\t")) return false;
  let spaces = 0;
  for (let p = line.indexOf(" "); p >= 0; p = line.indexOf(" ", p + 1)) spaces++;
  if (spaces / n >= DENSE_MAX_SPACE_RATIO) return false;
  const s = line.trim();
  // "{[".includes("") is true like Python's "" in "{[": an all-whitespace line counts as JSON-shaped, as upstream.
  if ("{[".includes(s.slice(0, 1)) && "}]".includes(s.slice(-1))) return false;
  return noJsonSpans(line);
}

/**
 * Dense line elider (upstream dense_line_elider.py + ContentRouter._elide_dense): each long, nearly space-free line that
 * holds no JSON document keeps its first 160 and last 80 characters around an omission note, when the dense lines add
 * up to at least 2000 characters; the block then ends with a retrieval line and its original goes to the CCR store.
 * A line a tag span touches is never dense (the tag protector, a mod-side guard). Undefined when nothing is dense or the
 * result is not shorter.
 * @param {string} text
 * @param {readonly [number, number][]} [spans] tagSpans(text), none when absent
 * @returns {Elision|undefined}
 */
export function elideDense(text, spans = []) {
  if (text.length < DENSE_MIN_LINE_CHARS) return undefined;
  const lines = text.split("\n"); // "\n" only: a "\r" stays on its line
  const tagged = spanLines(lines, spans);
  const dense = lines.map((line, i) => !tagged[i] && isDenseLine(line));
  let total = 0;
  for (let i = 0; i < lines.length; i++) if (dense[i]) total += lines[i].length;
  if (total < DENSE_MIN_TOTAL_CHARS) return undefined;
  let n = 0;
  const out = lines.map((line, i) => {
    if (!dense[i]) return line;
    n++;
    const head = line.slice(0, pairSafeEnd(line, DENSE_HEAD_CHARS));
    const tail = line.slice(pairSafeStart(line, line.length - DENSE_TAIL_CHARS));
    return `${head} ...[${line.length - head.length - tail.length} chars of dense machine-generated content elided]... ${tail}`;
  });
  const hash = contentHash(text);
  const elided = `${out.join("\n")}\n[${n} dense machine-generated ${n === 1 ? "line" : "lines"} elided. Retrieve original: hash=${hash}]`;
  // Deviation: upstream emits a result that grew (seven 300-char lines plus the retrieval line); the mod passes it through.
  return elided.length < text.length ? { text: elided, lines: n, offloaded: [[hash, text]] } : undefined;
}

// Cross-turn dedup: a port of headroom's cross_turn_dedup.py, run once per appended tool-result text.

/**
 * Upstream _num_and_key: a leading unpadded line number, the match key (the line without that number, its separator
 * kept, so the same content at another line number shares a key) and the content after the separator.
 * Deviation: a number beyond Number.MAX_SAFE_INTEGER counts as no number (Python ints are unbounded).
 * @param {string} line
 * @returns {[number|null, string, string]}
 */
function numAndKey(line) {
  const m = DEDUP_LINENO_RE.exec(line);
  if (!m) return [null, line, line];
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? [n, m[2] + m[3], m[3]] : [null, line, line];
}

/**
 * Upstream _is_trivial: a line too short or too common to anchor a match on its own.
 * @param {string} content
 * @returns {boolean}
 */
function isTrivial(content) {
  const s = content.trim();
  return s.length < 4 || DEDUP_TRIVIAL.has(s);
}

/**
 * Upstream _index_lines: records each surviving non-trivial line as [ordinal, line] under its match key, first-seen
 * order, at most DEDUP_MAX_ANCHOR_CANDIDATES per key. Folded lines (null) are skipped (keep-earliest).
 * @param {readonly (string|null)[]} verbatim
 * @param {number} turn the block's ordinal
 * @param {DedupState} st
 * @returns {void}
 */
function indexLines(verbatim, turn, st) {
  verbatim.forEach((ln, li) => {
    if (ln === null) return;
    const [, key, content] = numAndKey(ln);
    if (isTrivial(content)) return;
    let bucket = st.index.get(key);
    if (!bucket) st.index.set(key, (bucket = []));
    if (bucket.length < DEDUP_MAX_ANCHOR_CANDIDATES) bucket.push([turn, li]);
  });
}

/**
 * Upstream _longest_match: the longest run of `cur` from `start` found in one earlier block, its line keys equal and
 * every numbered pair under one uniform line-number shift (non-numbered lines must match exactly). A longer run wins;
 * a tie keeps the earliest candidate. Undefined when no run starts here.
 * @param {readonly string[]} cur
 * @param {readonly [number|null, string, string][]} curKeys numAndKey of each line of `cur`, computed once per block
 * @param {number} start
 * @param {DedupState} st
 * @returns {{ len: number, turn: number, li: number, delta: number }|undefined}
 */
function longestMatch(cur, curKeys, start, st) {
  const candidates = st.index.get(curKeys[start][1]);
  if (!candidates) return undefined;
  let best = { len: 0, turn: -1, li: -1, delta: 0 };
  for (const [t, li] of candidates) {
    const blockLines = st.corpus.get(t);
    if (!blockLines) continue;
    let k = 0;
    /** @type {number|null} */
    let delta = null;
    while (start + k < cur.length && li + k < blockLines.length) {
      const ca = cur[start + k];
      const cb = blockLines[li + k];
      if (cb === null) break; // a folded span ends the run
      const [na, ka] = curKeys[start + k];
      const [nb, kb] = numAndKey(cb);
      if (ka !== kb) break;
      if (na !== null && nb !== null) {
        const d = na - nb;
        if (delta === null) delta = d;
        else if (delta !== d) break; // an edit inside the span: the shift is not uniform
      } else if (ca !== cb) break;
      k++;
    }
    if (k > best.len) best = { len: k, turn: t, li, delta: delta ?? 0 };
  }
  return best.len === 0 ? undefined : best;
}

/**
 * Upstream _pointer plus a ` hash=H` CCR suffix: `[↑nL same as result K: "anchor" hash=H]`, with ` ±dL` after K when
 * the run's line numbers are shifted. The anchor is the run's first non-blank line's content, at most 20 code points.
 * @param {readonly string[]} span
 * @param {number} refTurn the earlier block's ordinal
 * @param {number} delta
 * @param {string} hash
 * @returns {string}
 */
function pointer(span, refTurn, delta, hash) {
  const first = span.find((ln) => ln.trim() !== "");
  const anchor = first === undefined ? "" : numAndKey(first)[2].trim();
  const points = [...anchor];
  const shown = points.length > 20 ? `${points.slice(0, 17).join("")}...` : anchor;
  const shift = delta === 0 ? "" : ` ${delta > 0 ? "+" : ""}${delta}L`;
  return `[↑${span.length}L same as result ${refTurn}${shift}: ${JSON.stringify(shown)} hash=${hash}]`;
}

/**
 * Empties a conversation's dedup corpus and keeps its ordinal counter, so a later pointer's "result N" never repeats
 * the number of a result that left the corpus. Mutates `st`.
 * @param {DedupState} st
 * @returns {void}
 */
export function resetCorpus(st) {
  st.corpus.clear();
  st.index.clear();
  st.chars = 0;
}

/**
 * Cross-turn dedup (upstream cross_turn_dedup.py) for one tool-result text appended to conversation `key`: each run of
 * at least 3 lines and 40 characters found verbatim (or under one uniform line-number shift) in an earlier block of the
 * same conversation becomes a pointer naming that block's ordinal, with the run's own text stored under a CCR hash.
 * A protected text is only indexed. A line a tag span touches never starts a run and ends one before it (the tag protector,
 * a mod-side guard), but is indexed like any other. The block is then indexed, and the oldest conversations are emptied
 * (resetCorpus, their ordinals kept) while all corpora hold more than DEDUP_MAX_CHARS. Mutates `states`. Undefined when
 * nothing folded.
 * @param {Map<string, DedupState>} states conversation key → corpus, least recently appended first
 * @param {string} key "" for the main loop, else the agentId
 * @param {string} text
 * @param {boolean} isProtected
 * @param {readonly [number, number][]} [spans] tagSpans(text), none when absent
 * @returns {Fold|undefined}
 */
export function dedupBlock(states, key, text, isProtected, spans = []) {
  const st = states.get(key) ?? { turn: 0, corpus: new Map(), index: new Map(), chars: 0 };
  states.delete(key);
  states.set(key, st); // this conversation is now the most recently appended
  const turn = ++st.turn;
  const lines = text.split("\n");
  const keys = isProtected ? [] : lines.map(numAndKey);
  /** @type {string[]} */
  const out = [];
  /** @type {(string|null)[]} */
  const verbatim = isProtected ? [...lines] : [];
  /** @type {[string, string][]} */
  const offloaded = [];
  const tagged = spanLines(lines, spans);
  let folds = 0;
  for (let i = 0; !isProtected && i < lines.length;) {
    const m = tagged[i] ? undefined : longestMatch(lines, keys, i, st);
    let len = m ? m.len : 0;
    for (let k = 1; k < len; k++)
      if (tagged[i + k]) {
        len = k; // a run ends before the first tagged line
        break;
      }
    if (m && len >= DEDUP_MIN_LINES) {
      const span = lines.slice(i, i + len);
      const spanText = span.join("\n");
      if (spanText.length >= DEDUP_MIN_CHARS) {
        const hash = contentHash(spanText);
        const ptr = pointer(span, m.turn, m.delta, hash);
        // Deviation: the hash suffix can make a short run's pointer longer than the run; such a run stays verbatim.
        if (ptr.length < spanText.length) {
          out.push(ptr);
          for (let k = 0; k < len; k++) verbatim.push(null);
          offloaded.push([hash, spanText]);
          folds++;
          i += len;
          continue;
        }
      }
    }
    out.push(lines[i]);
    verbatim.push(lines[i]);
    i++;
  }
  indexLines(verbatim, turn, st);
  st.corpus.set(turn, verbatim);
  st.chars += text.length;
  let total = 0;
  for (const s of states.values()) total += s.chars;
  for (const [oldest, s] of states) {
    if (total <= DEDUP_MAX_CHARS) break;
    if (oldest === key) {
      resetCorpus(st); // this conversation alone is over the cap
      break;
    }
    total -= s.chars;
    resetCorpus(s); // kept, not deleted: its ordinal counter must not restart at 1 while earlier pointers still name its results
  }
  return folds > 0 ? { text: out.join("\n"), spans: folds, offloaded } : undefined;
}

// Content detector and router: a port of headroom's content detection and a light content_router dispatch.

/**
 * Upstream _decode_concatenated_json read for objects: `s` is a run of 2+ JSON objects separated only by whitespace.
 * A SyntaxError means no; any other parse failure propagates (upstream: RecursionError).
 * @param {string} s trimmed text starting with "{"
 * @returns {boolean}
 */
function isObjectRun(s) {
  let idx = 0;
  let count = 0;
  while (idx < s.length) {
    if (/\s/.test(s[idx])) {
      idx++;
      continue;
    }
    if (s[idx] !== "{") return false; // upstream decodes a non-object and rejects the run after
    const end = scanFrom(s, idx, new Map())[0];
    if (end === null) return false;
    try {
      JSON.parse(s.slice(idx, end));
    } catch (err) {
      if (err instanceof SyntaxError) return false;
      throw err;
    }
    count++;
    idx = end;
  }
  return count >= 2;
}

/**
 * Upstream _try_detect_json as a verdict: `s` parses as an object or array (never a bare scalar), else is a run of
 * 2+ whitespace-separated objects, else holds one bracket span, from the first "{" or "[", that parses and spans at
 * least JSON_MIN_BULK_FRACTION of it. A parse failure other than a SyntaxError (upstream: RecursionError) means not JSON.
 * @param {string} s trimmed, non-empty text
 * @returns {boolean}
 */
function isJsonPayload(s) {
  try {
    const v = parseJson(s);
    return typeof v === "object" && v !== null;
  } catch (err) {
    if (!(err instanceof SyntaxError)) return false;
  }
  try {
    if (s.startsWith("{") && isObjectRun(s)) return true;
    const starts = [s.indexOf("{"), s.indexOf("[")].filter((i) => i >= 0);
    if (starts.length === 0) return false;
    const start = Math.min(...starts);
    const end = scanFrom(s, start, new Map())[0];
    if (end === null) return false;
    JSON.parse(s.slice(start, end));
    return end - start >= s.length * JSON_MIN_BULK_FRACTION;
  } catch {
    return false;
  }
}

/**
 * Upstream _try_detect_diff's confidence, 0 without a header line.
 * @param {readonly string[]} lines the first 500 lines
 * @returns {number}
 */
function diffConfidence(lines) {
  let headers = 0;
  let changes = 0;
  for (const line of lines) {
    if (DIFF_HEADER_RE.test(line)) headers++;
    if (DIFF_CHANGE_RE.test(line)) changes++;
  }
  return headers === 0 ? 0 : Math.min(1.0, 0.5 + headers * 0.2 + changes * 0.05);
}

/**
 * Upstream _try_detect_html's confidence, 0 where it returns None.
 * @param {string} sample the first 3000 characters
 * @returns {number}
 */
function htmlConfidence(sample) {
  const doctype = HTML_DOCTYPE_RE.test(sample);
  const html = HTML_TAG_RE.test(sample);
  const structural = (sample.match(HTML_STRUCTURAL_RE) ?? []).length;
  if (!doctype && !html && structural < 3) return 0;
  let c = 0.0;
  if (doctype) c += 0.5;
  if (html) c += 0.3;
  if (HTML_HEAD_RE.test(sample)) c += 0.1;
  if (HTML_BODY_RE.test(sample)) c += 0.1;
  c += Math.min(0.3, structural * 0.03);
  c = Math.min(1.0, c);
  return c < 0.5 ? 0 : c;
}

/**
 * Upstream _try_detect_git_status: a `git status` first line, then a section heading and a path entry under it.
 * @param {string} text
 * @returns {boolean}
 */
function isGitStatus(text) {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  if (!first.startsWith("On branch ") && !first.startsWith("HEAD detached at ") && !first.startsWith("HEAD detached from ")) return false;
  let heading = false;
  let path = false;
  /** @type {string|undefined} */
  let section;
  for (const line of text.split(LINE_BREAK_RE).slice(1)) {
    if (GIT_STATUS_HEADERS.has(line)) {
      heading = true;
      section = line;
    } else if (line === "" || line === "nothing to commit" || line.startsWith("Your branch ") || line.startsWith("  (use ")) continue;
    else if (section === "Untracked files:" && line.startsWith("\t") && line.slice(1).trim() !== "") path = true;
    else if (section !== undefined && section !== "Untracked files:" && GIT_STATUS_ENTRY_RE.test(line)) path = true;
    if (heading && path) return true;
  }
  return false;
}

/**
 * Upstream _prefix_looks_like_path: no markup tag and no key=value prefix.
 * @param {string} prefix
 * @returns {boolean}
 */
function pathLike(prefix) {
  return !/[<>=]/.test(prefix);
}

/**
 * Upstream _is_search_result_line: `path:N:` or `path:N-` with a path-shaped prefix, or a grep context line `path-N-`
 * whose path holds a "/" or "."; never a timestamped log row.
 * @param {string} line
 * @returns {boolean}
 */
function isSearchLine(line) {
  if (TIMESTAMP_ROW_RE.test(line)) return false;
  if (SEARCH_LINE_RE.test(line) || GREP_COLON_DASH_RE.test(line)) return pathLike(line.slice(0, line.indexOf(":")));
  const m = GREP_CONTEXT_RE.exec(line);
  return m !== null && pathLike(m[1]) && /[/.]/.test(m[1]);
}

/**
 * Upstream _try_detect_search's confidence, 0 below 2 matching lines or a 0.3 ratio.
 * @param {readonly string[]} lines the first 100 lines
 * @returns {number}
 */
function searchConfidence(lines) {
  let matching = 0;
  let nonEmpty = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    nonEmpty++;
    if (isSearchLine(line)) matching++;
  }
  if (matching < 2 || nonEmpty === 0) return 0;
  const ratio = matching / nonEmpty;
  return ratio < 0.3 ? 0 : Math.min(1.0, 0.4 + ratio * 0.6);
}

/**
 * Upstream _try_detect_log's confidence: one LOG_PATTERNS match per line at most, 0 below a 0.1 ratio.
 * @param {readonly string[]} lines the first 200 lines
 * @returns {number}
 */
function logConfidence(lines) {
  let matches = 0;
  let errors = 0;
  let nonEmpty = 0;
  for (const line of lines) {
    if (line.trim() !== "") nonEmpty++;
    const i = LOG_PATTERNS.findIndex((re) => re.test(line));
    if (i < 0) continue;
    matches++;
    if (i < 2) errors++;
  }
  if (matches === 0 || nonEmpty === 0) return 0;
  const ratio = matches / nonEmpty;
  return ratio < 0.1 ? 0 : Math.min(1.0, 0.3 + ratio * 0.5 + errors * 0.05);
}

/**
 * Upstream _try_detect_code's confidence from the best language's line score, 0 below a score of 3.
 * @param {readonly string[]} lines the first 100 lines
 * @returns {number}
 */
function codeConfidence(lines) {
  const best = Math.max(...CODE_PATTERNS.map(([, patterns]) => lines.filter((line) => patterns.some((re) => re.test(line))).length));
  if (best < 3) return 0;
  const ratio = best / Math.max(lines.filter((line) => line.trim() !== "").length, 1);
  return Math.min(1.0, 0.4 + ratio * 0.4 + best * 0.02);
}

/**
 * Upstream _INI_ASSIGN_RE (`^\s*[\w.\-@ ]+?\s*[=:]\s*`) as a linear scanner: before the first `=` or `:` stand optional
 * whitespace, a run of word characters, `.`, `-`, `@` and spaces, and optional whitespace. The regex's lazy run plus `\s*`
 * backtracks quadratically on whitespace-heavy lines.
 * @param {string} line
 * @returns {boolean}
 */
export function isIniAssign(line) {
  const k = line.search(/[=:]/);
  if (k < 0) return false;
  const prefix = line.slice(0, k);
  let a = 0;
  while (a < prefix.length && /\s/.test(prefix[a])) a++;
  if (a === prefix.length) return prefix.includes(" "); // all whitespace: a space can stand for the run
  let b = prefix.length;
  while (/\s/.test(prefix[b - 1])) b--;
  for (let i = a; i < b; i++) if (!INI_KEY_CHAR_RE.test(prefix[i])) return false;
  return true;
}

/**
 * Whether a TOML assignment's value lexeme is one tomllib would read: a basic or literal string (multi-line openers too), a
 * number, `inf`, `nan`, a boolean, an RFC 3339 date/time, or an array or inline table opener. Deviation: a line-level stand-in
 * for parsing the whole document.
 * @param {string} raw the text after the `=`
 * @returns {boolean}
 */
function isTomlValue(raw) {
  const v = raw.trim();
  if (v.startsWith('"""') || v.startsWith("'''") || v.startsWith("[") || v.startsWith("{") || TOML_STRING_RE.test(v)) return true;
  const hash = v.indexOf("#");
  const bare = (hash < 0 ? v : v.slice(0, hash)).trim();
  return bare === "true" || bare === "false" || TOML_NUMBER_RE.test(bare) || TOML_DATETIME_RE.test(bare);
}

/**
 * Upstream _try_detect_structured_config's verdict: a section header plus an assignment-dominant body is TOML when every
 * assignment is a TOML key with a TOML value, else INI when every one is an INI assignment (deviation: line checks stand in
 * for tomllib and configparser); otherwise YAML by key, list and document-marker share with the prose, front-matter and
 * structure guards. Runs over the first 200 sampled lines.
 * @param {string} text
 * @param {readonly string[]} head the line-capped sample lines (detectHead)
 * @returns {ConfigFlavor|undefined}
 */
export function configFlavor(text, head) {
  const first = text.trimStart().slice(0, 1);
  if (first === "" || first === "{" || first === "<") return undefined;
  const lines = head.slice(0, 200);
  const nonEmpty = lines.filter((ln) => ln.trim() !== "");
  if (nonEmpty.length < 3) return undefined;
  const body = nonEmpty.filter((ln) => !CONFIG_COMMENT_RE.test(ln)); // comment lines are neutral
  if (body.length < 3) return undefined;
  const sections = body.filter((ln) => CONFIG_SECTION_RE.test(ln)).length;
  if (sections >= 1 && text.length <= CONFIG_MAX_CHARS) {
    const assigns = body.filter((ln) => TOML_ASSIGN_RE.test(ln) || isIniAssign(ln));
    if (assigns.length >= 2 && (sections + assigns.length) / body.length >= 0.6) {
      const toml = assigns.every((ln) => {
        const m = TOML_ASSIGN_RE.test(ln) ? TOML_KEY_RE.exec(ln) : null;
        return m !== null && isTomlValue(ln.slice(m[0].length));
      });
      if (toml) return "toml";
      if (assigns.every(isIniAssign)) return "ini";
    }
  }
  // Markdown front matter: a `---` fence closed within 60 lines and followed by mostly non-YAML lines.
  if (lines[0]?.trim() === "---")
    for (let i = 1; i < Math.min(lines.length, 60); i++) {
      const t = lines[i].trim();
      if (t !== "---" && t !== "...") continue;
      const tail = lines.slice(i + 1).filter((ln) => ln.trim() !== "");
      const yamlTail = tail.filter((ln) => YAML_KEY_RE.test(ln) || YAML_LIST_RE.test(ln)).length;
      if (tail.length && yamlTail / tail.length < 0.3) return undefined;
      break;
    }
  const keys = body.filter((ln) => YAML_KEY_RE.test(ln)).length;
  const lists = body.filter((ln) => YAML_LIST_RE.test(ln) && !YAML_KEY_RE.test(ln)).length;
  const docs = body.filter((ln) => YAML_DOC_RE.test(ln.trim())).length;
  if (keys < 3 || (keys + lists + docs) / body.length < 0.6) return undefined;
  if (body.filter((ln) => /[.!?]$/.test(ln.trimEnd())).length / body.length >= 0.5) return undefined; // prose
  if (body.reduce((a, ln) => a + ln.trim().split(/\s+/).length, 0) / body.length > 8) return undefined;
  const indents = new Set(body.filter((ln) => YAML_KEY_RE.test(ln) || YAML_LIST_RE.test(ln)).map((ln) => ln.length - ln.replace(/^ +/, "").length));
  return indents.size < 2 && docs === 0 && lists < 3 ? undefined : "yaml";
}

/**
 * @param {number} c a UTF-16 code unit
 * @returns {boolean} an ASCII letter or `_` (upstream is_name_start)
 */
const isTagNameStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/**
 * @param {number} c a UTF-16 code unit
 * @returns {boolean} an ASCII letter, digit, `_`, `-`, `.` or `:` (upstream is_name_cont)
 */
const isTagNameCont = (c) => isTagNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 58;

/**
 * @param {number} c a UTF-16 code unit
 * @returns {boolean} ASCII whitespace as Rust's is_ascii_whitespace (space, tab, LF, FF, CR)
 */
const isAsciiSpace = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * Upstream tag_protector.rs parse_tag_at, the one tag lexer the HTML extractor and the tag protector share: at `i` (a `<`),
 * `</name>` with optional whitespace before `>`, or `<name …>` whose attributes run to the first `>` outside quotes (an
 * unterminated quote is no tag; a `/` sets self-closing, whitespace or a quoted value clears it). Each scanned character
 * costs one unit of `budget`, so retrying every `<` of an unterminated tag cannot go quadratic unnoticed.
 * @param {string} text
 * @param {number} i the index of a `<`
 * @param {WorkBudget} budget
 * @returns {TagToken|undefined}
 */
function tagAt(text, i, budget) {
  const n = text.length;
  let j = i + 1;
  const close = j < n && text.charCodeAt(j) === 47;
  if (close) j++;
  if (j >= n || !isTagNameStart(text.charCodeAt(j))) {
    budget.left -= j - i;
    return undefined;
  }
  j++;
  while (j < n && isTagNameCont(text.charCodeAt(j))) j++;
  const nameEnd = j;
  if (close) {
    while (j < n && isAsciiSpace(text.charCodeAt(j))) j++;
    budget.left -= j - i + 1;
    return j < n && text.charCodeAt(j) === 62 ? { close: true, nameEnd, end: j + 1, selfClosing: false } : undefined;
  }
  let selfClosing = false;
  while (j < n) {
    const c = text.charCodeAt(j);
    if (c === 62) {
      budget.left -= j - i + 1;
      return { close: false, nameEnd, end: j + 1, selfClosing };
    }
    if (c === 34 || c === 39) {
      const q = text.indexOf(c === 34 ? '"' : "'", j + 1);
      if (q < 0) break;
      j = q + 1;
      selfClosing = false;
    } else {
      if (c === 47) selfClosing = true;
      else if (isAsciiSpace(c)) selfClosing = false;
      j++;
    }
  }
  budget.left -= n - i;
  return undefined;
}

/**
 * @param {string} name a lowercase HTML element name (letters and digits only)
 * @returns {RegExp} its cached global, case-insensitive `</name\s*>` search
 */
function closeTagRe(name) {
  let re = HTML_CLOSE_RES.get(name);
  if (!re) HTML_CLOSE_RES.set(name, (re = new RegExp(`</${name}\\s*>`, "gi")));
  return re;
}

/**
 * The tag protector (upstream tag_protector.rs identify_spans in block mode, compress_tagged_content off): the [start, end)
 * ranges of every custom (non-HTML5, case-insensitive) tag block `<name …>…</name>`, nested ones collapsed into the outermost,
 * and of every self-closing custom tag `<name/>`. A close matches the top-most open of its name; an orphan close or open is
 * never protected. Deviation: the content of an HTML5 `<svg>` or `<math>` element is not scanned (SVG and MathML children
 * are no workflow tags; an unclosed one skips nothing). The scanned characters and every stack entry a close examines share a budget of 4 per character
 * + 4096; null when it runs out, and such a text must be passed through whole (upstream walks without a bound).
 * @param {string} text
 * @returns {[number, number][]|null} sorted, disjoint spans; null when the text is unprotectable
 */
export function tagSpans(text) {
  /** @type {[number, number][]} */
  const spans = [];
  if (!text.includes("<")) return spans;
  /** @type {WorkBudget} */
  const budget = { left: SCAN_BUDGET_PER_CHAR * text.length + SCAN_BUDGET_FLOOR };
  /** @type {[string, number][]} */
  const stack = []; // open custom tags: [lowercase name, start]
  for (let i = text.indexOf("<"); i >= 0;) {
    const t = tagAt(text, i, budget);
    if (budget.left < 0) return null;
    if (!t) {
      i = text.indexOf("<", i + 1);
      continue;
    }
    const name = text.slice(i + (t.close ? 2 : 1), t.nameEnd).toLowerCase();
    let next = t.end;
    if (HTML5_TAGS.has(name)) {
      if ((name === "svg" || name === "math") && !t.close && !t.selfClosing) {
        const re = closeTagRe(name);
        re.lastIndex = t.end;
        const m = re.exec(text);
        budget.left -= (m ? re.lastIndex : text.length) - t.end;
        if (budget.left < 0) return null;
        if (m) next = re.lastIndex; // unclosed: its content is scanned like any other, so a later workflow tag stays protected
      }
    } else if (!t.close) {
      if (t.selfClosing) spans.push([i, t.end]);
      else stack.push([name, i]);
    } else {
      let k = stack.length - 1;
      for (; k >= 0; k--) {
        budget.left--; // every entry examined costs, so many opens and non-matching closes cannot go quadratic
        if (stack[k][0] === name) break;
      }
      if (budget.left < 0) return null;
      if (k >= 0) {
        const start = stack[k][1];
        stack.length = k;
        while (spans.length > 0 && spans[spans.length - 1][0] >= start) spans.pop(); // spans inside the block collapse into it
        spans.push([start, t.end]);
      }
    }
    i = text.indexOf("<", next);
  }
  return spans;
}

/**
 * For each line of `lines` (the text split on "\n"), whether a span touches it.
 * @param {readonly string[]} lines
 * @param {readonly [number, number][]} spans sorted and disjoint, as tagSpans returns them
 * @returns {boolean[]}
 */
function spanLines(lines, spans) {
  const touched = new Array(lines.length).fill(false);
  let s = 0;
  let start = 0;
  for (let i = 0; i < lines.length && s < spans.length; i++) {
    const end = start + lines[i].length;
    while (s < spans.length && spans[s][1] <= start) s++;
    if (s < spans.length && spans[s][0] <= end) touched[i] = true;
    start = end + 1;
  }
  return touched;
}

/**
 * Decodes `&amp; &lt; &gt; &quot; &apos; &nbsp;` and decimal or hex character references; anything else stays as written.
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return s.includes("&")
    ? s.replace(HTML_ENTITY_RE, (m, dec, hex, name) => {
        if (name) return HTML_ENTITIES[name];
        const cp = dec ? Number(dec) : parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
      })
    : s;
}

/**
 * The HTML extractor (a bounded, hand-written stand-in for upstream's trafilatura HTMLExtractor): one forward pass that skips
 * comments, `<!…>` / `<?…>` declarations and boilerplate or non-text elements (HTML_DROP, open tag to its close tag, or to the
 * end when unclosed), and renders the rest as markdown-ish text: `#` headings, `- ` list items, `[text](href)` links (not `#…`
 * or `javascript:`), `| ` table cells, a line per block element, whitespace kept only inside `<pre>`, entities decoded. The
 * whole pass draws on a budget of 4 per character + 4096. Undefined when the budget runs out, nothing is left (upstream
 * #3609: fall through, never discard) or the result with its retrieval line is not shorter; else the extraction plus
 * `[HTML extracted to text: N characters of markup removed. Retrieve original: hash=H]`, the original under `offloaded`.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function extractHtml(text) {
  const n = text.length;
  /** @type {WorkBudget} */
  const budget = { left: SCAN_BUDGET_PER_CHAR * n + SCAN_BUDGET_FLOOR };
  /** @type {string[]} */
  const parts = [];
  let last = "\n"; // the last character written: a line start or a space swallows a following space
  /** @param {string} s */
  const raw = (s) => {
    if (s === "") return;
    parts.push(s);
    last = s[s.length - 1];
  };
  /** @param {string} s */
  const put = (s) => raw(s.startsWith(" ") && (last === " " || last === "\n") ? s.slice(1) : s);
  let pre = 0; // open <pre> elements
  /** @type {string|undefined} */
  let href; // the open link's target
  let i = 0;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const end = lt < 0 ? n : lt;
    if (end > i) {
      const chunk = decodeEntities(text.slice(i, end));
      if (pre > 0) raw(chunk);
      else put(chunk.replace(/\s+/g, " "));
    }
    budget.left -= end - i;
    if (lt < 0) break;
    if (text.startsWith("<!--", lt)) {
      const c = text.indexOf("-->", lt + 4);
      budget.left -= (c < 0 ? n : c + 3) - lt;
      if (c < 0) break; // an unterminated comment ends the page
      i = c + 3;
      continue;
    }
    const t = tagAt(text, lt, budget);
    if (budget.left < 0) return undefined;
    if (!t) {
      const next = text[lt + 1];
      if (next === "!" || next === "?") {
        const g = text.indexOf(">", lt);
        budget.left -= (g < 0 ? n : g + 1) - lt;
        if (g < 0) break;
        i = g + 1;
      } else {
        put("<");
        i = lt + 1;
      }
      continue;
    }
    const name = text.slice(lt + (t.close ? 2 : 1), t.nameEnd).toLowerCase();
    i = t.end;
    if (HTML_DROP.has(name)) {
      if (t.close || t.selfClosing) continue;
      const re = closeTagRe(name);
      re.lastIndex = i;
      const m = re.exec(text);
      budget.left -= (m ? re.lastIndex : n) - i;
      if (!m) break; // an unclosed drop element runs to the end
      i = re.lastIndex;
      continue;
    }
    const heading = HTML_HEADING_RE.exec(name);
    if (heading) raw(t.close ? "\n" : `\n${"#".repeat(Number(heading[1]))} `);
    else if (name === "li") {
      if (!t.close) raw("\n- ");
    } else if (name === "br") raw("\n");
    else if (name === "td" || name === "th") put(t.close ? " " : "| ");
    else if (name === "a") {
      if (!t.close && href === undefined) {
        const m = HTML_HREF_RE.exec(text.slice(lt, t.end));
        const target = m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
        if (target !== "" && !target.startsWith("#") && !/^\s*javascript:/i.test(target)) {
          href = target;
          put("[");
        }
      } else if (t.close && href !== undefined) {
        raw(`](${href})`);
        href = undefined;
      }
    } else if (HTML_BLOCK.has(name)) {
      if (name === "tr" && t.close) put("|");
      if (name === "pre") pre = Math.max(0, pre + (t.close ? -1 : 1));
      if (name !== "tr" || last !== "\n") raw("\n"); // table rows stay on consecutive lines
    }
  }
  const extracted = parts
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (extracted === "") return undefined;
  const hash = contentHash(text);
  const out = `${extracted}\n[HTML extracted to text: ${n - extracted.length} characters of markup removed. Retrieve original: hash=${hash}]`;
  return out.length < n ? { text: out, offloaded: [[hash, text]] } : undefined;
}

/**
 * The detector's sample: the first 500 lines, each cut to DETECT_MAX_LINE_CHARS.
 * @param {string} text
 * @returns {string[]}
 */
function detectHead(text) {
  return text.split("\n", 500).map((line) => (line.length > DETECT_MAX_LINE_CHARS ? line.slice(0, DETECT_MAX_LINE_CHARS) : line));
}

/**
 * Upstream detect_content_type's tag: the category set and branch order of content_detector.rs, each branch's
 * heuristics and thresholds from content_detector.py, plus Python's structured-config branch in its place (after log, before
 * code; the tabular branch Python checks in between stays omitted). Pure; never throws.
 * @param {string} text a tool-result text
 * @returns {ContentType}
 */
export function detectContentType(text) {
  const s = text.trim();
  if (s === "") return "text";
  if (isJsonPayload(s)) return "json_array";
  // Deviation: a sampled line is cut to DETECT_MAX_LINE_CHARS, because the PHP and C# stack-trace patterns backtrack quadratically
  // and detection runs synchronously on every appended result. A signal beyond that column of a line goes unseen.
  const head = detectHead(text);
  if (diffConfidence(head) >= 0.7) return "diff";
  // Deviation: line-numbered output (Read, `cat -n`) is a file's source, never a page to extract: the Edit tool must still match it.
  if (!LINE_NUMBERED_RE.test(text) && htmlConfidence(text.slice(0, 3000)) >= 0.7) return "html";
  if (isGitStatus(text)) return "tabular";
  if (searchConfidence(head.slice(0, 100)) >= 0.6) return "search";
  if (logConfidence(head.slice(0, 200)) >= 0.5) return "build";
  if (configFlavor(text, head)) return "structured_config";
  if (codeConfidence(head.slice(0, 100)) >= 0.5) return "source_code";
  return "text";
}

/**
 * Upstream _split_keep_trailing: the lines without a trailing newline's empty last one, and whether it was there.
 * @param {string} text
 * @returns {[string[], boolean]}
 */
function splitKeepTrailing(text) {
  if (text === "") return [[], false];
  const trailing = text.endsWith("\n");
  return [(trailing ? text.slice(0, -1) : text).split("\n"), trailing];
}

/**
 * @param {readonly string[]} lines
 * @param {boolean} trailing
 * @returns {string} the lines joined, with the trailing newline put back (upstream _join)
 */
const joinLines = (lines, trailing) => lines.join("\n") + (trailing ? "\n" : "");

/**
 * Upstream collapse_runs: 2+ identical consecutive lines become the line once plus `... (repeated N times)`.
 * @param {string} text
 * @returns {string}
 */
export function collapseRuns(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++;
    out.push(lines[i]);
    if (j > i) out.push(`... (repeated ${j - i + 1} times)`);
    i = j + 1;
  }
  return joinLines(out, trailing);
}

/**
 * Upstream expand_runs (collapseRuns' exact inverse). Deviation: gives up once the output would pass `maxLines`, so a marker
 * with a huge count in the input never allocates it.
 * @param {string} text
 * @param {number} [maxLines]
 * @returns {string|undefined} undefined past maxLines
 */
export function expandRuns(text, maxLines = Infinity) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length;) {
    const m = i + 1 < lines.length ? RUN_MARKER_RE.exec(lines[i + 1]) : null;
    const count = m ? Number(m[1]) : 1;
    if (out.length + count > maxLines) return undefined;
    for (let k = 0; k < count; k++) out.push(lines[i]);
    i += m ? 2 : 1;
  }
  return joinLines(out, trailing);
}

/**
 * Upstream fold_repeated_blocks: a run of K >= 3 lines that repeats the K lines D lines back (K <= D, original coordinates)
 * becomes `... (repeats K lines from D lines back)` when its characters exceed the marker's; at most 8 recent positions per
 * distinct line and 64 lines per block are tried, and a text under 6 or over 20,000 lines is left alone.
 * @param {string} text
 * @returns {string}
 */
export function foldRepeatedBlocks(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  const n = lines.length;
  if (n < FOLD_MIN_BLOCK * 2 || n > FOLD_MAX_LINES) return text;
  /** @type {Map<string, number[]>} */
  const positions = new Map();
  /** @type {(line: string, index: number) => void} */
  const remember = (line, index) => {
    let bucket = positions.get(line);
    if (!bucket) positions.set(line, (bucket = []));
    bucket.push(index);
    if (bucket.length > FOLD_MAX_CANDIDATES) bucket.shift();
  };
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < n;) {
    let bestLen = 0;
    let bestDist = 0;
    const candidates = positions.get(lines[i]) ?? [];
    for (let c = candidates.length - 1; c >= 0; c--) {
      const q = candidates[c];
      const maxLen = Math.min(FOLD_MAX_BLOCK, n - i, i - q);
      let len = 0;
      while (len < maxLen && lines[q + len] === lines[i + len]) len++;
      if (len > bestLen) [bestLen, bestDist] = [len, i - q];
    }
    if (bestLen >= FOLD_MIN_BLOCK) {
      const marker = `... (repeats ${bestLen} lines from ${bestDist} lines back)`;
      let chars = 0;
      for (let k = 0; k < bestLen; k++) chars += lines[i + k].length + 1;
      if (chars > marker.length + 1) {
        out.push(marker);
        for (let k = 0; k < bestLen; k++) remember(lines[i + k], i + k);
        i += bestLen;
        continue;
      }
    }
    remember(lines[i], i);
    out.push(lines[i]);
    i++;
  }
  return joinLines(out, trailing);
}

/**
 * Upstream unfold_repeated_blocks (foldRepeatedBlocks' exact inverse); a marker it could not have emitted (K > D, or reaching
 * before the start) stays as is. Deviation: gives up once the output would pass `maxLines`, so nested markers in the input
 * never double it repeatedly.
 * @param {string} text
 * @param {number} [maxLines]
 * @returns {string|undefined} undefined past maxLines
 */
export function unfoldRepeatedBlocks(text, maxLines = Infinity) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    const m = BLOCK_MARKER_RE.exec(line);
    const len = m ? Number(m[1]) : 0;
    const start = m ? out.length - Number(m[2]) : -1;
    if (m && start >= 0 && len <= out.length - start) {
      if (out.length + len > maxLines) return undefined;
      for (let k = 0; k < len; k++) out.push(out[start + k]);
    } else {
      if (out.length + 1 > maxLines) return undefined;
      out.push(line);
    }
  }
  return joinLines(out, trailing);
}

/**
 * Upstream compact_lossless(text, "config"): single-line runs, then repeated stanzas; kept only when the inverse gives the text
 * back exactly and the result is shorter.
 * @param {string} text
 * @returns {string}
 */
export function compactConfigLossless(text) {
  if (!text) return text;
  const candidate = foldRepeatedBlocks(collapseRuns(text));
  const max = splitKeepTrailing(text)[0].length;
  const unfolded = unfoldRepeatedBlocks(candidate, max);
  if (unfolded === undefined || expandRuns(unfolded, max) !== text) return text;
  return candidate.length < text.length ? candidate : text;
}

/**
 * Upstream ConfigCompressor._elision_safe: false when a `#` line could be data (a YAML block scalar; a TOML multi-line string).
 * Deviation: INI refuses `"""` / `'''` too, since its flavor is not parser-confirmed.
 * @param {string} text
 * @param {ConfigFlavor} flavor
 * @returns {boolean}
 */
function elisionSafe(text, flavor) {
  return flavor === "yaml" ? !YAML_BLOCK_SCALAR_RE.test(text) : !TOML_MULTILINE_RE.test(text);
}

/**
 * Upstream ConfigCompressor._strip_comment_lines: whole-line comments and, outside INI, blank lines go (INI drops only
 * column-0 `#`/`;` lines, as its values can continue on indented lines); a trailing newline stays.
 * @param {string} text
 * @param {ConfigFlavor} flavor
 * @returns {[string, number]} the text left, the lines elided
 */
function stripCommentLines(text, flavor) {
  const comment = flavor === "ini" ? /^[#;]/ : /^\s*#/;
  const [lines, trailing] = splitKeepTrailing(text);
  const kept = lines.filter((ln) => !comment.test(ln) && (flavor === "ini" || ln.trim() !== ""));
  return [joinLines(kept, trailing), lines.length - kept.length];
}

/**
 * Upstream ConfigCompressor.compress without Tier 3 (the TOML schema fold): Tier 2 drops whole-line comments and blank lines
 * behind `[N comment/blank lines elided. Retrieve original: hash=H]` (the original goes to `offloaded`), then Tier 1 folds
 * repeated lines and stanzas losslessly. Undefined when the text is no structured config or nothing was saved.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function compressConfig(text) {
  const flavor = configFlavor(text, detectHead(text));
  if (!flavor) return undefined;
  let working = text;
  /** @type {[string, string][]} */
  let offloaded = [];
  if (elisionSafe(text, flavor)) {
    const [stripped, elided] = stripCommentLines(text, flavor);
    if (elided > 0) {
      const hash = contentHash(text);
      working = `${stripped}${stripped.endsWith("\n") ? "" : "\n"}[${elided} comment/blank lines elided. Retrieve original: hash=${hash}]`;
      offloaded = [[hash, text]];
    }
  }
  let compressed = compactConfigLossless(working);
  // Deviation: upstream's Tier 1 markers carry no recovery hint; here a fold without Tier 2's line gets its own, so the
  // exact text a following Edit needs stays retrievable.
  if (compressed !== working && offloaded.length === 0) {
    const hash = contentHash(text);
    compressed = `${compressed}${compressed.endsWith("\n") ? "" : "\n"}[Repeated config lines folded. Retrieve original: hash=${hash}]`;
    offloaded = [[hash, text]];
  }
  return text.length - compressed.length < 1 ? undefined : { text: compressed, offloaded };
}

// Log compressor: a port of headroom's log_compressor.rs (compress_with_store with LogCompressorConfig::default()) and the
// "log" kind of lossless_compaction.py compact_lossless.

/** @typedef {'error'|'fail'|'warn'|'info'|'debug'|'trace'|'unknown'} LogLevel upstream LogLevel */
/** @typedef {'python'|'js'|'java'|'rust_error'|'rust_backtrace'|'go_panic'|'dotnet'} TraceFlavor upstream TraceFlavor */
/** @typedef {{ n: number, content: string, level: LogLevel, stack: boolean, summary: boolean, score: number }} LogLine a classified log line */
/** @typedef {{ entries: Map<number, string>, totals: Set<number>, header: number|undefined }} PytestSummary short-summary entries, totals lines, first header */

// Upstream LogCompressorConfig::default(); keep_first_error, keep_last_error, dedupe_warnings, keep_summary_lines and
// collapse_runtime_frames are true there and inlined here.
const LOG_MAX_ERRORS = 10;
const LOG_ERROR_CONTEXT = 3;
const LOG_MAX_STACK_TRACES = 3;
const LOG_STACK_TRACE_MAX_LINES = 20;
const LOG_MAX_WARNINGS = 5;
const LOG_MAX_TOTAL_LINES = 100;
const LOG_MIN_LINES = 50;
const LOG_TRACE_HEAD_FRAMES = 3;
const LOG_TRACE_APP_FRAMES = 5;
// Upstream _ANSI_RE (CSI SGR colour and style): dropped one-way by the log fold, as non-semantic.
// eslint-disable-next-line no-control-regex -- \x1b is the escape that starts an ANSI colour sequence, matched on purpose
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Upstream LevelClassifier's exact-casing words. One alternation, longest first, so at the leftmost match the longest word wins
// (aho-corasick LeftmostLongest); \b is its ASCII word-boundary post-filter (a word that fails it cannot be followed by a
// shorter word at the same start that passes, nor by one starting inside it).
/** @type {ReadonlyMap<string, LogLevel>} */
const LOG_LEVEL_WORDS = new Map(
  /** @type {[LogLevel, string][]} */ ([
    ["error", "ERROR error Error FATAL fatal Fatal CRITICAL critical"],
    ["fail", "FAIL FAILED fail failed Fail Failed"],
    ["warn", "WARN WARNING warn warning Warn Warning"],
    ["info", "INFO info Info"],
    ["debug", "DEBUG debug Debug"],
    ["trace", "TRACE trace Trace"],
  ]).flatMap(([level, words]) => words.split(" ").map((w) => /** @type {[string, LogLevel]} */ ([w, level]))),
);
const LOG_LEVEL_RE = new RegExp(`\\b(?:${[...LOG_LEVEL_WORDS.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`);
const LOG_LINE_COL_RE = /:\d+:\d/;
const LOG_RUST_FRAME_RE = /^\d+: *0x[0-9a-fA-F]/;
const LOG_GOROUTINE_RE = /^goroutine \d+ \[/;
const LOG_JAVA_MORE_RE = /^\.\.\. \d+\s*more\s*$/;
const LOG_UPPER_START_RE = /^\p{Uppercase}/u;
const LOG_JAVA_SYMBOL_RE = /^[A-Za-z0-9._$/]+$/;
const LOG_GO_SYMBOL_RE = /^[A-Za-z0-9._/*]+$/;
const LOG_DOTNET_HEAD_RE = /^[A-Za-z0-9._`+]+$/;
const LOG_LABEL_RE = /^[A-Za-z0-9_.]+$/;
const LOG_CODE_RE = /^[A-Za-z0-9]+$/;
// Upstream RUNTIME_FRAME_PREFIXES (start of the trimmed line) and RUNTIME_FRAME_MARKERS (anywhere).
const LOG_RUNTIME_PREFIXES = ["at java.", "at jdk.", "at sun.", "at javax.", "at scala.", "at System.", "at Microsoft.", "runtime.", "created by runtime."];
const LOG_RUNTIME_MARKERS = [
  "site-packages/",
  "/usr/lib/python",
  "lib/python3.",
  "node:internal/",
  "node_modules/",
  "(internal/",
  "core::",
  "std::",
  "alloc::",
  "rust_begin_unwind",
  "__rust_",
  "/rustc/",
  "/usr/local/go/src/",
  "/libexec/src/runtime/",
];

/**
 * Upstream LevelClassifier.classify: the level of the first word-boundary-valid level word by position.
 * @param {string} line
 * @returns {LogLevel}
 */
function logLevel(line) {
  const m = LOG_LEVEL_RE.exec(line);
  return m ? (LOG_LEVEL_WORDS.get(m[0]) ?? "unknown") : "unknown";
}

/** @param {string} s @returns {boolean} upstream is_python_file_frame: `File "<name>", line <N>` */
const isPythonFileFrame = (s) => s.startsWith('File "') && s.includes('", line ') && /\d$/.test(s);
/** @param {string} s @returns {boolean} upstream is_js_at_frame */
const isJsAtFrame = (s) => s.startsWith("at ") && s.includes("(") && s.includes(")") && LOG_LINE_COL_RE.test(s);
/** @param {string} s @returns {boolean} upstream is_java_at_frame: `at <dotted symbol>(` */
const isJavaAtFrame = (s) => s.startsWith("at ") && s.includes("(") && LOG_JAVA_SYMBOL_RE.test(s.slice(3, s.indexOf("(")));
/** @param {string} s @returns {boolean} upstream is_dotnet_frame: `at <symbol>(<args>) in <file>:line <N>` */
const isDotnetFrame = (s) => s.startsWith("at ") && s.includes(") in ") && s.includes(":line ");
/** @param {string} s @returns {boolean} upstream is_rust_backtrace_frame: `<digits>: 0x<hex>` */
const isRustBacktraceFrame = (s) => LOG_RUST_FRAME_RE.test(s.trimStart());
/** @param {string} line @returns {boolean} upstream is_go_file_frame: a tab-indented `.go:` line with ` +0x` */
const isGoFileFrame = (line) => line.startsWith("\t") && line.includes(".go:") && line.includes(" +0x");

/**
 * Upstream is_go_call_frame: `created by …`, or a column-0 `pkg.func(...)` call line.
 * @param {string} line
 * @returns {boolean}
 */
function isGoCallFrame(line) {
  if (line.startsWith("created by ")) return true;
  if (line.startsWith(" ") || line.startsWith("\t") || !line.endsWith(")")) return false;
  const open = line.indexOf("(");
  if (open < 0) return false;
  const symbol = line.slice(0, open);
  return symbol.includes(".") && LOG_GO_SYMBOL_RE.test(symbol);
}

/**
 * Upstream is_dotnet_exception_head: `System.InvalidOperationException: message`.
 * @param {string} trimmed
 * @returns {boolean}
 */
function isDotnetExceptionHead(trimmed) {
  const colon = trimmed.indexOf(":");
  if (colon < 0) return false;
  const head = trimmed.slice(0, colon);
  return head.endsWith("Exception") && head.includes(".") && LOG_DOTNET_HEAD_RE.test(head);
}

/**
 * Upstream StackTraceDetector::flavor_for: the trace a line opens, if any.
 * @param {string} line
 * @returns {TraceFlavor|undefined}
 */
function traceFlavor(line) {
  const t = line.trimStart();
  if (t.startsWith("Traceback (most recent call last)") || isPythonFileFrame(t)) return "python";
  // Before Js/Java: a .NET frame also has the Java `at <dotted>(` shape.
  if (t.startsWith("Unhandled exception.") || isDotnetFrame(t)) return "dotnet";
  if (isJsAtFrame(t)) return "js";
  if (isJavaAtFrame(t)) return "java";
  if (t.startsWith("--> ") && LOG_LINE_COL_RE.test(t)) return "rust_error";
  if ((t.startsWith("thread '") && t.includes("panicked at")) || t.startsWith("stack backtrace:") || isRustBacktraceFrame(line)) return "rust_backtrace";
  if (line.startsWith("panic: ") || line.startsWith("fatal error: ") || LOG_GOROUTINE_RE.test(line)) return "go_panic";
  return undefined;
}

/**
 * Upstream StackTraceDetector::terminates: whether `line` ends the active trace of `flavor`, which has claimed `sofar` lines.
 * @param {TraceFlavor} flavor
 * @param {string} line
 * @param {number} sofar
 * @returns {boolean}
 */
function traceEnds(flavor, line, sofar) {
  const t = line.trimStart();
  switch (flavor) {
    case "python": {
      // Blank and indented lines continue it (chained exceptions), as do its markers; the `Type: message` line closes it.
      const indentedOrBlank = line.startsWith(" ") || line.startsWith("\t") || line === "";
      const continues = t.startsWith("Traceback") || t.startsWith("File ") || t.startsWith("During handling") || t.startsWith("The above exception");
      return indentedOrBlank || continues ? false : !LOG_UPPER_START_RE.test(t);
    }
    case "js":
      return !t.startsWith("at ") && line !== "";
    case "java": {
      const chain = t.startsWith("Caused by:") || t.startsWith("Suppressed:") || LOG_JAVA_MORE_RE.test(t);
      return !t.startsWith("at ") && !chain && line !== "";
    }
    case "dotnet":
      if (line === "") return false;
      return !(t.startsWith("at ") || t.startsWith("--->") || t.startsWith("--- End of") || isDotnetExceptionHead(t));
    case "rust_error":
      return !t.startsWith("--> ") && line !== "";
    case "rust_backtrace": {
      // The panic message is the free-text line right after the `panicked at <loc>:` opener.
      if (line === "" || sofar === 1) return false;
      const frame = /^[0-9]/.test(t);
      const continues = line.startsWith(" ") || line.startsWith("\t") || t.startsWith("stack backtrace:") || t.startsWith("note: run with");
      return !frame && !continues;
    }
    case "go_panic": {
      if (line === "") return false;
      const continues = line.startsWith("\t") || LOG_GOROUTINE_RE.test(line) || isGoCallFrame(line) || line.startsWith("panic: ") || line.startsWith("fatal error: ") || line.startsWith("[signal ");
      return !continues;
    }
  }
  return true;
}

/** @param {string} line @returns {boolean} upstream is_frame_line: a stack frame, not a message or chain head */
const isFrameLine = (line) => {
  const t = line.trimStart();
  return t.startsWith("at ") || (t.startsWith('File "') && t.includes('", line ')) || isRustBacktraceFrame(line) || isGoFileFrame(line) || isGoCallFrame(line);
};

/** @param {string} line @returns {boolean} upstream is_chain_head_line: chain heads and markers a collapse always keeps */
const isChainHead = (line) => {
  const t = line.trimStart();
  return ["Caused by:", "Suppressed:", "... ", "--->", "--- End of", "During handling", "The above exception"].some((p) => t.startsWith(p));
};

/** @param {string} line @returns {boolean} upstream is_runtime_frame: a runtime or stdlib frame */
const isRuntimeFrame = (line) => {
  const t = line.trimStart();
  return LOG_RUNTIME_PREFIXES.some((p) => t.startsWith(p)) || LOG_RUNTIME_MARKERS.some((m) => line.includes(m));
};

/**
 * Upstream collapse_trace_frames: keep every message and chain-head line, the first `head` frames and up to `app` app-code frames;
 * each contiguous dropped run becomes one `      [... N frames collapsed]` line in its first line's slot (score 0.8, a stack line).
 * An indented continuation of a dropped frame drops with it.
 * @param {readonly LogLine[]} stack
 * @param {number} head
 * @param {number} app
 * @returns {{ kept: LogLine[], dropped: number[] }}
 */
function collapseTraceFrames(stack, head, app) {
  /** @type {LogLine[]} */
  const kept = [];
  /** @type {number[]} */
  const dropped = [];
  let frames = 0;
  let appKept = 0;
  /** @type {number|undefined} */
  let runStart;
  let runLen = 0;
  let prevDropped = false;
  const flush = () => {
    if (runStart === undefined) return;
    kept.push({ n: runStart, content: `      [... ${runLen} frames collapsed]`, level: "unknown", stack: true, summary: false, score: 0.8 });
    runStart = undefined;
    runLen = 0;
  };
  for (const line of stack) {
    if (isFrameLine(line.content) && !isChainHead(line.content)) {
      frames++;
      const runtime = isRuntimeFrame(line.content);
      if (frames <= head || (!runtime && appKept < app)) {
        if (!runtime) appKept++;
        flush();
        kept.push(line);
        prevDropped = false;
      } else {
        runStart ??= line.n;
        runLen++;
        dropped.push(line.n);
        prevDropped = true;
      }
    } else if (prevDropped && (line.content.startsWith(" ") || line.content.startsWith("\t")) && !isChainHead(line.content)) {
      runLen++;
      dropped.push(line.n);
    } else {
      flush();
      kept.push(line);
      prevDropped = false;
    }
  }
  flush();
  return { kept, dropped };
}

/**
 * Upstream is_summary_line: separators, `N passed`-style counts, `Tests: N`, TOTAL/Summary, and build/test outcome lines.
 * @param {string} line
 * @returns {boolean}
 */
function isSummaryLine(line) {
  if (line.startsWith("===") || line.startsWith("---")) return true;
  const digits = /^\d*/.exec(line)?.[0].length ?? 0;
  if (digits > 0 && line[digits] === " ") {
    const rest = line.slice(digits + 1);
    if (["passed", "failed", "skipped", "error", "warning"].some((k) => rest.startsWith(k))) return true;
  }
  for (const prefix of ["Test ", "Tests ", "Tests:", "Test:", "Suite ", "Suites ", "Suites:", "Suite:"]) {
    if (line.startsWith(prefix)) return /^\s*[0-9]/.test(line.slice(prefix.length));
  }
  if (["TOTAL", "Total", "Summary"].some((p) => line.startsWith(p))) return true;
  return ["Build", "Compile", "Test"].some((p) => line.startsWith(p)) && ["succeeded", "failed", "complete"].some((o) => line.includes(o));
}

/**
 * Upstream scan_pytest_short_summary: a section opens on a whole `=== … short test summary info … ===` line (a trailing \r
 * ignored) and closes at the next `===` line, its totals line; inside, `FAILED <id>` / `ERROR <id>` lines are entries, the id
 * cut at ` - `.
 * @param {readonly string[]} lines
 * @returns {PytestSummary}
 */
function scanPytestSummary(lines) {
  /** @type {PytestSummary} */
  const scan = { entries: new Map(), totals: new Set(), header: undefined };
  let inside = false;
  lines.forEach((line, i) => {
    const seen = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (seen.startsWith("===")) {
      const opens = seen.endsWith("===") && seen.includes("short test summary info");
      if (opens) scan.header ??= i;
      else if (inside) scan.totals.add(i);
      inside = opens;
      return;
    }
    if (!inside) return;
    const rest = line.startsWith("FAILED ") ? line.slice(7) : line.startsWith("ERROR ") ? line.slice(6) : undefined;
    if (rest === undefined) return;
    const cut = rest.indexOf(" - ");
    const id = (cut < 0 ? rest : rest.slice(0, cut)).trim();
    if (id) scan.entries.set(i, id);
  });
  return scan;
}

/**
 * Upstream score_log_line: the level's base, +0.3 in a stack trace, +0.4 on a summary line, at most 1.
 * @param {LogLevel} level
 * @param {boolean} stack
 * @param {boolean} summary
 * @returns {number}
 */
function logScore(level, stack, summary) {
  const base = level === "error" || level === "fail" ? 1 : level === "warn" ? 0.5 : level === "debug" ? 0.05 : level === "trace" ? 0.02 : 0.1;
  return Math.min(base + (stack ? 0.3 : 0) + (summary ? 0.4 : 0), 1);
}

/**
 * Upstream LogCompressor::parse_lines: each line's level, summary membership, score and stack-trace membership, through the
 * per-flavor trace state machine (a trace ends on its flavor's terminator or after 20 lines, where a continuing line opens the
 * next run).
 * @param {readonly string[]} lines
 * @param {ReadonlyMap<number, string>} entries the pytest short-summary entries
 * @returns {LogLine[]}
 */
function parseLogLines(lines, entries) {
  /** @type {TraceFlavor|undefined} */
  let active;
  let traced = 0;
  return lines.map((content, n) => {
    const level = logLevel(content);
    const summary = isSummaryLine(content) || entries.has(n);
    let stack = false;
    if (active) {
      if (traced >= LOG_STACK_TRACE_MAX_LINES || traceEnds(active, content, traced)) {
        const capHit = traced >= LOG_STACK_TRACE_MAX_LINES;
        const was = active;
        active = undefined;
        traced = 0;
        // A chained trace opens on the line that ended the last one.
        const next = traceFlavor(content);
        if (next) {
          active = next;
          traced = 1;
          stack = true;
        } else if (capHit && !traceEnds(was, content, 2)) {
          active = was;
          traced = 1;
          stack = true;
        }
      } else {
        stack = true;
        traced++;
      }
    } else {
      const next = traceFlavor(content);
      if (next) {
        active = next;
        traced = 1;
        stack = true;
      }
    }
    return { n, content, level, stack, summary, score: logScore(level, stack, summary) };
  });
}

/**
 * Upstream select_with_first_last: all when within `max`, else the first, the last, then the best by (score desc, line asc).
 * @param {readonly LogLine[]} lines
 * @param {number} max
 * @returns {LogLine[]}
 */
function firstLastBest(lines, max) {
  if (lines.length <= max) return [...lines];
  const out = [lines[0], lines[lines.length - 1]];
  const seen = new Set(out.map((l) => l.n));
  for (const l of [...lines].sort((a, b) => b.score - a.score || a.n - b.n)) {
    if (out.length >= max) break;
    if (seen.has(l.n)) continue;
    seen.add(l.n);
    out.push(l);
  }
  return out;
}

/**
 * Upstream normalize_for_dedupe: the text up to the first `:` or `=` verbatim, then digits → N, `0x…` → ADDR and `/…/` →
 * /PATH/, in that order (so a `0x` address has already lost its 0, as upstream).
 * @param {string} content
 * @returns {string}
 */
function dedupeKey(content) {
  const at = content.search(/[:=]/);
  const cut = at < 0 ? content.length : at;
  return (
    content.slice(0, cut) +
    content
      .slice(cut)
      .replace(/\d+/g, "N")
      .replace(/0x[0-9a-fA-F]+/g, "ADDR")
      .replace(/\/[\w/]+\//g, "/PATH/")
  );
}

/**
 * Upstream pytest_cap_reserve: the lines a binding cap keeps while a short summary competes for it, each section's totals line
 * and the first `E ` line before the first section.
 * @param {readonly LogLine[]} logLines
 * @param {PytestSummary} scan
 * @returns {Set<number>}
 */
function pytestReserve(logLines, scan) {
  const reserved = new Set(scan.totals);
  const detail = logLines.find((l) => (scan.header === undefined || l.n < scan.header) && l.content.startsWith("E "));
  if (detail) reserved.add(detail.n);
  return reserved;
}

/**
 * Upstream LogCompressor::select_lines: errors and fails (first, last, best 10 each), 5 deduplicated warnings, the first 3 stack
 * traces (20 lines each; a longer one with runtime frames collapsed), every summary line, ±3 context lines (never a collapsed
 * frame), then the adaptive cap by (reserved, score, short-summary entry, line). A line number is taken once, first come.
 * @param {readonly LogLine[]} logLines
 * @param {PytestSummary} scan
 * @param {WorkBudget} budget computeOptimalK's simhash budget
 * @returns {LogLine[]} in line order
 */
function selectLogLines(logLines, scan, budget) {
  const cap = computeOptimalK(
    logLines.map((l) => l.content),
    10,
    LOG_MAX_TOTAL_LINES,
    budget,
  );
  /** @type {LogLine[][]} */
  const traces = [];
  /** @type {LogLine[]} */
  let current = [];
  for (const line of logLines) {
    if (line.stack) current.push(line);
    else if (current.length) {
      traces.push(current);
      current = [];
    }
  }
  if (current.length) traces.push(current);
  /** @type {Map<number, LogLine>} */
  const selected = new Map();
  const take = (/** @type {readonly LogLine[]} */ lines) => {
    for (const l of lines) if (!selected.has(l.n)) selected.set(l.n, l);
  };
  take(
    firstLastBest(
      logLines.filter((l) => l.level === "error"),
      LOG_MAX_ERRORS,
    ),
  );
  take(
    firstLastBest(
      logLines.filter((l) => l.level === "fail"),
      LOG_MAX_ERRORS,
    ),
  );
  /** @type {Set<string>} */
  const seenWarnings = new Set();
  const warnings = logLines.filter((l) => {
    if (l.level !== "warn") return false;
    const key = dedupeKey(l.content);
    if (seenWarnings.has(key)) return false;
    seenWarnings.add(key);
    return true;
  });
  take(warnings.slice(0, LOG_MAX_WARNINGS));
  /** @type {Set<number>} */
  const collapsed = new Set();
  for (const trace of traces.slice(0, LOG_MAX_STACK_TRACES)) {
    if (trace.length > LOG_STACK_TRACE_MAX_LINES) {
      const c = collapseTraceFrames(trace, LOG_TRACE_HEAD_FRAMES, LOG_TRACE_APP_FRAMES);
      for (const n of c.dropped) collapsed.add(n);
      take(c.kept.slice(0, LOG_STACK_TRACE_MAX_LINES));
    } else take(trace.slice(0, LOG_STACK_TRACE_MAX_LINES));
  }
  take(logLines.filter((l) => l.summary));
  const picked = new Set(selected.keys());
  /** @type {Set<number>} */
  const context = new Set();
  for (const idx of picked) {
    for (let i = Math.max(0, idx - LOG_ERROR_CONTEXT); i < Math.min(idx + LOG_ERROR_CONTEXT + 1, logLines.length); i++) if (i !== idx) context.add(i);
  }
  for (const i of [...context].sort((a, b) => a - b)) if (!picked.has(i) && !collapsed.has(i)) take([logLines[i]]);
  let ordered = [...selected.values()].sort((a, b) => a.n - b.n);
  if (ordered.length > cap) {
    const reserved = scan.entries.size > 0 ? pytestReserve(logLines, scan) : new Set();
    const have = new Set(ordered.map((l) => l.n));
    for (const l of logLines) if (reserved.has(l.n) && !have.has(l.n)) ordered.push(l);
    const res = (/** @type {LogLine} */ l) => (reserved.has(l.n) ? 1 : 0);
    const entry = (/** @type {LogLine} */ l) => (scan.entries.has(l.n) ? 1 : 0);
    ordered = ordered
      .sort((a, b) => res(b) - res(a) || b.score - a.score || entry(b) - entry(a) || a.n - b.n)
      .slice(0, cap)
      .sort((a, b) => a.n - b.n);
  }
  return ordered;
}

/**
 * Upstream extract_error_label: a cargo `error[E0425]` code, or an exception type ending in Error, Exception or Warning
 * before a colon (after pytest's `E ` marker), never a bare `ERROR:`.
 * @param {string} line
 * @returns {string|undefined}
 */
function errorLabel(line) {
  const t = line.trim();
  if (t.startsWith("error[")) {
    const end = t.indexOf("]", 6);
    if (end >= 0 && LOG_CODE_RE.test(t.slice(6, end))) return t.slice(6, end);
  }
  const after = t.startsWith("E ") ? t.slice(2).trimStart() : t;
  const colon = after.indexOf(":");
  if (colon < 0) return undefined;
  const head = after.slice(0, colon);
  return LOG_LABEL_RE.test(head) && /^[A-Z]/.test(head) && (head.endsWith("Error") || head.endsWith("Exception") || head.endsWith("Warning")) ? head : undefined;
}

/**
 * Upstream extract_source_file: a Python `File "…"` name, or a `--> file:line:col` file holding a dot.
 * @param {string} line
 * @returns {string|undefined}
 */
function sourceFile(line) {
  const t = line.trim();
  if (t.startsWith('File "')) {
    const end = t.indexOf('"', 6);
    if (end >= 0) return t.slice(6, end);
  }
  const arrow = t.indexOf("--> ");
  if (arrow < 0) return undefined;
  const part = t.slice(arrow + 4).split(":", 1)[0];
  return part && part.includes(".") ? part : undefined;
}

/**
 * Upstream summarize_omitted: the dropped lines' distinct files and exception types (at most 5 named) that no kept line shows,
 * as `: K file(s), M exception type(s) (A, B, …)`, or "" when there are none.
 * @param {readonly LogLine[]} all
 * @param {readonly LogLine[]} selected
 * @returns {string}
 */
function omittedDescriptor(all, selected) {
  const kept = new Set(selected.map((l) => l.n));
  /** @type {Set<string>} */
  const keptLabels = new Set();
  /** @type {Set<string>} */
  const keptFiles = new Set();
  for (const l of selected) {
    const label = errorLabel(l.content);
    if (label !== undefined) keptLabels.add(label);
    const file = sourceFile(l.content);
    if (file !== undefined) keptFiles.add(file);
  }
  /** @type {Set<string>} */
  const labels = new Set();
  /** @type {Set<string>} */
  const files = new Set();
  for (const l of all) {
    if (kept.has(l.n)) continue;
    const label = errorLabel(l.content);
    if (label !== undefined && !keptLabels.has(label)) labels.add(label);
    const file = sourceFile(l.content);
    if (file !== undefined && !keptFiles.has(file)) files.add(file);
  }
  /** @type {string[]} */
  const parts = [];
  if (files.size) parts.push(`${files.size} file${files.size === 1 ? "" : "s"}`);
  if (labels.size) {
    const names = [...labels].sort();
    parts.push(`${labels.size} exception type${labels.size === 1 ? "" : "s"} (${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""})`);
  }
  return parts.length ? `: ${parts.join(", ")}` : "";
}

/**
 * Upstream LogCompressor::format_output: the kept lines, then `[N lines omitted: E ERROR, F FAIL, W WARN, I INFO; omitted: …]`
 * (counts over every line, levels with none left out, up to 5 omitted pytest short-summary ids named) when lines were omitted.
 * @param {readonly LogLine[]} selected
 * @param {readonly LogLine[]} all
 * @param {ReadonlyMap<number, string>} entries
 * @returns {string}
 */
function formatLogOutput(selected, all, entries) {
  const out = selected.map((l) => l.content);
  const omitted = all.length - selected.length;
  if (omitted > 0) {
    const count = (/** @type {LogLevel} */ level) => all.filter((l) => l.level === level).length;
    const parts = /** @type {[string, LogLevel][]} */ ([
      ["ERROR", "error"],
      ["FAIL", "fail"],
      ["WARN", "warn"],
      ["INFO", "info"],
    ]).flatMap(([label, level]) => {
      const n = count(level);
      return n > 0 ? [`${n} ${label}`] : [];
    });
    if (parts.length) {
      const kept = new Set(selected.map((l) => l.n));
      const ids = [...entries].sort((a, b) => a[0] - b[0]).flatMap(([n, id]) => (kept.has(n) ? [] : [id]));
      const names = ids.length === 0 ? "" : `; omitted: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? `, +${ids.length - 5} more` : ""}`;
      out.push(`[${omitted} lines omitted: ${parts.join(", ")}${names}]`);
    }
  }
  return out.join("\n");
}

/**
 * The log fold (upstream compact_lossless "log"): ANSI colour dropped one-way, then runs of identical lines collapsed to
 * `... (repeated N times)`, kept only when it expands back to the de-coloured text and is shorter than the input.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function foldLog(text) {
  const baseline = text.replace(ANSI_RE, "");
  const cand = collapseRuns(baseline);
  if (expandRuns(cand, splitKeepTrailing(baseline)[0].length) !== baseline || cand.length >= text.length) return undefined;
  return { text: cand, offloaded: [] };
}

/**
 * Upstream LogCompressor::compress_with_store with its default config: a log of 50+ lines keeps its errors, failures,
 * deduplicated warnings, stack traces, summary lines and their context, up to an adaptive 10 to 100 lines, plus the omitted-lines
 * summary, then `[N lines compressed to M<descriptor>. Retrieve original: hash=H]` with the input stored under H. Deviations:
 * the retrieval line is always added ("Retrieve original", no 0.5 ratio gate), the hash is contentHash, the simhash diversity
 * count is budgeted (an exhausted budget keeps 100), and the format detector (cosmetic) is not ported. Undefined under 50
 * lines or when the result is not shorter.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function compressLog(text) {
  const lines = text.split("\n");
  if (lines.length < LOG_MIN_LINES) return undefined;
  const scan = scanPytestSummary(lines);
  const all = parseLogLines(lines, scan.entries);
  const selected = selectLogLines(all, scan, { left: SCAN_BUDGET_PER_CHAR * text.length + SCAN_BUDGET_FLOOR });
  const hash = contentHash(text);
  const out = `${formatLogOutput(selected, all, scan.entries)}\n[${lines.length} lines compressed to ${selected.length}${omittedDescriptor(all, selected)}. Retrieve original: hash=${hash}]`;
  return out.length < text.length ? { text: out, offloaded: [[hash, text]] } : undefined;
}

// Search compressor: a port of headroom's search_compressor.rs (compress_with_store with SearchCompressorConfig::default()) and
// the "search" kind of lossless_compaction.py compact_lossless (search_heading, search_dir_heading and their inverses).

/** @typedef {{ file: string, line: number, content: string, score: number }} SearchMatch one grep hit and its relevance score */

// Upstream SearchCompressorConfig::default(): always_keep_first and always_keep_last are true there and inlined here.
const SEARCH_MAX_PER_FILE = 5;
const SEARCH_MAX_TOTAL = 30;
const SEARCH_MAX_FILES = 15;
const SEARCH_MIN_K = 5;
// Upstream lossless_compaction.py _GREP_ROW_RE, _HEADING_ROW_RE and _DIR_DATA_RE; [^\n]* stands in for Python's `.`, which,
// unlike JS's, also matches a \r.
const GREP_ROW_RE = /^([^\n:]+):(\d+):([^\n]*)$/;
const HEADING_ROW_RE = /^(\d+):([^\n]*)$/;
const DIR_DATA_RE = /^([^/\n:]+):(\d+):([^\n]*)$/;
// Upstream KeywordDetector in ImportanceContext::Search: the leftmost whole-word error or importance keyword decides (longest
// first at one start, case-insensitive); warning words count only when neither matched.
const SEARCH_ERROR_WORDS = new Set(["error", "exception", "fail", "failed", "failure", "fatal", "critical", "crash", "panic", "abort", "timeout", "denied", "rejected"]);
const SEARCH_UNIVERSAL_RE = new RegExp(`\\b(?:${[...SEARCH_ERROR_WORDS, "important", "note", "todo", "fixme", "hack", "xxx", "bug", "fix"].sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const SEARCH_WARN_RE = /\b(?:warning|warn)\b/i;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
// Context-word substring matching (search and diff scoring) does at most about this many character comparisons.
const CONTEXT_MATCH_BUDGET = 16_777_216;

/**
 * The query's context words for search and diff scoring (upstream score_matches, score_hunks): lowercased, whitespace-split,
 * longer than 2 code points, deduped in first-seen (newest-first) order, and at most CONTEXT_MATCH_BUDGET / chars of them, so
 * matching them against `chars` characters stays bounded. Deviation: upstream matches every word (the diff compressor even
 * counts a repeated word twice).
 * @param {string} query
 * @param {number} chars the characters the words will be matched against
 * @returns {string[]}
 */
function contextWords(query, chars) {
  const words = [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => Array.from(w).length > 2),
    ),
  ];
  return words.slice(0, Math.max(1, Math.floor(CONTEXT_MATCH_BUDGET / Math.max(chars, 1))));
}

/**
 * Upstream has_extension_dot: a dot followed by a run of 1 to 8 ASCII alphanumerics holding a letter (`.md`, `.7z`, not `.3`).
 * @param {string} tok
 * @returns {boolean}
 */
function hasExtensionDot(tok) {
  for (let i = tok.indexOf("."); i >= 0 && i + 1 < tok.length; i = tok.indexOf(".", i + 1)) {
    let end = i + 1;
    let letter = false;
    for (; end < tok.length; end++) {
      const c = tok.charCodeAt(end);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letter = true;
      else if (c < 48 || c > 57) break;
    }
    if (letter && end - i - 1 <= 8) return true;
  }
  return false;
}

/**
 * Upstream last_segment_has_extension over line[0, end): the path's last `/` or `\` segment carries an extension. The scan is
 * charged to `budget`.
 * @param {string} line
 * @param {number} end
 * @param {WorkBudget} budget
 * @returns {boolean}
 */
function lastSegmentHasExtension(line, end, budget) {
  let s = end;
  while (s > 0 && line[s - 1] !== "/" && line[s - 1] !== "\\") s--;
  budget.left -= end - s + 1;
  return hasExtensionDot(line.slice(s, end));
}

/**
 * Upstream path_continues over line[from…]: the first whitespace-free token after the marker still holds path structure
 * (a `/`, a `\` or an extension dot). The scan is charged to `budget`.
 * @param {string} line
 * @param {number} from
 * @param {WorkBudget} budget
 * @returns {boolean}
 */
function pathContinues(line, from, budget) {
  let a = from;
  while (a < line.length && /\s/.test(line[a])) a++;
  let b = a;
  while (b < line.length && !/\s/.test(line[b])) b++;
  budget.left -= b - from + 1;
  const tok = line.slice(a, b);
  return tok.includes("/") || tok.includes("\\") || hasExtensionDot(tok);
}

/**
 * Upstream scan_marker: one tier's `<sep><digits><sep>` marker in a trimmed grep line as [path end, digits start, digits end],
 * and whether the dash tier positively confirmed it as the path/body boundary (else it is the leftmost). The colon and dash
 * tiers only look inside the leading whitespace-free run; a separator right after another one never opens a marker.
 * @param {string} line
 * @param {"colon"|"dash"|"any"} tier
 * @param {WorkBudget} budget charged for the dash tier's path checks
 * @returns {[[number, number, number], boolean]|undefined}
 */
function scanMarker(line, tier, budget) {
  const n = line.length;
  let ws = 0;
  while (ws < n && !isAsciiSpace(line.charCodeAt(ws))) ws++;
  /** @type {[number, number, number]|undefined} */
  let first;
  /** @type {[number, number, number]|undefined} */
  let chosen;
  // A Windows drive prefix (C:\ or C:/): its colon is no marker.
  let i = WINDOWS_DRIVE_RE.test(line) ? 2 : 0;
  while (i < n) {
    const c = line[i];
    if (tier === "colon" ? c === ":" : tier === "dash" ? c === "-" : c === ":" || c === "-") {
      if (i > 0 && (line[i - 1] === ":" || line[i - 1] === "-")) {
        i++;
        continue;
      }
      if (tier !== "any" && ws < i) break;
      let j = i + 1;
      while (j < n && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
      if (j > i + 1 && j < n && (tier === "any" ? line[j] === ":" || line[j] === "-" : line[j] === c)) {
        if (i === 0) return undefined; // a line that starts with its marker has no path
        /** @type {[number, number, number]} */
        const m = [i, i + 1, j];
        first ??= m;
        // The dash tier walks past a marker only on positive evidence that the path runs through it.
        if (tier !== "dash" || lastSegmentHasExtension(line, i, budget) || !pathContinues(line, j + 1, budget)) {
          chosen = m;
          break;
        }
        if (budget.left < 0) return undefined; // the caller declines the whole text
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  const m = chosen ?? first;
  return m ? [m, chosen !== undefined] : undefined;
}

/**
 * Upstream parse_match_line: the colon tier wins, unless the dash tier confirmed a boundary before its marker (a `-` context
 * line whose body holds `name:N:`); else the dash tier; else the permissive leftmost marker. Deviation: a line number beyond
 * Number.MAX_SAFE_INTEGER leaves the line unparsed (upstream: u64).
 * @param {string} line a trimmed line
 * @param {WorkBudget} budget
 * @returns {[string, number, string]|undefined} file, line number, content
 */
function parseMatchLine(line, budget) {
  const colon = scanMarker(line, "colon", budget);
  const dash = scanMarker(line, "dash", budget);
  const pick = colon && dash && dash[1] && colon[0][0] > dash[0][2] ? dash : (colon ?? dash ?? scanMarker(line, "any", budget));
  if (!pick) return undefined;
  const [[pathEnd, from, to]] = pick;
  const no = Number(line.slice(from, to));
  return Number.isSafeInteger(no) ? [line.slice(0, pathEnd), no, line.slice(to + 1)] : undefined;
}

/**
 * Upstream KeywordDetector.score in ImportanceContext::Search as score_matches boosts it: an error word 0.5, an importance word
 * 0.3, else a warning word 0.4.
 * @param {string} content
 * @returns {number}
 */
function searchBoost(content) {
  const m = SEARCH_UNIVERSAL_RE.exec(content);
  if (m) return SEARCH_ERROR_WORDS.has(m[0].toLowerCase()) ? 0.5 : 0.3;
  return SEARCH_WARN_RE.test(content) ? 0.4 : 0;
}

/**
 * Upstream search_heading: consecutive `path:line:content` rows of one path become the path once, then `line:content` rows.
 * A timestamped log row is no grep row.
 * @param {string} text
 * @returns {string}
 */
function searchHeading(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  /** @type {string|undefined} */
  let current;
  for (const line of lines) {
    const m = TIMESTAMP_ROW_RE.test(line) ? null : GREP_ROW_RE.exec(line);
    if (m) {
      if (m[1] !== current) {
        out.push(m[1]);
        current = m[1];
      }
      out.push(`${m[2]}:${m[3]}`);
    } else {
      out.push(line);
      current = undefined;
    }
  }
  return joinLines(out, trailing);
}

/**
 * Upstream search_unheading (searchHeading's exact inverse): a line that is no `line:content` row and is followed by one is a
 * header, prefixed onto the rows under it.
 * @param {string} text
 * @returns {string}
 */
function searchUnheading(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  /** @type {string|undefined} */
  let current;
  for (let i = 0; i < lines.length; i++) {
    const data = HEADING_ROW_RE.exec(lines[i]);
    if (current !== undefined && data) out.push(`${current}:${data[1]}:${data[2]}`);
    else if (!data && i + 1 < lines.length && HEADING_ROW_RE.test(lines[i + 1])) current = lines[i];
    else {
      current = undefined;
      out.push(lines[i]);
    }
  }
  return joinLines(out, trailing);
}

/**
 * Upstream search_dir_heading: consecutive grep rows whose paths share a directory become the directory once (ending in `/`),
 * then `base:line:content` rows. Rows whose path has no `/` pass through.
 * @param {string} text
 * @returns {string}
 */
function searchDirHeading(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  /** @type {string|undefined} */
  let current;
  for (const line of lines) {
    const m = TIMESTAMP_ROW_RE.test(line) ? null : GREP_ROW_RE.exec(line);
    if (m && m[1].includes("/")) {
      const cut = m[1].lastIndexOf("/") + 1;
      const dir = m[1].slice(0, cut);
      if (dir !== current) {
        out.push(dir);
        current = dir;
      }
      out.push(`${m[1].slice(cut)}:${m[2]}:${m[3]}`);
    } else {
      out.push(line);
      current = undefined;
    }
  }
  return joinLines(out, trailing);
}

/**
 * Upstream search_dir_unheading (searchDirHeading's exact inverse): a line ending in `/` followed by a `base:line:content` row is
 * a header, prefixed onto the rows under it.
 * @param {string} text
 * @returns {string}
 */
function searchDirUnheading(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  if (!lines.length) return text;
  /** @type {string[]} */
  const out = [];
  /** @type {string|undefined} */
  let current;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (current !== undefined && DIR_DATA_RE.test(line)) out.push(`${current}${line}`);
    else if (line.endsWith("/") && i + 1 < lines.length && DIR_DATA_RE.test(lines[i + 1])) current = line;
    else {
      current = undefined;
      out.push(line);
    }
  }
  return joinLines(out, trailing);
}

/**
 * The search fold (upstream compact_lossless "search"): the file-heading and directory-heading folds, each kept only when its
 * inverse gives the text back exactly; the smaller one wins when it is shorter than the text.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function foldSearch(text) {
  let best = text;
  for (const [cand, inverse] of /** @type {[string, (t: string) => string][]} */ ([
    [searchHeading(text), searchUnheading],
    [searchDirHeading(text), searchDirUnheading],
  ])) {
    if (cand.length < best.length && inverse(cand) === text) best = cand;
  }
  return best === text ? undefined : { text: best, offloaded: [] };
}

/**
 * Upstream SearchCompressor::compress_with_store with its default config: grep/ripgrep rows (matches and `-C` context lines
 * alike) parsed by file, scored (+0.3 per query context word in the line, +0.5 an error word, +0.3 an importance word, else
 * +0.4 a warning word, at most 1), the 15 best-scoring files kept, then per file its first, last and best matches up to 5 and
 * an adaptive 5 to 30 in all, in path and line order with `[... and N more matches in FILE]`, then
 * `[N matches compressed to M. Retrieve original: hash=H]` with the input stored under H. Lines that do not parse are dropped,
 * as upstream. Deviations: the retrieval line is always added ("Retrieve original", no match-count or ratio gate), the hash is
 * contentHash, context words are capped (contextWords) and CJK query bigrams are not added, and the parse's path checks and
 * the simhash count are budgeted (an exhausted parse declines). Undefined when nothing parses or the result is not shorter.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function compressSearch(text, query) {
  const budget = { left: SCAN_BUDGET_PER_CHAR * text.length + SCAN_BUDGET_FLOOR };
  /** @type {Map<string, SearchMatch[]>} */
  const files = new Map();
  let total = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = parseMatchLine(line, budget);
    if (budget.left < 0) return undefined;
    if (!m) continue;
    let list = files.get(m[0]);
    if (!list) files.set(m[0], (list = []));
    list.push({ file: m[0], line: m[1], content: m[2], score: 0 });
    total++;
  }
  if (!total) return undefined;
  const words = contextWords(query, text.length);
  for (const list of files.values()) {
    for (const m of list) {
      const lower = m.content.toLowerCase();
      let s = 0;
      for (const w of words) if (lower.includes(w)) s += 0.3;
      m.score = Math.min(s + searchBoost(m.content), 1);
    }
  }
  const ranked = [...files.keys()]
    .sort()
    .map((f) => /** @type {[string, SearchMatch[], number]} */ ([f, files.get(f) ?? [], (files.get(f) ?? []).reduce((a, m) => a + m.score, 0)]))
    .sort((a, b) => b[2] - a[2])
    .slice(0, SEARCH_MAX_FILES);
  const cap = computeOptimalK(
    ranked.flatMap(([f, list]) => list.map((m) => `${f}:${m.line}:${m.content}`)),
    SEARCH_MIN_K,
    SEARCH_MAX_TOTAL,
    { left: SCAN_BUDGET_PER_CHAR * text.length + SCAN_BUDGET_FLOOR },
  );
  /** @type {Map<string, SearchMatch[]>} */
  const selected = new Map();
  let kept = 0;
  for (const [file, list] of ranked) {
    if (kept >= cap) continue;
    const room = Math.min(SEARCH_MAX_PER_FILE, cap - kept);
    /** @type {SearchMatch[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const push = (/** @type {SearchMatch} */ m) => {
      const key = `${m.line}\u0000${m.content}`;
      if (out.length >= room || seen.has(key)) return;
      seen.add(key);
      out.push(m);
    };
    push(list[0]);
    if (list.length > 1) push(list[list.length - 1]);
    for (const m of [...list].sort((a, b) => b.score - a.score || a.line - b.line)) push(m);
    out.sort((a, b) => a.line - b.line);
    kept += out.length;
    selected.set(file, out);
  }
  /** @type {string[]} */
  const lines = [];
  for (const file of [...selected.keys()].sort()) {
    const out = selected.get(file) ?? [];
    for (const m of out) lines.push(`${m.file}:${m.line}:${m.content}`);
    const omitted = (files.get(file)?.length ?? 0) - out.length;
    if (omitted > 0) lines.push(`[... and ${omitted} more matches in ${file}]`);
  }
  const hash = contentHash(text);
  const result = `${lines.join("\n")}\n[${total} matches compressed to ${kept}. Retrieve original: hash=${hash}]`;
  return result.length < text.length ? { text: result, offloaded: [[hash, text]] } : undefined;
}

// Diff compressor: a port of headroom's diff_compressor.rs (compress_with_store with DiffCompressorConfig::default()) and the
// "diff" kind of lossless_compaction.py compact_lossless (diff_strip_index).

/** @typedef {{ header: string, lines: string[], additions: number, deletions: number, score: number }} DiffHunk one hunk: its header, body lines, counts and relevance */
/**
 * One file section: its header, `---`/`+++` lines (or ""), hunks, binary/new/deleted flags and rename lines (upstream DiffFile).
 * @typedef {{ header: string, oldFile: string, newFile: string, hunks: DiffHunk[], binary: boolean, added: boolean, deleted: boolean, renames: string[] }} DiffFile
 */

// Upstream DiffCompressorConfig::default() (min_lines_for_ccr gates the whole compression) and its score constants.
const DIFF_MAX_CONTEXT = 2;
const DIFF_MAX_HUNKS = 10;
const DIFF_MAX_FILES = 20;
const DIFF_MIN_LINES = 50;
// Upstream _DIFF_INDEX_RE: git's blob bookkeeping line, which a diff does not need to apply.
const DIFF_INDEX_RE = /^index [0-9a-fA-F]+\.\.[0-9a-fA-F]+( [0-7]+)?$/;
// Upstream hunk_header_regex: @@ (regular), @@@ (3-way) and @@@@ (4-way merge) headers; 5 or more @ fall through as content.
const DIFF_HUNK_RE = /^(?:@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|@@@ -\d+(?:,\d+)? -\d+(?:,\d+)? \+\d+(?:,\d+)? @@@|@@@@ -\d+(?:,\d+)? -\d+(?:,\d+)? -\d+(?:,\d+)? \+\d+(?:,\d+)? @@@@)/;
const DIFF_NEW_START_RE = /\+(\d+)/;
const DIFF_BINARY_RE = /^Binary files [^\n]+ differ$/;
// Upstream priority_patterns (PRIORITY_PATTERNS_DIFF): one +0.3 when any matches the lowercased hunk.
const DIFF_PRIORITY_RES = [
  /\b(?:error|exception|fail(?:ed|ure)?|fatal|critical|crash|panic)\b/i,
  /\b(?:important|note|todo|fixme|hack|xxx|bug|fix)\b/i,
  /\b(?:security|auth|password|secret|token)\b/i,
];

/**
 * Upstream is_diff_header: `diff --git a/<x> b/<y>`, `diff --combined <path>` or `diff --cc <path>`. Hand-checked: the
 * `^diff --git a/(.+) b/(.+)$` regex would backtrack quadratically on a long line with many ` b/`.
 * @param {string} line
 * @returns {boolean}
 */
function isDiffHeader(line) {
  if (line.startsWith("diff --git a/")) return line.lastIndexOf(" b/", line.length - 4) >= 14;
  return (line.startsWith("diff --combined ") && line.length > 16) || (line.startsWith("diff --cc ") && line.length > 10);
}

/**
 * Upstream parse_diff: lines before the first header are kept verbatim; mode, rename and binary lines set their flags (and fall
 * through, as upstream); `---`/`+++` lines and hunk headers are taken whole; inside a hunk `+` and `-` lines (not `+++`/`---`)
 * count, and every line is kept. Other header lines outside a hunk (`index`, `old mode`, `new mode`) are dropped, as upstream.
 * @param {readonly string[]} lines
 * @returns {{ pre: string[], files: DiffFile[] }}
 */
function parseDiff(lines) {
  /** @type {string[]} */
  const pre = [];
  /** @type {DiffFile[]} */
  const files = [];
  /** @type {DiffFile|undefined} */
  let file;
  /** @type {DiffHunk|undefined} */
  let hunk;
  const closeHunk = () => {
    if (hunk && file) file.hunks.push(hunk);
    hunk = undefined;
  };
  for (const line of lines) {
    if (isDiffHeader(line)) {
      closeHunk();
      if (file) files.push(file);
      file = { header: line, oldFile: "", newFile: "", hunks: [], binary: false, added: false, deleted: false, renames: [] };
      continue;
    }
    if (!file) {
      pre.push(line);
      continue;
    }
    if (line.startsWith("new file mode")) file.added = true;
    else if (line.startsWith("deleted file mode")) file.deleted = true;
    else if (line.startsWith("rename ") || line.startsWith("similarity ") || line.startsWith("copy ") || line.startsWith("dissimilarity ")) file.renames.push(line);
    else if (DIFF_BINARY_RE.test(line)) file.binary = true;
    if (line === "--- /dev/null" || (line.startsWith("--- a/") && line.length > 6)) {
      file.oldFile = line;
      continue;
    }
    if (line === "+++ /dev/null" || (line.startsWith("+++ b/") && line.length > 6)) {
      file.newFile = line;
      continue;
    }
    if (DIFF_HUNK_RE.test(line)) {
      closeHunk();
      hunk = { header: line, lines: [], additions: 0, deletions: 0, score: 0 };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) hunk.additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) hunk.deletions++;
    hunk.lines.push(line);
  }
  closeHunk();
  if (file) files.push(file);
  return { pre, files };
}

/**
 * Upstream score_hunks: min(0.3, changes × 0.03), +0.2 per query context word in the lowercased hunk, +0.3 once for a priority
 * pattern, at most 1. Deviations: context words are deduped and capped (contextWords), no CJK bigrams.
 * @param {readonly DiffFile[]} files mutated: each hunk's score
 * @param {string} query
 * @param {number} chars the text's length, for contextWords' cap
 * @returns {void}
 */
function scoreHunks(files, query, chars) {
  const words = contextWords(query, chars);
  for (const f of files) {
    for (const h of f.hunks) {
      let s = Math.min((h.additions + h.deletions) * 0.03, 0.3);
      const lower = h.lines.join("\n").toLowerCase();
      for (const w of words) if (lower.includes(w)) s += 0.2;
      if (DIFF_PRIORITY_RES.some((re) => re.test(lower))) s += 0.3;
      h.score = Math.min(s, 1);
    }
  }
}

/**
 * Upstream extract_line_number: the first `+N` in a hunk header, else 0.
 * @param {string} header
 * @returns {number}
 */
function hunkNewStart(header) {
  const n = Number(DIFF_NEW_START_RE.exec(header)?.[1] ?? 0);
  return Number.isSafeInteger(n) ? n : 0;
}

/**
 * Upstream select_hunks: over 10 hunks, the first, the last and the 8 best middle hunks by score (stable), re-sorted (stably) by
 * their header's new start line.
 * @param {DiffHunk[]} hunks
 * @returns {DiffHunk[]}
 */
function selectHunks(hunks) {
  if (hunks.length <= DIFF_MAX_HUNKS) return hunks;
  const middle = hunks
    .slice(1, -1)
    .sort((a, b) => b.score - a.score)
    .slice(0, DIFF_MAX_HUNKS - 2);
  return [hunks[0], ...middle, hunks[hunks.length - 1]].sort((a, b) => hunkNewStart(a.header) - hunkNewStart(b.header));
}

/**
 * Upstream reduce_context: the lines within 2 of a `+`/`-` line, plus every `\` line, in order; a hunk without changes keeps its
 * first 2 lines.
 * @param {DiffHunk} h
 * @returns {DiffHunk}
 */
function reduceContext(h) {
  const n = h.lines.length;
  const keep = new Uint8Array(n);
  let changed = false;
  h.lines.forEach((l, p) => {
    if (!l.startsWith("+") && !l.startsWith("-")) return;
    changed = true;
    for (let i = Math.max(0, p - DIFF_MAX_CONTEXT); i <= Math.min(p + DIFF_MAX_CONTEXT, n - 1); i++) keep[i] = 1;
  });
  if (!changed) return { ...h, lines: h.lines.slice(0, DIFF_MAX_CONTEXT) };
  return { ...h, lines: h.lines.filter((l, i) => keep[i] === 1 || l.startsWith("\\")) };
}

/**
 * The diff fold (upstream compact_lossless "diff"): `index <sha>..<sha> [mode]` lines dropped, when that shortens the text. No
 * inverse check, as upstream; the router only calls it on diff-labelled text.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function foldDiff(text) {
  const [lines, trailing] = splitKeepTrailing(text);
  const cand = joinLines(
    lines.filter((l) => !DIFF_INDEX_RE.test(l)),
    trailing,
  );
  return cand.length < text.length ? { text: cand, offloaded: [] } : undefined;
}

/**
 * Upstream DiffCompressor::compress_with_store with its default config: a diff of 50+ lines keeps its pre-diff lines, at most 20
 * files (past 20 the most-changed, in that order), per file at most 10 hunks (the first, the last and the best-scored middle
 * ones) trimmed to 2 context lines around each change, with mode lines normalised to 100644 and binary lines to `Binary files
 * differ`, then `[N files changed, +A -D lines, H hunks omitted]` and `[N lines compressed to M. Retrieve original: hash=H]`
 * with the input stored under H. Deviations: the retrieval line is always added ("Retrieve original", no 0.8 line-ratio gate,
 * so a result is returned only when shorter), the hash is contentHash, hunks are scored only when a file has more than 10 (the
 * score is read nowhere else), and context words are deduped and capped. Undefined under 50 lines, without a file header, or
 * when the result is not shorter.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function compressDiff(text, query) {
  const lines = text.split("\n"); // "\n" only: a "\r" stays on its line, as upstream
  if (lines.length < DIFF_MIN_LINES) return undefined;
  const { pre, files: parsed } = parseDiff(lines);
  if (!parsed.length) return undefined;
  const changes = (/** @type {DiffFile} */ f) => f.hunks.reduce((a, h) => a + h.additions + h.deletions, 0);
  const files =
    parsed.length > DIFF_MAX_FILES
      ? parsed
          .map((f) => /** @type {[DiffFile, number]} */ ([f, changes(f)]))
          .sort((a, b) => b[1] - a[1])
          .slice(0, DIFF_MAX_FILES)
          .map(([f]) => f)
      : parsed;
  if (files.some((f) => f.hunks.length > DIFF_MAX_HUNKS)) scoreHunks(files, query, text.length);
  let adds = 0;
  let dels = 0;
  let omitted = 0;
  /** @type {string[]} */
  const out = [];
  for (const l of pre) out.push(l);
  for (const f of files) {
    for (const h of f.hunks) {
      adds += h.additions;
      dels += h.deletions;
    }
    const hunks = selectHunks(f.hunks).map(reduceContext);
    omitted += f.hunks.length - hunks.length;
    out.push(f.header);
    for (const l of f.renames) out.push(l);
    if (f.added) out.push("new file mode 100644");
    else if (f.deleted) out.push("deleted file mode 100644");
    if (f.binary) {
      out.push("Binary files differ");
      continue;
    }
    if (f.oldFile) out.push(f.oldFile);
    if (f.newFile) out.push(f.newFile);
    for (const h of hunks) {
      out.push(h.header);
      for (const l of h.lines) out.push(l);
    }
  }
  out.push(`[${files.length} files changed, +${adds} -${dels} lines${omitted > 0 ? `, ${omitted} hunks omitted` : ""}]`);
  const hash = contentHash(text);
  const result = `${out.join("\n")}\n[${lines.length} lines compressed to ${out.length}. Retrieve original: hash=${hash}]`;
  return result.length < text.length ? { text: result, offloaded: [[hash, text]] } : undefined;
}

// Text crusher: a port of headroom's text_crusher/crusher.rs (TextCrusher::compress, ASCII path, TextCrusherConfig::default())
// and the "text" kind of lossless_compaction.py compact_lossless. It stands in for upstream's Kompress (ML) on prose.

// Upstream TextCrusherConfig::default() (target_ratio is a constant here, not clamped per call).
const TEXT_TARGET_RATIO = 0.5;
const TEXT_W_RECENCY = 1.0;
const TEXT_W_RELEVANCE = 2.0;
const TEXT_W_SALIENCE = 1.5;
const TEXT_MIN_SEGMENT_CHARS = 12;
const TEXT_NEAR_DUP = 0.85;
const TEXT_MIN_SEGMENTS = 6;
// Upstream is_cjk exactly: CJK punctuation, kana, ideographs (BMP and astral), Hangul and half/full-width forms. CJK_RANGES
// (bigramCurve's) is narrower and stays as it is.
const TEXT_CJK_RE = /[\u{3000}-\u{303f}\u{3040}-\u{30ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{ac00}-\u{d7af}\u{f900}-\u{faff}\u{ff00}-\u{ffef}\u{20000}-\u{2fa1f}]/u;
// Upstream tokens_ascii: runs of Rust is_alphanumeric (Alphabetic or Numeric) or `_`, lowercased. Not BM25_TOKEN_RE.
const TEXT_TOKEN_RE = /[\p{Alphabetic}\p{N}_]+/gu;
const TEXT_WORD_CHAR_RE = /[\p{Alphabetic}\p{N}]/u;
const TEXT_LETTER_RE = /\p{Alphabetic}/gu;
const TEXT_UPPER_RE = /^\p{Uppercase}$/u;
const TEXT_IDENT_START_RE = /^[\p{Alphabetic}_]/u;
const TEXT_KEYWORDS = new Set(["error", "exception", "failed", "failure", "fail", "warning", "traceback", "assert", "todo", "fixme"]);

/**
 * Upstream split_segments_ascii: each trimmed non-empty line, cut after `.`, `!` or `?` and the whitespace that follows it,
 * each piece trimmed, empty pieces dropped.
 * @param {string} text
 * @returns {string[]}
 */
function splitSegments(text) {
  /** @type {string[]} */
  const segs = [];
  const push = (/** @type {string} */ s) => {
    const t = s.trim();
    if (t) segs.push(t);
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let start = 0;
    let prevTerm = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (prevTerm && /\s/.test(c)) {
        push(t.slice(start, i));
        start = i + 1;
        prevTerm = false;
        continue;
      }
      prevTerm = c === "." || c === "!" || c === "?";
    }
    push(t.slice(start));
  }
  return segs;
}

/**
 * Upstream trim_matches(|c| !c.is_alphanumeric()), by code points and without a regex (a backtracking one would be quadratic on
 * a long run of punctuation).
 * @param {string} word
 * @returns {string}
 */
function trimToWord(word) {
  const cps = Array.from(word);
  let s = 0;
  let e = cps.length;
  while (s < e && !TEXT_WORD_CHAR_RE.test(cps[s])) s++;
  while (e > s && !TEXT_WORD_CHAR_RE.test(cps[e - 1])) e--;
  return cps.slice(s, e).join("");
}

/**
 * Upstream is_salient: a word carrying hard-to-reconstruct information, holding an ASCII digit, being an error/status keyword
 * once trimmed of non-alphanumerics, ALLCAPS (2+ letters, all uppercase), or a dotted identifier (`foo.bar`).
 * @param {string} word
 * @returns {boolean}
 */
function isSalient(word) {
  if (/[0-9]/.test(word)) return true;
  if (TEXT_KEYWORDS.has(trimToWord(word).toLowerCase())) return true;
  const letters = word.match(TEXT_LETTER_RE) ?? [];
  if (letters.length >= 2 && letters.every((c) => TEXT_UPPER_RE.test(c))) return true;
  const dot = word.indexOf(".");
  return dot > 0 && dot + 1 < word.length && TEXT_IDENT_START_RE.test(word.slice(0, dot)) && TEXT_IDENT_START_RE.test(word.slice(dot + 1));
}

/**
 * Upstream shingles(words, 3): the 3-token windows joined by \u0001; a segment of 1 or 2 tokens gives all its sub-windows.
 * @param {readonly string[]} words
 * @returns {Set<string>}
 */
function shingles(words) {
  /** @type {Set<string>} */
  const set = new Set();
  const k = words.length < 3 ? 1 : 3;
  for (let size = k; size <= Math.min(words.length, 3); size++) for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join("\u0001"));
  return set;
}

/**
 * The text fold (upstream compact_lossless "text"): runs of identical lines collapsed to `... (repeated N times)`, kept only when
 * it expands back to the text and is shorter.
 * @param {string} text
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function foldText(text) {
  const cand = collapseRuns(text);
  if (cand.length >= text.length || expandRuns(cand, splitKeepTrailing(text)[0].length) !== text) return undefined;
  return { text: cand, offloaded: [] };
}

/**
 * Upstream TextCrusher::compress (the ASCII path, default config): prose split into sentence segments, each scored by recency
 * (1.0 × (i+1)/n), BM25 relevance to the query (2.0 ×) and salience (1.5 × salient words / (words + 1)), × 0.25 under 12 chars;
 * then, best first, segments are kept until half the characters are, skipping one whose 3-token shingles are 85% covered by kept
 * ones. The kept segments, in order and joined by \n, end with `[Text crushed: K of N segments kept. Retrieve original: hash=H]`
 * and the input is stored under H. Deviations: text holding a CJK character declines (upstream's ICU path is not ported), lengths
 * count UTF-16 units where upstream counts UTF-8 bytes, and the retrieval line is the mod's own. Undefined under 6 segments or
 * when the result is not shorter.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function crushText(text, query) {
  if (TEXT_CJK_RE.test(text)) return undefined;
  const segs = splitSegments(text);
  const n = segs.length;
  if (n < TEXT_MIN_SEGMENTS) return undefined;
  const target = Math.max(1, Math.floor(segs.reduce((a, s) => a + s.length, 0) * TEXT_TARGET_RATIO));
  const rel = bm25Scores(segs, query);
  const scores = segs.map((s, i) => {
    const words = s.split(/\s+/).filter(Boolean);
    const salience = words.filter(isSalient).length / (words.length + 1);
    const score = TEXT_W_RECENCY * ((i + 1) / n) + TEXT_W_RELEVANCE * rel[i] + TEXT_W_SALIENCE * salience;
    return s.length < TEXT_MIN_SEGMENT_CHARS ? score * 0.25 : score;
  });
  const order = segs.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const kept = new Uint8Array(n);
  /** @type {Set<string>} */
  const seen = new Set();
  let keptChars = 0;
  let keptCount = 0;
  for (const i of order) {
    if (keptChars >= target) break;
    const sh = shingles(segs[i].toLowerCase().match(TEXT_TOKEN_RE) ?? []);
    if (sh.size) {
      let covered = 0;
      for (const s of sh) if (seen.has(s)) covered++;
      if (covered / sh.size >= TEXT_NEAR_DUP) continue; // a near-duplicate of kept segments
    }
    kept[i] = 1;
    keptCount++;
    for (const s of sh) seen.add(s);
    keptChars += segs[i].length;
  }
  if (!keptCount) return undefined;
  const hash = contentHash(text);
  const out = `${segs.filter((_, i) => kept[i] === 1).join("\n")}\n[Text crushed: ${keptCount} of ${n} segments kept. Retrieve original: hash=${hash}]`;
  return out.length < text.length ? { text: out, offloaded: [[hash, text]] } : undefined;
}

// Relevance split: a port of headroom's relevance_split.py (segment, _otsu_threshold, adaptive_threshold, plan_relevance_split)
// and content_router.py _relevance_split_compress, routed on prose only (user decision; upstream splits LOG and SEARCH output).

const SPLIT_WINDOW = 8;
const SPLIT_MAX_CHARS = 1200;
// Upstream RelevanceScorerConfig.relevance_threshold: the KEEP cut's floor.
const SPLIT_FLOOR = 0.25;

/**
 * Upstream segment(content, window, max_chars): a lossless partition (`segs.join("") === text`) into blank-line-delimited
 * blocks, each packed into windows of at most `window` lines, an indented continuation line held past that, and at most
 * `maxChars` characters; a single longer line stays whole. Deviation: lines split on \n only (Python's splitlines also splits on
 * \r, \v, \f, \x1c-\x1e, \x85, U+2028 and U+2029).
 * @param {string} text
 * @param {number} [window]
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function segmentRecords(text, window = SPLIT_WINDOW, maxChars = SPLIT_MAX_CHARS) {
  /** @type {string[]} */
  const lines = [];
  for (let s = 0; s < text.length;) {
    const nl = text.indexOf("\n", s);
    const end = nl < 0 ? text.length : nl + 1;
    lines.push(text.slice(s, end));
    s = end;
  }
  if (lines.length <= 1) return text ? [text] : [];
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[]} */
  let cur = [];
  for (const ln of lines) {
    cur.push(ln);
    if (/^\s*$/.test(ln)) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);
  /** @type {string[]} */
  const segs = [];
  for (const block of blocks) {
    for (let i = 0; i < block.length;) {
      let j = i + 1;
      let size = block[i].length;
      while (j < block.length && (j - i < window || block[j].startsWith(" ") || block[j].startsWith("\t")) && size + block[j].length <= maxChars) {
        size += block[j].length;
        j++;
      }
      segs.push(block.slice(i, j).join(""));
      i = j;
    }
  }
  return segs;
}

/**
 * Upstream _otsu_threshold: the midpoint of the adjacent sorted pair that maximises the between-class variance.
 * @param {readonly number[]} values at least one
 * @returns {number}
 */
export function otsuThreshold(values) {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  let w0 = 0;
  let sum0 = 0;
  let bestT = xs[0];
  let bestVar = -1;
  for (let i = 0; i < n - 1; i++) {
    w0 += 1;
    sum0 += xs[i];
    const w1 = n - w0;
    const between = w0 * w1 * (sum0 / w0 - (total - sum0) / w1) ** 2;
    if (between > bestVar) {
      bestVar = between;
      bestT = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return bestT;
}

/**
 * Upstream adaptive_threshold: `floor` when fewer than 2 distinct values remain after rounding to 9 decimals, else the Otsu cut
 * of the raw values, at least `floor`.
 * @param {readonly number[]} values
 * @param {number} floor
 * @returns {number}
 */
export function adaptiveThreshold(values, floor) {
  if (new Set(values.map((v) => Math.round(v * 1e9) / 1e9)).size < 2) return floor;
  return Math.max(otsuThreshold(values), floor);
}

/**
 * A stand-in for upstream _json_straddles_segments: whether a top-level balanced `[`/`{` span crosses a cut between two segments.
 * The outer walk is noJsonSpans' (budget 4 per character + 4096, the `known` memo reused); spans and cuts are merged in one
 * linear pass. An exhausted budget counts as straddling. Deviation: any balanced span counts (upstream protects only spans that
 * parse as JSON documents or record arrays), which errs on keeping the text whole; one-line spans never straddle.
 * @param {string} text
 * @param {readonly string[]} segs segmentRecords(text)
 * @returns {boolean}
 */
function jsonStraddles(text, segs) {
  const n = text.length;
  const budget = SCAN_BUDGET_PER_CHAR * n + SCAN_BUDGET_FLOOR;
  /** @type {Map<number, number|null>} */
  const known = new Map();
  /** @type {[number, number][]} */
  const spans = [];
  let spent = 0;
  for (let i = 0; i < n;) {
    if (text[i] === "[" || text[i] === "{") {
      /** @type {number|null|undefined} */
      let end;
      if (known.has(i)) end = known.get(i);
      else if (spent >= budget) return true;
      else {
        const [e, walked] = scanFrom(text, i, known);
        end = e;
        spent += walked;
      }
      if (typeof end === "number") {
        spans.push([i, end]);
        i = end;
        continue;
      }
    }
    i++;
  }
  let s = 0;
  let cut = 0;
  for (let k = 0; k < segs.length - 1; k++) {
    cut += segs[k].length;
    while (s < spans.length && spans[s][1] <= cut) s++;
    if (s < spans.length && spans[s][0] < cut) return true;
  }
  return false;
}

/**
 * Upstream plan_relevance_split plus content_router.py _relevance_split_compress, for prose: the text's records
 * (segmentRecords) are scored by plain BM25 against the query and kept from the adaptive cut (floor 0.25) up; consecutive
 * records of one disposition form runs. A DROP run holding an ERROR_KEYWORDS line is kept whole (user decision). Each DROP run
 * becomes `...[N low-relevance line(s) elided]...` (upstream's CCR-mode disposition: the mod always has retrieval), KEEP runs
 * are folded with foldText while `foldOn` (text_crusher_enabled owns that fold; off, they stay raw and foldText is never
 * called), and `[N low-relevance line(s) in R run(s) elided. Retrieve original: hash=H]` ends the text, the input stored under H.
 * Adopted only when strictly shorter than the baseline: foldText's whole-text fold while `foldOn` (or the text when it
 * declines), else the text. Undefined for an empty query, a single record, a multi-line bracket span across a cut, no KEEP run
 * (never an all-DROP output; user decision) or no DROP run.
 * @param {string} text
 * @param {string} query the conversation context (crushQuery)
 * @param {boolean} foldOn whether the text crusher's lever, the owner of foldText, is on
 * @returns {{ text: string, offloaded: [string, string][] }|undefined}
 */
export function splitRelevance(text, query, foldOn) {
  if (query.trim() === "") return undefined;
  const segs = segmentRecords(text);
  if (segs.length < 2 || jsonStraddles(text, segs)) return undefined;
  const scores = bm25Scores(segs, query);
  const cut = adaptiveThreshold(scores, SPLIT_FLOOR);
  /** @type {{ keep: boolean, text: string, mustKeep: boolean }[]} */
  const runs = [];
  segs.forEach((seg, i) => {
    const keep = scores[i] >= cut;
    const lower = seg.toLowerCase();
    const mustKeep = ERROR_KEYWORDS.some((k) => lower.includes(k));
    const last = runs.at(-1);
    if (last && last.keep === keep) {
      last.text += seg;
      last.mustKeep ||= mustKeep;
    } else runs.push({ keep, text: seg, mustKeep });
  });
  /** @type {{ keep: boolean, text: string }[]} */
  const merged = [];
  for (const r of runs) {
    const keep = r.keep || r.mustKeep;
    const last = merged.at(-1);
    if (last && last.keep === keep) last.text += r.text;
    else merged.push({ keep, text: r.text });
  }
  const drops = merged.filter((r) => !r.keep);
  if (drops.length === 0 || drops.length === merged.length) return undefined;
  const lineCount = (/** @type {string} */ t) => (t.match(/\n/g)?.length ?? 0) + (t.endsWith("\n") ? 0 : 1);
  let dropped = 0;
  const body = merged
    .map((r) => {
      if (r.keep) return foldOn ? (foldText(r.text)?.text ?? r.text) : r.text;
      const n = lineCount(r.text);
      dropped += n;
      return `...[${n} low-relevance ${n === 1 ? "line" : "lines"} elided]...${r.text.endsWith("\n") ? "\n" : ""}`;
    })
    .join("");
  const hash = contentHash(text);
  const runWord = drops.length === 1 ? "run" : "runs";
  const out = `${body}${body.endsWith("\n") ? "" : "\n"}[${dropped} low-relevance ${dropped === 1 ? "line" : "lines"} in ${drops.length} ${runWord} elided. Retrieve original: hash=${hash}]`;
  const baseline = foldOn ? (foldText(text)?.text ?? text) : text;
  return out.length < baseline.length ? { text: out, offloaded: [[hash, text]] } : undefined;
}

/**
 * Each content type's compression steps, tried in order until one rewrites (a light upstream _strategy_from_detection).
 * The SmartCrusher owns JSON, the config compressor structured config, the HTML extractor HTML, the log compressor build
 * output, the search compressor search results, the diff compressor diffs, and the relevance split and the text crusher
 * prose. The dense line elider ends every route: it runs after a step in ELIDE_AFTER hands its rewrite on, and as the
 * fallback when every step before it declined; any other rewrite ends the route (a diff rewrite, a fold, a split, as
 * upstream returns them before its elision point). A lossy step sits before its kind's lossless fold because it has to beat
 * that fold, the floor (overFold, upstream's lossless_then_lossy gate); the fold step runs only on the route's input text, as
 * the fallback for a lossy step that declined or lost, never on a handed-on rewrite. A new compressor adds a RouteStep, a
 * case in rewriteRow's shrink, a Levers flag, and its name in the types it fits.
 * @type {Readonly<Record<ContentType, readonly RouteStep[]>>}
 */
const ROUTES = {
  json_array: ["crush", "elide"],
  diff: ["diff", "difffold", "elide"],
  html: ["extract", "elide"],
  tabular: ["elide"],
  search: ["search", "searchfold", "elide"],
  build: ["log", "logfold", "elide"],
  structured_config: ["config", "elide"],
  source_code: ["elide"],
  text: ["split", "textcrush", "textfold", "elide"],
};

// The router-wide floor: a shorter text skips detection and every step. The elider returns early below its line minimum and
// the crusher wants more; the new steps' own upstream floors are lower (search none, the split 2 records, log and diff 50
// lines, prose_field 256 bytes), but under 300 characters a retrieval line would eat most of any saving.
const ROUTE_MIN_CHARS = Math.min(CRUSH_MIN_CHARS, DENSE_MIN_LINE_CHARS);
// The steps whose rewrite the route goes on with (upstream _DENSE_ELIDE_AFTER's HTML, LOG, SEARCH and TEXT members): the
// elider then runs on the extraction or the lossy output. The SmartCrusher, the config compressor, the diff compressor, every
// fold and the relevance split end the route, as upstream leaves SMART_CRUSHER, CONFIG and DIFF out and returns a kept fold
// or a split before its elision point.
/** @type {ReadonlySet<RouteStep>} */
const ELIDE_AFTER = new Set(["extract", "log", "search", "textcrush"]);
// Upstream _DEFAULT_LOSSY_MIN_EXTRA_SAVINGS: a lossy step must save this fraction beyond its kind's fold.
const LOSSY_MIN_EXTRA_SAVINGS = 0.05;

/**
 * Upstream's lossless_then_lossy gate: a lossy result is kept only when it is at most (1 - LOSSY_MIN_EXTRA_SAVINGS) of its kind's
 * fold (the floor); when the fold declined, the step's own strictly-shorter contract has already decided.
 * @param {{ text: string }} r the lossy step's result
 * @param {{ text: string }|undefined} floor the kind's fold of the same text, undefined when it declined
 * @returns {boolean}
 */
function overFold(r, floor) {
  return floor === undefined || r.text.length <= floor.text.length * (1 - LOSSY_MIN_EXTRA_SAVINGS);
}

// The tool-result row pipeline (session.append): SmartCrusher and the dense line elider by content type, then cross-turn dedup.

/**
 * A tool_result block's texts as the model reads them: string content, or each text block of array content.
 * @param {Record<string, unknown>} block
 * @returns {string[]}
 */
function resultTexts(block) {
  const c = block.content;
  if (typeof c === "string") return [c];
  return Array.isArray(c) ? c.filter(isTextBlock).map((b) => b.text) : [];
}

/**
 * A row whose result is never rewritten: a headroom_retrieve result (the original text itself, so rewriting it again
 * would loop; matched by name in any namespace, as a row's `origin.tool` is not live-verified to carry the full one) and
 * the mod's own storage tools.
 * @param {string} tool a row's origin tool
 * @returns {boolean}
 */
function isProtectedTool(tool) {
  return tool === RETRIEVE_NAME || tool.endsWith(RETRIEVE_SUFFIX) || tool.startsWith(OWN_STORAGE_PREFIX);
}

const READ_TOOL = "Read";

/**
 * A tool_result block whose texts are never rewritten (dedup still indexes them): an error, or a protected tool's row.
 * wantsQuery and rewriteRow share it so the fetch gate and the rewrite never disagree.
 * @param {Record<string, unknown>} block
 * @param {string} tool a row's origin tool
 * @returns {boolean}
 */
function isProtectedBlock(block, tool) {
  return block.is_error === true || isProtectedTool(tool);
}

/**
 * Whether a tool-result row holds text a query-reading lever may rewrite, so the hook pays the transcript fetch only then:
 * a JSON document for the SmartCrusher, or, for the search and diff compressors, the text crusher and the relevance split,
 * any non-Read text of at least ROUTE_MIN_CHARS. A cheap pre-check: no content detection. The default levers are the
 * two-argument call's (the SmartCrusher alone).
 * @param {readonly ContentBlock[]} content the row's blocks
 * @param {string} tool the row's origin tool
 * @param {{ crush?: boolean, log?: boolean, search?: boolean, diff?: boolean, textcrush?: boolean, split?: boolean }} [levers] the row's levers; only crush and the query-reading prose levers count
 * @returns {boolean}
 */
export function wantsQuery(content, tool, levers = { crush: true }) {
  const prose = !!(levers.search || levers.diff || levers.textcrush || levers.split) && tool !== READ_TOOL;
  return content.some(
    (b) => isRecord(b) && b.type === "tool_result" && !isProtectedBlock(b, tool) && resultTexts(b).some((t) => (!!levers.crush && looksLikeJsonDoc(t)) || (prose && t.length >= ROUTE_MIN_CHARS)),
  );
}

/**
 * Rewrites a tool-result row's blocks before they are stored: per tool_result block, each text runs its content type's
 * route (`detectContentType`, `ROUTES`): crushed (one whole JSON document) or else dense-line-elided, then a single-text
 * result is deduplicated against earlier results of the same conversation. Error blocks and headroom_retrieve /
 * own-storage rows are never rewritten (dedup still indexes them). Undefined when no block changed. Mutates
 * levers.dedup.states; a throw starts that conversation's corpus over, since a block indexed before it belongs to a row
 * that is then stored as made.
 * @param {readonly ContentBlock[]} content the row's blocks
 * @param {string} tool the row's origin tool
 * @param {Levers} levers
 * @param {string} query the conversation context (crushQuery), "" for none
 * @returns {RowRewrite|undefined}
 */
export function rewriteToolResults(content, tool, levers, query) {
  try {
    return rewriteRow(content, tool, levers, query);
  } catch (err) {
    const d = levers.dedup;
    const st = d && d.states.get(d.key);
    if (st) resetCorpus(st);
    throw err;
  }
}

/**
 * rewriteToolResults without its failure handling.
 * @param {readonly ContentBlock[]} content
 * @param {string} tool
 * @param {Levers} levers
 * @param {string} query
 * @returns {RowRewrite|undefined}
 */
function rewriteRow(content, tool, levers, query) {
  /** @type {Omit<RowRewrite, "content">} */
  const acc = {
    offloaded: [],
    folded: [],
    crush: { dropped: 0, saved: 0 },
    compact: { arrays: 0, saved: 0 },
    config: { texts: 0, saved: 0 },
    extract: { pages: 0, saved: 0 },
    elide: { lines: 0, saved: 0 },
    dedup: { spans: 0, saved: 0 },
    log: { texts: 0, saved: 0 },
    search: { texts: 0, saved: 0 },
    diff: { texts: 0, saved: 0 },
    textcrush: { texts: 0, saved: 0 },
    split: { texts: 0, saved: 0 },
  };
  // A lever some route runs ahead of the elider is on, so a text's label can change what runs (every one but dedup and the elider).
  const routed = !!(levers.crush || levers.compact || levers.config || levers.extract || levers.log || levers.search || levers.diff || levers.textcrush || levers.split);
  // A Read result: the model needs its verbatim lines for the next Edit's old_string.
  const verbatimTool = tool === READ_TOOL;
  /**
   * Books a router compressor's adopted rewrite (its lossy step's or its fold's) in its table and returns the rewritten text.
   * @param {{ texts: number, saved: number }} slot
   * @param {string} from the step's input
   * @param {{ text: string, offloaded: [string, string][] }} r
   * @returns {string}
   */
  const adopt = (slot, from, r) => {
    slot.texts += 1;
    slot.saved += from.length - r.text.length;
    acc.offloaded.push(...r.offloaded);
    return r.text;
  };
  let changed = false;
  /** @type {[string, [number, number][]|null]|undefined} */
  let memo;
  // The tag spans of the last text scanned: shrink's final text is often fold's input, and the scan is a full lexer pass.
  const spansOf = (/** @type {string} */ t) => (memo?.[0] === t ? memo[1] : (memo = [t, tagSpans(t)])[1]);
  /** @type {ContentBlock[]} */
  const mapped = content.map((b) => {
    if (!isRecord(b) || b.type !== "tool_result") return b;
    const prot = isProtectedBlock(b, tool);
    /**
     * Its content type's route (ROUTES): the first rewrite wins, except that a step in ELIDE_AFTER hands its rewrite on to
     * the next step; upstream elides only text no JSON, config or diff strategy, fold or split rewrote. A fold step runs only
     * on the route's input (`cur === text`): an adopted rewrite is always strictly shorter, so a handed-on one never equals it.
     * With the tag protector on, each step gets the tag spans of the text it receives: a JSON text holding one loses no row,
     * the config compressor, the HTML extractor and the router compressors decline it, the elider skips its lines, and an
     * unprotectable text (tagSpans null) passes through whole. The router compressors also leave Read and line-numbered
     * (`N\t`, `cat -n`) text whole: the Edit tool must still match it.
     * @param {string} text
     * @returns {string}
     */
    const shrink = (text) => {
      if (prot || !(routed || levers.elide) || text.length < ROUTE_MIN_CHARS) return text;
      let spans = levers.tags ? spansOf(text) : [];
      if (spans === null) return text;
      let cur = text;
      // A text the router compressors may rewrite: not Read output, not line-numbered.
      const fresh = !verbatimTool && !LINE_NUMBERED_RE.test(text);
      // With only the elider on, every route runs just `elide`: skip the detection that cannot change the outcome.
      const type = routed ? detectContentType(text) : "text";
      for (const step of ROUTES[type]) {
        /** @type {string|undefined} */
        let next;
        const lossy = levers.crush && spans.length === 0;
        if (step === "crush" && (lossy || levers.compact)) {
          const c = crushJson(cur, query, { lossy, lossless: !!levers.compact });
          if (c) {
            // A document that lost nothing owes all its savings to compaction; otherwise the tables' own savings, capped.
            const saved = cur.length - c.text.length;
            const toCompact = c.rowsDropped === 0 ? saved : Math.max(0, Math.min(saved, c.compactSaved));
            acc.compact.arrays += c.compacted;
            acc.compact.saved += toCompact;
            acc.crush.dropped += c.rowsDropped;
            acc.crush.saved += saved - toCompact;
            acc.offloaded.push(...c.offloaded);
            next = c.text;
          }
        } else if (step === "config" && levers.config && spans.length === 0) {
          const k = compressConfig(cur);
          if (k) {
            acc.config.texts += 1;
            acc.config.saved += cur.length - k.text.length;
            acc.offloaded.push(...k.offloaded);
            next = k.text;
          }
        } else if (step === "extract" && levers.extract && spans.length === 0) {
          const x = extractHtml(cur);
          if (x) {
            acc.extract.pages += 1;
            acc.extract.saved += cur.length - x.text.length;
            acc.offloaded.push(...x.offloaded);
            next = x.text;
          }
        } else if (step === "log" && levers.log && fresh && spans.length === 0) {
          const r = compressLog(cur);
          if (r && overFold(r, foldLog(cur))) next = adopt(acc.log, cur, r);
        } else if (step === "logfold" && levers.log && fresh && spans.length === 0 && cur === text) {
          // A fold is the fallback for a lossy step that lost, never a post-processor of its output (that carries a retrieval line).
          const r = foldLog(cur);
          if (r) next = adopt(acc.log, cur, r);
        } else if (step === "search" && levers.search && fresh && spans.length === 0) {
          const r = compressSearch(cur, query);
          if (r && overFold(r, foldSearch(cur))) next = adopt(acc.search, cur, r);
        } else if (step === "searchfold" && levers.search && fresh && spans.length === 0 && cur === text) {
          const r = foldSearch(cur);
          if (r) next = adopt(acc.search, cur, r);
        } else if (step === "diff" && levers.diff && fresh && spans.length === 0) {
          const r = compressDiff(cur, query);
          if (r && overFold(r, foldDiff(cur))) next = adopt(acc.diff, cur, r);
        } else if (step === "difffold" && levers.diff && fresh && spans.length === 0 && cur === text) {
          const r = foldDiff(cur);
          if (r) next = adopt(acc.diff, cur, r);
        } else if (step === "textcrush" && levers.textcrush && fresh && spans.length === 0) {
          const r = crushText(cur, query);
          if (r && overFold(r, foldText(cur))) next = adopt(acc.textcrush, cur, r);
        } else if (step === "textfold" && levers.textcrush && fresh && spans.length === 0 && cur === text) {
          const r = foldText(cur);
          if (r) next = adopt(acc.textcrush, cur, r);
        } else if (step === "split" && levers.split && fresh && spans.length === 0) {
          // foldText belongs to the text crusher's lever: the split folds its KEEP runs only while that lever is on.
          const r = splitRelevance(cur, query, !!levers.textcrush);
          if (r) next = adopt(acc.split, cur, r);
        } else if (step === "elide" && levers.elide) {
          const d = elideDense(cur, spans);
          if (d) {
            acc.elide.lines += d.lines;
            acc.elide.saved += cur.length - d.text.length;
            acc.offloaded.push(...d.offloaded);
            next = d.text;
          }
        }
        if (next === undefined) continue;
        if (!ELIDE_AFTER.has(step)) return next;
        cur = next;
        // The extraction may hold a tag its markup did not (a decoded `&lt;system-reminder&gt;`): its own spans guard it.
        spans = levers.tags ? spansOf(cur) : [];
        if (spans === null) return cur;
      }
      return cur;
    };
    /**
     * Cross-turn dedup of a result's final text; a protected text, and with the tag protector on an unprotectable one, is
     * only indexed, and a tagged line never folds.
     * @param {string} text
     * @returns {string}
     */
    const fold = (text) => {
      if (!levers.dedup) return text;
      const spans = levers.tags ? spansOf(text) : [];
      // A Read result is only indexed: the model needs its verbatim lines for the next Edit's old_string.
      const f = dedupBlock(levers.dedup.states, levers.dedup.key, text, prot || spans === null || verbatimTool, spans ?? []);
      if (!f) return text;
      acc.dedup.spans += f.spans;
      acc.dedup.saved += text.length - f.text.length;
      acc.folded.push(...f.offloaded);
      return f.text;
    };
    const c = b.content;
    if (typeof c === "string") {
      let t = shrink(c);
      if (t !== "") t = fold(t);
      if (t === c) return b;
      changed = true;
      return { ...b, content: t };
    }
    if (!Array.isArray(c)) return b;
    let touched = false;
    /** @type {unknown[]} */
    const items = c.map((x) => {
      if (!isTextBlock(x)) return x;
      const text = shrink(x.text);
      if (text === x.text) return x;
      touched = true;
      return { ...x, text };
    });
    // Upstream dedups only a result with exactly one non-empty text block; multi-text results stay verbatim and unindexed.
    const texts = items.flatMap((x, i) => (isTextBlock(x) && x.text !== "" ? [i] : []));
    if (texts.length === 1) {
      const it = /** @type {{ type: "text", text: string }} */ (items[texts[0]]);
      const text = fold(it.text);
      if (text !== it.text) {
        items[texts[0]] = { ...it, text };
        touched = true;
      }
    }
    if (!touched) return b;
    changed = true;
    return { ...b, content: items };
  });
  return changed ? { content: mapped, ...acc } : undefined;
}
