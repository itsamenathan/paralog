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

The `./data` directory is mounted into the container at `/data`, holding both `journal.db`, uploads, settings, and Markdown entries. Back up this directory to back up Paralog. Set a long random `PARALOG_AUTH_SECRET` in a `.env` file before launching Docker, along with `PARALOG_PASSWORD`, the Pocket ID settings below, or both. Compose refuses to start without the secret; generate the secret with `openssl rand -base64 32`. The secret signs session cookies, so anyone who knows it can sign in without the password: keep it private and never reuse an example value.

### Sign in with Pocket ID

Paralog can sign in through [Pocket ID](https://pocket-id.org) instead of, or alongside, the password. Paralog still has one owner and no accounts: Pocket ID is another way to prove you are that owner, and exactly one Pocket ID user is let in.

**Requirements**

- Pocket ID 2.6.0 or later. Earlier versions keep accepting a disabled user's refresh token, so Paralog could not notice when access is revoked.
- Paralog reachable at a fixed address, such as `https://journal.example.com`. Pocket ID sends you back to that exact address after sign-in.

#### 1. Create the client in Pocket ID

1. In Pocket ID, open **Administration → OIDC Clients** and add a client named `Paralog`.
2. Under **Callback URLs**, add `https://journal.example.com/api/auth/oidc/callback`, using your own Paralog address. It must match `PARALOG_PUBLIC_URL` exactly, including `https` and any port.
3. Save, then copy the **Client ID** and **Client secret**. The secret is shown only once. If you made the client a **Public Client** instead, there is no secret; Paralog then relies on PKCE alone.
4. On the **General** tab, turn on **PKCE** and save. Paralog always sends a PKCE challenge.
5. On the **Access** tab, under **Allowed User Groups**, choose a group that contains only you. This is optional, since Paralog admits a single user anyway, but it stops anyone else from being offered the client.

#### 2. Configure Paralog

Add these to the `.env` file beside `docker-compose.yml`. The Compose file already passes them to the container.

```bash
PARALOG_AUTH_SECRET=...                           # required; generate with: openssl rand -base64 32
PARALOG_PUBLIC_URL=https://journal.example.com    # the address you open Paralog at
PARALOG_OIDC_ISSUER=https://id.example.com        # your Pocket ID address
PARALOG_OIDC_CLIENT_ID=...                        # from step 1
PARALOG_OIDC_CLIENT_SECRET=...                    # from step 1; leave unset for a public client
PARALOG_OIDC_SUBJECT=placeholder                  # your Pocket ID user ID; see step 3
# PARALOG_OIDC_NAME=Pocket ID                     # optional sign-in button label
# PARALOG_PASSWORD=...                            # optional fallback for when Pocket ID is down
```

Restart Paralog with `docker compose up -d`. The sign-in page now shows a **Sign in with Pocket ID** button. If it does not, open the sign-in page once and Paralog logs which settings are missing:

```bash
docker compose logs paralog | grep "Pocket ID sign-in is off"
```

#### 3. Tell Paralog which user is you

`PARALOG_OIDC_SUBJECT` is your Pocket ID user ID: the token's `sub` claim, not your username or email. A user cannot change their own ID, so renaming the account or changing its email can never hand the journal to someone else.

1. With `PARALOG_OIDC_SUBJECT=placeholder`, click **Sign in with Pocket ID** and sign in. Paralog answers "That account is not this journal's owner." and logs your ID:

   ```bash
   docker compose logs paralog | grep "journal's owner"
   # {"level":"warn",...,"sub":"0b2a3c4d-…","msg":"Someone other than the journal's owner signed in to Pocket ID"}
   ```

2. Set `PARALOG_OIDC_SUBJECT` to that `sub` value, then run `docker compose up -d` again.
3. Sign in with Pocket ID. You land back on the day you were viewing.

Changing the issuer, client ID, or subject signs out every device.

#### How access is checked

Paralog checks each ID token's signature against Pocket ID's published keys. About once a day it also uses the refresh token from your last Pocket ID sign-in to ask whether you may still sign in. If Pocket ID refuses, because the user was disabled, removed from the client's allowed groups, or the client was deleted, Paralog signs out every device, including any signed in with the password. If Pocket ID cannot be reached, Paralog keeps you signed in and asks again an hour later.

To sign in with Pocket ID only, leave `PARALOG_PASSWORD` unset. Keeping it set gives you a way in when Pocket ID is down, but it is also a second way in for anyone who guesses it.

#### Troubleshooting

| What you see | Likely cause |
| --- | --- |
| No **Sign in with Pocket ID** button | A setting is missing. Check the log line shown in step 2. |
| Pocket ID reports an invalid callback URL | The callback URL in Pocket ID does not match `PARALOG_PUBLIC_URL` + `/api/auth/oidc/callback`. |
| "That sign-in took too long or started in another browser." | You opened Paralog at a different address than `PARALOG_PUBLIC_URL`, such as a LAN IP instead of the domain. Sign-in must start at the address Pocket ID returns you to. Taking more than 10 minutes also causes this. |
| "That account is not this journal's owner." | `PARALOG_OIDC_SUBJECT` does not match the user you signed in as. See step 3. |
| "Single sign-on is unavailable right now." | Paralog could not reach `PARALOG_OIDC_ISSUER`. Check that the Paralog container can resolve and reach Pocket ID. |
| "Single sign-on failed. Try again." | Usually a wrong client ID or secret. The log line "Pocket ID sign-in failed" gives the reason. |

### Sessions

Sessions last 30 days. Signing out ends the session on every device, and changing `PARALOG_PASSWORD`, `PARALOG_AUTH_SECRET`, or the Pocket ID issuer, client ID, or subject signs every device out. After 10 wrong passwords in 15 minutes, sign-in is refused, even with the right password, until the oldest attempt is 15 minutes old. Behind a reverse proxy the limit applies per client address, taken from the last `X-Forwarded-For` entry; exposed directly, all attempts share one limit.

Pending database migrations run automatically before Paralog begins serving requests, including after a Docker image upgrade. Migration files are bundled into the production image while the database remains on the persistent `/data` volume. When changing the database schema during development, run `npm run db:generate` and commit the generated files under `drizzle/`; use `npm run db:check` to validate the migration history.

Notification signing keys are generated automatically and retained in `journal.db`. Optionally set `PARALOG_VAPID_SUBJECT` to a `mailto:` address you monitor; it defaults to `mailto:paralog@localhost`.

## Observability

Paralog exports traces with the OpenTelemetry SDK over OTLP/HTTP. Export is off until an endpoint is set, so local development and tests send nothing. Set the standard OpenTelemetry variables to turn it on:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://clickstack-collector.example:4318
OTEL_EXPORTER_OTLP_HEADERS=authorization=your-ingestion-key
# OTEL_SERVICE_NAME=paralog
```

Replace `clickstack-collector.example:4318` with the OTLP/HTTP address of your collector (ClickStack, which stores traces and logs in ClickHouse). The ingestion key is `HYPERDX_INGESTION_KEY` in OpenBao `prod/observability`; keep it in `.env` and out of Git. Set `OTEL_SDK_DISABLED=true` to switch export off again, and restart Paralog after changing any of these. Other `OTEL_*` variables, such as `OTEL_EXPORTER_OTLP_PROTOCOL` or `OTEL_TRACES_EXPORTER`, are honored too.

Next.js produces the request spans, including route handlers.

Logs go to stdout as one JSON object per line (`level`, `time`, `msg`, extra fields, and a serialized `err` for errors), written through `lib/log.ts`. Lines logged inside a request also carry `trace_id`, `span_id` and `trace_flags`, so a log collector that reads stdout can match them to the request's trace. Set `PARALOG_LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) to change the threshold. Uncaught request errors are logged the same way, with their route.

The SDK does not export logs by default, because a collector that already reads container output would store every line twice. Set `OTEL_LOGS_EXPORTER=otlp` to send them through the SDK as well, for example when nothing collects stdout. Output from Next.js itself and from libraries is not JSON and is not exported.

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
