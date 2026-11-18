# -*- coding: utf-8 -*-
"""Application database (SQLite): organizations, users, zones, orders, learning-store observations, collection records.
Operational data (users, zones, orders) is scoped per organization; the learning store is SHARED across organizations
(it holds only address text + GPS, never a name or phone)."""
import hashlib, hmac, json, os, secrets, sqlite3, threading, time, math
from shapely.geometry import Point, Polygon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PATH = os.environ.get('ADDRESSIQ_DB') or os.path.join(ROOT, 'data', 'app.sqlite')    # set ADDRESSIQ_DB to keep the data on a mounted disk

SCHEMA = '''
CREATE TABLE IF NOT EXISTS organizations(id INTEGER PRIMARY KEY, name TEXT, type TEXT, join_code TEXT UNIQUE, active INTEGER DEFAULT 1,
    contact TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pw_hash TEXT, role TEXT, name TEXT, phone TEXT,
    zone_id INTEGER, org_id INTEGER, created_at REAL);
CREATE TABLE IF NOT EXISTS zones(id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, color TEXT, polygon TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, org_id INTEGER, seller_id INTEGER, customer_name TEXT, phone TEXT, address_text TEXT, amount REAL,
    lat REAL, lon REAL, radius_m REAL, granularity TEXT, flag TEXT, explanation TEXT, result_json TEXT, premise_key TEXT,
    zone_id INTEGER, rider_id INTEGER, status TEXT, delivered_lat REAL, delivered_lon REAL, delivered_acc REAL, delivered_at REAL,
    corrected INTEGER DEFAULT 0, created_at REAL);
CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, premise_key TEXT, address_text TEXT, lat REAL, lon REAL, accuracy REAL,
    source TEXT, order_id INTEGER, rider_id INTEGER, org_id INTEGER, trusted INTEGER, created_at REAL);
CREATE INDEX IF NOT EXISTS ix_obs_key ON observations(premise_key);
CREATE TABLE IF NOT EXISTS collection(id INTEGER PRIMARY KEY, record_code TEXT, address_text TEXT, premise_type TEXT, city TEXT,
    lat REAL, lon REAL, accuracy REAL, drag_m REAL, consent_project INTEGER, consent_public INTEGER, status TEXT, created_at REAL);
'''

class Shared:
    """One name, one SQLite connection PER THREAD.
    FastAPI runs plain `def` endpoints and dependencies in a thread pool. A single sqlite3 connection shared by those threads
    let two requests that ran at the same moment reset each other's statement, so a lookup came back empty now and then and a
    signed-in user got "user not found" / "organization disabled". Every thread now works on its own connection."""
    def __init__(self): self._local = threading.local()
    def _conn(self):
        c = getattr(self._local, 'c', None)
        if c is None:
            c = self._local.c = sqlite3.connect(PATH, timeout=15); c.row_factory = sqlite3.Row
        return c
    def __getattr__(self, name): return getattr(self._conn(), name)

def connect():
    if os.path.dirname(PATH): os.makedirs(os.path.dirname(PATH), exist_ok=True)
    c = sqlite3.connect(PATH, timeout=15)
    c.execute('PRAGMA journal_mode=WAL')        # readers never wait for a writer
    c.executescript(SCHEMA); migrate(c); c.close()
    return Shared()

def migrate(c):
    """add columns introduced after the first prototype build (older app.sqlite files)"""
    for table, col, ddl in [('users', 'org_id', 'INTEGER'), ('zones', 'org_id', 'INTEGER'), ('orders', 'org_id', 'INTEGER'), ('observations', 'org_id', 'INTEGER')]:
        cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % table)]
        if col not in cols: c.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, col, ddl))
    c.commit()

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + '$' + hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100_000).hex()

def check_pw(pw, stored):
    salt, h = stored.split('$', 1)
    return hmac.compare_digest(hash_pw(pw, salt).split('$', 1)[1], h)

def rows(cur): return [dict(r) for r in cur.fetchall()]

def new_join_code(db, name):
    base = ''.join(ch for ch in name.upper() if ch.isalpha())[:3] or 'ORG'
    while True:
        code = '%s-%04d' % (base, secrets.randbelow(10000))
        if not db.execute('SELECT 1 FROM organizations WHERE join_code=?', (code,)).fetchone(): return code

# ----------------------------------------------------------------------------- learning store (SHARED across organizations)
class Store:
    def __init__(self, db): self.db = db
    def premise(self, key):
        obs = rows(self.db.execute('SELECT lat, lon, accuracy, trusted FROM observations WHERE premise_key=? ORDER BY created_at DESC', (key,)))
        if not obs: return None
        trusted = [o for o in obs if o['trusted']]
        # cached PREMISE only with 2 concordant observations (<=30 m apart) or 1 trusted (<=20 m accuracy)
        if len(obs) >= 2:
            a, b = obs[0], obs[1]
            if _hav(a['lat'], a['lon'], b['lat'], b['lon']) <= 30:
                return {'lat': (a['lat'] + b['lat']) / 2, 'lon': (a['lon'] + b['lon']) / 2, 'radius': 25.0, 'n': len(obs)}
        if trusted and trusted[0]['accuracy'] is not None and trusted[0]['accuracy'] <= 20:
            return {'lat': trusted[0]['lat'], 'lon': trusted[0]['lon'], 'radius': max(30.0, trusted[0]['accuracy'] + 10), 'n': len(obs)}
        o = obs[0]
        return {'lat': o['lat'], 'lon': o['lon'], 'radius': max(30.0, (o['accuracy'] or 25) + 15), 'n': len(obs)}
    def density(self, lat, lon):
        n = 0
        for o in self.db.execute('SELECT lat, lon FROM observations WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?',
                                 (lat - 0.003, lat + 0.003, lon - 0.003, lon + 0.003)):
            if _hav(lat, lon, o['lat'], o['lon']) <= 200: n += 1
        return n

def _hav(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2); dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))

# ----------------------------------------------------------------------------- zones (per organization)
def zone_for(db, lat, lon, org_id):
    if lat is None: return None
    for z in rows(db.execute('SELECT * FROM zones WHERE org_id=?', (org_id,))):
        ring = json.loads(z['polygon'])
        if len(ring) >= 3 and Polygon([(p[1], p[0]) for p in ring]).contains(Point(lon, lat)): return z
    return None

def pick_rider(db, zone_id):
    riders = rows(db.execute("SELECT id FROM users WHERE role='rider' AND zone_id=?", (zone_id,)))
    if not riders: return None
    best, load = None, 10 ** 9
    for r in riders:
        n = db.execute("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status IN ('assigned','out')", (r['id'],)).fetchone()[0]
        if n < load: best, load = r['id'], n
    return best

# ----------------------------------------------------------------------------- seed
def circle_poly(lat, lon, r_m, n=28):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        out.append([lat + (r_m * math.cos(a)) / 110540.0, lon + (r_m * math.sin(a)) / (111320.0 * math.cos(math.radians(lat)))])
    return out

def add_org(db, name, type_, contact=''):
    cur = db.execute('INSERT INTO organizations(name,type,join_code,active,contact,created_at) VALUES (?,?,?,?,?,?)',
                     (name, type_, new_join_code(db, name), 1, contact, time.time()))
    return cur.lastrowid

def add_user(db, username, pw, role, name, phone='', zone_id=None, org_id=None):
    cur = db.execute('INSERT INTO users(username,pw_hash,role,name,phone,zone_id,org_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
                     (username.lower(), hash_pw(pw), role, name, phone, zone_id, org_id, time.time()))
    return cur.lastrowid

def add_zone(db, org_id, name, color, lat, lon, r):
    cur = db.execute('INSERT INTO zones(org_id,name,color,polygon,created_at) VALUES (?,?,?,?,?)', (org_id, name, color, json.dumps(circle_poly(lat, lon, r)), time.time()))
    return cur.lastrowid

def seed(db, gaz):
    if db.execute('SELECT COUNT(*) FROM organizations').fetchone()[0]:
        return
    def find(name, kinds=('area', 'town')):
        hits = gaz.search(name, list(kinds), limit=1, cutoff=0.6)
        return (hits[0][1]['lat'], hits[0][1]['lon']) if hits else None
    # platform admin (no organization)
    if not db.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
        add_user(db, 'admin', 'admin123', 'admin', 'AddressIQ Platform Admin')
    # org 1: the demo seller with four zones and four riders
    o1 = add_org(db, 'Zaid Traders', 'shop', 'info@zaidtraders.pk')
    z = {'Jhelum City': add_zone(db, o1, 'Jhelum City', '#1F3864', 32.936, 73.722, 2600),
         'Satellite Town / Citi Housing': add_zone(db, o1, 'Satellite Town / Citi Housing', '#3C8D5A', 32.993, 73.660, 2000),
         'Cantt / Bilal Town': add_zone(db, o1, 'Cantt / Bilal Town', '#8E44AD', 32.903, 73.742, 2300),
         'Dina': add_zone(db, o1, 'Dina', '#E8A33D', *(find('dina') or (33.0279, 73.6011)), 2600)}
    add_user(db, 'seller', 'seller123', 'seller', 'Zaid Traders (dispatcher)', '0313-0000000', None, o1)
    add_user(db, 'ahmed', 'rider123', 'rider', 'Ahmed Raza', '0300-1111111', z['Jhelum City'], o1)
    add_user(db, 'bilal', 'rider123', 'rider', 'Bilal Hussain', '0300-2222222', z['Satellite Town / Citi Housing'], o1)
    add_user(db, 'faisal', 'rider123', 'rider', 'Faisal Mehmood', '0300-5555555', z['Cantt / Bilal Town'], o1)
    add_user(db, 'usman', 'rider123', 'rider', 'Usman Ali', '0300-3333333', z['Dina'], o1)
    add_user(db, 'hamza', 'rider123', 'rider', 'Hamza Khan', '0300-4444444', None, o1)
    # org 2: a courier company with one city-wide zone and one rider
    o2 = add_org(db, 'Leopard Courier (Jhelum branch)', 'courier', 'jhelum@leopard.pk')
    z2 = add_zone(db, o2, 'Jhelum + Dina', '#0E7490', 32.97, 73.68, 7000)
    add_user(db, 'leopard', 'leopard123', 'seller', 'Leopard Jhelum desk', '0544-000000', None, o2)
    add_user(db, 'tariq', 'rider123', 'rider', 'Tariq (Leopard)', '0300-6666666', z2, o2)
    # org 3: a restaurant, created but not set up yet (no zones, no riders)
    o3 = add_org(db, 'Chaaye Khaana', 'restaurant', '')
    add_user(db, 'chaaye', 'chaaye123', 'seller', 'Chaaye Khaana (orders desk)', '', None, o3)
    db.commit()
