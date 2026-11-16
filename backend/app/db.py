# -*- coding: utf-8 -*-
"""Application database (SQLite): users, zones, orders, learning-store observations, collection records."""
import hashlib, hmac, json, os, secrets, sqlite3, time, math
from shapely.geometry import Point, Polygon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PATH = os.path.join(ROOT, 'data', 'app.sqlite')

SCHEMA = '''
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pw_hash TEXT, role TEXT, name TEXT, phone TEXT,
    zone_id INTEGER, created_at REAL);
CREATE TABLE IF NOT EXISTS zones(id INTEGER PRIMARY KEY, name TEXT, color TEXT, polygon TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, seller_id INTEGER, customer_name TEXT, phone TEXT, address_text TEXT, amount REAL,
    lat REAL, lon REAL, radius_m REAL, granularity TEXT, flag TEXT, explanation TEXT, result_json TEXT, premise_key TEXT,
    zone_id INTEGER, rider_id INTEGER, status TEXT, delivered_lat REAL, delivered_lon REAL, delivered_acc REAL, delivered_at REAL,
    corrected INTEGER DEFAULT 0, created_at REAL);
CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, premise_key TEXT, address_text TEXT, lat REAL, lon REAL, accuracy REAL,
    source TEXT, order_id INTEGER, rider_id INTEGER, trusted INTEGER, created_at REAL);
CREATE INDEX IF NOT EXISTS ix_obs_key ON observations(premise_key);
CREATE TABLE IF NOT EXISTS collection(id INTEGER PRIMARY KEY, record_code TEXT, address_text TEXT, premise_type TEXT, city TEXT,
    lat REAL, lon REAL, accuracy REAL, drag_m REAL, consent_project INTEGER, consent_public INTEGER, status TEXT, created_at REAL);
'''

def connect():
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    c = sqlite3.connect(PATH, check_same_thread=False); c.row_factory = sqlite3.Row
    c.executescript(SCHEMA); return c

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + '$' + hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100_000).hex()

def check_pw(pw, stored):
    salt, h = stored.split('$', 1)
    return hmac.compare_digest(hash_pw(pw, salt).split('$', 1)[1], h)

def rows(cur): return [dict(r) for r in cur.fetchall()]

# ----------------------------------------------------------------------------- learning store (used by the geocoder)
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

# ----------------------------------------------------------------------------- zones
def zone_for(db, lat, lon):
    if lat is None: return None
    for z in rows(db.execute('SELECT * FROM zones')):
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
def circle_poly(lat, lon, r_m, n=14):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        out.append([lat + (r_m * math.cos(a)) / 110540.0, lon + (r_m * math.sin(a)) / (111320.0 * math.cos(math.radians(lat)))])
    return out

def seed(db, gaz):
    if db.execute('SELECT COUNT(*) FROM users').fetchone()[0]: return
    now = time.time()
    def find(name, kinds=('area', 'town')):
        hits = gaz.search(name, list(kinds), limit=1, cutoff=0.6)
        return (hits[0][1]['lat'], hits[0][1]['lon']) if hits else None
    # demo zones: city centre (Machine Mohalla, Model Colony, bazaar), Satellite Town / Citi Housing, Cantt & GT Road south, Dina
    zones = [('Jhelum City', '#1F3864', (32.936, 73.722), 2600),
             ('Satellite Town / Citi Housing', '#3C8D5A', (32.993, 73.660), 2000),
             ('Cantt / Bilal Town', '#8E44AD', (32.903, 73.742), 2300),
             ('Dina', '#E8A33D', find('dina') or (33.0279, 73.6011), 2600)]
    zid = {}
    for name, color, (lat, lon), r in zones:
        cur = db.execute('INSERT INTO zones(name,color,polygon,created_at) VALUES (?,?,?,?)', (name, color, json.dumps(circle_poly(lat, lon, r, n=28)), now))
        zid[name] = cur.lastrowid
    users = [('seller', 'seller123', 'seller', 'Zaid Traders (seller)', '0313-0000000', None),
             ('admin', 'admin123', 'admin', 'AddressIQ Admin', '', None),
             ('ahmed', 'rider123', 'rider', 'Ahmed Raza', '0300-1111111', zid['Jhelum City']),
             ('bilal', 'rider123', 'rider', 'Bilal Hussain', '0300-2222222', zid['Satellite Town / Citi Housing']),
             ('faisal', 'rider123', 'rider', 'Faisal Mehmood', '0300-5555555', zid['Cantt / Bilal Town']),
             ('usman', 'rider123', 'rider', 'Usman Ali', '0300-3333333', zid['Dina']),
             ('hamza', 'rider123', 'rider', 'Hamza Khan', '0300-4444444', None)]
    for u, pw, role, name, phone, z in users:
        db.execute('INSERT INTO users(username,pw_hash,role,name,phone,zone_id,created_at) VALUES (?,?,?,?,?,?,?)', (u, hash_pw(pw), role, name, phone, z, now))
    db.commit()
