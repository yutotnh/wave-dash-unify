// @ts-check

const js = require("@eslint/js");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");
const nPlugin = require("eslint-plugin-n");

module.exports = [
  {
    ignores: ["out/**", "dist/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/strict-type-checked"],
  ...tsPlugin.configs["flat/stylistic-type-checked"],
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 6,
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/naming-convention": "warn",
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
    },
  },
  {
    // Code that runs inside the VS Code Extension Host is bound by the
    // Node.js version bundled by the OLDEST supported VS Code
    // (engines.vscode), not by .nvmrc. engines.vscode: "^1.66.0" -> VS Code
    // 1.66.0 bundles Electron 17.2.0 -> Electron 17.2.0 bundles Node.js
    // v16.13.0 (see Electron's DEPS file). Guard against accidentally using
    // Node 18+-only builtins (structuredClone, fs.cp, Array#at, etc.) that
    // tsc alone would not catch, since @types/node intentionally tracks
    // .nvmrc (see .github/dependabot.yml) rather than this runtime floor.
    files: [
      "src/extension.ts",
      "src/debounce.ts",
      "src/eucjp.ts",
      "src/test/suite/**/*.ts",
    ],
    plugins: { n: nPlugin },
    rules: {
      "n/no-unsupported-features/node-builtins": [
        "error",
        { version: ">=16.13.0" },
      ],
      "n/no-unsupported-features/es-builtins": [
        "error",
        { version: ">=16.13.0" },
      ],
    },
  },
  {
    // src/test/runTest.ts is the dev/CI-machine test launcher (run via
    // `node ./out/test/runTest.js`, never inside the Extension Host), so it
    // is bound by .nvmrc's Node.js version (currently 24.x), not by the
    // Extension Host floor above. The floor is set to the version that
    // introduced util.parseArgs (18.3.0) rather than .nvmrc's current major,
    // since that is the actual minimum this file's code requires.
    // allowExperimental is needed because parseArgs was flagged
    // "experimental" until Node 20.0.0; that stability label doesn't matter
    // here since dev/CI machines always run .nvmrc's Node (currently far
    // newer than 20), so it never actually executes in an
    // experimental-only Node.
    files: ["src/test/runTest.ts"],
    plugins: { n: nPlugin },
    rules: {
      "n/no-unsupported-features/node-builtins": [
        "error",
        { version: ">=18.3.0", allowExperimental: true },
      ],
    },
  },
  prettierConfig,
];
