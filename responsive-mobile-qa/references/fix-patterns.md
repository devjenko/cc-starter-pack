# Fix Patterns

Fix the cause, in the layer that decides the layout. Match the project's styling
system: if it uses Tailwind, use its breakpoint prefixes and spacing scale; if it
uses CSS Modules or Sass, use its existing variables and media-query mixins. Do
not introduce a second system.

## Where To Fix

Prefer, in order: the shared layout/shell -> the reusable component -> the page.
A defect visible on nine routes is usually one shell. Fixing the page nine times
is the wrong fix nine times.

## Overflow

| Cause                                                       | Fix                                                                                        | Never                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Fixed `width: 280px` element                                | `width: 100%; max-width: 280px`, or make the width conditional on the breakpoint           | Wrap the page in `overflow-x: hidden`         |
| Flex child refusing to shrink (long text, a table, a `pre`) | `min-width: 0` on the flex child (and `min-height: 0` for column flex)                     | `flex-shrink: 0` everywhere, or a fixed width |
| Grid with fixed tracks                                      | `repeat(auto-fit, minmax(min(240px, 100%), 1fr))`, or a single column below the breakpoint | Hardcode a mobile-only track list per page    |
| `100vw`                                                     | `100%`, or `100dvw` where supported — `100vw` includes the scrollbar                       | Negative margin to compensate                 |
| Unbreakable string (URL, token, code)                       | `overflow-wrap: anywhere` on the text, or a scroll container for code blocks               | `word-break: break-all` on the whole page     |
| Wide absolute/transform element                             | Constrain the parent, or clip at the intended container with an explicit reason            | Body-level `overflow: hidden`                 |
| Negative margins on a full-bleed section                    | `margin-inline: calc(50% - 50vw)` with `max-width: 100vw`, or a proper full-bleed grid     | Arbitrary `-24px` guesses                     |

Body-level `overflow-x: hidden` is not a fix. It hides the evidence, breaks
`position: sticky` in some contexts, and leaves the content just as unreachable.

## Fixed Heights And Clipping

Replace `height` with `min-height` wherever content can grow. Reserve `height`
for genuinely fixed chrome (a header bar) and even then let its contents wrap.
For anything scrollable, set the scroll on the intended container with
`overflow-y: auto` and `min-height: 0` on its flex parent — otherwise the flex
item refuses to shrink and the scroll never appears.

## Typography

Use the project's existing type scale at its existing breakpoints. If the project
already uses `clamp()`, extend it; if it does not, do not introduce fluid type
unilaterally — that is a visual-identity change. Ask.

Never shrink type to resolve an overflow: the container is the problem.

## Navigation And Sidebars

There is no default answer here, only the project's answer. Drawer, collapse,
bottom bar, overflow menu, and horizontal scroll are all legitimate and all
change the product. Ask, then implement with the project's existing primitives
(the dialog/sheet component it already ships), and make sure the mobile control
is keyboard reachable, has an accessible name, traps focus if it is modal, and
closes on Escape and on route change.

## Tables

The strategy is a product decision — ask before implementing. Once decided:

- **Horizontal scroll**: wrap in `overflow-x: auto` with a `min-width` on the
  table so columns keep their intended width, `-webkit-overflow-scrolling: touch`
  where the project targets older iOS, and a visible affordance (a fade, a
  shadow, or a scroll hint). Consider a sticky first column.
- **Column hiding**: hide by priority with the project's breakpoints, and keep a
  way to reach the hidden data (a row expander, a detail view).
- **Card conversion**: one card per row below the breakpoint, labels retained.
  This is a real redesign — never do it unasked.

## Forms

Stack multi-column grids below the breakpoint (`grid-cols-1 md:grid-cols-2`).
Inputs go `width: 100%` with the container controlling the max width. Keep the
label above the input on mobile. Font size on inputs must be at least 16px on
iOS or Safari zooms the page on focus. Keep validation messages in flow so they
do not overlap the next field, and keep submit buttons reachable without a
horizontal scroll.

## Touch Targets

Grow the hit area, not the icon: padding on the button, or a pseudo-element that
extends the target. 44x44 is the comfortable target; 24x24 is the WCAG floor.
Space adjacent controls by at least 8px. Never delete a control to fix crowding.

## Verify Before Moving On

Every fix gets re-rendered at the width it fixed, all smaller mobile widths, the
neighbouring band, and desktop. Grep a new class or token name before introducing
it — a name the project already uses will silently override something else.

## Never

- Hide content so a check passes.
- `overflow: hidden` to erase overflow evidence.
- Shrink all type until it fits.
- Duplicate a component into a mobile-only twin.
- Add a breakpoint that is not in the project's scale.
- Change desktop appearance to simplify a mobile fix, unasked.
- Disable a feature on mobile because its layout is hard.
- Rename a class to evade the detector.
- Declare a fix done without re-rendering it.
