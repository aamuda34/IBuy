# IBuy V2.3 — Public-Ready Non-Payment Discovery & Reservation Build

IBuy is a local commerce discovery and reservation product. Payments are intentionally excluded.

## New in V2.3
- Seller captures exact shop coordinates from the device during registration/onboarding.
- Seller can recapture/change exact shop coordinates any time from Seller > Store profile.
- Shop location records capture accuracy, timestamp and device-GPS source.
- Seller can take a storefront photograph directly with the phone camera (`capture=environment`).
- Storefront image is shown to buyers on store cards and store profiles.
- Seller location and storefront identity are separate from buyer live-location sharing.
- Admin verification no longer overwrites a seller's location-capture state.

## Payment boundary
There is no payment system, payment provider, checkout, payment table, or payment webhook.
Reservations are for in-person pickup/payment.

## Public deployment boundary
The included server is still intentionally dependency-free Python. Before internet exposure, set a strong `IBUY_SESSION_SECRET`, enable `IBUY_SECURE_COOKIES=1`, bind to `0.0.0.0`, place the service behind HTTPS, and use persistent storage/backups. The current SQLite implementation is suitable for an initial controlled launch, not unlimited scale or multi-instance horizontal scaling.


## V2.4 — WhatsApp + Discovery
- Added normalized WhatsApp deep-link helpers for direct contact.
- Added horizontal Trending and Random Discovery feed components with no fixed item cap.
- Random Discovery rotates using a local seed and avoids recently viewed products when history is available.
- Payments remain intentionally excluded.


## V2.5 — Integrated WhatsApp + Discovery
Trending and Random Discovery are now rendered on Shop using server-backed catalog activity. WhatsApp contact is available to buyers and sellers with direct WhatsApp links. Payments remain excluded.


## V2.6 — Production hardening
- Production configuration is fail-closed for public hosts.
- Secure cookies and HTTPS public URL are required outside local development.
- Static files are allow-listed to prevent source/database exposure.
- Security response headers added.
- User API responses redact password hashes and verification tokens.
- Buyer WhatsApp contact permission added.
- Seller WhatsApp changes synchronize to the store contact.
- Email verification links support an absolute production base URL.
- SQLite backup helper included.
- Payments remain intentionally excluded.


## V2.7 — Mobile Navigation
- Android/browser Back now walks through IBuy's previous screens instead of immediately leaving the app.
- Navigation uses browser history entries for Shop, Basket, Stores, Orders, Seller, Product and Store routes.
- Previous scroll positions are restored when navigating backward/forward where available.
- The main navigation bar is sticky and remains accessible while the user scrolls.
- Mobile navigation is horizontally scrollable when necessary and respects device safe-area insets.


## V2.8 — Fixed Navigation
The mobile navigation is fixed to the viewport and remains visible while the user scrolls. Service-worker cache is bumped to v2.8 and CSS/JS assets are cache-busted.


## V2.9 — Registration stability fix
- Fixed seller registration crash caused by missing `re` import when normalizing the store WhatsApp number.
- Registration errors now remain server responses rather than terminating the request thread.
- Service-worker cache and frontend asset version bumped to V2.9.

## V2.13 — Header Visibility Fix
- The account/brand header is fixed above the persistent navigation.
- Sign in, account, WhatsApp and sign-out controls remain visible and are no longer covered by the navigation bar.
- The Shop/Basket/Stores/Orders/Seller navigation remains fixed directly below the account header while scrolling.
- Content receives combined top spacing for both fixed bars.
- Service-worker cache bumped to V2.13.
