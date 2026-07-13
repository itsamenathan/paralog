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

- `npm run dev` starts Next.js on `0.0.0.0`.
- `npm run build` is the required verification command after code changes.
- `npm run start` serves the production build.
- `docker compose up --build -d` is the self-hosted deployment path.

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
3. Run `npm run build`.
4. For UI changes, test both light/dark and a mobile-width viewport when possible.
5. Do not commit generated `.next/`, `node_modules/`, or local `data/` contents.
