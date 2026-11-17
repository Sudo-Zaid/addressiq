# -*- coding: utf-8 -*-
"""AddressIQ API (FastAPI). Run: uvicorn app.main:app --reload --port 8000  (from the backend/ folder)
Roles: admin (platform, manages organizations) · seller (dispatch console, scoped to its organization) · rider (its own orders).
The learning store is shared across organizations; everything operational is per organization."""
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
app = FastAPI(title='AddressIQ API', version='0.2')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
DB = D.connect(); GAZ = Gazetteer(); GC = Geocoder(GAZ, D.Store(DB)); D.seed(DB, GAZ)

# ----------------------------------------------------------------------------- auth
def make_token(u): return jwt.encode({'uid': u['id'], 'role': u['role'], 'exp': time.time() + 7 * 86400}, SECRET, algorithm='HS256')
def org_of(org_id):
    return dict(DB.execute('SELECT * FROM organizations WHERE id=?', (org_id,)).fetchone() or {}) if org_id else None
def current_user(request: Request):
    auth = request.headers.get('authorization', '')
    if not auth.startswith('Bearer '): raise HTTPException(401, 'login required')
    try: data = jwt.decode(auth[7:], SECRET, algorithms=['HS256'])
    except Exception: raise HTTPException(401, 'invalid or expired token')
    u = DB.execute('SELECT * FROM users WHERE id=?', (data['uid'],)).fetchone()
    if not u: raise HTTPException(401, 'user not found')
    u = dict(u)
    if u['role'] != 'admin':
        org = org_of(u['org_id'])
        if not org or not org['active']: raise HTTPException(403, 'your organization is disabled — contact the platform admin')
    return u
def need(user, *roles):
    if user['role'] not in roles: raise HTTPException(403, 'not allowed for role ' + user['role'])
def public_user(u):
    org = org_of(u.get('org_id'))
    return {**{k: u[k] for k in ('id', 'username', 'role', 'name', 'phone', 'zone_id', 'org_id')}, 'org_name': org['name'] if org else None}

class Login(BaseModel): username: str; password: str
class Register(BaseModel): username: str; password: str; name: str; phone: str = ''; org_code: str
class Text(BaseModel): text: str
class NewOrder(BaseModel): customer_name: str; phone: str = ''; address_text: str; amount: float = 0
class Assign(BaseModel): rider_id: int | None = None
class Fix(BaseModel): lat: float; lon: float
class Delivered(BaseModel): lat: float; lon: float; accuracy: float | None = None
class Zone(BaseModel): name: str; color: str = '#1F3864'; polygon: list
class RiderZone(BaseModel): zone_id: int | None = None
class NewOrg(BaseModel): name: str; type: str = 'courier'; contact: str = ''; seller_username: str; seller_password: str; seller_name: str = ''
class OrgActive(BaseModel): active: bool
class NewUser(BaseModel): username: str; password: str; name: str; role: str = 'seller'; phone: str = ''
class Collect(BaseModel):
    address_text: str; premise_type: str = 'home'; city: str = 'Jhelum'; lat: float; lon: float; accuracy: float | None = None
    drag_m: float = 0; consent_project: bool = True; consent_public: bool = False

@app.post('/api/auth/login')
def login(body: Login):
    u = DB.execute('SELECT * FROM users WHERE username=?', (body.username.strip().lower(),)).fetchone()
    if not u or not D.check_pw(body.password, u['pw_hash']): raise HTTPException(401, 'wrong username or password')
    u = dict(u)
    if u['role'] != 'admin':
        org = org_of(u['org_id'])
        if not org or not org['active']: raise HTTPException(403, 'your organization is disabled — contact the platform admin')
    return {'token': make_token(u), 'user': public_user(u)}

@app.post('/api/auth/register')
def register(body: Register):
    un = body.username.strip().lower()
    if len(un) < 3 or len(body.password) < 6: raise HTTPException(400, 'username min 3 chars, password min 6')
    org = DB.execute('SELECT * FROM organizations WHERE join_code=?', (body.org_code.strip().upper(),)).fetchone()
    if not org: raise HTTPException(400, 'unknown organization code — ask your dispatcher for it')
    if not org['active']: raise HTTPException(403, 'this organization is disabled')
    if DB.execute('SELECT 1 FROM users WHERE username=?', (un,)).fetchone(): raise HTTPException(409, 'username already taken')
    D.add_user(DB, un, body.password, 'rider', body.name.strip(), body.phone.strip(), None, org['id']); DB.commit()
    u = dict(DB.execute('SELECT * FROM users WHERE username=?', (un,)).fetchone())
    return {'token': make_token(u), 'user': public_user(u)}

@app.get('/api/me')
def me(user=Depends(current_user)):
    z = DB.execute('SELECT name FROM zones WHERE id=?', (user['zone_id'],)).fetchone() if user['zone_id'] else None
    return {**public_user(user), 'zone_name': z['name'] if z else None}

# ----------------------------------------------------------------------------- geocoding & orders (per organization)
@app.post('/api/geocode')
def geocode(body: Text, user=Depends(current_user)):
    return GC.geocode(body.text)

def _store_order(user, name, phone, address, amount):
    r = GC.geocode(address)
    zone = D.zone_for(DB, r.get('lat'), r.get('lon'), user['org_id'])
    rider = D.pick_rider(DB, zone['id']) if zone and r['flag'] != 'UNRESOLVED' else None
    status = 'assigned' if rider else ('unassigned' if r['flag'] != 'UNRESOLVED' else 'needs_call')
    cur = DB.execute('''INSERT INTO orders(org_id,seller_id,customer_name,phone,address_text,amount,lat,lon,radius_m,granularity,flag,explanation,result_json,
                        premise_key,zone_id,rider_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                     (user['org_id'], user['id'], name, phone, address, amount, r.get('lat'), r.get('lon'), r.get('radius_m'), r['granularity'], r['flag'],
                      r['explanation'], json.dumps({k: r[k] for k in ('matched', 'not_found', 'candidates', 'alternatives', 'parts', 'band') if k in r}, ensure_ascii=False),
                      r['premise_key'], zone['id'] if zone else None, rider, status, time.time()))
    return cur.lastrowid

def order_out(o):
    o = dict(o); o['result'] = json.loads(o.pop('result_json') or '{}'); return o

ORDER_SQL = '''SELECT o.*, u.name AS rider_name, z.name AS zone_name, z.color AS zone_color, g.name AS org_name FROM orders o
               LEFT JOIN users u ON u.id=o.rider_id LEFT JOIN zones z ON z.id=o.zone_id LEFT JOIN organizations g ON g.id=o.org_id'''

def own_order(user, oid):
    o = DB.execute('SELECT * FROM orders WHERE id=?', (oid,)).fetchone()
    if not o: raise HTTPException(404, 'order not found')
    if user['role'] != 'admin' and o['org_id'] != user['org_id']: raise HTTPException(403, 'not your organization')
    return o

@app.post('/api/orders')
def create_order(body: NewOrder, user=Depends(current_user)):
    need(user, 'seller')
    oid = _store_order(user, body.customer_name, body.phone, body.address_text, body.amount); DB.commit()
    return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/upload')
async def upload_orders(file: UploadFile = File(...), user=Depends(current_user)):
    need(user, 'seller')
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
    return {'created': len(ids), 'orders': [order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (i,)).fetchone()) for i in ids]}

@app.get('/api/orders')
def list_orders(user=Depends(current_user)):
    if user['role'] == 'rider': cur = DB.execute(ORDER_SQL + ' WHERE o.rider_id=? ORDER BY o.status, o.created_at DESC', (user['id'],))
    elif user['role'] == 'seller': cur = DB.execute(ORDER_SQL + ' WHERE o.org_id=? ORDER BY o.created_at DESC LIMIT 500', (user['org_id'],))
    else: cur = DB.execute(ORDER_SQL + ' ORDER BY o.created_at DESC LIMIT 500')
    return [order_out(o) for o in cur.fetchall()]

@app.post('/api/orders/{oid}/assign')
def assign(oid: int, body: Assign, user=Depends(current_user)):
    need(user, 'seller'); own_order(user, oid)
    if body.rider_id and not DB.execute("SELECT 1 FROM users WHERE id=? AND role='rider' AND org_id=?", (body.rider_id, user['org_id'])).fetchone():
        raise HTTPException(400, 'rider is not in your organization')
    DB.execute('UPDATE orders SET rider_id=?, status=? WHERE id=?', (body.rider_id, 'assigned' if body.rider_id else 'unassigned', oid)); DB.commit()
    return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/{oid}/correct')
def correct(oid: int, body: Fix, user=Depends(current_user)):
    need(user, 'seller'); o = own_order(user, oid)
    zone = D.zone_for(DB, body.lat, body.lon, user['org_id'])
    rider = o['rider_id'] or (D.pick_rider(DB, zone['id']) if zone else None)
    DB.execute('UPDATE orders SET lat=?, lon=?, radius_m=?, flag=?, granularity=?, corrected=1, explanation=?, zone_id=?, rider_id=?, status=? WHERE id=?',
               (body.lat, body.lon, 40.0, 'FOUND', 'PREMISE', 'Pin placed by the seller (customer confirmed on the phone).',
                zone['id'] if zone else None, rider, 'assigned' if rider else 'unassigned', oid))
    DB.execute('INSERT INTO observations(premise_key,address_text,lat,lon,accuracy,source,order_id,rider_id,org_id,trusted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
               (o['premise_key'], o['address_text'], body.lat, body.lon, None, 'seller_correction', oid, None, user['org_id'], 0, time.time()))
    DB.commit(); return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.post('/api/orders/{oid}/delivered')
def delivered(oid: int, body: Delivered, user=Depends(current_user)):
    o = own_order(user, oid)
    if user['role'] == 'rider' and o['rider_id'] != user['id']: raise HTTPException(403, 'not your order')
    trusted = 1 if (body.accuracy is not None and body.accuracy <= 25) else 0
    DB.execute('UPDATE orders SET status=?, delivered_lat=?, delivered_lon=?, delivered_acc=?, delivered_at=? WHERE id=?',
               ('delivered', body.lat, body.lon, body.accuracy, time.time(), oid))
    DB.execute('INSERT INTO observations(premise_key,address_text,lat,lon,accuracy,source,order_id,rider_id,org_id,trusted,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
               (o['premise_key'], o['address_text'], body.lat, body.lon, body.accuracy, 'rider_gps', oid, user['id'], o['org_id'], trusted, time.time()))
    DB.commit(); return order_out(DB.execute(ORDER_SQL + ' WHERE o.id=?', (oid,)).fetchone())

@app.delete('/api/orders')
def clear_orders(user=Depends(current_user)):
    need(user, 'seller'); DB.execute('DELETE FROM orders WHERE org_id=?', (user['org_id'],)); DB.commit(); return {'ok': True}

# ----------------------------------------------------------------------------- zones & riders (per organization)
@app.get('/api/zones')
def zones(user=Depends(current_user)):
    sql, args = ('SELECT z.*, g.name AS org_name FROM zones z LEFT JOIN organizations g ON g.id=z.org_id ORDER BY z.id', ()) if user['role'] == 'admin' \
        else ('SELECT z.*, g.name AS org_name FROM zones z LEFT JOIN organizations g ON g.id=z.org_id WHERE z.org_id=? ORDER BY z.id', (user['org_id'],))
    out = []
    for z in D.rows(DB.execute(sql, args)):
        z['polygon'] = json.loads(z['polygon'])
        z['riders'] = D.rows(DB.execute("SELECT id, name, username FROM users WHERE role='rider' AND zone_id=?", (z['id'],)))
        z['open_orders'] = DB.execute("SELECT COUNT(*) FROM orders WHERE zone_id=? AND status!='delivered'", (z['id'],)).fetchone()[0]
        out.append(z)
    return out

@app.post('/api/zones')
def add_zone(body: Zone, user=Depends(current_user)):
    need(user, 'seller')
    if len(body.polygon) < 3: raise HTTPException(400, 'polygon needs 3+ points')
    cur = DB.execute('INSERT INTO zones(org_id,name,color,polygon,created_at) VALUES (?,?,?,?,?)', (user['org_id'], body.name, body.color, json.dumps(body.polygon), time.time())); DB.commit()
    return {'id': cur.lastrowid}

@app.delete('/api/zones/{zid}')
def del_zone(zid: int, user=Depends(current_user)):
    need(user, 'seller')
    DB.execute('DELETE FROM zones WHERE id=? AND org_id=?', (zid, user['org_id'])); DB.execute('UPDATE users SET zone_id=NULL WHERE zone_id=?', (zid,)); DB.commit(); return {'ok': True}

@app.get('/api/riders')
def riders(user=Depends(current_user)):
    need(user, 'seller', 'admin')
    sql = "SELECT u.id,u.username,u.name,u.phone,u.zone_id,u.org_id,z.name AS zone_name,g.name AS org_name FROM users u LEFT JOIN zones z ON z.id=u.zone_id LEFT JOIN organizations g ON g.id=u.org_id WHERE u.role='rider'"
    cur = DB.execute(sql + ' ORDER BY u.id') if user['role'] == 'admin' else DB.execute(sql + ' AND u.org_id=? ORDER BY u.id', (user['org_id'],))
    out = []
    for r in D.rows(cur):
        r['open'] = DB.execute("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status!='delivered'", (r['id'],)).fetchone()[0]
        r['delivered'] = DB.execute("SELECT COUNT(*) FROM orders WHERE rider_id=? AND status='delivered'", (r['id'],)).fetchone()[0]
        out.append(r)
    return out

@app.post('/api/riders/{rid}/zone')
def set_rider_zone(rid: int, body: RiderZone, user=Depends(current_user)):
    need(user, 'seller')
    if body.zone_id and not DB.execute('SELECT 1 FROM zones WHERE id=? AND org_id=?', (body.zone_id, user['org_id'])).fetchone(): raise HTTPException(400, 'zone not in your organization')
    DB.execute("UPDATE users SET zone_id=? WHERE id=? AND role='rider' AND org_id=?", (body.zone_id, rid, user['org_id'])); DB.commit(); return {'ok': True}

# ----------------------------------------------------------------------------- stats, learning store (shared), collection, gazetteer
def _stats(org_id=None):
    w, a = ('WHERE org_id=?', (org_id,)) if org_id else ('', ())
    q = lambda extra='': DB.execute('SELECT COUNT(*) FROM orders %s %s' % (w, extra) if w else 'SELECT COUNT(*) FROM orders %s' % (extra.replace('AND', 'WHERE', 1) if extra else ''), a).fetchone()[0]
    return {'orders': q(), 'found': q("AND flag='FOUND'"), 'area_only': q("AND flag='AREA-ONLY'"), 'ambiguous': q("AND flag='AMBIGUOUS'"),
            'unresolved': q("AND flag='UNRESOLVED'"), 'delivered': q("AND status='delivered'"), 'assigned': q("AND status='assigned'"), 'unassigned': q("AND status='unassigned'")}

@app.get('/api/stats')
def stats(user=Depends(current_user)):
    s = _stats(None if user['role'] == 'admin' else user['org_id'])
    s.update({'observations': DB.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 'premises_learned': DB.execute('SELECT COUNT(DISTINCT premise_key) FROM observations').fetchone()[0],
              'gazetteer': {'landmarks': len(GAZ.by_kind.get('landmark', [])), 'streets': len(GAZ.by_kind.get('street', [])), 'areas': len(GAZ.by_kind.get('area', []))},
              'collection': DB.execute('SELECT COUNT(*) FROM collection').fetchone()[0],
              'organizations': DB.execute('SELECT COUNT(*) FROM organizations WHERE active=1').fetchone()[0]})
    return s

@app.get('/api/learning')
def learning(user=Depends(current_user)):
    need(user, 'seller', 'admin')   # shared across organizations: address text + GPS only, no names or phones
    return D.rows(DB.execute('SELECT o.*, u.name AS rider_name, g.name AS org_name FROM observations o LEFT JOIN users u ON u.id=o.rider_id LEFT JOIN organizations g ON g.id=o.org_id ORDER BY o.created_at DESC LIMIT 300'))

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

# ----------------------------------------------------------------------------- platform admin: organizations
def org_out(o):
    o = dict(o); oid = o['id']
    o['sellers'] = D.rows(DB.execute("SELECT id, username, name, phone FROM users WHERE org_id=? AND role='seller' ORDER BY id", (oid,)))
    o['riders'] = DB.execute("SELECT COUNT(*) FROM users WHERE org_id=? AND role='rider'", (oid,)).fetchone()[0]
    o['zones'] = DB.execute('SELECT COUNT(*) FROM zones WHERE org_id=?', (oid,)).fetchone()[0]
    o['stats'] = _stats(oid)
    o['contributed'] = DB.execute('SELECT COUNT(*) FROM observations WHERE org_id=?', (oid,)).fetchone()[0]
    return o

@app.get('/api/admin/orgs')
def admin_orgs(user=Depends(current_user)):
    need(user, 'admin'); return [org_out(o) for o in DB.execute('SELECT * FROM organizations ORDER BY id').fetchall()]

@app.post('/api/admin/orgs')
def admin_add_org(body: NewOrg, user=Depends(current_user)):
    need(user, 'admin')
    un = body.seller_username.strip().lower()
    if len(un) < 3 or len(body.seller_password) < 6: raise HTTPException(400, 'seller username min 3 chars, password min 6')
    if DB.execute('SELECT 1 FROM users WHERE username=?', (un,)).fetchone(): raise HTTPException(409, 'username already taken')
    oid = D.add_org(DB, body.name.strip(), body.type, body.contact.strip())
    D.add_user(DB, un, body.seller_password, 'seller', body.seller_name.strip() or (body.name.strip() + ' (dispatcher)'), '', None, oid); DB.commit()
    return org_out(DB.execute('SELECT * FROM organizations WHERE id=?', (oid,)).fetchone())

@app.post('/api/admin/orgs/{oid}/active')
def admin_org_active(oid: int, body: OrgActive, user=Depends(current_user)):
    need(user, 'admin'); DB.execute('UPDATE organizations SET active=? WHERE id=?', (1 if body.active else 0, oid)); DB.commit()
    return org_out(DB.execute('SELECT * FROM organizations WHERE id=?', (oid,)).fetchone())

@app.delete('/api/admin/orgs/{oid}')
def admin_delete_org(oid: int, user=Depends(current_user)):
    """removes the organization with its users, zones and orders; shared learning-store points are kept (org reference cleared)"""
    need(user, 'admin')
    if not DB.execute('SELECT 1 FROM organizations WHERE id=?', (oid,)).fetchone(): raise HTTPException(404, 'organization not found')
    for sql in ('DELETE FROM orders WHERE org_id=?', 'DELETE FROM zones WHERE org_id=?', 'DELETE FROM users WHERE org_id=?',
                'UPDATE observations SET org_id=NULL WHERE org_id=?', 'DELETE FROM organizations WHERE id=?'):
        DB.execute(sql, (oid,))
    DB.commit(); return {'ok': True}

@app.post('/api/admin/orgs/{oid}/users')
def admin_add_user(oid: int, body: NewUser, user=Depends(current_user)):
    need(user, 'admin')
    if body.role not in ('seller', 'rider'): raise HTTPException(400, 'role must be seller or rider')
    un = body.username.strip().lower()
    if DB.execute('SELECT 1 FROM users WHERE username=?', (un,)).fetchone(): raise HTTPException(409, 'username already taken')
    D.add_user(DB, un, body.password, body.role, body.name.strip(), body.phone.strip(), None, oid); DB.commit()
    return org_out(DB.execute('SELECT * FROM organizations WHERE id=?', (oid,)).fetchone())

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
