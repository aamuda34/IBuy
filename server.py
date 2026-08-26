import os, re, json, time, uuid, sqlite3, hashlib, base64, secrets, hmac, threading, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from collections import defaultdict

ROOT=os.path.dirname(os.path.abspath(__file__))
DB=os.getenv("IBUY_DB_PATH",os.path.join(ROOT,"ibuy.sqlite3"))
HOST=os.getenv("IBUY_HOST","127.0.0.1")
PORT=int(os.getenv("PORT",os.getenv("IBUY_PORT","8090")))
SECRET_VALUE=os.getenv("IBUY_SESSION_SECRET","")
SECRET=SECRET_VALUE.encode() if SECRET_VALUE else b""
SESSION_TTL=7*24*3600
MAX_BODY=2*1024*1024
RATE_WINDOW=300
RATE_LIMIT=8
FAILED=defaultdict(list); RATE_LOCK=threading.Lock()
SECURE_COOKIES=os.getenv("IBUY_SECURE_COOKIES","0") == "1"
PUBLIC_BASE_URL=os.getenv("IBUY_PUBLIC_BASE_URL","").rstrip("/")


def now(): return int(time.time())
def uid(p="id"): return p+"_"+uuid.uuid4().hex[:20]
def j(x): return json.dumps(x,separators=(",",":"),ensure_ascii=False)
def conn():
    c=sqlite3.connect(DB,timeout=10); c.row_factory=sqlite3.Row; c.execute("PRAGMA foreign_keys=ON"); return c
def q(c,sql,args=(),one=False): return c.execute(sql,args).fetchone() if one else c.execute(sql,args).fetchall()
def hashpw(p,salt=None):
    salt=salt or secrets.token_bytes(16); dk=hashlib.pbkdf2_hmac("sha256",p.encode(),salt,210000)
    return base64.b64encode(salt).decode()+":"+base64.b64encode(dk).decode()
def checkpw(p,stored):
    try:
        a,b=stored.split(":"); salt=base64.b64decode(a); got=hashpw(p,salt).split(":")[1]
        return hmac.compare_digest(got,b)
    except Exception:return False
def token(payload):
    raw=j(payload).encode(); sig=hmac.new(SECRET,raw,hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(raw).decode()+"."+sig
def untoken(t):
    try:
        a,b=t.split(".",1); raw=base64.urlsafe_b64decode(a.encode())
        if not hmac.compare_digest(hmac.new(SECRET,raw,hashlib.sha256).hexdigest(),b): return None
        x=json.loads(raw); return x if x.get("exp",0)>=now() else None
    except Exception:return None
def audit(c,actor,action,etype,eid,meta=None):
    c.execute("INSERT INTO audit VALUES(?,?,?,?,?,?,?)",(uid("aud"),actor,action,etype,eid,j(meta or {}),now()))
def add_col(c,table,col,definition):
    cols=[x["name"] for x in c.execute(f"PRAGMA table_info({table})")]
    if col not in cols: c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
def stock_status(qty,threshold=2):
    return "in_stock" if qty>threshold else ("low" if qty>0 else "out_of_stock")
def secure_cookie(t,max_age=SESSION_TTL):
    secure="; Secure" if SECURE_COOKIES else ""
    return f"ibuy_session={t}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}"

def init_db():
    c=conn(); c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,phone TEXT,whatsapp_number TEXT,allow_seller_whatsapp INTEGER NOT NULL DEFAULT 1,role TEXT NOT NULL CHECK(role IN ('buyer','seller','staff','admin')),password_hash TEXT NOT NULL,created_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,email_verified INTEGER NOT NULL DEFAULT 0,verification_token TEXT,verification_expires_at INTEGER);
    CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,address TEXT NOT NULL,landmark TEXT,lat REAL NOT NULL,lon REAL NOT NULL,hours TEXT,verification_tier TEXT NOT NULL,location_verified INTEGER NOT NULL DEFAULT 0,phone TEXT,created_at INTEGER NOT NULL,description TEXT DEFAULT '',image_b64 TEXT,verified_at INTEGER,location_accuracy REAL,location_captured_at INTEGER,location_source TEXT);
    CREATE TABLE IF NOT EXISTS staff(user_id TEXT NOT NULL,store_id TEXT NOT NULL,permissions TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,store_id));
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,store_id TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,unit TEXT NOT NULL,price INTEGER NOT NULL,stock_qty REAL NOT NULL,stock_status TEXT NOT NULL,price_updated_at INTEGER NOT NULL,stock_updated_at INTEGER NOT NULL,confidence TEXT NOT NULL,image_b64 TEXT,active INTEGER NOT NULL DEFAULT 1,description TEXT DEFAULT '',created_at INTEGER DEFAULT 0,low_stock_threshold REAL DEFAULT 2);
    CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL,store_id TEXT NOT NULL,status TEXT NOT NULL,intent TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,notes TEXT);
    CREATE TABLE IF NOT EXISTS reservation_items(reservation_id TEXT NOT NULL,product_id TEXT NOT NULL,qty REAL NOT NULL,unit_price INTEGER NOT NULL,PRIMARY KEY(reservation_id,product_id));
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,reservation_id TEXT UNIQUE NOT NULL,buyer_id TEXT NOT NULL,store_id TEXT NOT NULL,status TEXT NOT NULL,total INTEGER NOT NULL,completed_at INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS location_sessions(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL,store_id TEXT NOT NULL,mode TEXT NOT NULL,started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,stopped_at INTEGER,lat REAL,lon REAL,accuracy REAL);
    CREATE TABLE IF NOT EXISTS disputes(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,reservation_id TEXT,kind TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,owner_id TEXT,evidence TEXT,created_at INTEGER NOT NULL,resolved_at INTEGER);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL,store_id TEXT NOT NULL,order_id TEXT NOT NULL,rating INTEGER NOT NULL,comment TEXT,created_at INTEGER NOT NULL,UNIQUE(buyer_id,order_id));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,metadata TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS store_documents(id TEXT PRIMARY KEY,store_id TEXT NOT NULL,kind TEXT NOT NULL,file_b64 TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name); CREATE INDEX IF NOT EXISTS idx_products_category ON products(category); CREATE INDEX IF NOT EXISTS idx_res_store ON reservations(store_id,status); CREATE INDEX IF NOT EXISTS idx_loc_store ON location_sessions(store_id,stopped_at,expires_at);
    """)
    add_col(c,"users","whatsapp_number","TEXT"); add_col(c,"users","allow_seller_whatsapp","INTEGER NOT NULL DEFAULT 1"); add_col(c,"users","email_verified","INTEGER NOT NULL DEFAULT 0"); add_col(c,"users","verification_token","TEXT"); add_col(c,"users","verification_expires_at","INTEGER")
    add_col(c,"stores","image_b64","TEXT"); add_col(c,"stores","verified_at","INTEGER"); add_col(c,"stores","location_accuracy","REAL"); add_col(c,"stores","location_captured_at","INTEGER"); add_col(c,"stores","location_source","TEXT")
    add_col(c,"products","created_at","INTEGER DEFAULT 0"); add_col(c,"products","low_stock_threshold","REAL DEFAULT 2")
    if q(c,"SELECT id FROM users LIMIT 1",one=True) is None: seed(c)
    # Existing demo accounts are deliberately verified so the local demo remains usable.
    c.execute("UPDATE users SET email_verified=1 WHERE email IN ('admin@ibuy.local','seller@ibuy.local')")
    c.commit(); c.close()

def seed(c):
    admin_email=os.getenv("IBUY_BOOTSTRAP_ADMIN_EMAIL","").strip().lower()
    admin_password=os.getenv("IBUY_BOOTSTRAP_ADMIN_PASSWORD","")
    if HOST not in ("127.0.0.1","localhost","::1") and not os.getenv("IBUY_SEED_DEMO","0")=="1":
        if not admin_email or len(admin_password)<12:
            return
        admin=uid("usr"); ts=now()
        c.execute("INSERT INTO users(id,email,name,phone,whatsapp_number,allow_seller_whatsapp,role,password_hash,created_at,active,email_verified,verification_token,verification_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(admin,admin_email,"IBuy Administrator","","",0,"admin",hashpw(admin_password),ts,1,1,None,None))
        audit(c,admin,"bootstrap_admin","user",admin,{"source":"environment"})
        return
    admin,seller=uid("usr"),uid("usr"); ts=now()
    c.execute("INSERT INTO users(id,email,name,phone,whatsapp_number,allow_seller_whatsapp,role,password_hash,created_at,active,email_verified,verification_token,verification_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(admin,"admin@ibuy.local","IBuy Admin","","",1,"admin",hashpw("Admin123!"),ts,1,1,None,None))
    c.execute("INSERT INTO users(id,email,name,phone,whatsapp_number,allow_seller_whatsapp,role,password_hash,created_at,active,email_verified,verification_token,verification_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(seller,"seller@ibuy.local","Demo Seller","08000000000","2348000000000",1,"seller",hashpw("Seller123!"),ts,1,1,None,None))
    stores=[("Iwo Central Market Store","Oke Afo, Iwo","Near Central Market",7.6356,4.1815,"08:00-20:00"),("Iwo Household Hub","Oke Omiru, Iwo","Opposite Community Hall",7.6320,4.1778,"08:00-19:00")]
    ids=[]
    for name,address,landmark,lat,lon,hours in stores:
        sid=uid("sto"); ids.append(sid)
        c.execute("INSERT INTO stores(id,owner_id,name,address,landmark,lat,lon,hours,verification_tier,location_verified,phone,created_at,description,image_b64,verified_at,location_accuracy,location_captured_at,location_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(sid,seller,name,address,landmark,lat,lon,hours,"verified",1,"08000000000",ts,"Local store available for reservation.",None,ts,8.0,ts,"seed"))
    cats=[("Spaghetti","Groceries","500g",950,25),("Tomato Paste","Groceries","400g",700,18),("Rice","Groceries","1kg",1800,40),("Bath Soap","Household","1 bar",550,30),("Detergent","Household","1kg",2200,12),("LED Bulb","Electronics","12W",1800,16),("Phone Charger","Electronics","1 unit",3500,8),("Extension Box","Electronics","4-way",4200,10)]
    for i,sid in enumerate(ids):
        for k,(name,cat,unit,price,stock) in enumerate(cats):
            adj=i*80+(k%3)*25; qty=stock-(k%2); t=now()
            c.execute("INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(uid("prd"),sid,name,cat,unit,price+adj,qty,stock_status(qty),t,t,"seller_confirmed",None,1,f"{name} available from {stores[i][0]}.",t,2))
    c.execute("INSERT INTO staff VALUES(?,?,?,?)",(seller,ids[0],j(["pricing","inventory","orders","location"]),1)); audit(c,admin,"seed","system","system",{"stores":2,"products":16})

def body(h):
    n=int(h.headers.get("Content-Length","0"));
    if n>MAX_BODY: raise ValueError("payload too large")
    return json.loads(h.rfile.read(n) or b"{}")
def client_user(h):
    tok=next((p.strip().split("=",1)[1] for p in h.headers.get("Cookie","").split(";") if p.strip().startswith("ibuy_session=")),"")
    p=untoken(tok)
    if not p:return None
    c=conn(); u=q(c,"SELECT * FROM users WHERE id=? AND active=1",(p["uid"],),one=True); c.close(); return u
def rate_limited(ip,key):
    k=ip+":"+key; t=now()
    with RATE_LOCK:
        FAILED[k]=[x for x in FAILED[k] if x>t-RATE_WINDOW]
        if len(FAILED[k])>=RATE_LIMIT:return True
        FAILED[k].append(t); return False
def safe_user(u):
    if not u:return None
    d=dict(u)
    for k in ("password_hash","verification_token","verification_expires_at"): d.pop(k,None)
    return d
def verified(u): return bool(u and u["email_verified"])
def notify(c,user_id,message):
    u=q(c,"SELECT email,phone FROM users WHERE id=?",(user_id,),one=True)
    if not u:return
    provider=os.getenv("IBUY_NOTIFY_PROVIDER","").lower(); api_key=os.getenv("IBUY_NOTIFY_API_KEY","")
    if not provider or not api_key:
        audit(c,None,"notification_queued","notification",user_id,{"message":message,"provider":"local"}); return
    try:
        if provider=="resend":
            req=urllib.request.Request("https://api.resend.com/emails",data=json.dumps({"from":os.getenv("IBUY_NOTIFY_FROM","IBuy <onboarding@resend.dev>"),"to":[u["email"]],"subject":"IBuy update","text":message}).encode(),headers={"Authorization":"Bearer "+api_key,"Content-Type":"application/json"}); urllib.request.urlopen(req,timeout=5).read()
        elif provider=="termii" and u["phone"]:
            req=urllib.request.Request("https://api.ng.termii.com/api/sms/send",data=json.dumps({"to":u["phone"],"from":os.getenv("IBUY_NOTIFY_SENDER_ID","IBuy"),"sms":message,"type":"plain","channel":"generic","api_key":api_key}).encode(),headers={"Content-Type":"application/json"}); urllib.request.urlopen(req,timeout=5).read()
        audit(c,None,"notification_sent","notification",user_id,{"provider":provider})
    except Exception as e: audit(c,None,"notification_failed","notification",user_id,{"error":str(e)[:200]})
def restock(c,rid):
    items=q(c,"SELECT product_id,qty FROM reservation_items WHERE reservation_id=?",(rid,))
    for it in items:
        p=q(c,"SELECT stock_qty,low_stock_threshold FROM products WHERE id=?",(it["product_id"],),one=True)
        if p:
            qty=p["stock_qty"]+it["qty"]; threshold=p["low_stock_threshold"] or 2
            c.execute("UPDATE products SET stock_qty=?,stock_status=? WHERE id=?",(qty,stock_status(qty,threshold),it["product_id"]))

def expire_reservations():
    c=conn(); rows=q(c,"SELECT id FROM reservations WHERE status='reserved' AND expires_at IS NOT NULL AND expires_at<?",(now(),))
    for r in rows:
        c.execute("BEGIN IMMEDIATE")
        cur=q(c,"SELECT status FROM reservations WHERE id=?",(r["id"],),one=True)
        if cur and cur["status"]=="reserved": restock(c,r["id"]); c.execute("UPDATE reservations SET status='cancelled',intent='expired' WHERE id=?",(r["id"],)); audit(c,None,"reservation_expired","reservation",r["id"])
        c.commit()
    c.execute("UPDATE location_sessions SET stopped_at=? WHERE stopped_at IS NULL AND expires_at<?",(now(),now())); c.commit(); c.close()
def sweep_loop():
    while True:
        try: expire_reservations()
        except Exception: pass
        time.sleep(60)

class H(BaseHTTPRequestHandler):
    server_version="IBuy/2.6"
    def _security_headers(self):
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy","geolocation=(self)")
    def send_json(self,d,status=200,headers=None):
        raw=json.dumps(d,separators=(",",":"),ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self._security_headers()
        if headers:
            for k,v in headers.items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def send_file(self,path,ctype,cache="no-cache"):
        try:
            raw=open(path,"rb").read()
            self.send_response(200); self.send_header("Content-Type",ctype)
            self.send_header("Content-Length",str(len(raw))); self.send_header("Cache-Control",cache)
            self._security_headers(); self.end_headers(); self.wfile.write(raw)
        except OSError: self.err("not found",404)
    def err(self,msg,status=400): self.send_json({"ok":False,"error":msg},status)
    def auth_required(self):
        u=client_user(self)
        return u
    def can_store(self,c,u,sid,perm=None,owner_only=False):
        if u["role"]=="admin": return True
        s=q(c,"SELECT owner_id FROM stores WHERE id=?",(sid,),one=True)
        if not s:return False
        if s["owner_id"]==u["id"]: return True
        if owner_only:return False
        row=q(c,"SELECT permissions FROM staff WHERE store_id=? AND user_id=? AND active=1",(sid,u["id"]),one=True)
        if not row:return False
        return perm is None or perm in json.loads(row["permissions"])
    def do_GET(self):
        p=urlparse(self.path).path; qs=parse_qs(urlparse(self.path).query)
        if p=="/api/health": return self.send_json({"ok":True,"service":"IBuy","version":"2.6","db":os.path.exists(DB),"payments":False})
        if p=="/api/me":
            u=client_user(self); return self.send_json({"ok":True,"user":safe_user(u)})
        if p=="/api/verify":
            tok=qs.get("token",[""])[0]; c=conn(); u=q(c,"SELECT * FROM users WHERE verification_token=? AND verification_expires_at>?",(tok,now()),one=True)
            if not u:c.close(); return self.err("verification link is invalid or expired",400)
            c.execute("UPDATE users SET email_verified=1,verification_token=NULL,verification_expires_at=NULL WHERE id=?",(u["id"],)); audit(c,u["id"],"email_verified","user",u["id"]); c.commit(); c.close(); return self.send_json({"ok":True,"message":"Email verified. You can return to IBuy."})
        if p=="/api/catalog":
            term=qs.get("q",[""])[0].strip(); cat=qs.get("category",[""])[0].strip(); mn=qs.get("min_price",[""])[0]; mx=qs.get("max_price",[""])[0]
            try: mn=int(mn) if mn else None; mx=int(mx) if mx else None; page=max(1,int(qs.get("page",["1"])[0])); size=min(50,max(1,int(qs.get("page_size",["20"])[0])))
            except: return self.err("invalid catalog parameters")
            sort=qs.get("sort",["newest"])[0]; sortsql={"price_asc":"p.price ASC","price_desc":"p.price DESC","newest":"p.created_at DESC"}.get(sort,"p.created_at DESC")
            where=["p.active=1"]; args=[]
            if term:where.append("(p.name LIKE ? OR p.category LIKE ? OR p.description LIKE ?)"); args += [f"%{term}%"]*3
            if cat:where.append("p.category=?");args.append(cat)
            if mn is not None:where.append("p.price>=?");args.append(mn)
            if mx is not None:where.append("p.price<=?");args.append(mx)
            c=conn(); total=q(c,"SELECT COUNT(*) n FROM products p WHERE "+" AND ".join(where),args,one=True)["n"]
            rows=q(c,"SELECT p.*,s.name store_name,s.address,s.landmark,s.lat,s.lon,s.verification_tier,s.location_verified,s.image_b64 store_image FROM products p JOIN stores s ON s.id=p.store_id WHERE "+" AND ".join(where)+f" ORDER BY {sortsql} LIMIT ? OFFSET ?",args+[size,(page-1)*size])
            cats=q(c,"SELECT DISTINCT category FROM products WHERE active=1 ORDER BY category"); self.send_json({"ok":True,"products":[dict(x) for x in rows],"total":total,"page":page,"page_size":size,"categories":[x["category"] for x in cats]}); c.close(); return
        if p=="/api/discovery":
            c=conn();cut30=now()-30*86400;cut14=now()-14*86400
            sql="""SELECT p.*,s.name store_name,s.address,s.landmark,s.lat,s.lon,s.verification_tier,s.location_verified,s.image_b64 store_image,
            (SELECT COUNT(*) FROM reservation_items ri JOIN reservations rr ON rr.id=ri.reservation_id WHERE ri.product_id=p.id AND rr.created_at>=?) recent_reservations,
            ((SELECT COUNT(*) FROM reservation_items ri2 JOIN reservations rr2 ON rr2.id=ri2.reservation_id WHERE ri2.product_id=p.id AND rr2.created_at>=?)*5+
             CASE WHEN p.created_at>=? THEN 2 ELSE 0 END) trending_score
            FROM products p JOIN stores s ON s.id=p.store_id WHERE p.active=1
            ORDER BY trending_score DESC,p.created_at DESC LIMIT 200"""
            rows=q(c,sql,[cut30,cut30,cut14]);items=[dict(x) for x in rows]
            self.send_json({"ok":True,"trending":items,"random":items});c.close();return
        if p.startswith("/api/products/"):
            pid=p.rsplit("/",1)[1]; c=conn(); r=q(c,"SELECT p.*,s.name store_name,s.address,s.landmark,s.lat,s.lon,s.hours,s.verification_tier,s.location_verified,s.phone store_phone,s.description store_description,s.image_b64 store_image,s.verified_at FROM products p JOIN stores s ON s.id=p.store_id WHERE p.id=? AND p.active=1",(pid,),one=True)
            if not r:c.close();return self.err("product not found",404)
            self.send_json({"ok":True,"product":dict(r)});c.close();return
        if p.startswith("/api/stores/"):
            sid=p.rsplit("/",1)[1]; c=conn(); r=q(c,"SELECT * FROM stores WHERE id=?",(sid,),one=True)
            if not r:c.close();return self.err("store not found",404)
            ps=q(c,"SELECT * FROM products WHERE store_id=? AND active=1 ORDER BY name",(sid,)); rv=q(c,"SELECT rv.*,u.name buyer_name FROM reviews rv JOIN users u ON u.id=rv.buyer_id WHERE rv.store_id=? ORDER BY rv.created_at DESC",(sid,)); self.send_json({"ok":True,"store":dict(r),"products":[dict(x) for x in ps],"reviews":[dict(x) for x in rv]});c.close();return
        if p=="/api/stores":
            c=conn();rows=q(c,"SELECT * FROM stores ORDER BY name");self.send_json({"ok":True,"stores":[dict(x) for x in rows]});c.close();return
        if p=="/api/reservations":
            u=client_user(self)
            if not u:return self.err("authentication required",401)
            c=conn();
            if u["role"]=="admin": rows=q(c,"SELECT r.*,s.name store_name,u.name buyer_name,u.whatsapp_number buyer_whatsapp,u.allow_seller_whatsapp FROM reservations r JOIN stores s ON s.id=r.store_id JOIN users u ON u.id=r.buyer_id ORDER BY r.created_at DESC")
            elif u["role"] in ("seller","staff"): rows=q(c,"SELECT r.*,s.name store_name,u.name buyer_name,u.whatsapp_number buyer_whatsapp,u.allow_seller_whatsapp FROM reservations r JOIN stores s ON s.id=r.store_id JOIN users u ON u.id=r.buyer_id WHERE s.owner_id=? OR r.store_id IN (SELECT store_id FROM staff WHERE user_id=? AND active=1) ORDER BY r.created_at DESC",(u["id"],u["id"]))
            else: rows=q(c,"SELECT r.*,s.name store_name FROM reservations r JOIN stores s ON s.id=r.store_id WHERE r.buyer_id=? ORDER BY r.created_at DESC",(u["id"],))
            out=[]
            for r in rows:
                d=dict(r);d["items"]=[dict(x) for x in q(c,"SELECT ri.*,p.name,p.unit FROM reservation_items ri JOIN products p ON p.id=ri.product_id WHERE ri.reservation_id=?",(r["id"],))];out.append(d)
            self.send_json({"ok":True,"reservations":out});c.close();return
        if p=="/api/arrivals":
            u=client_user(self)
            if not u:return self.err("authentication required",401)
            c=conn();rows=q(c,"SELECT l.*,s.name store_name,u.name buyer_name,r.id reservation_id,r.status reservation_status FROM location_sessions l JOIN stores s ON s.id=l.store_id JOIN users u ON u.id=l.buyer_id LEFT JOIN reservations r ON r.buyer_id=l.buyer_id AND r.store_id=l.store_id AND r.status IN ('reserved','ready','arrived') WHERE l.stopped_at IS NULL AND l.expires_at>? AND (s.owner_id=? OR l.store_id IN (SELECT store_id FROM staff WHERE user_id=? AND active=1) OR ?='admin')",(now(),u["id"],u["id"],u["role"]));self.send_json({"ok":True,"arrivals":[dict(x) for x in rows]});c.close();return
        if p=="/api/reviews":
            c=conn();sid=qs.get("store_id",[""])[0];where="WHERE rv.store_id=?" if sid else "";args=[sid] if sid else [];rows=q(c,f"SELECT rv.*,s.name store_name,u.name buyer_name FROM reviews rv JOIN stores s ON s.id=rv.store_id JOIN users u ON u.id=rv.buyer_id {where} ORDER BY rv.created_at DESC LIMIT 100",args);self.send_json({"ok":True,"reviews":[dict(x) for x in rows]});c.close();return
        if p=="/api/disputes":
            u=client_user(self)
            if not u:return self.err("authentication required",401)
            c=conn();rows=q(c,"SELECT d.*,u.name reporter_name FROM disputes d JOIN users u ON u.id=d.reporter_id WHERE (?='admin') OR d.reporter_id=? ORDER BY d.created_at DESC",(u["role"],u["id"]));self.send_json({"ok":True,"disputes":[dict(x) for x in rows]});c.close();return
        if p=="/api/admin/stores":
            u=client_user(self)
            if not u or u["role"]!="admin":return self.err("admin required",403)
            c=conn();rows=q(c,"SELECT s.*,u.name owner_name,u.email owner_email FROM stores s JOIN users u ON u.id=s.owner_id ORDER BY s.name");self.send_json({"ok":True,"stores":[dict(x) for x in rows]});c.close();return
        if p=="/api/admin/users":
            u=client_user(self)
            if not u or u["role"]!="admin":return self.err("admin required",403)
            c=conn();rows=q(c,"SELECT id,name,email,phone,role,active,email_verified,created_at FROM users ORDER BY created_at DESC");self.send_json({"ok":True,"users":[dict(x) for x in rows]});c.close();return
        if p=="/api/staff":
            u=client_user(self)
            if not u:return self.err("authentication required",401)
            sid=qs.get("store_id",[""])[0];c=conn()
            if not self.can_store(c,u,sid,owner_only=True):c.close();return self.err("owner only",403)
            rows=q(c,"SELECT st.*,u.name,u.email FROM staff st JOIN users u ON u.id=st.user_id WHERE st.store_id=? ORDER BY u.name",(sid,));self.send_json({"ok":True,"staff":[dict(x) for x in rows]});c.close();return
        if p=="/api/analytics":
            u=client_user(self)
            if not u:return self.err("authentication required",401)
            sid=qs.get("store_id",[""])[0];c=conn()
            if not self.can_store(c,u,sid):c.close();return self.err("not authorized",403)
            m={"products":q(c,"SELECT COUNT(*) n FROM products WHERE store_id=? AND active=1",(sid,),one=True)["n"],"reservations":q(c,"SELECT COUNT(*) n FROM reservations WHERE store_id=?",(sid,),one=True)["n"],"completed":q(c,"SELECT COUNT(*) n FROM orders WHERE store_id=? AND status='completed'",(sid,),one=True)["n"],"arrivals":q(c,"SELECT COUNT(*) n FROM location_sessions WHERE store_id=? AND stopped_at IS NULL AND expires_at>?",(sid,now()),one=True)["n"],"reviews":q(c,"SELECT COUNT(*) n FROM reviews WHERE store_id=?",(sid,),one=True)["n"]}
            since=now()-6*86400; trend=[]
            for i in range(7):
                start=since+i*86400; end=start+86400; n=q(c,"SELECT COUNT(*) n FROM reservations WHERE store_id=? AND created_at>=? AND created_at<?",(sid,start,end),one=True)["n"];trend.append({"day":time.strftime("%Y-%m-%d",time.localtime(start)),"reservations":n})
            self.send_json({"ok":True,"metrics":m,"trend":trend});c.close();return
        if p=="/robots.txt": return self.send_file(os.path.join(ROOT,"robots.txt"),"text/plain; charset=utf-8","public, max-age=3600")
        if p=="/sitemap.xml": return self.send_file(os.path.join(ROOT,"sitemap.xml"),"application/xml; charset=utf-8","public, max-age=3600")
        files={"/":"index.html","/index.html":"index.html","/app.js":"app.js","/styles.css":"styles.css","/manifest.json":"manifest.json","/sw.js":"sw.js"}
        icon_files={"/icons/icon-192.png":"icon-192.png","/icons/icon-512.png":"icon-512.png"}
        if p in icon_files: return self.send_file(os.path.join(ROOT,"icons",icon_files[p]),"image/png","public, max-age=31536000, immutable")
        if p in files:
            name=files[p]; ext=name.rsplit(".",1)[-1]
            ctype={"html":"text/html; charset=utf-8","js":"application/javascript; charset=utf-8","css":"text/css; charset=utf-8","json":"application/json","sw":"application/javascript; charset=utf-8"}.get(ext,"application/octet-stream")
            return self.send_file(os.path.join(ROOT,name),ctype,"no-cache" if name in ("index.html","sw.js") else "public, max-age=3600")
        return self.err("not found",404)
    def do_POST(self):
        p=urlparse(self.path).path
        try:data=body(self)
        except Exception as e:return self.err(str(e),413 if "large" in str(e) else 400)
        c=conn();u=client_user(self)
        if p in ("/api/auth/login","/api/auth/signup") and rate_limited(self.client_address[0],p):c.close();return self.err("too many attempts; try again later",429)
        if p=="/api/auth/signup":
            email=data.get("email","").strip().lower();name=data.get("name","").strip();pw=data.get("password","");role=data.get("role","buyer")
            if role not in ("buyer","seller") or not email or not name or len(pw)<8:return self.err("valid name, email, role and password (8+ chars) required")
            try:
                uidv=uid("usr");phone=data.get("phone","");vt=secrets.token_urlsafe(32);exp=now()+86400
                wa=data.get("whatsapp_number") or phone
                c.execute("INSERT INTO users(id,email,name,phone,whatsapp_number,allow_seller_whatsapp,role,password_hash,created_at,active,email_verified,verification_token,verification_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(uidv,email,name,phone,wa,1,role,hashpw(pw),now(),1,0,vt,exp))
                sid=None
                if role=="seller":
                    sid=uid("sto");slat=data.get("lat"); slon=data.get("lon"); sacc=data.get("location_accuracy")
                    if slat is not None and slon is not None:
                        slat=float(slat); slon=float(slon)
                        if not (-90<=slat<=90 and -180<=slon<=180): raise ValueError("invalid shop coordinates")
                    else: slat,slon=7.6356,4.1815
                    sacc=float(sacc) if sacc is not None else None
                    loc_verified=1 if data.get("location_source")=="device_gps" else 0
                    c.execute("INSERT INTO stores(id,owner_id,name,address,landmark,lat,lon,hours,verification_tier,location_verified,phone,created_at,description,image_b64,verified_at,location_accuracy,location_captured_at,location_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(sid,uidv,name+" Store",data.get("address","") or "",data.get("landmark","") or "",slat,slon,"08:00-20:00","pending",loc_verified,phone,now(),"New seller store pending verification.",None,None,sacc,now() if loc_verified else None,data.get("location_source") if loc_verified else None));c.execute("INSERT INTO staff VALUES(?,?,?,?)",(uidv,sid,j(["pricing","inventory","orders","location"]),1))
                audit(c,uidv,"signup","user",uidv,{"role":role}); c.commit()
                verify_url=(PUBLIC_BASE_URL+"/api/verify?token="+vt) if PUBLIC_BASE_URL else ("/api/verify?token="+vt); notify(c,uidv,f"Verify your IBuy email by opening {verify_url}. This link expires in 24 hours.")
                c.commit(); t=token({"uid":uidv,"exp":now()+SESSION_TTL}); u2=dict(q(c,"SELECT * FROM users WHERE id=?",(uidv,),one=True)); c.close(); return self.send_json({"ok":True,"user":safe_user(u2),"store_id":sid,"email_verification_required":True},headers={"Set-Cookie":secure_cookie(t)})
            except sqlite3.IntegrityError:c.close();return self.err("email already registered",409)
        if p=="/api/auth/login":
            email=data.get("email","").strip().lower();pw=data.get("password","");row=q(c,"SELECT * FROM users WHERE email=? AND active=1",(email,),one=True)
            if not row or not checkpw(pw,row["password_hash"]):c.close();return self.err("invalid credentials",401)
            t=token({"uid":row["id"],"exp":now()+SESSION_TTL});audit(c,row["id"],"login","user",row["id"]);c.commit();c.close();return self.send_json({"ok":True,"user":safe_user(row)},headers={"Set-Cookie":secure_cookie(t)})
        if p=="/api/auth/logout":c.close();return self.send_json({"ok":True},headers={"Set-Cookie":secure_cookie("",0)})
        if p=="/api/auth/resend-verification":
            if not u:return self.err("authentication required",401)
            if u["email_verified"]:return self.send_json({"ok":True,"message":"Email already verified"})
            vt=secrets.token_urlsafe(32);exp=now()+86400;c.execute("UPDATE users SET verification_token=?,verification_expires_at=? WHERE id=?",(vt,exp,u["id"]));notify(c,u["id"],f"Verify your IBuy email by opening {((PUBLIC_BASE_URL+"/api/verify?token="+vt) if PUBLIC_BASE_URL else ("/api/verify?token="+vt))}. This link expires in 24 hours.");c.commit();c.close();return self.send_json({"ok":True})
        if not u:c.close();return self.err("authentication required",401)
        if p=="/api/account/update":
            name=str(data.get("name",u["name"])).strip()
            wa=str(data.get("whatsapp_number",u["whatsapp_number"] or u["phone"] or "")).strip()
            allow=1 if data.get("allow_seller_whatsapp",bool(u["allow_seller_whatsapp"])) else 0
            digits=re.sub(r"[^0-9]","",wa)
            if not name:return self.err("name is required")
            if wa and len(digits)<7:return self.err("enter a valid WhatsApp number")
            c.execute("UPDATE users SET name=?,phone=?,whatsapp_number=?,allow_seller_whatsapp=? WHERE id=?",(name,digits,digits,allow,u["id"]))
            if u["role"]=="seller": c.execute("UPDATE stores SET phone=? WHERE owner_id=?",(digits,u["id"]))
            audit(c,u["id"],"update_contact","user",u["id"],{"whatsapp":bool(digits)});c.commit()
            row=q(c,"SELECT * FROM users WHERE id=?",(u["id"],),one=True)
            return self.send_json({"ok":True,"user":safe_user(row)})
        if p in ("/api/products","/api/products/update","/api/reservations") and not verified(u):c.close();return self.err("Please verify your email before using this feature.",403)
        if p=="/api/products":
            if u["role"] not in ("seller","staff","admin"):return self.err("seller permission required",403)
            sid=data.get("store_id")
            if not self.can_store(c,u,sid):return self.err("not authorized",403)
            name=data.get("name","").strip();img=data.get("image_b64");desc=data.get("description","")
            if not name:return self.err("product name required")
            if img and len(img)>400000:return self.err("image payload too large",413)
            pid=uid("prd");ts=now();stock=float(data.get("stock_qty",0));threshold=float(data.get("low_stock_threshold",2));c.execute("INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(pid,sid,name,data.get("category","Other"),data.get("unit","unit"),int(data["price"]),stock,stock_status(stock,threshold),ts,ts,"seller_confirmed",img,1,desc,ts,threshold));audit(c,u["id"],"create_product","product",pid,{"store_id":sid});c.commit();return self.send_json({"ok":True,"id":pid})
        if p=="/api/products/update":
            pid=data.get("id");r=q(c,"SELECT p.*,s.owner_id FROM products p JOIN stores s ON s.id=p.store_id WHERE p.id=?",(pid,),one=True)
            if not r:return self.err("product not found",404)
            if not self.can_store(c,u,r["store_id"]):return self.err("not authorized",403)
            price=int(data.get("price",r["price"]));stock=float(data.get("stock_qty",r["stock_qty"]));threshold=float(data.get("low_stock_threshold",r["low_stock_threshold"] or 2));img=data.get("image_b64");ts=now()
            if img and len(img)>400000:return self.err("image payload too large",413)
            c.execute("UPDATE products SET name=?,category=?,unit=?,price=?,stock_qty=?,stock_status=?,price_updated_at=?,stock_updated_at=?,confidence=?,image_b64=COALESCE(?,image_b64),description=?,low_stock_threshold=? WHERE id=?",(data.get("name",r["name"]),data.get("category",r["category"]),data.get("unit",r["unit"]),price,stock,stock_status(stock,threshold),ts,ts,"seller_confirmed",img,data.get("description",r["description"] or ""),threshold,pid));audit(c,u["id"],"update_product","product",pid);c.commit();return self.send_json({"ok":True})
        if p=="/api/products/deactivate":
            pid=data.get("id");r=q(c,"SELECT * FROM products WHERE id=?",(pid,),one=True)
            if not r:return self.err("product not found",404)
            if not self.can_store(c,u,r["store_id"]):return self.err("not authorized",403)
            c.execute("UPDATE products SET active=0 WHERE id=?",(pid,));audit(c,u["id"],"deactivate_product","product",pid);c.commit();return self.send_json({"ok":True})
        if p=="/api/stores/update":
            sid=data.get("id")
            if not self.can_store(c,u,sid):return self.err("not authorized",403)
            img=data.get("image_b64")
            if img and len(img)>400000:return self.err("image payload too large",413)
            r=q(c,"SELECT * FROM stores WHERE id=?",(sid,),one=True)
            if not r:return self.err("store not found",404)
            has_location=("lat" in data or "lon" in data)
            if has_location and not self.can_store(c,u,sid,"location"):return self.err("location permission required",403)
            lat=float(data.get("lat",r["lat"])); lon=float(data.get("lon",r["lon"]))
            if not (-90<=lat<=90 and -180<=lon<=180):return self.err("invalid shop coordinates")
            loc_acc=data.get("location_accuracy",r["location_accuracy"])
            loc_source=data.get("location_source",r["location_source"])
            loc_captured=r["location_captured_at"]; loc_verified=r["location_verified"]
            if has_location:
                if loc_source!="device_gps":return self.err("Shop location must be captured from this device.")
                if loc_acc is not None and float(loc_acc)<=0:return self.err("invalid location accuracy")
                loc_acc=float(loc_acc) if loc_acc is not None else None; loc_captured=now(); loc_verified=1
            wa_store=re.sub(r"[^0-9]","",str(data.get("phone",r["phone"] or "")))
            if wa_store and len(wa_store)<7:return self.err('enter a valid store WhatsApp number')
            c.execute("UPDATE stores SET name=?,address=?,landmark=?,hours=?,description=?,image_b64=COALESCE(?,image_b64),phone=?,lat=?,lon=?,location_verified=?,location_accuracy=?,location_captured_at=?,location_source=? WHERE id=?",(data.get('name',r['name']),data.get('address',r['address']),data.get('landmark',r['landmark']),data.get('hours',r['hours']),data.get('description',r['description'] or ''),img,wa_store,lat,lon,loc_verified,loc_acc,loc_captured,loc_source,sid))
            audit(c,u["id"],"update_store","store",sid,{"location_captured":has_location,"location_source":loc_source})
            c.commit();return self.send_json({"ok":True,"location_captured":bool(has_location)})
        if p=="/api/staff/invite":
            sid=data.get("store_id")
            if not self.can_store(c,u,sid,owner_only=True):return self.err("owner only",403)
            email=data.get("email","").strip().lower();perms=[x for x in data.get("permissions",[]) if x in ("pricing","inventory","orders","location")]
            target=q(c,"SELECT id FROM users WHERE email=? AND active=1",(email,),one=True)
            if not target:return self.err("That person must sign up for IBuy first.",404)
            if target["id"]==u["id"]:return self.err("Owner does not need a staff invite")
            c.execute("INSERT INTO staff(user_id,store_id,permissions,active) VALUES(?,?,?,1) ON CONFLICT(user_id,store_id) DO UPDATE SET permissions=excluded.permissions,active=1",(target["id"],sid,j(perms)));audit(c,u["id"],"staff_invite","staff",target["id"],{"store_id":sid,"permissions":perms});c.commit();return self.send_json({"ok":True})
        if p=="/api/staff/remove":
            sid=data.get("store_id");uidv=data.get("user_id")
            if not self.can_store(c,u,sid,owner_only=True):return self.err("owner only",403)
            c.execute("UPDATE staff SET active=0 WHERE store_id=? AND user_id=?",(sid,uidv));audit(c,u["id"],"staff_remove","staff",uidv,{"store_id":sid});c.commit();return self.send_json({"ok":True})
        if p=="/api/reservations":
            if u["role"]!="buyer":return self.err("buyer account required",403)
            sid=data.get("store_id");items=data.get("items",[])
            if not sid or not items:return self.err("store and items required")
            rid=uid("res")
            try:
                c.execute("BEGIN IMMEDIATE");total=0;validated=[]
                for it in items:
                    qty=float(it["qty"])
                    if qty<=0:raise ValueError("invalid quantity")
                    pr=q(c,"SELECT * FROM products WHERE id=? AND store_id=? AND active=1",(it["product_id"],sid),one=True)
                    if not pr or pr["stock_qty"]<qty:raise ValueError(f"insufficient stock for {pr['name'] if pr else 'product'}")
                    total+=pr["price"]*qty;validated.append((pr,qty))
                ts=now();c.execute("INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?)",(rid,u["id"],sid,"reserved","reserved",ts,ts+3600,data.get("notes","")))
                for pr,qty in validated:c.execute("INSERT INTO reservation_items VALUES(?,?,?,?)",(rid,pr["id"],qty,pr["price"]));c.execute("UPDATE products SET stock_qty=stock_qty-?,stock_status=? WHERE id=?",(qty,stock_status(pr["stock_qty"]-qty,pr["low_stock_threshold"] or 2),pr["id"]));
                audit(c,u["id"],"create_reservation","reservation",rid,{"total":total});owner=q(c,"SELECT owner_id FROM stores WHERE id=?",(sid,),one=True);notify(c,owner["owner_id"],f"New reservation {rid} is waiting.");c.commit();return self.send_json({"ok":True,"reservation_id":rid,"total":total})
            except Exception as e:c.rollback();return self.err(str(e),409)
        if p=="/api/reservations/status":
            rid=data.get("id");status=data.get("status");allowed={"reserved","ready","cancelled","arrived","completed"}
            if status not in allowed:return self.err("invalid status")
            r=q(c,"SELECT r.*,s.owner_id,s.name store_name FROM reservations r JOIN stores s ON s.id=r.store_id WHERE r.id=?",(rid,),one=True)
            if not r:return self.err("reservation not found",404)
            ok=u["role"]=="admin" or r["buyer_id"]==u["id"] or r["owner_id"]==u["id"] or q(c,"SELECT 1 FROM staff WHERE user_id=? AND store_id=? AND active=1",(u["id"],r["store_id"]),one=True)
            if not ok:return self.err("not authorized",403)
            if status=="cancelled" and r["status"] in ("reserved","ready","arrived"):
                restock(c,rid)
            if status=="completed" and not q(c,"SELECT 1 FROM orders WHERE reservation_id=?",(rid,),one=True):
                total=sum(x["qty"]*x["unit_price"] for x in q(c,"SELECT qty,unit_price FROM reservation_items WHERE reservation_id=?",(rid,)));c.execute("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)",(uid("ord"),rid,r["buyer_id"],r["store_id"],"completed",int(total),now(),now()))
            c.execute("UPDATE reservations SET status=?,intent=? WHERE id=?",(status,status,rid));audit(c,u["id"],"reservation_status","reservation",rid,{"status":status})
            if status=="ready":notify(c,r["buyer_id"],f"Your IBuy reservation at {r['store_name']} is ready.")
            if status in ("arrived","completed"):notify(c,r["owner_id"],"A buyer has arrived/confirmed completion.")
            c.commit();return self.send_json({"ok":True})
        if p=="/api/location/start":
            if u["role"]!="buyer":return self.err("buyer account required",403)
            sid=data.get("store_id");mode=data.get("mode");mins=int(data.get("minutes",30))
            if mode not in ("approximate","precise") or mins not in (15,30,60,120):return self.err("invalid location session")
            if not q(c,"SELECT id FROM stores WHERE id=?",(sid,),one=True):return self.err("store not found")
            c.execute("UPDATE location_sessions SET stopped_at=? WHERE buyer_id=? AND stopped_at IS NULL",(now(),u["id"]));lid=uid("loc");exp=now()+mins*60;c.execute("INSERT INTO location_sessions VALUES(?,?,?,?,?,?,?,?,?,?)",(lid,u["id"],sid,mode,now(),exp,None,None,None,None));audit(c,u["id"],"location_session_started","location_session",lid,{"store_id":sid,"mode":mode,"minutes":mins});c.commit();return self.send_json({"ok":True,"id":lid,"expires_at":exp})
        if p=="/api/location/update":
            lid=data.get("id");r=q(c,"SELECT * FROM location_sessions WHERE id=? AND buyer_id=? AND stopped_at IS NULL",(lid,u["id"]),one=True)
            if not r:return self.err("location session inactive",404)
            if r["expires_at"]<now():return self.err("location session expired",410)
            lat=float(data["lat"]);lon=float(data["lon"]);acc=float(data.get("accuracy",0));
            if r["mode"]=="approximate":lat=round(lat,2);lon=round(lon,2)
            c.execute("UPDATE location_sessions SET lat=?,lon=?,accuracy=? WHERE id=?",(lat,lon,acc,lid));audit(c,u["id"],"location_update","location_session",lid,{"mode":r["mode"]});c.commit();return self.send_json({"ok":True})
        if p=="/api/location/stop":c.execute("UPDATE location_sessions SET stopped_at=? WHERE id=? AND buyer_id=?",(now(),data.get("id"),u["id"]));c.commit();return self.send_json({"ok":True})
        if p=="/api/reviews":
            oid=data.get("order_id");rating=int(data.get("rating",0));comment=data.get("comment","").strip()
            if not 1<=rating<=5:return self.err("rating must be 1-5")
            o=q(c,"SELECT * FROM orders WHERE id=? AND buyer_id=? AND status='completed'",(oid,u["id"]),one=True)
            if not o:return self.err("completed order required",403)
            try:c.execute("INSERT INTO reviews VALUES(?,?,?,?,?,?,?)",(uid("rev"),u["id"],o["store_id"],oid,rating,comment,now()));audit(c,u["id"],"review","order",oid);c.commit();return self.send_json({"ok":True})
            except sqlite3.IntegrityError:return self.err("review already submitted",409)
        if p=="/api/disputes":
            if not data.get("description","").strip():return self.err("description required")
            did=uid("dsp");c.execute("INSERT INTO disputes VALUES(?,?,?,?,?,?,?,?,?,?,?)",(did,u["id"],data.get("reservation_id"),data.get("kind","other"),data["description"].strip(),"open",None,j(data.get("evidence",{})),now(),None));audit(c,u["id"],"create_dispute","dispute",did);c.commit();return self.send_json({"ok":True,"id":did})
        if p=="/api/admin/disputes/resolve":
            if u["role"]!="admin":return self.err("admin required",403)
            c.execute("UPDATE disputes SET status='resolved',owner_id=?,resolved_at=? WHERE id=?",(u["id"],now(),data.get("id")));audit(c,u["id"],"resolve_dispute","dispute",data.get("id"));c.commit();return self.send_json({"ok":True})
        if p=="/api/admin/stores/verify":
            if u["role"]!="admin":return self.err("admin required",403)
            tier=data.get("verification_tier");
            if tier not in ("pending","verified","suspended"):return self.err("invalid verification tier")
            verified_at=now() if tier=="verified" else None;c.execute("UPDATE stores SET verification_tier=?,verified_at=? WHERE id=?",(tier,verified_at,data.get("id")));audit(c,u["id"],"store_verification","store",data.get("id"),{"tier":tier});c.commit();return self.send_json({"ok":True})
        if p=="/api/admin/users/deactivate":
            if u["role"]!="admin":return self.err("admin required",403)
            if data.get("id")==u["id"]:return self.err("cannot deactivate yourself")
            c.execute("UPDATE users SET active=0 WHERE id=?",(data.get("id"),));audit(c,u["id"],"deactivate_user","user",data.get("id"));c.commit();return self.send_json({"ok":True})
        if p=="/api/admin/store-documents":
            if u["role"]!="admin":return self.err("admin required",403)
            sid=data.get("store_id");rows=q(c,"SELECT id,store_id,kind,created_at FROM store_documents WHERE store_id=? ORDER BY created_at DESC",(sid,));return self.send_json({"ok":True,"documents":[dict(x) for x in rows]})
        if p=="/api/store-documents":
            sid=data.get("store_id");
            if not self.can_store(c,u,sid):return self.err("not authorized",403)
            fb=data.get("file_b64","");
            if len(fb)>700000:return self.err("document too large",413)
            did=uid("doc");c.execute("INSERT INTO store_documents VALUES(?,?,?,?,?)",(did,sid,data.get("kind","business_document"),fb,now()));audit(c,u["id"],"store_document_upload","store",sid);c.commit();return self.send_json({"ok":True,"id":did})
        c.close();return self.err("not found",404)

if __name__=="__main__":
    if HOST not in ("127.0.0.1","localhost","::1"):
        if not SECRET_VALUE or SECRET_VALUE=="local-dev-change-me" or len(SECRET_VALUE)<32:
            raise SystemExit("IBUY_SESSION_SECRET must be a random secret of at least 32 characters for non-local deployment.")
        if not SECURE_COOKIES:
            raise SystemExit("IBUY_SECURE_COOKIES=1 is required for non-local deployment.")
        if not PUBLIC_BASE_URL.startswith("https://"):
            raise SystemExit("IBUY_PUBLIC_BASE_URL must be an https:// URL for non-local deployment.")
    init_db(); threading.Thread(target=sweep_loop,daemon=True).start(); print(f"IBuy V2.9 production-ready system: http://{HOST}:{PORT}",flush=True); ThreadingHTTPServer((HOST,PORT),H).serve_forever()
