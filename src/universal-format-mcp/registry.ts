// registry.ts — extension/language map and the CLI formatter chains. REGISTRY holds ONLY the
// non-prettier languages: prettier is never spawned as a subprocess, so it has no chain, no
// npmSpec and no guardPrintWidth entry. EXT_MAP still maps the thirteen prettier languages
// (format_pre needs them), which is exactly why formatPost carries a REGISTRY[lang] existence
// guard.
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
};

/** Languages the bundled prettier owns, entirely inside format_pre. */
export const PRETTIER_LANGS: Set<string> = new Set(["jsts", "json", "yaml", "markdown", "css", "scss", "less", "html", "vue", "graphql", "shell", "java", "php"]);

// Formatter registry (research-verified). chain = first tool on PATH wins.
// strategy "native"/"fixed" -> always run bare (base args); "mapped" -> .editorconfig flag
// mapping applied only when no tool-native config governs. base = argv BEFORE the target file
// (the file is always appended last).
export const REGISTRY: Record<string, LangEntry> = {
  kotlin: {
    chain: [
      {
        name: "ktlint",
        strategy: "native",
        base: ["--format", "--log-level=none"],
      },
      {
        name: "ktfmt",
        strategy: "native",
        base: ["--enable-editorconfig", "--quiet"],
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
      },
      {
        name: "black",
        strategy: "mapped",
        nativeConfig: [{ file: "pyproject.toml", section: "tool.black" }],
        base: ["--quiet"],
      },
    ],
  },
  go: {
    chain: [
      { name: "goimports", strategy: "fixed", base: ["-w"] },
      { name: "gofmt", strategy: "fixed", base: ["-w"] },
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
// entry rather than aborting. Returns the first {tool, argv} that can actually run, or null.
// One pass only: the second (package-runner) pass is gone along with npmSpec.
export function selectFormatter(chain: FormatTool[], file: string, cwd: string): { tool: FormatTool; argv: string[] } | null {
  for (const tool of chain) {
    if (!onPath(tool.name)) continue;
    const inv = resolveInvocation(tool, file, cwd);
    if ("skip" in inv) continue;
    return { tool, argv: inv.argv };
  }
  return null;
}
