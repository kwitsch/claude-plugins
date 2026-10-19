// registry.ts — extension/language map and the CLI formatter chains. REGISTRY holds ONLY the
// non-prettier languages: prettier is never spawned as a subprocess, so it has no chain, no
// npmSpec and no guardPrintWidth entry. EXT_MAP still maps the thirteen prettier languages, so
// formatPre dispatches on PRETTIER_LANGS first and only then looks a language up here.
import path from "node:path";
import type { EditorConfigProps, FormatTool, LangEntry } from "./types.js";
import { buildInvocation, findNativeConfig, resolveEditorconfig } from "./editorconfig.js";
import { onPath } from "./util.js";

// Lowercased file extension (incl. leading dot) -> language key.
export const EXT_MAP: Record<string, string> = {
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
  ".json": "json",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".html": "html",
  ".htm": "html",
  ".vue": "vue",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".php": "php",
  ".rs": "rust",
};

/** Languages the bundled prettier owns, in-process. */
export const PRETTIER_LANGS: Set<string> = new Set(["jsts", "json", "yaml", "markdown", "css", "scss", "less", "html", "vue", "graphql", "shell", "java", "php"]);

// Formatter registry (research-verified against each tool's docs and, for every tool, a local run
// in stdin mode). chain = first tool on PATH wins. strategy "native"/"fixed" -> always run bare
// (base args); "mapped" -> .editorconfig flag mapping applied only when no tool-native config
// governs. The content goes in on stdin and comes back on stdout; `stdinArgs(file)` is the tail
// that switches each tool into that mode and names the real path so pyproject.toml/.ruff.toml,
// .editorconfig and goimports' module context are resolved exactly as for the file on disk.
export const REGISTRY: Record<string, LangEntry> = {
  kotlin: {
    chain: [
      {
        name: "ktlint",
        strategy: "native",
        base: ["--format", "--log-level=none"],
        stdinArgs: (file) => ["--stdin", "--stdin-path", file],
        // 1 = "reformatted, but violations ktlint cannot fix remain" -- stdout still holds the whole
        // formatted file. A syntax error is exit 0 with EMPTY stdout (caught by the empty-stdout rule).
        okExit: [0, 1],
      },
      {
        name: "ktfmt",
        strategy: "native",
        base: ["--enable-editorconfig", "--quiet"],
        // .editorconfig resolution through --stdin-name needs ktfmt >= 0.65; older ktfmt formats
        // stdin with its default style (documented in the README).
        stdinArgs: (file) => [`--stdin-name=${file}`, "-"],
      },
    ],
  },
  python: {
    chain: [
      {
        name: "ruff",
        strategy: "mapped",
        nativeConfig: [".ruff.toml", "ruff.toml", { file: "pyproject.toml", section: "tool.ruff" }],
        base: ["format", "--quiet"],
        stdinArgs: (file) => ["--stdin-filename", file, "-"],
      },
      {
        name: "black",
        strategy: "mapped",
        nativeConfig: [{ file: "pyproject.toml", section: "tool.black" }],
        base: ["--quiet"],
        // exit 123 (parse error) echoes the UNFORMATTED input on stdout: only exit 0 may be trusted.
        stdinArgs: (file) => ["--stdin-filename", file, "-"],
      },
    ],
  },
  go: {
    chain: [
      // -srcdir "may instead be the complete file name" (goimports -h): import grouping then sees the
      // file's own module, which it cannot from stdin alone.
      { name: "goimports", strategy: "fixed", base: [], stdinArgs: (file) => ["-srcdir", file] },
      { name: "gofmt", strategy: "fixed", base: [], stdinArgs: () => [] },
    ],
  },
  // rust: no viable prettier plugin formats Rust source (survey, not deferral). rustfmt has no path
  // flag for stdin: it finds rustfmt.toml by walking up from cwd, hence spawnCwd "fileDir". Strategy
  // "mapped" gives .rs the same .editorconfig parity as python.
  rust: {
    chain: [
      {
        name: "rustfmt",
        strategy: "mapped",
        nativeConfig: ["rustfmt.toml", ".rustfmt.toml"],
        base: [],
        stdinArgs: () => [],
        spawnCwd: "fileDir",
      },
    ],
  },
};

// Determine the formatter invocation for a resolved tool. native/fixed -> bare. mapped -> if a
// tool-native config governs the file, bare; else resolve .editorconfig for this file and
// map/skip via buildInvocation.
export function resolveInvocation(tool: FormatTool, file: string, cwd: string): { argv: string[] } | { skip: true } {
  if (tool.strategy !== "mapped") return buildInvocation(tool);
  const hasNativeConfig = findNativeConfig(path.dirname(file), cwd, tool.nativeConfig ?? []);
  let editorconfig: EditorConfigProps | null = null;
  if (!hasNativeConfig) {
    const ec = resolveEditorconfig(file, cwd);
    if (ec.found) editorconfig = ec.props;
  }
  return buildInvocation(tool, { hasNativeConfig, editorconfig });
}

// Try each formatter in the language's chain, in order: skip a tool that isn't on PATH, or whose
// resolveInvocation reports a hard style conflict (skip:true), and fall through to the next chain
// entry rather than aborting. Returns the first {tool, argv} that can actually run -- argv complete
// with the tool's stdin tail -- or null. One pass only: there is no package-runner second pass.
export function selectFormatter(chain: FormatTool[], file: string, cwd: string): { tool: FormatTool; argv: string[] } | null {
  for (const tool of chain) {
    if (!onPath(tool.name)) continue;
    const inv = resolveInvocation(tool, file, cwd);
    if ("skip" in inv) continue;
    return { tool, argv: [...inv.argv, ...tool.stdinArgs(file)] };
  }
  return null;
}
