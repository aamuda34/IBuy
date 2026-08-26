# IBuy V2.6 Production Readiness

## What changed
- Version 2.6.
- Production startup refuses unsafe non-local configuration: default/short session secrets, non-secure cookies, or a non-HTTPS public base URL.
- Uses the platform `PORT` when supplied.
- Static file serving is allow-listed; database, Python source, and arbitrary paths are not exposed.
- Adds security response headers.
- Fixes `/api/account/update` so it is POST-only.
- User API responses no longer expose password hashes or email-verification tokens.
- Seller WhatsApp updates synchronize to the store contact channel.
- Buyers can choose whether sellers may contact them on WhatsApp.
- Seller reservation views can contact opted-in buyers directly through WhatsApp.
- Email verification links use `IBUY_PUBLIC_BASE_URL` in production.
- Discovery remains payment-free.
- Reservation expiry/restocking and location-session expiry continue to run automatically.
- Includes `backup_db.py` for consistent SQLite backups.

## Local test
```bash
python -m py_compile server.py
node --check app.js
python server.py
```

Open `http://127.0.0.1:8090`.

## Production environment
Set:
- `IBUY_SESSION_SECRET`: random, 32+ characters
- `IBUY_SECURE_COOKIES=1`
- `IBUY_PUBLIC_BASE_URL=https://your-real-domain`
- `IBUY_DB_PATH` to persistent storage
- `IBUY_BOOTSTRAP_ADMIN_EMAIL` and `IBUY_BOOTSTRAP_ADMIN_PASSWORD` for the first production admin (12+ character password)
- notification provider credentials if email/SMS notifications are wanted

Never publish the `.env` file or secrets.

## Backup
```bash
python backup_db.py
```

## Important
IBuy intentionally has no payment system. It is a local discovery, contact, reservation and pickup platform.


Production databases do **not** receive the local demo accounts. On a fresh public database, the bootstrap admin is created only from the two bootstrap environment variables above.
