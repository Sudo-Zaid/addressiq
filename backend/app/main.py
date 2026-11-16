# -*- coding: utf-8 -*-
"""AddressIQ API (FastAPI). Run: uvicorn app.main:app --reload --port 8000  (from the backend/ folder)"""
import csv, io, json, os, secrets, time
import jwt
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from . import db as D
from .geocoder import Geocoder, Gazetteer

SECRET = os.environ.get('ADDRESSIQ_SECRET', 'dev-secret-change-me')
app = FastAPI(title='AddressIQ API', version='0.1')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
DB = D.connect(); GAZ = Gazetteer(); GC = Geocoder(GAZ, D.Store(DB)); D.seed(DB, GAZ)

# ----------------------------------------------------------------------------- auth
def make_token(u): return jwt.encode({'uid': u['id'], 'role': u['role'], 'exp': time.time() + 7 * 86400}, SECRET, algorithm='HS256')
def current_user(request: Request):
    auth = request.headers.get('authorization', '')
    if not auth.startswith('Bearer '): raise HTTPException(401, 'login required')
    try: data = jwt.decode(auth[7:], SECRET, algorithms=['HS256'])
    except Exception: raise HTTPException(401, 'invalid or expired token')
    u = DB.execute('SELECT * FROM users WHERE id=?', (data['uid'],)).fetchone()
    if not u: raise HTTPException(401, 'user not found')
    return dict(u)
def need(user, *roles):
    if user['role'] not in roles: raise HTTPException(403, 'not allowed for role ' + user['role'])
def public_user(u): return {k: u[k] for k in ('id', 'username', 'role', 'name', 'phone', 'zone_id')}

class Login(BaseModel): username: str; password: str
class Register(BaseModel): username: str; password: str; name: str; phone: str = ''
class Text(BaseModel): text: str
class NewOrder(BaseModel): customer_name: str; phone: str = ''; address_text: str; amount: float = 0
class Assign(BaseModel): rider_id: int | None = None
class Fix(BaseModel): lat: float; lon: float
class Delivered(BaseModel): lat: float; lon: float; accuracy: float | None = None
class Zone(BaseModel): name: str; color: str = '#1F3864'; polygon: list
class RiderZone(BaseModel): zone_id: int | None = None
class Collect(BaseModel):
    address_text: str; premise_type: str = 'home'; city: str = 'Jhelum'; lat: float; lon: float; accuracy: float | None = None
    drag_m: float = 0; consent_project: bool = True; consent_public: bool = False

@app.post('/api/auth/login')
def login(body: Login):
    u = DB.execute('SELECT * FROM users WHERE username=?', (body.username.strip().lower(),)).fetchone()
    if not u or not D.check_pw(body.password, u['pw_hash']): raise HTTPException(401, 'wrong username or password')
    return {'token': make_token(u), 'user': public_user(dict(u))}

@app.post('/api/auth/register')
def register(body: Register):
    un = body.username.strip().lower()
    if len(un) < 3 or len(body.password) < 6: raise HTTPException(400, 'username min 3 chars, password min 6')
    if DB.execute('SELECT 1 FROM users WHERE username=?', (un,)).fetchone(): raise HTTPException(409, 'username already taken')
    DB.execute('INSERT INTO users(username,pw_hash,role,name,phone,zone_id,created_at) VALUES (?,?,?,?,?,?,?)',
               (un, D.hash_pw(body.password), 'rider', body.name.strip(), body.phone.strip(), None, time.time())); DB.commit()
    u = DB.execute('SELECT * FROM users WHERE username=?', (un,)).fetchone()
    return {'token': make_token(u), 'user': public_user(dict(u))}

@app.get('/api/me')
def me(user=Depends(current_user)):
    z = DB.execute('SELECT name FROM zones WHERE id=?', (user['zone_id'],)).fetchone() if user['zone_id'] else None
    return {**public_user(user), 'zone_name': z['name'] if z else None}

# ----------------------------------------------------------------------------- geocoding
@app.post('/api/geocode')
def geocode(body: Text, user=Depends(current_user)):
    return GC.geocode(body.text)

def _store_order(user, name, phone, address, amount):
    r = GC.geocode(address)
    zone = D.zone_for(DB, r.get('lat'), r.get('lon'))
    rider = D.pick_rider(DB, zone['id']) if zone and r['flag'] != 'UNRESOLVED' else None
    status = 'assigned' if rider else ('unassigned' if r['flag'] != 'UNRESOLVED' else 'needs_call')
    cur = DB.execute('''INSERT INTO orders(seller_id,customer_name,phone,address_text,amount,lat,lon,radius_m,granularity,flag,explanation,result_json,
                        premise_key,zone_id,rider_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                     (user['id'], name, phone, address, amount, r.get('lat'), r.get('lon'), r.get('radius_m'), r['granularity'], r['flag'],
                      r['explanation'], json.dumps({k: r[k] for k in ('matched', 'not_found', 'candidates', 'alternatives', 'parts')}, ensure_ascii=False),
                      r['premise_key'], zone['id'] if zone else None, rider, status, time.time()))
    return cur.lastrowid

def order_out(o):
    o = dict(o)
    o['result'] = json.loads(o.pop('result_json') or '{}')
    return o

ORDER_SQL = '''SELECT o.*, u.name AS rider_name, z.name AS zone_name, z.color AS zone_color FROM orders o
               LEFT JOIN users u ON u.id=o.rider_id LEFT JOIN zones z ON z.id=o.zone_id'''

@app.post('/api/orders')
def create_order(body: NewOrder, user=Depends(current_user)):
    need(user, 'seller', 'admin')
    oid = _store_order(user, body.customer_name, body.phone, body.address_text, body.amount); DB.commit()
    return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/upload')
async def upload_orders(file: UploadFile = File(...), user=Depends(current_user)):
    need(user, 'seller', 'admin')
    raw = (await file.read()).decode('utf-8-sig', errors='replace')
    rd = csv.DictReader(io.StringIO(raw)); ids = []
    def pick(row, *keys):
        for k in row:
            if k and k.strip().lower() in keys: return (row[k] or '').strip()
        return ''
    for row in rd:
        addr = pick(row, 'address', 'address_text', 'addr', 'pata')
        if not addr: continue
        amt = pick(row, 'amount', 'cod', 'price', 'total') or '0'
        try: amt = float(str(amt).replace(',', '').replace('rs', '').strip() or 0)
        except ValueError: amt = 0
        ids.append(_store_order(user, pick(row, 'name', 'customer', 'customer_name') or 'Customer', pick(row, 'phone', 'mobile', 'contact'), addr, amt))
    DB.commit()
    out = [order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (i,)).fetchone()) for i in ids]
    return {'created': len(out), 'orders': out}

@app.get('/api/orders')
def list_orders(user=Depends(current_user)):
    if user['role'] == 'rider':
        cur = DB.execute(ORDER_SQL + ' WHERE o.rider_id=? ORDER BY o.status, o.created_at DESC', (user['id'],))
    else:
        cur = DB.execute(ORDER_SQL + ' ORDER BY o.created_at DESC LIMIT 500')
    return [order_out(o) for o in cur.fetchall()]

@app.post('/api/orders/{oid}/assign')
def assign(oid: int, body: Assign, user=Depends(current_user)):
    need(user, 'seller', 'admin')
    DB.execute('UPDATE orders SET rider_id=?, status=? WHERE id=?', (body.rider_id, 'assigned' if body.rider_id else 'unassigned', oid)); DB.commit()
    return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/{oid}/correct')
def correct(oid: int, body: Fix, user=Depends(current_user)):
    need(user, 'seller', 'admin')
    o = DB.execute('SELECT * FROM orders WHERE id=?', (oid,)).fetchone()
    if not o: raise HTTPException(404)
    zone = D.zone_for(DB, body.lat, body.lon)
    rider = o['rider_id'] or (D.pick_rider(DB, zone['id']) if zone else None)
    DB.execute('UPDATE orders SET lat=?, lon=?, radius_m=?, flag=?, granularity=?, corrected=1, explanation=?, zone_id=?, rider_id=?, status=? WHERE id=?',
               (body.lat, body.lon, 40.0, 'FOUND', 'PREMISE', 'Pin placed by the seller (customer confirmed on the phone).',
                zone['id'] if zone else None, rider, 'assigned' if rider else 'unassigned', oid))
    DB.execute('INSERT INTO observations(premise_key,address_text,lat,lon,accuracy,source,order_id,rider_id,trusted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
               (o['premise_key'], o['address_text'], body.lat, body.lon, None, 'seller_correction', oid, None, 0, time.time()))
    DB.commit(); return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/{oid}/delivered')
def delivered(oid: int, body: Delivered, user=Depends(current_user)):
    o = DB.execute('SELECT * FROM orders WHERE id=?', (oid,)).fetchone()
    if not o: raise HTTPException(404)
    if user['role'] == 'rider' and o['rider_id'] != user['id']: raise HTTPException(403, 'not your order')
    trusted = 1 if (body.accuracy is not None and body.accuracy <= 25) else 0
    DB.execute('UPDATE orders SET status=?, delivered_lat=?, delivered_lon=?, delivered_acc=?, delivered_at=? WHERE id=?',
               ('delivered', body.lat, body.lon, body.accuracy, time.time(), oid))
    DB.execute('INSERT INTO observations(premise_key,address_text,lat,lon,accuracy,source,order_id,rider_id,trusted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
               (o['premise_key'], o['address_text'], body.lat, body.lon, body.accuracy, 'rider_gps', oid, user['id'], trusted, time.time()))
    DB.commit(); return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.delete('/api/orders')
def clear_orders(user=Depends(current_user)):
    need(user, 'seller', 'admin'); DB.execute('DELETE FROM orders'); DB.commit(); return {'ok': True}

# ----------------------------------------------------------------------------- zones & riders
@app.get('/api/zones')
def zones(user=Depends(current_user)):
    out = []
    for z in D.rows(DB.execute('SELECT * FROM zones ORDER BY id')):
        z['polygon'] = json.loads(z['polygon'])
        z['riders'] = D.rows(DB.execute("SELECT id, name, username FROM users WHERE role='rider' AND zone_id=?", (z['id'],)))
        z['open_orders'] = DB.execute("SELECT COUNT(*) FROM orders WHERE zone_id=? AND status!='delivered'", (z['id'],)).fetchone()[0]
        out.append(z)
    return out

@app.post('/api/zones')
def add_zone(body: Zone, user=Depends(current_user)):
    need(user, 'seller', 'admin')
    if len(body.polygon) < 3: raise HTTPException(400, 'polygon needs 3+ points')
    cur = DB.execute('INSERT INTO zones(name,color,polygon,created_at) VALUES (?,?,?,?)', (body.name, body.color, json.dumps(body.polygon), time.time())); DB.commit()
    return {'id': cur.lastrowid}

@app.delete('/api/zones/{zid}')
def del_zone(zid: int, user=Depends(current_user)):
    need(user, 'seller', 'admin')
    DB.execute('DELETE FROM zones WHERE id=?', (zid,)); DB.execute('UPDATE users SET zone_id=NULL WHERE zone_id=?', (zid,)); DB.commit(); return {'ok': True}

@app.get('/api/riders')
def riders(user=Depends(current_user)):
    need(user, 'seller', 'admin')
    out = []
    for r in D.rows(DB.execute("SELECT u.id,u.username,u.name,u.phone,u.zone_id,z.name AS zone_name FROM users u LEFT JOIN zones z ON z.id=u.zone_id WHERE u.role='rider' ORDER BY u.id")):
        r['open'] = DB.execute("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status!='delivered'", (r['id'],)).fetchone()[0]
        r['delivered'] = DB.execute("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status='delivered'", (r['id'],)).fetchone()[0]
        out.append(r)
    return out

@app.post('/api/riders/{rid}/zone')
def set_rider_zone(rid: int, body: RiderZone, user=Depends(current_user)):
    need(user, 'seller', 'admin'); DB.execute('UPDATE users SET zone_id=? WHERE id=? AND role=?', (body.zone_id, rid, 'rider')); DB.commit(); return {'ok': True}

# ----------------------------------------------------------------------------- stats, learning store, collection, gazetteer
@app.get('/api/stats')
def stats(user=Depends(current_user)):
    q = lambda sql, *a: DB.execute(sql, a).fetchone()[0]
    return {'orders': q('SELECT COUNT(*) FROM orders'), 'found': q("SELECT COUNT(*) FROM orders WHERE flag='FOUND'"),
            'area_only': q("SELECT COUNT(*) FROM orders WHERE flag='AREA-ONLY'"), 'ambiguous': q("SELECT COUNT(*) FROM orders WHERE flag='AMBIGUOUS'"),
            'unresolved': q("SELECT COUNT(*) FROM orders WHERE flag='UNRESOLVED'"), 'delivered': q("SELECT COUNT(*) FROM orders WHERE status='delivered'"),
            'assigned': q("SELECT COUNT(*) FROM orders WHERE status='assigned'"), 'unassigned': q("SELECT COUNT(*) FROM orders WHERE status='unassigned'"),
            'observations': q('SELECT COUNT(*) FROM observations'), 'premises_learned': q('SELECT COUNT(DISTINCT premise_key) FROM observations'),
            'gazetteer': {'landmarks': len(GAZ.by_kind.get('landmark', [])), 'streets': len(GAZ.by_kind.get('street', [])), 'areas': len(GAZ.by_kind.get('area', []))},
            'collection': q('SELECT COUNT(*) FROM collection')}

@app.get('/api/learning')
def learning(user=Depends(current_user)):
    need(user, 'seller', 'admin')
    return D.rows(DB.execute('SELECT o.*, u.name AS rider_name FROM observations o LEFT JOIN users u ON u.id=o.rider_id ORDER BY o.created_at DESC LIMIT 300'))

@app.post('/api/collect')
def collect(body: Collect):
    acc = body.accuracy
    status = 'AUTO' if (acc is not None and acc <= 25 and body.drag_m <= 30) else 'NEEDS-VERIFICATION'
    code = 'R-' + secrets.token_hex(3).upper()
    DB.execute('INSERT INTO collection(record_code,address_text,premise_type,city,lat,lon,accuracy,drag_m,consent_project,consent_public,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
               (code, body.address_text, body.premise_type, body.city, body.lat, body.lon, acc, body.drag_m, int(body.consent_project), int(body.consent_public), status, time.time()))
    DB.commit(); return {'record_code': code, 'status': status}

@app.get('/api/collection')
def collection(user=Depends(current_user)):
    need(user, 'seller', 'admin'); return D.rows(DB.execute('SELECT * FROM collection ORDER BY created_at DESC LIMIT 300'))

@app.get('/api/gazetteer/search')
def gaz_search(q: str, user=Depends(current_user)):
    from .normalise import normalise
    hits = GAZ.search(normalise(q), ['landmark', 'area', 'street', 'town'], limit=10, cutoff=0.5)
    return [{'name': r['name'], 'kind': r['kind'], 'category': r['category'], 'lat': r['lat'], 'lon': r['lon'], 'score': round(s, 2)} for s, r in hits]

@app.get('/api/health')
def health(): return {'ok': True, 'gazetteer_rows': len(GAZ.rows)}

# ----------------------------------------------------------------------------- frontend (production build)
DIST = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'dist')
if os.path.isdir(os.path.join(DIST, 'assets')) and os.path.isfile(os.path.join(DIST, 'index.html')):
    app.mount('/assets', StaticFiles(directory=os.path.join(DIST, 'assets')), name='assets')
    @app.get('/{path:path}')
    def spa(path: str):
        f = os.path.join(DIST, path)
        return FileResponse(f if path and os.path.isfile(f) else os.path.join(DIST, 'index.html'))
