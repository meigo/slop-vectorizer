# slop-vectorizer — Prettier + ESLint (tooling)

**Date:** 2026-08-08
**Status:** Approved (conventions matched to slop-paint; ESLint scope decided TS/JS-only)

## Prettier

- Dev deps: `prettier`, `prettier-plugin-svelte`.
- `.prettierrc`: `semi: false`, `singleQuote: true`, `printWidth: 100`, svelte plugin with `parser: svelte` override for `*.svelte` — chosen to match the repo's existing style so the one-time reformat is minimal.
- `.prettierignore`: `dist/`, `package-lock.json`, `docs/`, `fixtures/`, `.claude/`, `.superpowers/`.
- Scripts: `format` (`prettier --write .`), `format:check` (`prettier --check .`).
- One-time `format` run lands as its own `style:` commit.

## ESLint

- Dev deps: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`.
- `eslint.config.js` flat config mirroring slop-paint: `eslint.configs.recommended` + `tseslint.configs.recommended`, warn-level `@typescript-eslint/no-unused-vars` (argsIgnorePattern `^_`), `@typescript-eslint/no-explicit-any`, `no-constant-condition`, `prefer-const`; `eslint-config-prettier` last; ignores `dist/`, `**/*.svelte` (components stay covered by svelte-check in `npm run check`), `docs/`, `.claude/`.
- Script: `lint` (`eslint .`).
- Pre-existing lint findings in the codebase are REPORTED, not mass-fixed in this change (surgical-change rule); fixes are a separate decision.

## Acceptance

`npm run lint`, `npm run format:check`, `npx vitest run` (70), `npm run check`, `npm run build` all runnable and green after the format commit (lint may emit warnings — zero errors required).
