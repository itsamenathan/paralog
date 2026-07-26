# Paralog agent notes

## Project

Paralog is a single-user, self-hosted Next.js journal. The app uses the App Router and Node runtime API routes. Journal entries are Markdown files on disk; SQLite is an index and settings store, not the source of truth for entry content.

## Product requirements

- The home screen opens on the user's local current date and makes starting or editing that entry immediate.
- Provide a calendar view that marks dates with entries and lets the user select a day to edit.
- For a selected date, show links to entries from the same month/day in previous years.
- The default entry filename format is `YYYY/MM-MMMM/YYYY-MM-DD-dddd.md` (for example, `2026/07-July/2026-07-11-Saturday.md`). Future saves may use the user-configured format; existing files must remain readable.
- Entries are edited as Markdown. The primary editor should render Markdown inline in one Obsidian-like interface, not a split editor/preview layout. Keep a raw Markdown source mode for advanced editing.
- Saving is debounced/automatic after typing pauses, with a manual Save action still available and visible save feedback.
- Allow attaching photos and arbitrary documents. Store uploads below the persistent data directory and insert usable Markdown image/link syntax into the entry.
- Markdown files placed directly into the data directory using the date-bearing filename convention must appear in the calendar and history automatically.
- Protect the single-user app with password authentication. Credentials are supplied through environment variables and journal/content APIs must not be usable while unauthenticated.
- Provide settings for changing the future save path format and defining a global Markdown template for new entries. A template should be easy to apply to a new entry without overwriting existing content.
- Date selection must update browser history (`?date=YYYY-MM-DD`), and browser Back/Forward must restore the corresponding day, month, and entry.
- Include a user-selectable dark theme based on Dracula and a light theme based on Alucard. Keep editor controls, dropdowns, focus states, and menus on the active palette.
- The layout must be usable on mobile: no broken portal dropdowns, clipped essential controls, or split-pane editor requirement. Preserve Markdown shortcuts/source mode when a rich control is hidden on narrow screens.
- The app is self-hosted for one user and must include a Docker deployment with a persistent `/data` volume for Markdown, SQLite, settings, and uploads.
- The app is an installable PWA. Previously opened entries and calendar data must remain available offline; edits are cached locally first, shown as pending/offline, and synchronized automatically after reconnecting.

## Commands

- Use `mise` for Node.js and npm commands so the project runs with the toolchain pinned in `mise.toml`. Prefer a defined task (`mise run <task>`); for commands without a task, use `mise exec -- <command>` instead of invoking `node`, `npm`, or `npx` directly.
- `mise run install` installs the locked npm dependencies.
- `mise run dev` starts Next.js on `0.0.0.0`.
- `mise run build` is the required verification command after code changes.
- `mise run start` serves the production build.
- `mise run browser -- <command>` drives the app in a real browser (see Browser testing).
- `docker compose up --build -d` is the self-hosted deployment path.

## Browser testing

Use [agent-browser](https://github.com/vercel-labs/agent-browser) to drive the app in a real Chrome whenever you change the UI. It is a pinned devDependency, so run it through the task rather than a global install:

```bash
mise run browser -- <command>            # e.g. mise run browser -- snapshot -i -c
mise run browser -- install              # once per machine: download Chrome (--with-deps on Linux)
mise run browser -- skills get core      # version-matched usage guide; read before your first session
```

The examples below are written as bare `agent-browser` for readability; prefix each with `mise run browser --`.

**Never point the browser at a server you did not start.** `mise run test:start` serves `.test-data`, but a `mise run dev` server on the same port serves the real journal in `data/`. Start the test server on a port you know is free and confirm the data directory it prints:

```bash
PARALOG_TEST_PORT=3457 mise run test:start   # prints the port, data directory, and password
PARALOG_TEST_PORT=3457 mise run test:stop
```

Isolate the browser session per project with `AGENT_BROWSER_SESSION`, and on Linux hosts that block unprivileged user namespaces (Ubuntu 23.10+ AppArmor) pass `--args "--no-sandbox"` on the first `open`:

```bash
export AGENT_BROWSER_SESSION=paralog
agent-browser open http://localhost:3457 --args "--no-sandbox"
agent-browser snapshot -i -c            # interactive, compact; @eN refs
agent-browser fill @e3 paralog          # refs go stale on any page change — re-snapshot
agent-browser press Enter
agent-browser wait --load networkidle
agent-browser click ".cm-live-property-icon"   # CSS selectors work anywhere a ref does
agent-browser eval "document.querySelectorAll('.cm-line').length"
agent-browser screenshot shot.png
agent-browser close
```

- **Check `agent-browser console` and `agent-browser errors` after every UI change.** React invalid-DOM-property warnings, hydration mismatches, and CodeMirror exceptions surface only there — `mise run build` and the `scripts/` tests cannot catch them.
- `agent-browser eval` is the most direct way to assert on Live Preview internals, which the accessibility tree does not expose: computed styles, CodeMirror decoration classes, and element geometry.
- Cover the palette and mobile requirements with `agent-browser set media dark` (and `light`) and `agent-browser set viewport 375 812 2`.
- Prefer `snapshot` and `read` for assertions; take a screenshot when the change is genuinely visual.
- Pass `--json` to anything you parse; human-readable output is not a stable contract.

## Storage invariants

- Use `PARALOG_DATA_DIR` for persistent data. It contains `journal.db`, Markdown entries, and `attachments/`.
- Preserve the configurable save-format tokens in `lib/journal.ts` (`YYYY`, `YY`, `MM`, `M`, `MMMM`, `MMM`, `DD`, `D`, `dddd`, `ddd`).
- Manually added Markdown files must be discoverable when their filename contains a `YYYY-MM-DD` date. Do not require a database migration/import step for them to appear.
- Keep path traversal protections for configurable paths and file-serving routes.
- Use `PARALOG_PASSWORD` and `PARALOG_AUTH_SECRET` for authentication configuration; do not hard-code credentials.

## UI conventions

- Keep the URL date query (`?date=YYYY-MM-DD`) in sync with selected entries so browser Back/Forward works.
- Preserve the Markdown-native Live Preview editor, raw Markdown source mode, and reading mode. Live Preview must edit the actual Markdown buffer, render formatting inline, and reveal syntax markers around the active line; do not replace it with a rich-text abstraction.
- Dark mode uses Dracula colors; light mode uses Alucard colors. Keep CodeMirror, its toolbar, selections, and inline decorations on the same palette.
- Test narrow layouts. Mobile must not depend on a portal dropdown or horizontally clipped toolbar; Markdown shortcuts/source mode are valid fallbacks for controls hidden on small screens.
- Autosave should remain debounced and must not save a newly loaded entry merely because the user navigated to it.
- Keep the selected entry synchronized across tabs, browsers, devices, and direct filesystem edits. Apply remote changes automatically only when the local entry is clean; never overwrite an unsaved local edit without an explicit conflict choice.

## Change workflow

1. Read the relevant route, component, and storage code before editing.
2. Make focused changes with `apply_patch`.
3. Run `mise run build`.
4. For UI changes, drive the running app with agent-browser (see Browser testing) and check `agent-browser console` and `agent-browser errors`. Test both light/dark and a mobile-width viewport when possible.
5. Do not commit generated `.next/`, `node_modules/`, or local `data/` contents.
