# IBuy V2.3

IBuy is a mobile-first local commerce discovery and reservation app. It helps buyers discover products, compare store information, reserve stock, navigate to the exact shop, and optionally share time-limited arrival location with the selected store.

## No payments
Payments are deliberately excluded. IBuy is a discovery/reservation application with in-person payment.

## Seller location
During seller registration/onboarding, IBuy asks the seller to capture the exact shop location using high-accuracy browser geolocation. The seller can change it at any time from the Seller store profile. The database stores the coordinates, capture accuracy, capture time and device-GPS source.

## Storefront identity
Sellers can take a storefront photo using the phone camera. Buyers see this image on store cards and store profiles so they can identify the physical shop.

## Local run
```bash
python server.py
```
Default: http://127.0.0.1:8090

## Production minimums
Set:
```bash
export IBUY_SESSION_SECRET="a-long-random-secret"
export IBUY_SECURE_COOKIES=1
export IBUY_HOST=0.0.0.0
export IBUY_PORT=8090
```
Use HTTPS at the edge and persistent storage/backups. Do not expose the local-development secret.


## V2.4
WhatsApp contact helpers and unlimited horizontal Trending / Random Discovery feed components are included. Payments are intentionally excluded.


## V2.5 — Integrated WhatsApp + Discovery
Trending and Random Discovery are now rendered on Shop using server-backed catalog activity. WhatsApp contact is available to buyers and sellers with direct WhatsApp links. Payments remain excluded.


## V2.6 Production Hardening
See `DEPLOYMENT.md` and `.env.example`. Public deployment requires a strong `IBUY_SESSION_SECRET`, secure cookies, HTTPS, and persistent database storage. Payments are intentionally excluded.


## V2.7
Improved Android/mobile navigation with browser history Back behavior, scroll-position restoration, and a sticky navigation bar.


## V2.8 — Fixed Navigation
The mobile navigation is fixed to the viewport and remains visible while the user scrolls. Service-worker cache is bumped to v2.8 and CSS/JS assets are cache-busted.


## V2.9
Registration stability fix: WhatsApp number normalization during seller signup now has the required Python `re` module imported.

V2.13 fixes the fixed-header overlap so account controls remain visible above the persistent navigation.
