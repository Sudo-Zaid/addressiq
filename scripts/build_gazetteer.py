# -*- coding: utf-8 -*-
"""Build data/gazetteer.sqlite from data/osm_raw.json.
One row per named feature: kind (landmark / street / area / town), category, name, normalised + phonetic keys,
centre lat/lon, and for streets/areas the geometry (list of [lat, lon]) as JSON."""
import json, re, sqlite3, os, sys, unicodedata
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from app.normalise import normalise, phonetic_key

raw = json.load(open('data/osm_raw.json', encoding='utf-8'))
els = raw['elements']
nodes = {e['id']: (e['lat'], e['lon']) for e in els if e['type'] == 'node' and 'lat' in e}

AREA_TAGS = {('place', 'neighbourhood'), ('place', 'suburb'), ('place', 'quarter'), ('place', 'locality'),
             ('landuse', 'residential'), ('residential', 'housing'), ('place', 'city_block'), ('place', 'hamlet'), ('place', 'village')}
TOWN_TAGS = {('place', 'city'), ('place', 'town')}
LANDMARK_KEYS = ['amenity', 'shop', 'building', 'office', 'leisure', 'tourism', 'healthcare', 'religion', 'craft', 'man_made', 'public_transport', 'railway', 'aeroway', 'historic', 'education']

def classify(tags):
    for k, v in tags.items():
        if (k, v) in TOWN_TAGS: return 'town', v
        if (k, v) in AREA_TAGS: return 'area', v
    if 'highway' in tags: return 'street', tags['highway']
    for k in LANDMARK_KEYS:
        if k in tags: return 'landmark', (tags.get('amenity') or tags.get('shop') or tags.get('building') or tags.get(k) or k)
    if 'name' in tags and tags.get('type') == 'multipolygon': return 'area', 'multipolygon'
    if 'name' in tags: return 'landmark', 'other'
    return None, None

def way_geom(e):
    pts = [nodes[n] for n in e.get('nodes', []) if n in nodes]
    return pts

rows = []
for e in els:
    tags = e.get('tags') or {}
    if 'name' not in tags: continue
    kind, cat = classify(tags)
    if not kind: continue
    if e['type'] == 'node':
        lat, lon, geom = e['lat'], e['lon'], None
    else:
        c = e.get('center') or {}
        geom = way_geom(e) if e['type'] == 'way' else None
        if c: lat, lon = c['lat'], c['lon']
        elif geom: lat, lon = sum(p[0] for p in geom) / len(geom), sum(p[1] for p in geom) / len(geom)
        else: continue
    names = {tags['name']}
    for k in ('name:en', 'name:ur', 'alt_name', 'old_name', 'official_name', 'short_name'):
        if tags.get(k): names.add(tags[k])
    for nm in names:
        norm = normalise(nm)
        if not norm: continue
        rows.append((e['type'], e['id'], kind, cat, nm, norm, phonetic_key(norm), lat, lon,
                     json.dumps(geom) if geom else None, 1 if nm == tags['name'] else 0))

os.makedirs('data', exist_ok=True)
if os.path.exists('data/gazetteer.sqlite'): os.remove('data/gazetteer.sqlite')
db = sqlite3.connect('data/gazetteer.sqlite')
db.executescript('''
CREATE TABLE place(id INTEGER PRIMARY KEY, osm_type TEXT, osm_id INTEGER, kind TEXT, category TEXT, name TEXT,
                   norm TEXT, phon TEXT, lat REAL, lon REAL, geom TEXT, primary_name INTEGER);
CREATE INDEX ix_kind ON place(kind); CREATE INDEX ix_phon ON place(phon); CREATE INDEX ix_norm ON place(norm);
CREATE VIRTUAL TABLE place_fts USING fts5(norm, content='place', content_rowid='id', tokenize='trigram');
''')
db.executemany('INSERT INTO place(osm_type,osm_id,kind,category,name,norm,phon,lat,lon,geom,primary_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)', rows)
db.execute("INSERT INTO place_fts(place_fts) VALUES('rebuild')")
db.commit()
print('rows:', len(rows))
for kind, n in db.execute('SELECT kind, COUNT(*) FROM place WHERE primary_name=1 GROUP BY kind ORDER BY 2 DESC'): print('  %-9s %d' % (kind, n))
print('top landmark categories:', db.execute("SELECT category, COUNT(*) c FROM place WHERE kind='landmark' AND primary_name=1 GROUP BY category ORDER BY c DESC LIMIT 12").fetchall())
print('areas:', [r[0] for r in db.execute("SELECT name FROM place WHERE kind='area' AND primary_name=1 ORDER BY name LIMIT 40")])
print('mosques:', db.execute("SELECT COUNT(*) FROM place WHERE category='place_of_worship' AND primary_name=1").fetchone()[0],
      '| streets:', db.execute("SELECT COUNT(*) FROM place WHERE kind='street' AND primary_name=1").fetchone()[0])
db.close()
