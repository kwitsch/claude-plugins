// editorconfig.ts — .editorconfig resolver + registry flag mapping (pure, unit-tested).
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { EditorConfigProps, FormatTool } from "./types.js";

// Build the argv-tail for a mapped tool given whether a tool-native config governs the file and
// the resolved .editorconfig props (null = no .editorconfig found). Returns {argv} to run, or
// {skip:true} for a hard style conflict the tool cannot honor.
export function buildInvocation(tool: FormatTool, opts: { hasNativeConfig?: boolean; editorconfig?: EditorConfigProps | null } = {}): { argv: string[] } | { skip: true } {
  const { hasNativeConfig = false, editorconfig = null } = opts;
  if (tool.strategy !== "mapped") return { argv: tool.base.slice() };
  if (hasNativeConfig || !editorconfig) return { argv: tool.base.slice() };
  const mapper = MAPPERS[tool.name];
  return mapper ? mapper(tool.base, editorconfig) : { argv: tool.base.slice() };
}

// Per-tool .editorconfig -> CLI-flag mappers. Only reached when the tool is "mapped", no
// tool-native config governs, and an .editorconfig was found for the file.
const MAPPERS: Record<string, (base: string[], ec: EditorConfigProps) => { argv: string[] } | { skip: true }> = {
  ruff(base, ec) {
    const argv = base.slice();
    if (typeof ec.max_line_length === "number") argv.push("--line-length", String(ec.max_line_length));
    if (ec.indent_style === "tab" || ec.indent_style === "space") argv.push("--config", `format.indent-style='${ec.indent_style}'`);
    if (typeof ec.indent_size === "number") argv.push("--config", `format.indent-width=${ec.indent_size}`);
    return { argv };
  },
  black(base, ec) {
    if (ec.indent_style === "tab") return { skip: true }; // black is hard-fixed 4-space; tabs rejected
    const argv = base.slice();
    if (typeof ec.max_line_length === "number") argv.push("--line-length", String(ec.max_line_length));
    return { argv };
  },
};

// Walk from the file's dir up to cwd (inclusive); return true if a tool-native config governs the
// file. Entry: a filename (existence) or {file, section} — file must exist AND contain a
// `[section]` or `[section.*]` TOML header.
export function findNativeConfig(fileDir: string, cwd: string, entries: Array<string | { file: string; section: string }>): boolean {
  let dir = fileDir;
  for (;;) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        if (existsSync(path.join(dir, entry))) return true;
      } else {
        const p = path.join(dir, entry.file);
        if (existsSync(p)) {
          let text = "";
          try {
            text = readFileSync(p, "utf8");
          } catch {
            /* unreadable config file -> treat as absent */
          }
          const escaped = entry.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp("^\\s*\\[" + escaped + "(\\.[^\\]]*)?\\]", "m");
          if (re.test(text)) return true;
        }
      }
    }
    if (dir === cwd) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root safety
    dir = parent;
  }
  return false;
}

// Resolve .editorconfig props for a file by walking dir->cwd (inclusive), stopping after a file
// with root=true. Sections applied farthest-first, later-section-wins, so nearer files and later
// matching sections override. Returns {found, props}. `opts.unbounded` skips the cwd stop,
// walking all the way to the filesystem root instead -- real .editorconfig resolution (and
// prettier's own internal `editorconfig: true` lookup) has no project-boundary concept, only
// root=true/filesystem-root; the printWidth guard needs that same unbounded scope to avoid
// missing a real max_line_length set above cwd (a workspace/monorepo case). ruff/black's
// tool-native-config mapping stays cwd-bounded (the default) -- unrelated concern, unchanged.
export function resolveEditorconfig(file: string, cwd: string, opts: { unbounded?: boolean } = {}): { found: boolean; props: EditorConfigProps } {
  const { unbounded = false } = opts;
  const basename = path.basename(file);
  const parsed: Array<{ root: boolean; sections: Array<{ glob: string; props: Record<string, string> }> }> = []; // nearest-first as we ascend
  let dir = path.dirname(file);
  for (;;) {
    const p = path.join(dir, ".editorconfig");
    if (existsSync(p)) {
      let text: string | undefined;
      try {
        text = readFileSync(p, "utf8");
      } catch {
        /* unreadable .editorconfig -> treat as absent: do not push a phantom empty entry */
      }
      if (text !== undefined) {
        const pf = parseEditorconfig(text);
        parsed.push(pf);
        if (pf.root) break; // stop climbing at root=true
      }
    }
    if (!unbounded && dir === cwd) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (parsed.length === 0) return { found: false, props: {} };
  const raw: Record<string, string> = {};
  for (const pf of parsed.slice().reverse()) {
    // farthest-first so nearer wins
    for (const section of pf.sections) {
      if (matchGlob(section.glob, basename)) Object.assign(raw, section.props);
    }
  }
  return { found: true, props: normalizeProps(raw) };
}

// Parse .editorconfig INI text into { root, sections:[{glob, props}] }. Comments (# / ;) and
// blanks ignored. Keys before the first [section] contribute root=true only.
export function parseEditorconfig(text: string): { root: boolean; sections: Array<{ glob: string; props: Record<string, string> }> } {
  let root = false;
  const sections: Array<{ glob: string; props: Record<string, string> }> = [];
  let current: { glob: string; props: Record<string, string> } | null = null;
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith(";")) continue;
    const sec = s.match(/^\[(.*)\]$/);
    if (sec) {
      current = { glob: sec[1].trim(), props: {} };
      sections.push(current);
      continue;
    }
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim().toLowerCase();
    const value = s.slice(eq + 1).trim();
    if (!current) {
      if (key === "root") root = value.toLowerCase() === "true";
      continue;
    }
    current.props[key] = value;
  }
  return { root, sections };
}

// Match an editorconfig section glob against a file basename, supporting only the separatorless
// subset *, *.ext, *.{a,b}, **.ext. Any unsupported form (path separator, charset [], negation !,
// brace range {n..m}) -> false (fail toward "no mapping").
export function matchGlob(glob: string, basename: string): boolean {
  const re = globToRegExp(glob);
  return re ? re.test(basename) : false;
}

function globToRegExp(glob: string): RegExp | null {
  if (glob.includes("/") || glob.includes("[") || glob.includes("]") || glob.includes("!")) return null;
  if (/\{[^}]*\.\.[^}]*\}/.test(glob)) return null; // brace range {1..9}
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) return null;
      const parts = glob
        .slice(i + 1, end)
        .split(",")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      re += "(?:" + parts.join("|") + ")";
      i = end;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}

// Normalize raw string props to typed EditorConfigProps (lowercased styles; positive integers
// only — a non-numeric, zero, negative, or fractional value is dropped rather than mapped to a
// formatter flag). An explicit `max_line_length = off` is dropped entirely, i.e. treated the same
// as "not set".
function normalizeProps(raw: Record<string, string>): EditorConfigProps {
  const out: EditorConfigProps = {};
  if (raw.indent_style) out.indent_style = raw.indent_style.toLowerCase();
  if (raw.indent_size !== undefined) {
    const v = raw.indent_size.toLowerCase();
    if (v === "tab") out.indent_size = "tab";
    else {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) out.indent_size = n;
    }
  }
  if (raw.max_line_length !== undefined) {
    const v = raw.max_line_length.toLowerCase();
    if (v !== "off") {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) out.max_line_length = n;
    }
  }
  if (raw.end_of_line) out.end_of_line = raw.end_of_line.toLowerCase();
  return out;
}
