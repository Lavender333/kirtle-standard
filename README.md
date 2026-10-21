# Kirtle Standard

Static cleaning-service website for GitHub Pages. No build, database, API keys, or custom backend is required.

## Pages
- `index.html`: public website.
- `booking.html`: scheduling entry page, with a Square booking link when configured.
- `dashboard.html`: owner entry page linking to the real, authenticated Square dashboard. This public page does not contain customer records or implement authentication.
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

Manage appointments, customers, and transactions after signing in to Square from `dashboard.html`. No credentials or customer data are stored in browser storage or in this repository. Quote requests still require owner follow-up and manual entry into Square to block out the agreed visit. Activate/verify FormSubmit delivery for `service@kirtlestandard.com` separately if not already completed.

Official guides: [Online booking](https://squareup.com/help/us/en/article/5355-set-up-online-booking-with-square-appointments) and [payment policies](https://squareup.com/help/us/en/article/5493-set-a-custom-cancellation-policy-with-square-appointments).

## Preview and publish
Run `python3 -m http.server 8000` in this directory, then visit `http://localhost:8000`.
In repository Settings → Pages, use Deploy from a branch, main, and / (root).
