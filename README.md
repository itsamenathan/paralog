# Paralog

A private, single-user journal that stores each entry as a Markdown file and keeps a small SQLite index for the calendar. It includes a Markdown-native Live Preview editor, password auth, autosave, uploads, configurable paths, new-entry templates, and Dracula/Alucard themes.

Live Preview keeps the real Markdown editable while rendering formatting inline. Syntax markers are visible on the active line and collapse when you move away, similar to Obsidian; raw source and reading modes remain available.

Open sessions stay synchronized without a refresh. Paralog broadcasts saves instantly to other tabs and checks the server periodically for changes from other browsers, devices, or direct filesystem edits. Unsaved local work is never overwritten silently; concurrent changes produce an explicit version choice.

Paralog is also an installable PWA. Once opened online, the app shell, visited entries, and calendar data remain available without a connection. Offline edits are stored locally immediately and sync back to the Markdown filesystem after reconnecting.

## Run locally

```bash
export PARALOG_PASSWORD='choose-a-long-password'
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Journal data defaults to `./data`; set `PARALOG_DATA_DIR` to store it elsewhere.

## Docker

```bash
docker compose up --build -d
```

The `./data` directory is mounted into the container at `/data`, holding both `journal.db`, uploads, settings, and Markdown entries. Back up this directory to back up Paralog. Set `PARALOG_PASSWORD` and a long random `PARALOG_AUTH_SECRET` in a `.env` file before launching Docker.

Entries are written as `YYYY/MM-MMMM/YYYY-MM-DD-dddd.md`, for example `2026/07-July/2026-07-11-Saturday.md`.

## Immich photo previews

Paralog can show previews of photos taken on the journal date. Create a read-only Immich API key with the `asset.read` and `asset.view` permissions, then configure:

```bash
IMMICH_API_URL=https://photos.example.com
IMMICH_API_KEY=your-api-key
```

The URL may include `/api`; Paralog adds it when omitted. Searches and thumbnail requests run only on the server, and the API key is never sent to the browser. Leave either variable unset to disable the integration.

## Imported files and settings

Paralog discovers Markdown files added directly under the data directory when their filename includes `YYYY-MM-DD`, so entries using the default format appear without an import step. In Settings, change the path format with tokens such as `YYYY`, `MM`, `MMMM`, `DD`, and `dddd`, and set a Markdown template for new entries. Changing the format affects future saves only; existing files remain in place and are still discovered.
