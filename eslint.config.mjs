import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Workflow-tool scripts run inside an implicit async wrapper (top-level
    // `await`/`return` are valid there) — not parseable as a standalone module.
    ignores: ["**/*.workflow.js"],
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
