---
name: responsive-mobile-qa
description: >-
  Audits a running web application for responsive and mobile-usability defects,
  fixes them, and re-renders to verify each fix at multiple viewport sizes.
  Discovers routes, starts the project's dev server, drives a real browser with
  Playwright, inspects DOM geometry and screenshots at phone, tablet, and desktop
  widths, fixes root causes in the project's own styling system, re-verifies
  across neighbouring viewports, runs a regression pass, and opens a pull request.
  Use when asked to make an app mobile-friendly, audit responsive behaviour, fix
  layout breakage at small widths, or check a UI across breakpoints. Do not use
  for greenfield UI design, visual identity work, or non-visual debugging.
---

# Responsive & Mobile QA

Make an existing web app work at every viewport **without redesigning it**. The
rendered application is the source of truth; CSS that looks responsive is a
hypothesis, not a result.

The loop is fixed:

    Discover -> Render -> Inspect -> Identify -> Ask if ambiguous
             -> Fix -> Render again -> Verify neighbours -> Regression -> Repeat

Never run: read CSS -> guess -> change everything -> declare success.

## Two Rules That Outrank Everything Else

**1. Preserve the product.** You are making the existing design responsive, not
replacing it. Match the project's design system, spacing scale, breakpoints, and
component conventions. A fix that changes desktop appearance is a defect unless
the user asked for it.

**2. Never guess on an ambiguous design decision.** When two reasonable
behaviours exist and the code does not settle it, STOP and ask, then wait for the
answer. The catalogue of decisions that always require a question is in
[references/ambiguous-decisions.md](references/ambiguous-decisions.md) — read it
before the first fix. Minor implementation choices that follow obviously from the
existing design system are yours to make.

## Phase 1 — Understand The Project

Read before touching anything. Record the answers; the rest of the run depends on
them.

- Framework and version (Next.js App/Pages Router, Remix, Vite+React, Vue/Nuxt,
  SvelteKit, Astro, Angular, plain HTML).
- Styling system (Tailwind + config/theme, CSS Modules, styled-components,
  Sass, vanilla CSS, a component library such as MUI/shadcn/Chakra).
- Package manager: the lockfile decides (`pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, `bun.lockb`). Never switch it.
- Scripts in `package.json`: dev, build, start, lint, typecheck, test, e2e.
- Routing style and where routes live.
- Existing breakpoints — Tailwind `screens`, Sass variables, raw media queries.
  Grep them and use the project's values; do not introduce a new scale.
- Existing Playwright/Cypress config, fixtures, and any auth storage state.
- Shared layouts, shells, nav, and the components that repeat everywhere. A
  defect in a shared layout is one fix for many pages — find those first.
- Project instructions (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`) and any
  standing rules about comments, commits, or PRs.

Do not edit CSS in this phase.

## Phase 2 — Run The Application

Start the dev server with the project's own package manager and script, in the
background, and prove it answers over HTTP before auditing anything. The startup
and readiness recipes, port discovery, and the traps (server not ready, wrong
port, HTML error shell returning 200) are in
[references/running-and-auth.md](references/running-and-auth.md).

Fix only what blocks the audit — a missing `.env` value, an unseeded database.
If starting the app needs a product decision (which seed data, which account),
ask.

## Phase 3 — Discover Every Page

Build a route inventory from two independent sources and merge them:

1. **The router source.** File-based routes (`app/**/page.tsx`,
   `pages/**/*.tsx`, `routes/**`), or the route table in a
   `createBrowserRouter`/`<Route>` tree. Include nested and dynamic segments.
2. **The rendered app.** Follow real links:

       node <skill>/scripts/crawl_routes.mjs --base-url http://localhost:3000 \
         --seed / --max-pages 40 --out /tmp/routes.txt

For each dynamic route (`[id]`, `:slug`), find one representative real value from
seed data or the database — an audit of `/lesson/[id]` proves nothing until it
renders a real lesson. Cover authenticated areas too; see
[references/running-and-auth.md](references/running-and-auth.md) for capturing a
storage state from existing dev/test credentials. Never invent, commit, or print
real credentials.

Then **prioritise**, because auditing everything at ten viewports is wasteful:

- every distinct layout shell (each one covers many routes);
- the highest-traffic user journey end to end;
- every page with a table, a multi-column form, a dashboard grid, a modal, or a
  sidebar;
- one representative of each repeated page family, plus any page a stakeholder
  named.

Write the inventory down (route, why it is in the list, what state it needs).

## Phase 4 — The Viewport Matrix

Every important breakpoint must be exercised; not every page needs all ten
sizes.

| Band    | Sizes                                   | Use                                                                    |
| ------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Mobile  | 320x568, 375x667, 390x844, 430x932      | 320 always — it is the WCAG 1.4.10 reflow floor and where things break |
| Tablet  | 768x1024, 820x1180                      | any page whose layout changes at `md`/`lg`                             |
| Desktop | 1024x768, 1280x800, 1440x900, 1920x1080 | regression protection for the layout that already worked               |

Practical policy: run every prioritised route at `--preset standard`
(320/390/768/1280). Escalate to `--preset full` for pages that showed defects, for
shared layouts, and for the whole regression pass. Pay closest attention to 320.

## Phase 5 — Render And Inspect

Run the bundled sweep from the audited project so it resolves that project's
Playwright:

    node <skill>/scripts/responsive_audit.mjs \
      --base-url http://localhost:3000 \
      --routes-file /tmp/routes.txt \
      --preset standard \
      --out /tmp/rqa/pass-1

Useful flags: `--viewport 320x568` (repeatable, replaces the preset),
`--storage-state auth.json`, `--ready-selector`, `--settle-ms`, `--full-page`,
`--baseline <previous report.json>`, `--screenshot issues`, `--fail-on warning`.
Exit codes: 0 clean, 1 findings, 2 bad input or setup failure. It writes
`report.json` plus one screenshot per route/viewport into `--out`.

What it detects, what each finding means, how to confirm it, and its known false
positives are catalogued in
[references/detection-catalog.md](references/detection-catalog.md). Read that
before triaging, and consult it whenever a finding surprises you.

**Then open the screenshots.** The script produces candidates, not verdicts. A
mechanical pass with zero findings is not a responsive page: fitting inside the
viewport is the floor, not the goal. Look at the images and judge what no script
can — is it readable, coherent, appropriately spaced, touch-friendly, still
recognisably the same product as the desktop view? Excessive whitespace, a
squeezed two-column form, a nav that technically fits but is unusable, an
information hierarchy that collapsed into noise: all of those pass every
geometric check.

For interaction states the sweep never sees — open menus, drawers, modals,
dropdowns, tooltips, validation messages, loading and empty states — drive them
yourself with the browser tooling available in this session (Playwright script,
or a devtools/browser MCP if one is connected), and screenshot them at mobile
width. A closed menu proves nothing about an open one.

## Phase 6 — Triage And Ask

Sort findings into:

- **Broken** — content unreachable, overlapping, clipped, page scrolls
  sideways, control untappable. Fix.
- **Degraded** — readable but cramped, mis-scaled, or awkward. Fix with the
  project's existing scale.
- **Ambiguous** — more than one reasonable behaviour. **Ask.**
- **Intentional** — a fixed-width canvas, a deliberately horizontal-scrolling
  data grid. Leave it and say so in the report.

Ask in this format, batching related questions, then wait:

    Responsive QA question

    Page: /example (390x844)

    Issue: The desktop sidebar is 280px fixed and pushes the page 120px wider
    than the viewport.

    Options:
    1. Collapse it into a drawer behind a menu button.
    2. Move it above the content as a horizontal strip.
    3. Hide it below `md` (nav is reachable from the header).
    4. Something else.

    Which behaviour do you want?

## Phase 7 — Fix Root Causes

Fix where the layout is actually decided — usually the shared layout or the
component, rarely the page. Prefer flex/grid corrections, `min-width: 0` on flex
and grid children, fluid `max-width`, the project's own breakpoint tokens,
`clamp()` for type and spacing that the design system already uses, and
container-level scroll where the product intends it.

Banned: hiding content to make a check pass, `overflow: hidden` to erase evidence
of overflow, shrinking all type until it fits, arbitrary negative margins, a
parallel mobile-only component tree, dozens of one-off breakpoints, and any
desktop-affecting change that was not requested. The full pattern list — cause,
correct fix, and the hack to avoid for each — is in
[references/fix-patterns.md](references/fix-patterns.md).

Follow the project's own code conventions, including its comment policy. One
behavioural change per commit-sized chunk.

## Phase 8 — Verify Every Fix

Re-render. Never assume a CSS change worked.

For a fix made at width W, re-run at W, at every smaller mobile width, at the
neighbouring band, and at desktop:

    node <skill>/scripts/responsive_audit.mjs --base-url http://localhost:3000 \
      --route /fixed-page --preset full --out /tmp/rqa/verify-1

Confirm three things: the original finding is gone from `report.json`, no new
finding appeared at any other width, and the screenshot actually looks right.
A fix verified only by the absence of a mechanical error is not verified.

## Phase 9 — Regression Pass

When the major fixes are done, re-run the whole inventory and diff it against the
first pass:

    node <skill>/scripts/responsive_audit.mjs --base-url http://localhost:3000 \
      --routes-file /tmp/routes.txt --preset full \
      --baseline /tmp/rqa/pass-1/report.json --out /tmp/rqa/pass-2

The diff names introduced, resolved, and persisting findings. Anything under
"NEW" is a regression you created — fix it before continuing. Look specifically
for desktop and tablet breakage, newly clipped content, and anything that
disappeared from the page. Repeat until the run is stable and the remaining
findings are ones you can defend in writing.

## Phase 10 — Clean Up And Guard

Remove QA scaffolding: debug logging, temporary CSS, screenshot output inside the
repo, throwaway routes, test credentials. Keep evidence in a temp directory, not
in git — check `git status` before committing.

Keep what protects the work: if the project already runs Playwright, add a small
responsive spec asserting the failure class you fixed (no horizontal overflow at
320/390, the drawer opens on mobile, the table scrolls in its container). Follow
the project's existing test layout and naming. Prove a new assertion can fail —
reintroduce the defect, watch it go red, then remove it. An assertion that stayed
green through the whole bug is not a guard.

## Phase 11 — Branch, Commit, PR

Never work on the default branch. Check the current branch first; if it is
`main`/`master`, create one (`fix/responsive-mobile-qa`). If the user is already
on a feature branch, ask whether to branch from it or continue on it.

Before opening the PR, run the project's own gates: lint, typecheck, unit tests,
and a final clean audit pass. Report failures honestly, including pre-existing
ones you did not cause.

Commit in logical chunks with meaningful messages
(`fix: make the dashboard grid reflow below md`). Push the branch, open the PR,
**and do not merge it.** The PR body must state:

- **Checked** — routes audited, viewports tested, how they were selected.
- **Found** — the major issue categories, with counts.
- **Fixed** — what changed, grouped by category, and what the user will see.
- **Verified** — tests, lint, typecheck, and the before/after audit numbers.
- **Open questions** — everything deliberately left unresolved pending a
  decision, each with the options offered.

Write the PR in normal prose, not shorthand.

## Completion Gate

Report the work complete only when: every prioritised route rendered at its
viewports; every screenshot cited was actually opened; every fix was re-verified
at neighbouring viewports; the regression pass introduced nothing new; the
project's gates ran and their real results are reported; the branch is pushed and
the PR is open and unmerged. Otherwise report **partial** and name exactly what
is unverified. Never describe a page as responsive because its CSS looks
responsive.

## Bundled Resources

- `scripts/responsive_audit.mjs` — Playwright viewport sweep: overflow with the
  offending element identified, clipping, touch targets, tables, images,
  typography, overlaps, viewport meta, console errors, screenshots, JSON report,
  and a baseline diff for regression passes.
- `scripts/crawl_routes.mjs` — same-origin link crawler for route discovery,
  with optional authenticated session.
- `references/detection-catalog.md` — every finding type: meaning, confirmation,
  root fix, false positives, plus the defects no script can see.
- `references/fix-patterns.md` — root-cause fixes per defect class and the hacks
  that are never acceptable.
- `references/ambiguous-decisions.md` — decisions that must become a question,
  with the question template and worked examples.
- `references/running-and-auth.md` — starting the app, readiness, ports,
  authenticated audits, and environment traps.
