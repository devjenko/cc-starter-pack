# Ambiguous Decisions — Always Ask

The rule: **if two reasonable behaviours exist and the code does not settle it,
ask and wait.** Do not invent requirements, and do not substitute your own taste
for the product's.

## Always A Question

1. **Sidebar/nav on mobile** — drawer, collapse, move above content, bottom bar,
   or hide. Each changes the product.
2. **Table strategy** — horizontal scroll, hide low-priority columns, convert to
   cards, or a detail view. See the table section in fix-patterns.
3. **Information hierarchy** — any reorder of a mobile stack, or promoting one
   panel over another.
4. **A fixed width that may be intentional** — a canvas, a chart, a print
   preview, an editor surface, a brand-locked hero.
5. **A component with product behaviour you cannot infer** — a wizard, a
   scheduler, a seating chart, a diff view.
6. **An unclear breakpoint** — the project has no scale, or the natural break
   sits between two of its values.
7. **A fix that trades viewports** — improving 390 measurably degrades 1440.
8. **Something that looks broken but may be deliberate** — an overlap, an
   intentional overflow, an off-canvas peek.
9. **Any new visual token** — a new type step, a new spacing value, a new
   breakpoint. These are design-system changes, not fixes.
10. **Hiding anything at any viewport.** Removing content from a screen is a
    product decision, always.
11. **Scope creep** — a defect that predates this work, or an unrelated bug found
    on the way.
12. **Auth or seed data needed to reach a route.**

## Decide Yourself

- Which layer to fix in (layout vs component vs page).
- Applying a value the design system already defines at a breakpoint it already
  defines.
- `min-width: 0` on a flex child, `max-width: 100%` on an image, `min-height`
  replacing a fixed `height` — mechanical corrections with one right answer.
- Stacking a two-column grid to one column at the project's existing mobile
  breakpoint, when the project already does that elsewhere.
- Padding on an icon button to reach 24/44px.
- Naming, file placement, and commit structure.

The test: _does this change what the product does or how it looks on purpose?_
If yes, ask. If it only makes the existing intent survive a narrower screen,
proceed.

## Question Format

Batch related questions into one message. Give real options with real
consequences, recommend one, and stop.

    Responsive QA question

    Page: /dashboard (390x844, also 320x568)

    Issue: The 280px fixed sidebar pushes the page 120px past the viewport, so
    every dashboard route scrolls sideways on a phone.

    Options:
    1. Collapse into a drawer behind a header menu button (matches the existing
       Sheet component). Recommended — no content is lost.
    2. Move it above the content as a horizontal scrolling strip.
    3. Hide it below `md`; all its links already exist in the header.
    4. Something else.

    Which behaviour do you want?

While waiting, continue with unrelated unambiguous work; do not implement a
guess and do not silently pick option 1. If the user answers in a way you think
is risky, say so once in a sentence and then do exactly what they asked.
