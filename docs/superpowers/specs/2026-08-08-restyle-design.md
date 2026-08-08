# slop-vectorizer — Paint-dialect Restyle (v1.5)

**Date:** 2026-08-08
**Status:** Approved (brainstorming with visual companion; user selected mockup A of three family dialects, with two adjustments: compact theme toggle, Lucide icons)

## Direction

Visual-only restyle to slop-paint's design language: monochrome token system with light + dark themes, JetBrains Mono chrome, slim custom sliders, flush docked panel. No structural/behavioral changes beyond a theme-toggle button and icon swaps.

## Tokens (verbatim from slop-paint, as CSS custom properties in a new `src/app.css`)

Light (`:root`): surface #ffffff, surface-hover #f5f5f5, surface-active #ebebeb, border #e0e0e0, border-light #f0f0f0, text #222222, text-secondary #666666, text-muted #999999, canvas-bg #f5f5f5, accent #222222, accent-text #ffffff, selection #6688cc.
Dark (`.dark` on `<html>`): surface #1e1e1e, surface-hover #282828, surface-active #333333, border #383838, border-light #2a2a2a, text #e0e0e0, text-secondary #999999, text-muted #666666, canvas-bg #121212, accent #e0e0e0, accent-text #1e1e1e, selection #6688cc.
Naming: `--color-<name>`. All component styles reference tokens — no raw hex in components (exceptions: toast red #c0392b family, checkerboard tints).

## Global chrome (`src/app.css` + `index.html`)

- JetBrains Mono via Google Fonts link (weights 400/500/600/700) in index.html; `body { font-family: 'JetBrains Mono', ui-monospace, monospace; }`. Chrome text sizes ~11–12px.
- Paint's `input[type=range]` CSS verbatim: transparent 20px input, 3px track (border token, 1.5px radius), 12px round thumb (accent fill, 2px surface border, 1px border-token ring, scale 1.2 on :active). Include the -moz equivalents.
- Native `<select>`: ~30px height, border token, 6px radius, surface bg, text-secondary, 12px.
- Buttons: neutral default (surface bg, border token, text-secondary, 6px radius, hover surface-hover); active/selected state filled (accent bg, accent-text). Filled accent is reserved for the primary action (Download SVG).

## Theme switching

`src/lib/theme.svelte.ts`: `$state` theme ('light' | 'dark'), initialized from localStorage `theme` key, falling back to `prefers-color-scheme`; setting it toggles `.dark` on `document.documentElement` and persists. Toggle button in the panel header: ~28px ghost icon button, Lucide `Moon` (in light) / `Sun` (in dark).

## Icons

Dependency: `@lucide/svelte` (approved). Usage: theme toggle Moon/Sun; View section becomes compact icon buttons with `title` tooltips — `Columns2` (side by side), `SquareSplitHorizontal` (split), `Maximize` (Fit). Elsewhere text stays text.

## Component application (visual only)

- **ControlsPanel**: flush panel look (border-l token, surface bg); section labels 10px semibold uppercase letter-spaced text-secondary; compact View icon-button row; header row = app name (12px semibold) + theme toggle + New image (neutral); Download = filled accent; stats footer text-muted 10px; swatches keep 22px, border token, 4px radius, override ring uses selection token; reset-colors link uses selection token.
- **App**: panel border/bg via tokens; `.views` background canvas-bg; stage pill (surface-raised dark-tolerant: #333c is fine in both — restate as token-based: accent-ish neutral overlay), toast keeps red; empty-state dropzone centered on canvas-bg.
- **ImagePane / CompareView**: pane labels (surface bg token w/ opacity, text-secondary); checkerboard: light `#f0f0f0/#fff`, dark `#2a2a2a/#1e1e1e` (via tokens or `.dark` override); CompareView divider color → selection token.
- **Dropzone**: dashed border token, text-secondary, hover/drag state via selection token.

## Out of scope / unchanged

Layout structure, component props/behavior, pipeline, tests (suite must stay green unchanged), download filename, favicon.

## Verification

All five checks green; `npm run build`; visual QA by user in both themes.
