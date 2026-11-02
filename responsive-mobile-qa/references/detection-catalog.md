# Detection Catalog

Every finding `responsive_audit.mjs` can emit: what it means, how to confirm it,
the usual root cause, and how it lies. Findings are **candidates**. Confirm the
user-visible effect on a screenshot before assigning severity or writing a fix.

Elements 2x2 CSS px or smaller are treated as not visible, so the
screen-reader-only pattern (`sr-only`, `clip: rect(0,0,0,0)`) does not appear as
clipped text or as an undersized touch target. A genuinely 1px control is
therefore also invisible to this sweep — find those by inspection.

## Severity Contract

- `error` — content or function is unreachable, cut off, or unusable.
- `warning` — degraded but workable; usually still worth fixing.
- `info` — an observation that needs a human judgement, not a defect claim.

## Layout And Overflow

| Type                              | Meaning                                                                                                                                                                                                                                                                                        | Confirm with                                                     | Usual root cause                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page-horizontal-overflow`        | The document scrolls sideways. The finding names the outermost element that sticks out and dumps its computed `width`/`min-width`/`display`/`whiteSpace`/`grid-template-columns`. Elements inside an ancestor that clips or scrolls horizontally are excluded — they cannot move the document. | Screenshot at that width; the `box` field gives x/right.         | Fixed px width, a grid with fixed tracks, a flex child without `min-width: 0`, `100vw` under a scrollbar, an unbreakable string, a negative margin.                                                                |
| `content-clipped-horizontally`    | A container's content is wider than the container and `overflow-x` is `hidden`/`clip`, so it is silently lost — not scrollable, not visible. Elements with `text-overflow: ellipsis` (Tailwind's `truncate`) are excluded, since the clipping is signalled.                                    | Compare rendered text to the source string.                      | `overflow: hidden` used to suppress an overflow instead of fixing it. This is often the residue of a previous bad fix.                                                                                             |
| `horizontal-scroll-region` (info) | A container scrolls horizontally on a mobile viewport. Legitimate for a data table or a carousel; wrong for prose or a form.                                                                                                                                                                   | The screenshot, plus the product intent.                         | Intentional, or an accident. **Ask if unclear.**                                                                                                                                                                   |
| `elements-overlap`                | Two statically positioned text elements overlap by more than a third of the smaller one.                                                                                                                                                                                                       | Always the screenshot — this check is the noisiest one here.     | A fixed height that content outgrew, a negative margin, an absolutely positioned sibling that was mis-detected.                                                                                                    |
| `effective-viewport-mismatch`     | `innerWidth` is wider than the requested width. Every measurement from that run describes a zoomed-out page, not the one you asked for.                                                                                                                                                        | Compare `meta.innerWidth` with `meta.clientWidth` in the report. | Usually **not** a broken viewport meta: under mobile emulation, content that cannot fit widens the layout viewport itself, so this is a downstream symptom of a real overflow. Fix the overflow and it disappears. |

Zero page overflow is necessary, never sufficient. A phone table can be unusable
while `scrollWidth === clientWidth`.

## Typography

| Type                                                            | Meaning                                                                                                | Notes                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-clipped` (error)                                          | Text exceeds its box and `overflow` hides it, with no ellipsis or line clamp — the reader loses words. | Almost always a fixed `height` that should be `min-height`.                                                                                                       |
| `text-truncated` (info)                                         | Same geometry, but with `text-overflow: ellipsis` or `-webkit-line-clamp` — deliberate.                | Only a defect if the truncated content is essential at that width.                                                                                                |
| `text-too-small` (<10px, error) / `text-small` (<12px, warning) | Mobile body text below the readable floor.                                                             | Check whether it is a caption/legal line the design intends to be small. Fix by using the design system's smallest legitimate step, never by inventing a new one. |
| `heading-oversized-on-mobile`                                   | An `h1`/`h2` larger than viewport/9.                                                                   | A judgement call. If the project has a responsive type scale, apply it; if it does not, ask before inventing one.                                                 |
| `control-label-wraps`                                           | A button/tab label breaks across lines.                                                                | Sometimes fine on a 320px screen. Fix the container width before touching the label text — never shorten product copy to satisfy a layout.                        |

## Components

| Type                                       | Meaning                                                                                          | Response                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `table-overflows-without-scroll-container` | A table is wider than the viewport with nothing to scroll it, so columns are simply unreachable. | **Never auto-redesign a table.** Horizontal scroll, column hiding, card conversion, and column priority are four different products. Ask. |
| `table-scrolls-horizontally` (info)        | The table scrolls inside a container.                                                            | Verify the identifying first column is still usable while scrolled, and that the scroll affordance is visible.                            |
| `table-cell-crushed`                       | A cell under 36px carries real content.                                                          | Column sizing, or the table needs the strategy question above.                                                                            |
| `image-overflows-container`                | An image renders wider than its parent.                                                          | Missing `max-width: 100%`, a fixed `width` attribute, or a `next/image` used without responsive `sizes`.                                  |
| `image-failed-to-load`                     | The request failed or the asset is undecodable.                                                  | Not a responsive defect, but it invalidates any judgement of that region. Report it.                                                      |
| `image-aspect-distorted`                   | `object-fit: fill` stretches the image.                                                          | Set an explicit aspect ratio and a deliberate `object-fit`.                                                                               |

## Touch And Interaction

| Type                             | Meaning                                                                                                              | Notes                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `touch-target-too-small` (error) | Under 24x24 CSS px — below WCAG 2.5.8 minimum.                                                                       | Icon buttons are the usual offenders. Grow the hit area (padding, a larger tap surface) without growing the icon. Inline links inside prose are excluded by the check, per the criterion's inline exception. |
| `touch-targets-crowded`          | Under 44px with less than 8px of clear space from a neighbour.                                                       | Adjacent icon rows, pagination, chip lists. Add spacing or size, do not remove controls.                                                                                                                     |
| `hover-only-reveal`              | A CSS rule reveals content on `:hover` with no `:focus`/`:focus-within` counterpart. Touch users may never reach it. | Add the focus equivalent, or make the content permanently visible on small screens. Check whether it is a decorative effect first.                                                                           |
| `focus-indicator-suppressed`     | Stylesheets remove the focus outline and define no replacement.                                                      | Pre-existing accessibility debt more often than something you caused. Report it; fix it only if in scope.                                                                                                    |
| `zoom-disabled` / `zoom-capped`  | `user-scalable=no` or `maximum-scale < 2`.                                                                           | Nearly always wrong. Remove the restriction.                                                                                                                                                                 |
| `viewport-meta-missing`          | No viewport meta at all: a phone renders ~980px scaled down.                                                         | One-line fix, and it invalidates every mobile finding until fixed — fix it and re-run.                                                                                                                       |

## Route Health

`route-http-error`, `route-navigation-failed`, `console-error`, `request-failed`
are not responsive defects. They mean the page you audited was not the page the
user sees. Resolve them (or the state/auth problem behind them) before trusting
findings from that route.

## What This Script Cannot See

Run these by hand and say you did:

- **Anything behind an interaction** — open menus, drawers, modals, dropdowns,
  tooltips, date pickers, validation states, loading and empty states.
- **Aesthetic collapse** — a page that fits and is still ugly, cramped, or
  incoherent. Excessive whitespace, inconsistent padding between sections, a
  broken visual rhythm, a mobile layout that no longer reads as the same product.
- **Information hierarchy** — a mobile stack where the primary action ends up
  below three secondary panels passes every geometric check.
- **Real device behaviour** — Chromium emulation approximates it. Momentum
  scrolling, browser chrome height, the iOS keyboard, and `100vh` behaviour on
  mobile Safari differ. Prefer `100dvh` and say emulation was used.
- **Keyboard journeys and focus order.**
- **Fonts that never shipped** — a family declared but not loaded changes every
  metric on the page while every check stays green.
- **Cross-viewport regressions in one run** — only the baseline diff catches
  those, so keep pass-1's `report.json`.
