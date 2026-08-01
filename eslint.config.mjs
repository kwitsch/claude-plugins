import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
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
