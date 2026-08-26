#!/usr/bin/env python3
"""Create a consistent SQLite backup without stopping IBuy."""
import os, sqlite3, time
src=os.getenv("IBUY_DB_PATH","ibuy.sqlite3")
out=os.getenv("IBUY_BACKUP_PATH",f"ibuy-backup-{time.strftime('%Y%m%d-%H%M%S')}.sqlite3")
if not os.path.exists(src):
    raise SystemExit(f"Database not found: {src}")
a=sqlite3.connect(src)
b=sqlite3.connect(out)
try:
    with b:
        a.backup(b)
finally:
    b.close(); a.close()
print(out)
