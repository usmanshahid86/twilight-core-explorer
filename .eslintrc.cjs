// Shared ESLint config for the non-Next TypeScript workspaces (apps/api, apps/indexer, packages/*).
// apps/web has its own config (`next lint`, root:true) and is excluded here.
//
// Phase 13c-1 — WARN-ONLY first pass: this surfaces the general TypeScript/ESLint baseline as warnings
// so it cannot block CI while the codebase is brought under lint for the first time (these workspaces
// had no linter at all). Promotion of selected rules to `error` is a later pass. The load-bearing
// project invariants are HARD-FAIL *tests*, not lint rules — see boundary.test.ts (web boundary),
// the repo static-route guard test, openapi:check, and coverage.test.ts.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/generated/**',
    'apps/web/**', // web is linted by its own next config
    // packages/proto's descriptor artifacts (.pb/.json) and dist are non-.ts / covered by the dist+
    // generated ignores above; its hand-written src/index.ts IS linted (Codex 13c-1 review).
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs',
  ],
  rules: {
    // --- Warn-only baseline (13c-1): every rule that fires today is a warning, so `npm run lint`
    // --- exits 0 and the baseline is visible without blocking. Tighten to `error` in a later pass.
    'no-unused-vars': 'off', // superseded by the type-aware rule below
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-empty-function': 'warn',
    '@typescript-eslint/no-empty-interface': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/no-inferrable-types': 'warn',
    '@typescript-eslint/no-namespace': 'warn',
    'no-empty': 'warn',
    'no-constant-condition': 'warn',
    'no-useless-escape': 'warn',
    'no-control-regex': 'warn',
  },
};
