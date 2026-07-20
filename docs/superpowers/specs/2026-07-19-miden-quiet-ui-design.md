# Miden Quiet UI design

## Intent

Modernize the bridge portal around the calm, precise qualities of ChatGPT's product UI without copying OpenAI branding. The interface remains recognizably Miden through its logo, orange accent, and protocol-specific language, while neutral surfaces and clearer state hierarchy make transfers feel safer.

Mobile is a primary layout, not a compressed desktop card. The 390 x 844 viewport is the baseline mobile review size; 360 px is the minimum supported width. Desktop remains focused at 480-520 px rather than expanding into dashboard chrome.

## Design principles

1. **Neutral hierarchy.** Primary actions use high-contrast neutral colors. Miden orange is reserved for focus, active route markers, progress, and testnet identity.
2. **Quiet materiality.** Use borders and tonal surface changes before shadows. Remove the page glow, card hover lift, and oversized 28 px radii.
3. **Financial clarity.** Amounts, hashes, addresses, fees, and timestamps use Geist Mono or tabular figures. Warnings stay visible before confirmation.
4. **State over decoration.** Animation explains state changes: route/mode transitions, menu entry, review-sheet entry, and progress. There is no perpetual decorative motion.
5. **Mobile reachability.** Controls have at least 44 px touch targets. The primary action stays reachable without covering content, honors the safe area, and never traps the warning underneath it.

## Theme system

Use `next-themes` with class-based themes, `defaultTheme="system"`, `enableSystem`, and `disableTransitionOnChange`. The root document uses `suppressHydrationWarning` because the theme class is client-resolved.

Semantic variables replace light-only component colors. Tokens are defined in `:root` and `.dark`:

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | `#f4f7f5` | `#0d1210` |
| `--surface` | `#ffffff` | `#141b18` |
| `--surface-muted` | `#edf3f0` | `#1b2521` |
| `--surface-strong` | `#e2ece7` | `#24302b` |
| `--foreground` | `#17201c` | `#f1f6f3` |
| `--muted-foreground` | `#607069` | `#a1b0a8` |
| `--faint-foreground` | `#89958f` | `#718078` |
| `--border` | `rgba(23,32,28,.11)` | `rgba(241,246,243,.12)` |
| `--border-strong` | `rgba(23,32,28,.19)` | `rgba(241,246,243,.21)` |
| `--primary` | `#17201c` | `#f1f6f3` |
| `--primary-foreground` | `#ffffff` | `#0d1210` |
| `--accent` | `#ff5500` | `#ff6a2a` |

Success, warning, and danger tokens receive dark-mode variants with sufficient separation from their soft backgrounds. Native controls use the active color scheme. The static viewport publishes light and dark `themeColor` entries using media queries.

The palette is intentionally cool rather than gray: light mode uses a porcelain page with pale mint-mist secondary surfaces and crisp white transfer inputs; dark mode uses botanical green-black ink surfaces rather than charcoal gray. Miden orange remains the only saturated accent.

## Global shell and controls

- Keep Geist Sans and Geist Mono.
- Use a 10 px control radius, 14 px panel radius, and pills only for identities or status.
- The transfer card uses a one-pixel border and a restrained shadow. It does not lift on hover.
- Wallet controls, route controls, menus, inputs, activity rows, and detail panels use semantic surfaces rather than hard-coded white.
- The primary button is neutral high contrast. Disabled state remains clearly disabled in both themes.
- Add a compact theme control with accessible `Light`, `Dark`, and `System` choices. Its trigger lives beside the connected-wallet cluster on desktop and in the brand row on mobile.
- Preserve current wallet behavior, bridge state, copy, and route data.

## Responsive bridge flow

### Desktop

- Keep the bridge card between 480 and 520 px.
- Reduce visual nesting: the swap legs remain the dominant surfaces; quote information becomes border-separated rows rather than three inset cards.
- Route selection remains anchored to the card header and uses the existing accessible listbox behavior.
- The review surface remains a centered in-card dialog with an overlay.

### Mobile

- Header is two rows: brand plus theme control, then the two wallet identities in equal tracks.
- Card loses the floating-card impression and becomes a near-edge working surface with 12-16 px side gutters.
- Route control stays beside the title, but its option list becomes a viewport-safe bottom sheet below 640 px. It uses a dimmed backdrop, a drag-handle treatment, safe-area padding, and a short translate/opacity entrance.
- Transfer legs remain compact two-column rows. The amount retains visual priority without forcing labels or wallet identity to wrap unpredictably.
- Destination helper text is shortened visually and may wrap naturally; the input never overflows.
- Quote rows remain in normal flow.
- Primary action is placed in a sticky action dock with its own reserved flow space and opaque/blurred theme surface. The dock never overlaps quote rows, errors, or the route disclaimer.
- Preflight review becomes a true bottom sheet below 640 px. It has a fixed backdrop, maximum height based on `100dvh`, internal scrolling, a sticky action footer, and safe-area padding. Escape, backdrop click, and close button retain their current cancellation behavior.
- Activity rows collapse to a two-line layout: state and summary first, amount and time second. No horizontal clipping at 360 px.

## Motion

- Use CSS transform and opacity only for structural transitions.
- Control feedback: 140 ms; menus and mode changes: 180-220 ms; sheets: 240-300 ms.
- Mode switch retains the sliding indicator.
- Route/menu and review-sheet entrances use the standard easing curve.
- Initial card entrance is subtle and runs once.
- `prefers-reduced-motion: reduce` removes entrances, transform motion, pulsing, and smooth scrolling while preserving state changes.

## Activity detail

- Apply the same semantic tokens, radii, neutral primary hierarchy, and mobile gutters to the activity route.
- Timeline state uses Miden orange only for active progress; success, warning, and danger retain semantic colors.
- Recovery and next-action panels are distinct through borders and tone, not large shadows.
- On mobile, long hashes and destinations wrap or truncate with an explicit reveal/copy affordance; action controls remain at least 44 px tall.

## Accessibility and verification

- Theme trigger has an accessible name and exposes the selected theme.
- Light, dark, and system choices are keyboard reachable.
- Dialog and sheet surfaces keep `role="dialog"`, `aria-modal="true"`, focused confirmation, Escape cancellation, and focus restoration.
- No horizontal overflow at 360, 390, 768, or 1440 px.
- The sticky mobile action does not cover the disclaimer, error text, or quote summary.
- Existing unit and mock E2E behavior remains green.
- Add mock E2E coverage for theme selection persistence, dark-mode root class, mobile route sheet, mobile preflight sheet, and sticky-action non-overlap.

## Out of scope

- No bridge protocol, wallet adapter, quote, or transaction-state changes.
- No OpenAI branding, font, copy, or chat components.
- No broad component-library migration. Existing bespoke bridge controls are retained where they already encode domain behavior.
- No perpetual animation, glassmorphism, canvas effects, or decorative gradients.
