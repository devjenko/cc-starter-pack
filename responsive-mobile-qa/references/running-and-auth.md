# Running The App, Auth, And Environment Traps

## Starting The Dev Server

Use the project's lockfile to pick the package manager, and its own script:

    pnpm dev / npm run dev / yarn dev / bun run dev

Run it in the background and capture its output — the port and the compile errors
both live there. Then prove it answers before auditing:

    curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/

Poll until it is non-zero rather than sleeping a fixed time; a first-request
compile in a dev server can take 30 seconds. A 200 that returns a framework error
shell is still a failure — check that the body contains real app markup.

Traps:

- **Wrong port.** Read it from the server's own output; a busy port makes many
  frameworks silently pick the next one.
- **A dev server already running** on that port, serving different code. Confirm
  the process is yours before trusting a fix.
- **Production build vs dev.** Dev overlays, unminified layout, and missing
  optimisations can each change geometry. Audit the mode the user cares about,
  and say which one you used.
- **Missing env or an unseeded database** — fix only what blocks the audit; ask
  before creating data that has product meaning.
- **Do not add dependencies** to the audited project to make the sweep run. If
  Playwright is absent, say so and fall back to whatever browser tooling this
  session already has.

Stop the server when finished; do not leave a background process behind.

## Authenticated Routes

In order of preference:

1. **Reuse what the project already has.** Look for a Playwright global setup, a
   `storageState` file, seeded dev accounts in a seed script, or documented test
   credentials in the README or `.env.example`.
2. **Capture a storage state once** with a short throwaway script that signs in
   through the real form and calls `context.storageState({ path })`, then pass
   that file to both bundled scripts with `--storage-state`.
3. **Ask.** If no test account exists, ask for one. Never create real accounts in
   a shared environment, never print credentials into the transcript or a report,
   and never commit a storage-state file — add it to a temp directory outside the
   repo.

Session traps:

- A short session expiry can log you out mid-sweep; re-capture and re-run rather
  than reporting the login page as a broken route.
- A route that silently redirects to `/login` produces a perfectly clean audit of
  the wrong page. The audit records `finalUrl` — check it.
- Role-gated pages need each role's session. Signed-out and admin views are
  different products; auditing one proves nothing about the other.

## Reaching Real Content

Dynamic routes need a real id. Take one from the seed data or query the dev
database read-only. An empty state and a populated state are different layouts —
overflow usually only appears in the populated one, so audit that.

## Interaction States

The sweep captures the page as it loads. For menus, drawers, modals, dropdowns,
accordions, tooltips, and validation states, drive the interaction with a short
Playwright script (or the browser MCP tooling connected to this session), set the
mobile viewport, trigger the state, and screenshot it. Report which states you
exercised and which you did not.
