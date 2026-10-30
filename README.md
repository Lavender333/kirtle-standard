# Kirtle Standard

Cleaning-service website with Square scheduling, owner/admin accounts, and private cleaning-job management. Production uses Supabase Postgres and the `kirtle-api` Edge Function; public pages can stay on GitHub Pages. The original Node.js 24+ / SQLite server remains available for local development. Both deployments share the same validation, account, and cleaning-workflow code.

## Supabase production deployment

Target project: `ywuylrdtimpqhhtipqnh`, in Kirtle Cleaning. Deploy the backend **before** publishing the frontend changes. A configured URL does not prove a successful deployment.

1. Apply `supabase/migrations/20261029205300_kirtle_private_backend.sql` to the target database using the authenticated Supabase CLI or SQL Editor. It creates a separate `kirtle_private` schema; it does not replace existing tables. Inspect the schema first and apply this initial migration once. Keep this schema out of the Data API's exposed schemas. Every table has RLS enabled, and the public, anon, and authenticated roles have no access. Only the server database connection can access these tables.
2. Deploy `kirtle-api` with `supabase functions deploy kirtle-api --project-ref ywuylrdtimpqhhtipqnh --use-api`. The checked-in function configuration disables Supabase JWT verification because this application has its own username/password sessions. Public intake, login, and health are the only public operations; customer records and administrator operations require a server-validated session and role. The function uses the platform-provided `SUPABASE_DB_URL`; do not put it or any service key into the website.
3. Provision the initial owner and administrator privately: set `DATABASE_URL` to a Supabase TLS database connection string, then run `npm run setup:supabase` with the same JSON stdin format described below. No default passwords, public signup, or public bootstrap endpoint exists. The command is transactional, refuses to replace any existing accounts, and does not print passwords. Supabase dashboard sign-in is separate from the website's owner/admin sign-in. Existing SQLite accounts and jobs are **not automatically migrated**; preserve the old database and plan an explicit migration if it contains real data.
4. `assets/api-config.js` routes `kirtlecleans.com` and `www.kirtlecleans.com` to the function. Other hosts use the same-origin local server by default. If adding another production host, update both this file and the server-only `KIRTLE_ALLOWED_ORIGINS` setting. CORS is restricted to exact HTTPS origins; no wildcard is used. Verify the website's HTTPS certificate before clients submit details or log in.
5. Verify `GET /functions/v1/kirtle-api/api/health` returns `{ "ok": true }`, then check login, intake submission, review, checklist reload persistence, admin visibility, and logout on the real site. Use clearly labeled test data and remove it through an approved maintenance procedure.

The database is authoritative: request idempotency, account throttling, sessions, checklist revisions, sync timestamps, and sync errors persist across Edge Function instances. Cross-origin owner sessions use random, eight-hour bearer tokens kept in the current browser tab's `sessionStorage`; only token hashes are stored server-side. Passwords are never stored in the browser. Account changes and disabling an owner revoke their sessions. The local Node server continues using HttpOnly cookies. Writes require matching origins and CSRF tokens in both modes.

Edge requests share a persistent conservative rate-limit bucket (15 intake attempts and 30 login attempts per 15 minutes, plus per-username login limits); caller-controlled forwarding headers cannot bypass it. A busier deployment should add verified edge IP handling or a challenge service before raising limits. Transactional mutations use a database lock, and checklist updates also compare revisions atomically.

Square syncing on the Edge deployment is **manual**, through the authenticated dashboard's Sync button, after the server-only Square secrets are configured. The optional Node deployment also runs its five-minute sync timer. No scheduled Edge sync is configured by this change. The website request workflow works independently of Square; requesting a visit does not reserve a slot, collect payment, or send email.

Validation: `npm ci`, `npm test`, and `npm run check:edge`. Tests include PostgreSQL execution through PGlite, deny-public-access checks, the real Web Request handler, account lifecycle and role isolation, durable intake, optimistic concurrency, and SQLite regression coverage. They do not verify live Square credentials or merchant payment settings.

## Pages
- `index.html`: public website.
- `booking.html`: scheduling entry page, with a Square booking link when configured.
- `dashboard.html`: appointments, client details, ordered cleaning plans, saved checkmarks, account settings, and administrator account management.
- `quote.html`: detailed estimate, intake, checklist, and optional release. Submissions save privately to this website through `/api/requests`; they no longer go to FormSubmit.
- `forms.html`: compatibility redirect to the questionnaire.

## Activate live scheduling and checkout
1. Create/sign in to the business's Square account and enable Appointments.
2. Configure services, prices, durations, staff, availability, Eastern time zone, and service area. Square's service catalog is the source of truth for hosted checkout; the custom quote calculator does not transfer prices or intake into Square.
3. Activate payment processing and choose the applicable booking payment/cancellation policy. Check plan eligibility and processing fees. Square documents full prepayment for fixed-price services; the website does not configure or promise automatic 50% deposits. The existing 50% Zelle policy applies to manually confirmed custom quotes.
4. Under Appointments → Online Booking → Channels, enable online booking and obtain the booking flow URL using Get URL.
5. Set `bookingUrl` in `assets/booking-config.js` to that HTTPS Square URL and publish. Only public configuration belongs in this file. Supported hosts are `squareup.com`/subdomains and `square.site`/subdomains with a non-root path. For a Square website with a root-only or custom-domain URL, get its booking flow URL instead.
6. Test service selection, available dates, time zone, final price, checkout, and confirmation using the real business account before announcing online scheduling. Do not use real charges just to test the website wiring.

Until a valid booking link is supplied, clients see an honest "not open yet" message and can request a visit or call. No sample appointment or payment is treated as real. A configured URL indicates a link has been added, not that the merchant account or payment policy has been verified.

Manage appointments, customers, and transactions after signing in separately to Square from `dashboard.html`. Website accounts do not grant Square access. No plaintext credentials or private databases are committed or stored in browser storage. Website requests appear in the private appointments dashboard immediately. They still need owner confirmation and entry into Square to reserve time. Staff can attach the saved questionnaire to the matching imported Square appointment; no automatic match is made from an unverified name, email, or reference.

Official guides: [Online booking](https://squareup.com/help/us/en/article/5355-set-up-online-booking-with-square-appointments) and [payment policies](https://squareup.com/help/us/en/article/5493-set-a-custom-cancellation-policy-with-square-appointments).

## Owner and administrator accounts

- Owners can view the business’s appointments and client details, approve cleaning plans, save checklist progress and work notes, and change their own username/password. This is a single-business workspace, not a client portal; all owners see the same jobs.
- Administrators can view all accounts and the latest 100 account events, edit owner usernames, reset owner passwords, and disable/re-enable owners. Administrators change their own credentials in My account. Owners cannot access any admin API or change roles.
- Password changes and administrative edits revoke existing sessions. Self-service edits keep the current browser signed in with a new session. Current-password confirmation is required for changes.
- Passwords use salted scrypt hashes. Sessions use random, server-stored token hashes, HttpOnly/SameSite cookies, eight-hour expiry, and Secure cookies on HTTPS. Writes require matching origin and CSRF tokens. Login/change throttling is persisted. Rate limits currently use the direct connection IP; proxy deployments share that IP limit unless adapted to a trusted proxy configuration.
- Accounts, audit events, client intake, appointment snapshots, work notes, and checklist progress are private server data. Administrators see the same jobs as owners plus account controls. Square payments are not imported; admins cannot read passwords or card information.

## Cleaning jobs and saved progress

After login, Kayla and the administrator land on Appointments. The dashboard shows client contact information, service address, visit time in Eastern Time, original room/add-on selections, client requests, pets/product preferences, arrival instructions, optional photo consent, and work notes. There is no sample client data in the live database.

Each website intake starts as **Needs review**, not a confirmed booking. Staff verify the service address, appointment, and cleaning scope before approving a plan. Square-only visits can be planned manually or linked to the correct website questionnaire after verifying the client and visit. The original intake remains stored even when the approved plan changes.

Checklists are generated on the server from the approved service, room counts, and extras: arrival/preparation, high surfaces, kitchen, bathrooms, living spaces/bedrooms, extras, floors, final walkthrough. Special requests are shown prominently for staff review; free-text exclusions are not silently interpreted. Staff must adjust room counts and instructions for rooms to skip. Checkmarks and notes are stored in SQLite and visible across devices to both roles. Concurrent edits return a refresh warning rather than overwriting a newer version. Complete requires all checklist items checked; record unfinished work in notes and keep the job in progress.

Website intake uses a per-submission idempotency key, validation, same-origin checks, and request throttling. A success response is shown only after the database save. It does not charge or reserve a slot, and does not send email. There is no public endpoint to read client details. Static hosting must use the configured Supabase API; a static-only preview without that API or the local account server cannot accept intake.

## Connect Square appointments to this website

Set these **server-side hosting secrets/settings**, never in `assets/booking-config.js`:

- `SQUARE_ACCESS_TOKEN`: an access token for this business’s Square account. For a single merchant, provision it privately through the Square developer dashboard/hosting secret manager. Do not paste it into source control or client code. OAuth for multiple merchants is not implemented.
- `SQUARE_ENVIRONMENT`: `production` (default) or `sandbox`. Use separate private data directories for each.
- `SQUARE_LOCATION_ID`: optional restriction to the business location.

The integration needs seller-level booking reads (`APPOINTMENTS_READ` and `APPOINTMENTS_ALL_READ`), customer reads (`CUSTOMERS_READ`), and catalog reads (`ITEMS_READ`). Verify the account has the required Square Appointments capabilities/plan. The public booking URL alone cannot authorize reading private client data.

When configured, the server performs a read-only sync at startup and every five minutes. Both authenticated roles can request a manual sync. It imports bookings from the previous 30 days through the next 180 days, with explicit 31-day windows and pagination. Known unfinished appointments outside that window are retrieved individually so reschedules are not lost. Previously imported records remain saved; this is not a full historical import of all Square records.

The sync retrieves booking status/date/duration, customer name/contact information, the actual customer-location booking address when supplied, customer/seller notes, and service names from the catalog. A customer-profile address is displayed separately and is never silently treated as the service address. Missing fields are flagged for staff confirmation. Room counts, cleaning preferences, and the optional release come from the website intake or staff-approved plan; Square does not provide these automatically. Square custom attributes/forms and payments are not imported by this version.

Sync is one-way **Square → this website**. Scheduling, rescheduling, cancellation, and payment changes are made in Square. Cleaning checks/notes stay on this website. Sync preserves local intake and task progress; significant Square changes require another plan review. Cancelled/declined/no-show bookings cannot be worked or completed. Failed syncs retain the prior saved snapshot and show an error and last successful sync time; check Square when data is stale. A successful sync commits its complete result atomically. No live Square connection has been verified until a real account token is supplied and tested.

API documentation: [List bookings](https://developer.squareup.com/reference/square/bookings-api/list-bookings), [booking fields](https://developer.squareup.com/reference/square/objects/Booking), [customer details](https://developer.squareup.com/reference/square/customers-api/retrieve-customer), and [service catalog](https://developer.squareup.com/reference/square/catalog-api/retrieve-catalog-object).

## Run locally

Use Node.js 24 or later. `npm start` runs at `http://localhost:8000`; open `/dashboard.html`. Run `npm ci` to install the pinned development/deployment dependencies. `npm test` runs account, job, intake, authorization, checklist, and mocked Square integration tests. Browser checks should also exercise mobile intake, owner approval/checkmarks, reload persistence, and administrator visibility. The tests do not use real clients or make live Square requests.

The first run creates `.data/accounts.sqlite`. To put private data elsewhere, set `DATA_DIR` to a private writable directory. Keep the SQLite file, WAL, and shared-memory files out of static hosting and backups available only to authorized operators.

Provision the initial owner and administrator once with `npm run setup:accounts`. The command reads a JSON array from standard input with `username`, `password`, and `role` (`owner` or `admin`) for each account. Supply the chosen credentials privately through stdin; do not commit a credentials file. Include an administrator. Setup refuses to overwrite existing accounts; restarting the server never restores old usernames/passwords. Use the same `DATA_DIR` for setup and start.

Passwords are not included in the repository, Docker image, documentation, or client-side code. There is no public signup or emailed password recovery. An administrator can reset an owner's password; keep the administrator login and a protected database backup available.

## Hosting

GitHub Pages serves the frontend and uses the Supabase Edge Function described above for accounts and intake. For an alternative self-hosted deployment, set `KIRTLE_API_BASE` to an empty string in the frontend configuration and run the Node service on a host with HTTPS and persistent disk. It serves both the public website and `/api` from the same origin. Do not publish the SQLite database on GitHub Pages. The GitHub Pages-only dashboard shows that the account service is unavailable.

Set `APP_ORIGIN` to the exact HTTPS site origin (no trailing slash), `PORT` to the service port, `HOST=0.0.0.0` when needed by the host, and `DATA_DIR` to the mounted private persistent directory. The HTTPS reverse proxy must preserve the public Host header. The service rejects non-local HTTP origins and requests from another Host/Origin. Use one service instance per SQLite disk; multi-instance scaling requires a shared database design. Back up the database using SQLite's backup mechanism or while the service is stopped.

An optional Dockerfile is included: build the image, mount a persistent volume at `/data`, set `APP_ORIGIN`, and expose container port 8080 behind HTTPS. Provision accounts by running `server/setup.mjs` in the container with private stdin and the same volume. The image runs as a non-root user; the mounted volume must be writable by that user.

For public-page-only preview, `python3 -m http.server 8000` works **only in a directory without the private account database**. It does not support accounts. The Node server uses an explicit public-file allowlist and is the preferred preview.
