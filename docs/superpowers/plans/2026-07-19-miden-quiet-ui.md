# Miden Quiet UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a neutral, ChatGPT-like Miden bridge design system with first-class light/dark/system themes and a mobile bridge flow whose menus, review sheet, and primary action remain reachable without covering content.

**Architecture:** Keep the existing bespoke bridge state and wallet components. Add a narrowly scoped `next-themes` provider and theme control, convert global CSS to semantic light/dark variables, add minimal bridge markup hooks for mobile sheets and the action dock, and verify interaction geometry through the existing mock Playwright tier.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4 global tokens, `next-themes`, Lucide React, Vitest, Playwright.

## Global Constraints

- Work only in `/Users/brianseong/Develop/Miden/Projects/worktrees/bridge-portal/miden-quiet-ui` on `brian/miden-quiet-ui`.
- Preserve all bridge protocol, quote, wallet adapter, transaction, persistence, and activity state behavior.
- Support 360 px minimum width; use 390 x 844 as the primary mobile review viewport and 1440 x 1000 as desktop review viewport.
- Use the exact theme tokens in `docs/superpowers/specs/2026-07-19-miden-quiet-ui-design.md`.
- Primary actions are neutral; Miden orange is reserved for focus, active route/progress, and testnet identity.
- Controls are at least 44 px on touch layouts; the mobile action dock must not overlap quote rows, errors, or the route disclaimer.
- Animate structural changes with transform and opacity only; honor `prefers-reduced-motion`.
- Do not add OpenAI branding, AI/chat components, perpetual animation, decorative gradients, glassmorphism, or a broad UI-library migration.
- Keep current Lucide icons; do not add another icon package.
- Every task runs its focused tests before commit; final verification runs lint, typecheck, unit tests, build, mock E2E, and visual screenshots.

---

### Task 1: Theme foundation and accessible theme control

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/components/ThemeProvider.tsx`
- Create: `src/app/components/ThemeToggle.tsx`
- Modify: `src/app/components/Providers.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Test: `e2e/tests/mock/theme.spec.ts`

**Interfaces:**
- Produces: `ThemeProvider({ children }: { children: ReactNode })`
- Produces: `ThemeToggle({ className?: string }: { className?: string })`
- `ThemeToggle` renders a button named `Theme: <selected label>` and a `role="menu"` containing `role="menuitemradio"` choices for `Light`, `Dark`, and `System` with exactly one `aria-checked="true"`.

- [ ] **Step 1: Write the failing theme E2E test**

Create `e2e/tests/mock/theme.spec.ts` with assertions that the theme trigger is visible, the three radio menu items are keyboard reachable, choosing Dark adds `.dark` to `<html>`, reload preserves it, choosing Light removes `.dark`, and choosing System exposes `aria-checked="true"` while emulated system color scheme controls the effective root class. Use the existing `bridge` fixture and wait for `bridge.waitForReady()` before interaction.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/tests/mock/theme.spec.ts --config playwright.mock.config.ts`

Expected: FAIL because no accessible theme trigger exists.

- [ ] **Step 3: Add the dependency and provider**

Run: `npm install next-themes@latest --save --cache /private/tmp/bridge-portal-npm-cache`

Create a client component wrapping `next-themes`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

Wrap the existing wallet providers inside this provider, without moving wallet setup or changing cookies.

- [ ] **Step 4: Implement the theme control**

Build `ThemeToggle` as an isolated client component using `useTheme`, `Sun`, `Moon`, `Monitor`, and `Check`. Avoid rendering a theme-dependent icon until mounted. The trigger toggles an accessible radio menu, closes on Escape and outside pointer down, and restores focus to the trigger. Arrow keys move among choices; Enter and Space call `setTheme("light" | "dark" | "system")`. The accessible trigger label reports the persisted choice, not only the resolved light/dark class.

- [ ] **Step 5: Make document metadata theme-aware**

Add `suppressHydrationWarning` to `<html>`. Replace the single theme color with:

```tsx
themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
  { media: "(prefers-color-scheme: dark)", color: "#171716" },
],
colorScheme: "light dark",
```

- [ ] **Step 6: Add the exact semantic tokens and control styles**

Replace the light-only root tokens with the spec values. Add `.dark` semantic overrides, `color-scheme`, `--primary`, `--primary-foreground`, overlay/scrim variables, theme-menu styles, 44 px trigger targets, semantic focus/selection, and remove the page radial gradient.

- [ ] **Step 7: Run focused verification**

Run: `npm run typecheck && npm run lint && npx playwright test e2e/tests/mock/theme.spec.ts --config playwright.mock.config.ts`

Expected: typecheck and lint exit 0; theme test passes.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/app/components/ThemeProvider.tsx src/app/components/ThemeToggle.tsx src/app/components/Providers.tsx src/app/layout.tsx src/app/globals.css e2e/tests/mock/theme.spec.ts
git commit -m "feat(theme): add semantic light and dark modes"
```

### Task 2: Responsive bridge shell, mobile route sheet, and action dock

**Files:**
- Modify: `src/app/components/BridgeExperience.tsx`
- Modify: `src/app/globals.css`
- Modify: `e2e/pages/bridge-page.ts`
- Create: `e2e/tests/mock/mobile-layout.spec.ts`

**Interfaces:**
- Consumes: `ThemeToggle` from Task 1.
- Produces: `.topbar-actions`, `.route-menu-root[data-open]`, `.route-sheet-backdrop`, `.route-options-layer`, `.route-options-list`, and `.primary-action-dock` layout hooks.
- Preserves: `.route-trigger`, `.route-options-menu`, `.route-option`, `.primary-button`, and `.preflight-overlay` selectors used by existing tests.

- [ ] **Step 1: Write failing mobile geometry and interaction tests**

At a 390 x 844 viewport, assert:

1. the header renders brand/theme on the first row and both wallet pills without horizontal overflow;
2. opening Route makes the labelled route dialog fixed at the viewport bottom, shows `.route-sheet-backdrop`, and contains the existing `role="listbox"`;
3. Escape closes the route sheet and restores focus to `.route-trigger`;
4. `.primary-action-dock` does not intersect `.quote-summary` or `.route-disclaimer` by comparing bounding boxes;
5. document width does not exceed viewport width at 360 and 390 px.

- [ ] **Step 2: Run the mobile test to verify it fails**

Run: `npx playwright test e2e/tests/mock/mobile-layout.spec.ts --config playwright.mock.config.ts`

Expected: FAIL because the theme/header hooks, fixed route sheet, backdrop, and action dock do not exist.

- [ ] **Step 3: Add minimal structural hooks**

Import and render `ThemeToggle`. Group desktop header actions in `.topbar-actions`. Set `data-open={routeMenuOpen}` on `.route-menu-root`; render a button `.route-sheet-backdrop` with `aria-label="Close route menu"` while open; wrap the route list in a labelled `.route-options-layer` dialog containing `.route-options-list[role="listbox"]`; wrap the primary CTA in `.primary-action-dock`. Add `aria-controls` from trigger to listbox. Store the route trigger and restore focus whenever selection, Escape, or backdrop closes the menu. Trap focus within the mobile dialog. Set `document.body.dataset.overlayOpen` while the route or preflight sheet is open and restore prior body overflow/scroll state during cleanup.

- [ ] **Step 4: Restyle the desktop bridge around quiet neutral hierarchy**

Use a 500 px maximum bridge card, 14 px panel radius, semantic border/surface, restrained shadow, no hover lift, neutral primary button, and quote rows separated by borders instead of inset sub-cards. Preserve visual dominance of the two transfer legs and keep route details readable.

- [ ] **Step 5: Implement the mobile shell at 640 px and below**

Use safe-area-aware 12 px page gutters, near-edge card treatment, equal wallet tracks, compact transfer legs, full-width mono destination inputs, no horizontal overflow, and 44 px targets for wallet, balance, refresh, route, menu, and secondary controls. Convert `.route-options-layer` to a fixed bottom sheet with `max-height: min(72dvh, 560px)`, safe-area padding, rounded top corners, a visual handle, scrim, and translate/opacity entry. Body overflow is locked while any sheet is open. Add mobile activity-row rules that place summary/status on line one and amount/time on line two without ellipsis-driven information loss.

- [ ] **Step 6: Replace overlapping sticky CTA with a reserved action dock**

Keep `.primary-action-dock` in normal flow with reserved padding, then make only the dock sticky. Give it an opaque semantic background and safe-area bottom padding. Ensure its own button is `position: static`; it may not cover `.quote-summary`, `.form-error`, or `.route-disclaimer` at any tested viewport.

- [ ] **Step 7: Run focused verification**

Run: `npm run typecheck && npm run lint && npx playwright test e2e/tests/mock/mobile-layout.spec.ts e2e/tests/mock/cta-preflight.spec.ts --config playwright.mock.config.ts`

Expected: all commands exit 0 and both focused E2E files pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/BridgeExperience.tsx src/app/globals.css e2e/pages/bridge-page.ts e2e/tests/mock/mobile-layout.spec.ts
git commit -m "design(bridge): rebuild the responsive mobile flow"
```

### Task 3: Mobile preflight sheet, activity styling, and motion polish

**Files:**
- Modify: `src/app/components/BridgeExperience.tsx`
- Modify: `src/app/components/ActivityDetail.tsx`
- Modify: `src/app/globals.css`
- Create: `e2e/tests/mock/responsive-preflight.spec.ts`

**Interfaces:**
- Consumes: semantic theme tokens and `.primary-action-dock` from Tasks 1-2.
- Produces: `.preflight-panel` as centered desktop dialog and mobile bottom sheet without changing the dialog's labels or submit behavior.
- Produces: `ThemeToggle` on the activity header.

- [ ] **Step 1: Write failing responsive preflight tests**

At 390 x 844, fill a valid Agglayer transfer and open review. Assert the overlay is fixed to the viewport, the panel is bottom aligned, panel height is at most the viewport, confirmation remains visible after scrolling the receipt, body scroll is locked, every sheet action has a 44 px target, Tab and Shift+Tab remain inside the dialog, Escape closes the sheet, and focus returns to the bridge CTA. At 1024 px, assert the panel is centered rather than bottom aligned.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/tests/mock/responsive-preflight.spec.ts --config playwright.mock.config.ts`

Expected: FAIL because the current dialog is card-scoped and does not restore focus.

- [ ] **Step 3: Complete dialog focus behavior**

Add a ref for the bridge CTA. On open, save the previously focused element; on close from cancel, Escape, close button, or backdrop, restore focus. Add a Tab/Shift+Tab trap covering the close, inspect, cancel, and confirm buttons. Keep initial focus on confirmation. Make close, inspect, cancel, and confirm targets at least 44 px.

- [ ] **Step 4: Convert mobile review to a bottom sheet**

Below 640 px, make `.preflight-overlay` fixed with `inset: 0`, align items to end, remove card radius from the scrim, and animate the panel from `translateY(18px)` to zero. Limit panel to `min(88dvh, 720px)`. Keep receipt rows in an internal scroll region and make `.preflight-actions` sticky at the bottom with safe-area padding and semantic surface.

- [ ] **Step 5: Apply the theme system to activity detail**

Render `ThemeToggle` beside `New transfer`. Replace translucent white receipt materials, hard-coded white icons, dashed light-only borders, and oversized radii with semantic tokens. Use neutral surfaces, 14 px panels, and orange only for current progress. On mobile, maintain safe-area-aware 12 px gutters, wrap long values, and ensure all actions are at least 44 px. Remove `aria-live` from the full milestone list and keep one concise polite status announcement. Where a destination or transaction hash is shown, pair its truncated presentation with explicit 44 px Show/Hide and Copy actions whose accessible names contain the value type.

- [ ] **Step 6: Polish motion and reduced motion**

Use 140 ms control feedback, 180-220 ms menu/mode transitions, and 240-300 ms sheets. Animate only opacity and transform. Remove card hover lift and any non-state perpetual motion other than the existing active progress pulse; remove that pulse in reduced-motion mode.

- [ ] **Step 7: Run focused verification**

Run: `npm run typecheck && npm run lint && npx playwright test e2e/tests/mock/responsive-preflight.spec.ts e2e/tests/mock/cta-preflight.spec.ts --config playwright.mock.config.ts`

Expected: all commands exit 0 and focused E2E files pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/BridgeExperience.tsx src/app/components/ActivityDetail.tsx src/app/globals.css e2e/tests/mock/responsive-preflight.spec.ts
git commit -m "design(mobile): add responsive review and activity surfaces"
```

### Task 4: Full regression and visual verification

**Files:**
- Modify if required by findings: `src/app/globals.css`
- Modify if required by findings: `src/app/components/ThemeToggle.tsx`
- Modify if required by findings: `src/app/components/BridgeExperience.tsx`
- Modify if required by findings: `src/app/components/ActivityDetail.tsx`
- Modify if required by findings: `e2e/tests/mock/theme.spec.ts`
- Modify if required by findings: `e2e/tests/mock/mobile-layout.spec.ts`
- Modify if required by findings: `e2e/tests/mock/responsive-preflight.spec.ts`

**Interfaces:**
- Validates the complete branch; introduces no new product behavior.

- [ ] **Step 1: Run the complete static and unit gates**

Run separately:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: every command exits 0; Vitest reports 74 or more passing tests.

- [ ] **Step 2: Run the complete deterministic browser tier**

Run: `npm run test:e2e:mock`

Expected: every mock test passes with no retries.

- [ ] **Step 3: Capture light and dark visual evidence**

Run the built app with the mock E2E environment and capture full-page screenshots after the `Bridge` heading is visible at 360 x 800, 390 x 844, 768 x 1024, and 1440 x 1000. Capture both light and dark themes, plus mobile route sheet and preflight sheet states.

- [ ] **Step 4: Perform geometry and visual checks**

For each screenshot confirm: no horizontal clipping; wallet pills remain legible; route sheet and preflight sheet honor safe areas; action dock covers no content; dark surfaces retain visible borders and semantic warnings; desktop remains compact; no decorative glow or hover-lift material remains.

- [ ] **Step 5: Fix only verified regressions and rerun their covering test**

Any fix must include the exact focused E2E or static command that covers it, followed by the complete mock tier if behavior changed.

- [ ] **Step 6: Commit final polish if needed**

```bash
git add src/app e2e package.json package-lock.json
git commit -m "test(ui): verify responsive theme behavior"
```

Do not create an empty commit when no final changes are needed.
