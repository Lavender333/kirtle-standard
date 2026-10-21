# Kirtle Standard

Cleaning-service website with hosted Square scheduling and a small account service. Public pages can remain static; secure owner/admin accounts use one Node.js 24+ process and a SQLite file. There are no third-party runtime packages or external database accounts to connect.

## Pages
- `index.html`: public website.
- `booking.html`: scheduling entry page, with a Square booking link when configured.
- `dashboard.html`: account login, personal username/password changes, and administrator account management. Links to Square for appointments and payments.
- `quote.html`: original detailed estimate, intake, checklist, and optional release. Requests go to FormSubmit, not Square.
- `forms.html`: compatibility redirect to the questionnaire.

## Activate live scheduling and checkout
1. Create/sign in to the business's Square account and enable Appointments.
2. Configure services, prices, durations, staff, availability, Eastern time zone, and service area. Square's service catalog is the source of truth for hosted checkout; the custom quote calculator does not transfer prices or intake into Square.
3. Activate payment processing and choose the applicable booking payment/cancellation policy. Check plan eligibility and processing fees. Square documents full prepayment for fixed-price services; the website does not configure or promise automatic 50% deposits. The existing 50% Zelle policy applies to manually confirmed custom quotes.
4. Under Appointments → Online Booking → Channels, enable online booking and obtain the booking flow URL using Get URL.
5. Set `bookingUrl` in `assets/booking-config.js` to that HTTPS Square URL and publish. Only public configuration belongs in this file. Supported hosts are `squareup.com`/subdomains and `square.site`/subdomains with a non-root path. For a Square website with a root-only or custom-domain URL, get its booking flow URL instead.
6. Test service selection, available dates, time zone, final price, checkout, and confirmation using the real business account before announcing online scheduling. Do not use real charges just to test the website wiring.

Until a valid booking link is supplied, clients see an honest "not open yet" message and can request a visit or call. No sample appointment or payment is treated as real. A configured URL indicates a link has been added, not that the merchant account or payment policy has been verified.

Manage appointments, customers, and transactions after signing in separately to Square from `dashboard.html`. Website accounts do not grant Square access. No plaintext credentials or private databases are committed or stored in browser storage. Quote requests still require owner follow-up and manual entry into Square to block out the agreed visit. Activate/verify FormSubmit delivery for `service@kirtlestandard.com` separately if not already completed.

Official guides: [Online booking](https://squareup.com/help/us/en/article/5355-set-up-online-booking-with-square-appointments) and [payment policies](https://squareup.com/help/us/en/article/5493-set-a-custom-cancellation-policy-with-square-appointments).

## Owner and administrator accounts

- Owners can change their own username/password and open the shared service tools.
- Administrators can view all accounts and the latest 100 account events, edit owner usernames, reset owner passwords, and disable/re-enable owners. Administrators change their own credentials in My account. Owners cannot access any admin API or change roles.
- Password changes and administrative edits revoke existing sessions. Self-service edits keep the current browser signed in with a new session. Current-password confirmation is required for changes.
- Passwords use salted scrypt hashes. Sessions use random, server-stored token hashes, HttpOnly/SameSite cookies, eight-hour expiry, and Secure cookies on HTTPS. Writes require matching origin and CSRF tokens. Login/change throttling is persisted. Rate limits currently use the direct connection IP; proxy deployments share that IP limit unless adapted to a trusted proxy configuration.
- Accounts and audit events are the private data in this workspace. Square appointments/payments and FormSubmit emails are not synced or exposed here. Admins cannot read anyone’s password.

## Run locally

Use Node.js 24 or later. `npm start` runs at `http://localhost:8000`; open `/dashboard.html`. No dependency installation is needed. `npm test` runs the account/authorization integration tests.

The first run creates `.data/accounts.sqlite`. To put private data elsewhere, set `DATA_DIR` to a private writable directory. Keep the SQLite file, WAL, and shared-memory files out of static hosting and backups available only to authorized operators.

Provision the initial owner and administrator once with `npm run setup:accounts`. The command reads a JSON array from standard input with `username`, `password`, and `role` (`owner` or `admin`) for each account. Supply the chosen credentials privately through stdin; do not commit a credentials file. Include an administrator. Setup refuses to overwrite existing accounts; restarting the server never restores old usernames/passwords. Use the same `DATA_DIR` for setup and start.

Passwords are not included in the repository, Docker image, documentation, or client-side code. There is no public signup or emailed password recovery. An administrator can reset an owner's password; keep the administrator login and a protected database backup available.

## Hosting

GitHub Pages cannot run the login/account service. To activate these accounts publicly, run the Node service on a host with HTTPS and persistent disk. It serves both the public website and `/api` from the same origin. Do not publish the SQLite database on GitHub Pages. The GitHub Pages-only dashboard shows that the account service is unavailable.

Set `APP_ORIGIN` to the exact HTTPS site origin (no trailing slash), `PORT` to the service port, `HOST=0.0.0.0` when needed by the host, and `DATA_DIR` to the mounted private persistent directory. The HTTPS reverse proxy must preserve the public Host header. The service rejects non-local HTTP origins and requests from another Host/Origin. Use one service instance per SQLite disk; multi-instance scaling requires a shared database design. Back up the database using SQLite's backup mechanism or while the service is stopped.

An optional Dockerfile is included: build the image, mount a persistent volume at `/data`, set `APP_ORIGIN`, and expose container port 8080 behind HTTPS. Provision accounts by running `server/setup.mjs` in the container with private stdin and the same volume. The image runs as a non-root user; the mounted volume must be writable by that user.

For public-page-only preview, `python3 -m http.server 8000` works **only in a directory without the private account database**. It does not support accounts. The Node server uses an explicit public-file allowlist and is the preferred preview.
