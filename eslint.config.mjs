import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Workflow-tool scripts run inside an implicit async wrapper (top-level
    // `await`/`return` are valid there) — not parseable as a standalone module.
    // universal-format's MCP server is a ~5.4 MB `bun build` bundle generated from
    // src/universal-format-mcp/; linting build output is meaningless and `max-len: 200`
    // alone would flood it with thousands of errors.
    ignores: ["**/*.workflow.js", "plugins/universal-format/mcp/server.mjs"],
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      // deprecated core rule (removal in 11.0.0), still valid to configure explicitly
      "max-len": ["error", { code: 200 }],
    },
  },
];
