(() => {
  "use strict";
  // Square-hosted booking links only; no arbitrary redirects or executable URLs.
  function bookingUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname;
      const squareHost = host === "squareup.com" || host.endsWith(".squareup.com") ||
        host === "square.site" || host.endsWith(".square.site");
      if (url.protocol !== "https:" || url.username || url.password || url.port || !squareHost || url.pathname === "/") return null;
      return url.href;
    } catch { return null; }
  }
  const url = bookingUrl(window.KIRTLE_BOOKING?.bookingUrl);
  const link = document.getElementById("schedule-link");
  if (link && url) {
    link.href = url;
    document.getElementById("booking-ready").hidden = false;
    document.getElementById("booking-unavailable").hidden = true;
  }
  const status = document.getElementById("connection-status");
  if (status) status.textContent = url
    ? "Booking link added. Test the client booking flow in Square before sharing it."
    : "Setup needed: add your Square booking link to enable online scheduling.";
})();
