import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["node_modules/**", "data/**", "coverage/**", "public/css/**"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: globals.node,
    },
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      sourceType: "script",
      ecmaVersion: "latest",
      globals: globals.browser,
    },
  },
  eslintConfigPrettier,
];
