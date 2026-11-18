import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // Workflow-tool scripts run inside an implicit async wrapper (top-level
    // `await`/`return` are valid there) — not parseable as a standalone module.
    // Synced plugins are minified build output from kwitsch/claude-plugins-development; linting
    // it is meaningless (`max-len: 200` alone floods it with errors).
    ignores: [
      "**/*.workflow.js",
      "plugins/dprint/**",
      "plugins/inline-headroom/**",
      "plugins/universal-lint/**",
      "plugins/universal-format/**",
      "plugins/jevfort/**",
      "plugins/jev-api/**",
      "plugins/graphmind-helper/**",
      "plugins/rc-enhancement/**",
    ],
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
