# Kirtle Standard

Cleaning-service website with hosted Square scheduling and a small account service. Public pages can remain static; secure owner/admin accounts use one Node.js 24+ process and a SQLite file. There are no third-party runtime packages or external database accounts to connect.

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

Website intake uses a per-submission idempotency key, validation, same-origin checks, and request throttling. A success response is shown only after the database save. It does not charge or reserve a slot, and does not send email. There is no public endpoint to read client details. Public/static hosting without the account server cannot accept intake.

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

Use Node.js 24 or later. `npm start` runs at `http://localhost:8000`; open `/dashboard.html`. No dependency installation is needed. `npm test` runs account, job, intake, authorization, checklist, and mocked Square integration tests. Browser checks should also exercise mobile intake, owner approval/checkmarks, reload persistence, and administrator visibility. The tests do not use real clients or make live Square requests.

The first run creates `.data/accounts.sqlite`. To put private data elsewhere, set `DATA_DIR` to a private writable directory. Keep the SQLite file, WAL, and shared-memory files out of static hosting and backups available only to authorized operators.

Provision the initial owner and administrator once with `npm run setup:accounts`. The command reads a JSON array from standard input with `username`, `password`, and `role` (`owner` or `admin`) for each account. Supply the chosen credentials privately through stdin; do not commit a credentials file. Include an administrator. Setup refuses to overwrite existing accounts; restarting the server never restores old usernames/passwords. Use the same `DATA_DIR` for setup and start.

Passwords are not included in the repository, Docker image, documentation, or client-side code. There is no public signup or emailed password recovery. An administrator can reset an owner's password; keep the administrator login and a protected database backup available.

## Hosting

GitHub Pages cannot run the login/account service. To activate these accounts publicly, run the Node service on a host with HTTPS and persistent disk. It serves both the public website and `/api` from the same origin. Do not publish the SQLite database on GitHub Pages. The GitHub Pages-only dashboard shows that the account service is unavailable.

Set `APP_ORIGIN` to the exact HTTPS site origin (no trailing slash), `PORT` to the service port, `HOST=0.0.0.0` when needed by the host, and `DATA_DIR` to the mounted private persistent directory. The HTTPS reverse proxy must preserve the public Host header. The service rejects non-local HTTP origins and requests from another Host/Origin. Use one service instance per SQLite disk; multi-instance scaling requires a shared database design. Back up the database using SQLite's backup mechanism or while the service is stopped.

An optional Dockerfile is included: build the image, mount a persistent volume at `/data`, set `APP_ORIGIN`, and expose container port 8080 behind HTTPS. Provision accounts by running `server/setup.mjs` in the container with private stdin and the same volume. The image runs as a non-root user; the mounted volume must be writable by that user.

For public-page-only preview, `python3 -m http.server 8000` works **only in a directory without the private account database**. It does not support accounts. The Node server uses an explicit public-file allowlist and is the preferred preview.
