// types.ts — shared type aliases for the universal-format MCP server sources.
// Type-only module: `bun build` elides it entirely.

/** One formatter in a language's chain. No npmSpec/guardPrintWidth: prettier is never spawned. */
export type FormatTool = {
  name: string;
  strategy: string;
  base: string[];
  nativeConfig?: Array<string | { file: string; section: string }>;
};

/** A language's formatter chain (first tool on PATH wins). */
export type LangEntry = { chain: FormatTool[] };

/** The .editorconfig properties this plugin understands. */
export type EditorConfigProps = {
  indent_style?: string;
  indent_size?: number | string;
  max_line_length?: number;
  end_of_line?: string;
};
