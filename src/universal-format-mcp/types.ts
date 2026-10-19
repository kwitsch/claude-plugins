// types.ts — shared type aliases for the universal-format MCP server sources.
// Type-only module: `bun build` elides it entirely.

/** One formatter in a language's chain. The tool is fed the would-be file content on stdin and
 * its stdout becomes the content that is written; nothing is ever run against the file on disk. */
export type FormatTool = {
  name: string;
  strategy: "native" | "fixed" | "mapped";
  /** argv that precedes the mapped .editorconfig flags (never the target file). */
  base: string[];
  nativeConfig?: Array<string | { file: string; section: string }>;
  /** argv tail that makes the tool read stdin, print to stdout and resolve its project config as if
   * the input lived at `file` (the real, absolute path of the file being written). */
  stdinArgs: (file: string) => string[];
  /** Exit codes whose stdout IS the fully formatted content; `[0]` when omitted. */
  okExit?: number[];
  /** Working directory of the spawn: the project base (default), or the file's own directory for a
   * tool whose config search walks up from cwd rather than from a path flag. */
  spawnCwd?: "base" | "fileDir";
};

/** A language's formatter chain (first tool on PATH wins). */
export type LangEntry = { chain: FormatTool[] };

/** The .editorconfig properties this plugin understands. `indent_size` is a validated positive
 * integer or the literal "tab" — see editorconfig.ts's normalizeProps. */
export type EditorConfigProps = {
  indent_style?: string;
  indent_size?: number | "tab";
  max_line_length?: number;
  end_of_line?: string;
};
