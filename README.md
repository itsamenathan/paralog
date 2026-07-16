# Paralog

A private, single-user journal that stores each entry as a Markdown file and keeps a small SQLite index for the calendar. It includes a Markdown-native Live Preview editor, password auth, autosave, uploads, configurable paths, new-entry templates, and Dracula/Alucard themes.

Live Preview keeps the real Markdown editable while rendering formatting inline. Syntax markers are visible on the active line and collapse when you move away, similar to Obsidian; raw source and reading modes remain available.

Open sessions stay synchronized without a refresh. Paralog broadcasts saves instantly to other tabs and checks the server periodically for changes from other browsers, devices, or direct filesystem edits. Unsaved local work is never overwritten silently; concurrent changes produce an explicit version choice.

Paralog is also an installable PWA. Once opened online, the app shell, visited entries, and calendar data remain available without a connection. Offline edits are stored locally immediately and sync back to the Markdown filesystem after reconnecting.

Paralog can also send Web Push journal reminders while the app is closed. In Settings, enable notifications separately on each device, then configure up to ten schedules with their own time, weekdays, message, and option to skip days whose entry already has content. Schedules follow the timezone of the last authenticated device to open the app. Push requires HTTPS outside localhost; on iPhone and iPad, install Paralog on the Home Screen before enabling notifications.

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

Pending database migrations run automatically before Paralog begins serving requests, including after a Docker image upgrade. Migration files are bundled into the production image while the database remains on the persistent `/data` volume. When changing the database schema during development, run `npm run db:generate` and commit the generated files under `drizzle/`; use `npm run db:check` to validate the migration history.

Notification signing keys are generated automatically and retained in `journal.db`. Optionally set `PARALOG_VAPID_SUBJECT` to a `mailto:` address you monitor; it defaults to `mailto:paralog@localhost`.

## Entry metadata and location

The **Add location** action requests the device location, looks up the nearest city, and adds or updates YAML front matter without changing the journal prose:

```yaml
---
location: "Los Angeles, California, United States"
---
```

Only the city, state, and country are written to Markdown. The opt-in **Add location to new entries** setting can run the same lookup when writing begins on an empty day, without creating entries merely by browsing dates. Reverse geocoding defaults to OpenStreetMap Nominatim; coordinates are sent to that service during a lookup but are not stored by Paralog. The UI displays OpenStreetMap attribution. Set `PARALOG_GEOCODING_URL` to a compatible reverse endpoint to use another or self-hosted provider, and identify this installation with `PARALOG_GEOCODING_USER_AGENT`.

Entries are written as `YYYY/MM-MMMM/YYYY-MM-DD-dddd.md`, for example `2026/07-July/2026-07-11-Saturday.md`.

## Immich photo previews

Paralog can show previews of photos taken on the journal date. Create a read-only Immich API key with the `asset.read` and `asset.view` permissions, then configure:

```bash
IMMICH_API_URL=https://photos.example.com
IMMICH_API_KEY=your-api-key
```

The URL may include `/api`; Paralog adds it when omitted. Searches and thumbnail requests run only on the server, and the API key is never sent to the browser. Leave either variable unset to disable the integration.

## Daily activity integrations

Paralog loads date-based context through a shared server-side provider registry. Immich photos and GitHub commits use the same daily activity endpoint, so another service can be added by implementing the provider contract in `lib/day-providers.ts` without adding another fetch lifecycle to the journal UI. Provider credentials stay on the server.

### GitHub commits

Paralog uses GitHub's GraphQL contribution collection to show the number of commits and the repositories committed to on each journal date. A fine-grained personal access token is recommended.

1. Open GitHub's [fine-grained token settings](https://github.com/settings/personal-access-tokens/new), or follow GitHub's [token creation guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token).
2. Name the token `Paralog` and choose an expiration date.
3. Choose the **Resource owner**. A fine-grained token can access repositories owned by only that user or organization.
4. Under **Repository access**, keep the default public-repository access if public contributions are enough. To include private repositories, choose **Only select repositories** and select the repositories Paralog should display.
5. Under **Repository permissions**, set **Contents** to **Read-only** when private repositories are selected. GitHub includes read-only **Metadata** access automatically. Leave all account and organization permissions unset.
6. Generate the token and copy it immediately, then configure:

```bash
PARALOG_GITHUB_TOKEN=github_pat_your_token
```

No write permissions are needed. In particular, Paralog does not need Actions, Administration, Commit statuses, Issues, or Pull requests permissions. The token identifies the GitHub user whose contributions are displayed; repositories outside its selected resource owner and repository access will not be named. Organization-owned repositories may require an administrator to approve the token before GitHub exposes them.

GitHub documents the available [fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2026-03-10). Although that table is organized around REST endpoints, Paralog calls GraphQL and only reads contribution counts plus repository names. If a classic token must be used instead, `read:user` includes private and internal contribution totals; repository access through the broad `repo` scope is needed to name private repositories, so a fine-grained token is safer.

Treat the token like a password: keep it in `.env`, never commit it, and restart Paralog after changing it. Leave `PARALOG_GITHUB_TOKEN` unset to disable the GitHub provider.

## Imported files and settings

Paralog discovers Markdown files added directly under the data directory when their filename includes `YYYY-MM-DD`, so entries using the default format appear without an import step. In Settings, change the path format with tokens such as `YYYY`, `MM`, `MMMM`, `DD`, and `dddd`, and set a Markdown template for new entries. Changing the format affects future saves only; existing files remain in place and are still discovered.
