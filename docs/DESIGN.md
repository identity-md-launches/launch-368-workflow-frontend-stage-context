# Lockvote design

## Overview

The implemented page serves Sepolia testers participating in a shared ETH treasury. Warm paper surfaces, dark green emphasis and a restrained typographic hierarchy keep balances, prerequisites and transactions readable. The treasury summary leads into a voting-power panel and proposal list, followed by rules and optional donations. This is the final implementation in `web/src/App.tsx` and `web/src/styles.css`, not a proposed system.

This document lives in `docs/` because the overriding write scope excludes repository-root `DESIGN.md`.

## Colors

All colors use the hex palette and semantic aliases at the start of `web/src/styles.css`.

| Semantic token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#faf9f6` | Page background |
| `--color-surface` | `#fffefa` | Forms, cards, dialog |
| `--color-text` | `#242c25` | Main text |
| `--color-muted` | `#646a61` | Hints and metadata |
| `--color-border` | `#deded3` | Dividers and card structure |
| `--color-field-border` | `#8a9185` | Interactive boundaries |
| `--color-accent` | `#183c32` | Primary action and treasury surface |
| `--color-on-accent` | `#ffffff` | Text on dark emphasis |
| `--color-highlight` | `#d9ed9b` | Treasury captions and selection |
| `--color-subtle` | `#e9efe3` | Active/success surfaces |
| `--color-success` | `#275341` | Active/executable/executed labels |
| `--color-error` | `#8a3026` | Errors and defeated/expired labels |
| `--color-error-bg` | `#faeae5` | Error/status background |
| `--color-focus` | `#436822` | Keyboard focus perimeter |

Neutral `#f0eee7` also fills summary cards, disabled controls and the segmented control. There is one light theme. States always include text. Computed rendered contrast measurements are in `evidence/contrast.json`: muted/page 5.28:1, muted/card 5.51:1, lime/treasury 9.55:1, white/treasury 12.13:1, green status 7.47:1 and red status 7.10:1. These measurements cover those pairs, not every possible browser rendering.

## Typography

The stack is `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; Inter is an optional locally installed face, not a downloaded dependency. Chromium on this worker used the available system fallback. No webfont or third-party font request is needed. CSS requests 400/500/600/650 weight, with synthesis disabled. Monospace values use `ui-monospace, SFMono-Regular, Consolas, monospace`.

Body defaults to 16px/1.55. The main heading is `clamp(2.6rem, 5.2vw, 4.5rem)`, weight 500, 1.15 line-height and negative tracking. Section headings use 1.5rem/600; card headings use 1.25rem/600, with compact voting-panel headings at 1.125rem. Rules heading is 2rem/500. Treasury numbers use 2.8rem (2.5rem on small screens); voting power uses 2rem. Numeric readouts use tabular figures and exact text amounts.

Buttons use .875rem, hints .8125rem, metadata .75rem, and short tracked uppercase eyebrows .6875rem (some .625rem on small screens). Inputs and textareas stay 1rem on all widths. Body content wraps naturally; headings use balanced wrapping, description copy uses pretty wrapping, and rules prose caps at 70ch. Addresses and hashes wrap anywhere rather than clipping. Full recipients/hashes are available in the page, and the abbreviated wallet address has a full-value title and explorer destination.

## Layout

Shared header, main and footer edges have a 1200px maximum width and 48px horizontal margins on a large screen. The spacing rhythm uses 8/16/24/32px steps with 40/56/58px section separations where implemented. `.row` wraps; `.spread` separates its ends.

The overview is a 1.45:1:1 grid. The workspace is a 340px participation panel plus a fluid proposal column, separated by 40px. The rules section uses a 300px title column and a fluid list. These are page arrangements, not requirements for unrelated future content.

- At 65rem: outer margins become 24px, workspace panel becomes 300px and gap 24px; the brand caption hides.
- At 48rem: overview treasury spans both columns, workspace stacks, participation can use two columns, header/footer wrap, and the decorative intro note hides.
- At 34rem: outer margins become 16px, participation stacks, network/wallet controls fill a new header row, notice text stacks, and donation buttons fill the row.

Browser checks covered 1440, 768 and 320 CSS pixels, full-length hashes and addresses, populated and empty states, and 200% root text enlargement at 768px without horizontal overflow. That text enlargement is not a native-browser zoom test. RTL/localized layouts were not tested; the product is English only. Directional spacing mostly uses logical properties.

## Elevation & Depth

Surfaces are mostly flat. One-pixel borders communicate card and field structure. The selected segment has a small `0 1px 4px #242c251a` shadow. Native modal dialog uses `#14281f99` backdrop dimming; it does not introduce a second navigation layer. The skip link appears above content when focused. There are no floating toolbars, parallax or entrance animations.

## Shapes

Cards use `--radius: 16px`, disclosures 10px, buttons/fields 8px, count labels 6px, and status badges 5px. The empty-state symbol uses a circle. Long data wraps inside its own card. Do not clip recipient addresses or transaction/error text for visual symmetry.

## Components

These are source patterns in `App.tsx`, not an exported component library:

- **Wallet controls:** connection, abbreviated explorer-linked account, disconnect, and a separate visible network-switch notice. Pending wallet operations disable repeated requests.
- **Overview:** treasury value with donation anchor, voting duration and quorum. Unread values use an em dash; actual empty state appears only after a successful read.
- **Participation panel:** live balance/allowance/unlock time, native buttons with `aria-pressed` for lock/unlock selection, labeled amount input and a full-width prerequisite-aware action. Approval and lock are separate calls.
- **Proposal card:** textual state badge, full recipient link, both tallies, labeled native progress, vote end, native details disclosure, and eligible vote/execute actions. Pagination keeps the view bounded to six cards.
- **Forms:** native labels, required fields, decimal keyboards and 16px input text. Validation uses `invalidField`, `fieldAttributes` and `fieldMessage` to identify/focus the failing field with `aria-invalid` and a linked description. Global alerts retain recoverable transaction errors.
- **Transaction review:** native `<dialog>` and `showModal()` provide modal behavior. Cancel receives initial focus; Escape dismisses and native focus returns to the trigger. The dialog states amount, account, network and consequences before wallet confirmation.
- **Buttons:** outlined by default; `.primary` gives the connection/review action emphasis. Minimum height is 44px (40px segments with surrounding padding). Disabled controls retain visible labels and explanatory nearby text.
- **Feedback:** persistent polite status region for pending/confirmed transactions, alert region for errors, labeled stale-read notice, purposeful empty state. No status relies on color alone.

Focus uses a 3px perimeter and 4px offset; forced colors use the system Highlight. Hover is gated by pointer capability. Only background/color transition at 120ms and press scale `.96` are enabled under `prefers-reduced-motion: no-preference`. Reduced motion removes these transitions.

## Do’s and don’ts

Reuse semantic palette aliases, shared page edges, wrapping rows, native controls and proposal/status patterns. Keep one prominent action in the current flow, exact token units, readable prerequisites and consequence-specific labels. Keep source-of-truth deployment data outside components. Do not add decorative charts, sampled proposals, external fonts or arbitrary badges to empty chain state.

For a new view, start with the shared main width, use an existing section heading and card/form pattern, preserve label/focus/error behavior, and test 320px reflow before adding a new breakpoint or visual token.

Design guidance was adapted from Jakub Krehel’s [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method was adapted from Paul Bakaus’s [Impeccable document guide](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The assignment supplied pinned copies, which were read locally; no broader redesign authority was inferred.
