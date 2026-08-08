// types.ts — shared type aliases for the universal-format MCP server sources.
// Type-only module: `bun build` elides it entirely.

/** One formatter in a language's chain. No npmSpec/guardPrintWidth: prettier is never spawned. */
export type FormatTool = {
  name: string;
  strategy: "native" | "fixed" | "mapped";
  base: string[];
  nativeConfig?: Array<string | { file: string; section: string }>;
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
