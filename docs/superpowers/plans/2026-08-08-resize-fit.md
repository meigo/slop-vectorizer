# Resize Refit (fit-until-touched) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (single small task, inline execution approved by user). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-refit the compare view on pane-geometry changes (window resize, mode/column flips) until the user manually zooms or pans, per the v1.3.1 addendum in `docs/superpowers/specs/2026-08-08-fullscreen-ui-design.md`.

**Architecture:** `touched` flag on the existing `Viewport` class; one new `$effect` in App keyed on pane geometry + the flag.

**Tech Stack:** existing (Svelte 5 runes, TS strict).

## Global Constraints

- No pipeline changes; suite stays 70 green unchanged; `npm run check` 0 errors (1 pre-existing warning); build green.
- Work on branch `feature/resize-fit` off main (no worktree — user preference).

---

### Task 1: touched flag + geometry-keyed refit effect

**Files:**
- Modify: `src/lib/viewport.svelte.ts`, `src/App.svelte`

- [ ] **Step 1: Viewport flag**

In `viewport.svelte.ts`: add `touched = $state(false)`; set `this.touched = true` as the first line of `wheelAt()` and `panBy()`; set `this.touched = false` as the last line of `fitTo()`.

- [ ] **Step 2: App refit effect**

In `App.svelte`, after the existing dimension-keyed fit effect, add:

```ts
// Auto-refit on pane-geometry changes (resize, mode/column flips) until the
// user manually zooms/pans; Fit and new-image fits re-arm via fitTo().
$effect(() => {
  void viewsW; void viewsH; void twoColumn
  if (!viewport.touched && displayImage && viewsW > 0) fit()
})
```

(`twoColumn` is the existing derived controlling side-by-side vs split columns; referencing it makes the split-mode result-arrival flip refit too. If the variable name differs, read App.svelte and use the actual derived.)

- [ ] **Step 3: Verify**

`npx vitest run` (70), `npm run check`, `npm run build`, dev-server curl smoke. Manual QA (human): resize window before touching → view follows; wheel-zoom then resize → view stays; Fit → resize follows again; split-mode new image no longer stuck at half-width fit.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: auto-refit on resize until view is touched"`

---

## Self-review notes

Spec addendum coverage complete: flag semantics (set/clear points), single geometry effect, re-arm paths, parked-edge resolution. Effect reads `viewport.touched` reactively — becoming untouched (via Fit) with unchanged geometry re-runs the effect and fits once more, which is idempotent (fit of a fit is the same view).
