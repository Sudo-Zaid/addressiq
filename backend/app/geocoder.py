# -*- coding: utf-8 -*-
"""AddressIQ geocoder v0 (rule-based tagger + fuzzy gazetteer retrieval + relation geometry + ranking).
Input: free text address. Output: pin, radius (m), granularity, flag, explanation, matched parts, candidates."""
import json, math, os, re, sqlite3
from rapidfuzz import fuzz
from shapely.geometry import Point, Polygon, LineString
from .normalise import normalise, phonetic_key

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GAZ = os.path.join(ROOT, 'data', 'gazetteer.sqlite')

RELATIONS = {'peeche': (40, 120, 'behind'), 'samne': (20, 80, 'in front of'), 'sath': (10, 60, 'next to'),
             'pass': (0, 150, 'near'), 'qareeb': (0, 150, 'near'), 'nazdeek': (0, 150, 'near')}
CONNECTORS = {'ke', 'k', 'kay', 'kai', 'ky', 'key', 'kee', 'ki', 'ka', 'kae', 'the', 'of'}
CITIES = {'jhelum': 'Jhelum', 'dina': 'Dina', 'sarai alamgir': 'Sarai Alamgir', 'sarae alamgir': 'Sarai Alamgir', 'kala gujran': 'Kala Gujran', 'mangla': 'Mangla'}
AREA_WORDS = {'colony', 'town', 'mohalla', 'pura', 'abad', 'housing', 'nagar', 'lines', 'society', 'scheme', 'estate', 'village',
              'chak', 'dhoke', 'gujran', 'cantt', 'camp', 'area', 'phase', 'quarters', 'garden', 'gardens', 'enclave', 'city'}
LANDMARK_WORDS = {'masjid', 'jamia', 'school', 'college', 'university', 'plaza', 'hospital', 'clinic', 'bank', 'hotel', 'park', 'chowk',
                  'market', 'bazar', 'stop', 'station', 'pump', 'cng', 'petrol', 'mall', 'store', 'mart', 'restaurant', 'office', 'darbar',
                  'church', 'gate', 'mill', 'factory', 'ground', 'stadium', 'rescue', '1122', 'academy', 'tower', 'center', 'centre',
                  'pharmacy', 'medical', 'shop', 'dera', 'adda', 'bus', 'railway', 'cafe', 'bakery', 'gym', 'lab', 'masjad', 'madrasa', 'eid', 'gah'}
GENERIC = {'masjid', 'jamia', 'school', 'college', 'plaza', 'hospital', 'bank', 'hotel', 'park', 'chowk', 'market', 'bazar', 'pump', 'cng',
           'shop', 'store', 'office', 'road', 'main', 'govt', 'government', 'public', 'high', 'model', 'girls', 'boys', 'the', 'big', 'new',
           'old', 'near', 'wali', 'wala', 'ke', 'k', 'ki', 'ka', 'mohalla', 'colony', 'town', 'housing', 'city', 'block', 'gali', 'street', 'no'}
STREET_RE = re.compile(r'\b(gali|street)\s+([a-z]?\d+[a-z]?|[a-z])\b')
BLOCK_RE = re.compile(r'\b(?:(block|sector|phase)\s+([a-z]|\d+)|([a-z]|\d+)\s+(block|sector))\b')
HOUSE_RE = re.compile(r'^(?:(?:house|plot|flat|shop|h|office)\s*)?(\d+[a-z]?|[a-z]\d+)$')
HOUSE_IN_RE = re.compile(r'\b(house|plot|flat|shop)\s+(\d+[a-z]?|[a-z]\d+)\b')
EARTH = 6371000.0

def hav(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH * math.asin(math.sqrt(a))

def to_xy(lat, lon, lat0, lon0):
    """local metres (x east, y north) around a reference point"""
    return ((lon - lon0) * math.cos(math.radians(lat0)) * 111320.0, (lat - lat0) * 110540.0)

def from_xy(x, y, lat0, lon0):
    return (lat0 + y / 110540.0, lon0 + x / (111320.0 * math.cos(math.radians(lat0))))


def ensure_fresh(path=GAZ):
    """rebuild the gazetteer when normalise.py changed since it was built (keys must come from the same normaliser)"""
    import hashlib, subprocess, sys
    want = hashlib.sha1(open(os.path.join(os.path.dirname(__file__), 'normalise.py'), 'rb').read()).hexdigest()
    have = None
    if os.path.exists(path):
        try:
            db = sqlite3.connect(path); have = db.execute("SELECT value FROM meta WHERE key='normaliser_hash'").fetchone(); db.close()
            have = have[0] if have else None
        except sqlite3.Error:
            have = None
    if have != want and os.path.exists(os.path.join(ROOT, 'data', 'osm_raw.json')):
        print('[gazetteer] normaliser changed -> rebuilding data/gazetteer.sqlite ...', flush=True)
        subprocess.run([sys.executable, '-X', 'utf8', os.path.join(ROOT, 'scripts', 'build_gazetteer.py')], cwd=ROOT, check=True)


class Gazetteer:
    def __init__(self, path=GAZ):
        ensure_fresh(path)
        db = sqlite3.connect(path); db.row_factory = sqlite3.Row
        self.rows = [dict(r) for r in db.execute('SELECT * FROM place')]
        db.close()
        for r in self.rows:
            r['geom'] = json.loads(r['geom']) if r['geom'] else None
            r['is_poly'] = bool(r['geom'] and len(r['geom']) > 3 and r['geom'][0] == r['geom'][-1])
        self.by_kind = {}
        for r in self.rows: self.by_kind.setdefault(r['kind'], []).append(r)

    def search(self, phrase_norm, kinds, limit=6, cutoff=0.55):
        """fuzzy search over kind-filtered rows; returns [(score, row)] best first (one entry per OSM object)"""
        if not phrase_norm: return []
        pk = phonetic_key(phrase_norm); best = {}
        specific = [w for w in phrase_norm.split() if w not in GENERIC and not w.isdigit()]
        for kind in kinds:
            for r in self.by_kind.get(kind, []):
                if len(r['norm']) < 3: continue                      # junk one-letter OSM names
                s = fuzz.token_set_ratio(phrase_norm, r['norm']) / 100.0
                if len(r['norm']) >= 0.6 * len(phrase_norm):         # a much shorter name inside the query ("dina" in "madina") is not evidence
                    s = max(s, 0.92 * fuzz.partial_ratio(phrase_norm, r['norm']) / 100.0)
                if r['phon'] == pk: s = max(s, 0.93)
                elif fuzz.ratio(pk, r['phon']) >= 85: s = max(s, 0.80)
                elif pk and set(pk.split()) <= set(r['phon'].split()): s = max(s, 0.85)   # Urdu script drops vowels: "blal town" ~ "bilal town jhelum"
                if s >= cutoff:
                    if specific:
                        # at least one specific (non-generic) word of the query must appear in the name
                        # (spelled similarly, or with the same consonant skeleton — Urdu script drops vowels)
                        rp = set(r['phon'].split())
                        if not any(fuzz.partial_ratio(w, r['norm']) >= 80 or phonetic_key(w) in rp for w in specific): s *= 0.6
                    else:
                        # query is only generic words ("city housing"): the whole phrase must appear in the name
                        if len(phrase_norm.split()) < 2 or fuzz.partial_ratio(phrase_norm, r['norm']) < 90: s *= 0.5
                    key = (r['osm_type'], r['osm_id'])
                    if s > best.get(key, (0, None))[0]: best[key] = (s, r)
        out = sorted(best.values(), key=lambda t: -t[0])
        return [t for t in out if t[0] >= cutoff][:limit]

    def nearest_on_street(self, street, lat, lon):
        """nearest point on a street polyline to (lat, lon): returns (dist_m, plat, plon)"""
        g = street['geom']
        if not g or len(g) < 2: return hav(lat, lon, street['lat'], street['lon']), street['lat'], street['lon']
        pts = [to_xy(p[0], p[1], lat, lon) for p in g]
        line = LineString(pts); q = line.interpolate(line.project(Point(0, 0)))
        plat, plon = from_xy(q.x, q.y, lat, lon)
        return math.hypot(q.x, q.y), plat, plon

    def street_mid(self, street):
        g = street['geom']
        if not g or len(g) < 2: return street['lat'], street['lon'], 80.0
        lat0, lon0 = g[0]
        pts = [to_xy(p[0], p[1], lat0, lon0) for p in g]
        line = LineString(pts); m = line.interpolate(0.5, normalized=True)
        lat, lon = from_xy(m.x, m.y, lat0, lon0)
        return lat, lon, max(60.0, min(250.0, line.length / 2.0))

    def area_radius(self, area):
        if area['is_poly']:
            lat0, lon0 = area['lat'], area['lon']
            poly = Polygon([to_xy(p[0], p[1], lat0, lon0) for p in area['geom']])
            if poly.is_valid and poly.area > 0: return max(150.0, min(1500.0, math.sqrt(poly.area / math.pi)))
        return 400.0

    def inside_area(self, area, lat, lon):
        if area['is_poly']:
            lat0, lon0 = area['lat'], area['lon']
            poly = Polygon([to_xy(p[0], p[1], lat0, lon0) for p in area['geom']])
            if poly.is_valid: return poly.buffer(150).contains(Point(to_xy(lat, lon, lat0, lon0)))
        return hav(lat, lon, area['lat'], area['lon']) <= self.area_radius(area) * 1.4 + 300


# ----------------------------------------------------------------------------- tagger
def split_segments(text):
    parts = re.split(r'[,;\n،]|\s-\s|\s/\s', text)
    return [p.strip() for p in parts if p and p.strip()]

def tag(text):
    """rule-based tagging of one address into parts (all on normalised text)"""
    parts = {'house': None, 'streets': [], 'blocks': [], 'landmarks': [], 'areas': [], 'city': None, 'unknown': [], 'segments': []}
    for seg in split_segments(text):
        n = normalise(seg)
        if not n: continue
        parts['segments'].append(n)
        toks = n.split()
        # city (whole segment or trailing)
        for c in CITIES:
            if n == c: parts['city'] = parts['city'] or CITIES[c]; n = ''; break
            if n.endswith(' ' + c): parts['city'] = parts['city'] or CITIES[c]; n = n[:-len(c)].strip(); break
        if not n: continue
        toks = n.split()
        # house
        m = HOUSE_RE.match(n)
        if m and len(toks) <= 2: parts['house'] = parts['house'] or m.group(1); continue
        m = HOUSE_IN_RE.search(n)
        if m: parts['house'] = parts['house'] or m.group(2); n = (n[:m.start()] + ' ' + n[m.end():]).strip(); toks = n.split()
        if not n: continue
        # relation
        rel_i = next((i for i, t in enumerate(toks) if t in RELATIONS), None)
        if rel_i is not None:
            rel = toks[rel_i]
            if rel_i == 0:           # "near X" / "behind X"
                lm = [t for t in toks[1:] if t not in CONNECTORS]
            else:
                lm = toks[:rel_i]
                while lm and lm[-1] in CONNECTORS: lm.pop()
            lm_text = ' '.join(lm).strip()
            if lm_text: parts['landmarks'].append({'text': lm_text, 'relation': rel}); continue
        # street
        m = STREET_RE.search(n)
        if m:
            parts['streets'].append({'text': '%s %s' % (m.group(1), m.group(2)), 'label': m.group(2)})
            rest = (n[:m.start()] + ' ' + n[m.end():]).strip()
            if rest and len(rest) > 2: n = rest; toks = n.split()
            else: continue
        if 'road' in toks and len(toks) >= 2:
            parts['streets'].append({'text': n, 'label': None}); continue
        # block
        m = BLOCK_RE.search(n)
        if m:
            lab = m.group(2) or m.group(3)
            parts['blocks'].append(lab)
            rest = (n[:m.start()] + ' ' + n[m.end():]).strip()
            if not rest: continue
            n = rest; toks = n.split()
        # area vs landmark
        if any(t in AREA_WORDS for t in toks) and not any(t in LANDMARK_WORDS for t in toks):
            parts['areas'].append(n); continue
        if any(t in LANDMARK_WORDS for t in toks):
            parts['landmarks'].append({'text': n, 'relation': None}); continue
        parts['unknown'].append(n)
    return parts


# ----------------------------------------------------------------------------- geocoder
class Geocoder:
    def __init__(self, gaz=None, store=None):
        self.g = gaz or Gazetteer()
        self.store = store      # optional learning-store interface: premise(key) -> dict|None, density(lat, lon) -> int

    def premise_key(self, parts, text):
        city = (parts['city'] or '').lower(); area = parts['areas'][0] if parts['areas'] else ''
        body = normalise(text)
        for c in CITIES: body = re.sub(r'\b' + c + r'\b', ' ', body)
        return '%s|%s|%s' % (city, area, re.sub(r'\s+', ' ', body).strip())

    def city_hint(self, city):
        """An address that could not be placed still gets a reference area for the map: the city it names
        (the default city when it names none). It is a hint for the dispatcher, never a delivery point."""
        hits = self.g.search((city or 'Jhelum').lower(), ['town'], limit=1, cutoff=0.6)
        if not hits: return None
        r = hits[0][1]
        return {'name': city or 'Jhelum', 'lat': r['lat'], 'lon': r['lon'], 'radius_m': 2500.0 if r['category'] == 'city' else 1500.0, 'assumed': not city}

    def geocode(self, text):
        parts = tag(text)
        res = {'input': text, 'parts': parts, 'matched': {}, 'not_found': [], 'candidates': [], 'alternatives': []}
        key = self.premise_key(parts, text); res['premise_key'] = key
        # 0) learning store: a confirmed premise wins
        if self.store:
            hit = self.store.premise(key)
            if hit:
                res.update(lat=hit['lat'], lon=hit['lon'], radius_m=hit['radius'], granularity='PREMISE', flag='FOUND',
                           explanation='Confirmed by %d earlier deliver%s to this exact address.' % (hit['n'], 'y' if hit['n'] == 1 else 'ies'),
                           source='learning_store')
                res['matched']['premise_observations'] = hit['n']; return res
        # 1) area / town
        area = None
        for a in parts['areas'] + parts['unknown']:
            hits = self.g.search(a, ['area', 'town'], limit=3, cutoff=0.62)
            if hits: area = hits[0][1]; res['matched']['area'] = {'name': area['name'], 'score': round(hits[0][0], 2), 'text': a}; break
            else: res['not_found'].append(a)
        area_from_landmark = False
        if not area:
            # an area that OSM has no polygon for (e.g. Citi Housing) is often present as a named landmark
            # ("Citi Housing Office", "MCB ATM Citi Housing"): use the best such hit as an area-level anchor
            for a in parts['areas']:
                hits = self.g.search(a, ['landmark'], limit=3, cutoff=0.7)
                if hits:
                    area = dict(hits[0][1]); area['is_poly'] = False; area_from_landmark = True
                    res['matched']['area'] = {'name': area['name'], 'score': round(hits[0][0], 2), 'text': a, 'via_landmark': True}
                    if a in res['not_found']: res['not_found'].remove(a)
                    break
        if not area and parts['blocks']:
            res['not_found'].append('block ' + ', '.join(parts['blocks']))
        city_row = None
        if parts['city']:
            hits = self.g.search(parts['city'].lower(), ['town'], limit=1, cutoff=0.6)
            if hits: city_row = hits[0][1]
        anchor = area or city_row          # geographic anchor for filtering
        def near_anchor(r):
            if area: return self.g.inside_area(area, r['lat'], r['lon'])
            if city_row: return hav(r['lat'], r['lon'], city_row['lat'], city_row['lon']) <= 6000
            return True
        def anchor_term(r):
            """+0.25 inside the stated area, +0.1 within 2 km of it (adjacent colonies), -0.1 beyond;
            the stated city breaks ties between same-named places (+0.05 within 6 km of the city centre)"""
            city_term = 0.0
            if city_row: city_term = 0.05 if hav(r['lat'], r['lon'], city_row['lat'], city_row['lon']) <= 6000 else -0.05
            if area:
                if self.g.inside_area(area, r['lat'], r['lon']): return 0.25 + city_term
                return (0.1 if hav(r['lat'], r['lon'], area['lat'], area['lon']) <= 2000 else -0.1) + city_term
            if city_row: return 0.15 if city_term > 0 else -0.15
            return 0.0
        # 2) street
        street = None; street_amb = []
        for s in parts['streets']:
            hits = [h for h in self.g.search(s['text'], ['street'], limit=8, cutoff=0.7)]
            same = [h for h in hits if h[0] >= 0.85]
            loc = [h for h in same if near_anchor(h[1])] or ([] if anchor else same)
            if loc:
                street = loc[0][1]; res['matched']['street'] = {'name': street['name'], 'score': round(loc[0][0], 2), 'text': s['text']}
                if len(loc) > 1 and hav(loc[0][1]['lat'], loc[0][1]['lon'], loc[1][1]['lat'], loc[1][1]['lon']) > 300: street_amb = loc[:3]
                break
            res['not_found'].append(s['text'])
        # 3) landmarks
        best = None; scored = []
        for lm in parts['landmarks']:
            specific = [w for w in lm['text'].split() if w not in GENERIC and not w.isdigit()]
            if not specific and len(lm['text'].split()) < 3:
                # "jamia masjid", "big plaza": names nothing in particular; 3+ generic words ("govt boys high school")
                # are searched but must appear as a whole phrase inside a map name (see Gazetteer.search)
                res['not_found'].append(lm['text'] + ' (generic)'); continue
            for s_name, r in self.g.search(lm['text'], ['landmark', 'area'], limit=8, cutoff=0.55):
                total = 0.6 * s_name + anchor_term(r)
                if street:
                    d, _, _ = self.g.nearest_on_street(street, r['lat'], r['lon']); total += 0.15 * max(0.0, 1 - d / 250.0)
                dens = self.store.density(r['lat'], r['lon']) if self.store else 0
                total += min(0.3, 0.1 * dens)
                scored.append({'total': round(total, 3), 'name_score': round(s_name, 2), 'row': r, 'relation': lm['relation'], 'text': lm['text'], 'density': dens})
        scored.sort(key=lambda c: -c['total'])
        res['candidates'] = [{'name': c['row']['name'], 'kind': c['row']['kind'], 'category': c['row']['category'], 'lat': c['row']['lat'],
                              'lon': c['row']['lon'], 'score': c['total'], 'name_score': c['name_score'], 'nearby_confirmations': c['density']} for c in scored[:6]]
        if scored and scored[0]['total'] >= 0.45: best = scored[0]
        elif parts['landmarks']:
            for lm in parts['landmarks']:
                if lm['text'] + ' (generic)' not in res['not_found']: res['not_found'].append(lm['text'])
        # 4) decide
        if best:
            r = best['row']; rel = best['relation']
            res['matched']['landmark'] = {'name': r['name'], 'category': r['category'], 'score': best['total'], 'text': best['text'], 'relation': rel}
            alt = [c for c in scored[1:] if best['total'] - c['total'] <= 0.08 and c['name_score'] >= 0.75
                   and hav(r['lat'], r['lon'], c['row']['lat'], c['row']['lon']) > 150]
            if rel:
                dmin, dmax, word = RELATIONS[rel]
                if street:
                    d, plat, plon = self.g.nearest_on_street(street, r['lat'], r['lon'])
                    if d <= 300:
                        if d < dmin:   # push out along the landmark->street direction to the band
                            x, y = to_xy(plat, plon, r['lat'], r['lon']); n = math.hypot(x, y) or 1
                            plat, plon = from_xy(x / n * dmin, y / n * dmin, r['lat'], r['lon'])
                        res['band'] = {'landmark_name': r['name'], 'lat': r['lat'], 'lon': r['lon'], 'relation': rel, 'word': word, 'dmin': dmin, 'dmax': dmax}
                        res.update(lat=plat, lon=plon, radius_m=float(max(60, (dmax - dmin) / 2 + 30)), granularity='STREET', flag='FOUND',
                                   explanation='%s %s %s, on %s.' % (word.capitalize(), r['name'], '', street['name']).replace('  ', ' '))
                        res['explanation'] = '%s is %s %s, and the address names %s, so the pin is where that street passes %s.' % (
                            'The stop', word, r['name'], street['name'], word + ' it')
                        return self._finish(res, alt)
                res['band'] = {'landmark_name': r['name'], 'lat': r['lat'], 'lon': r['lon'], 'relation': rel, 'word': word, 'dmin': dmin, 'dmax': dmax}
                res.update(lat=r['lat'], lon=r['lon'], radius_m=float(dmax + 40), granularity='LANDMARK', flag='FOUND',
                           explanation='%s found; "%s" means %s-%s m %s it, but the map does not say which side, so the circle covers all sides.' % (r['name'], rel, dmin, dmax, word))
                return self._finish(res, alt)
            res.update(lat=r['lat'], lon=r['lon'], radius_m=100.0, granularity='LANDMARK', flag='FOUND',
                       explanation='%s found on the map (%s).' % (r['name'], r['category']))
            return self._finish(res, alt)
        if street:
            lat, lon, rad = self.g.street_mid(street)
            res.update(lat=lat, lon=lon, radius_m=rad, granularity='STREET', flag='FOUND',
                       explanation='%s found; no landmark given, so the pin is the middle of the street.' % street['name'])
            if street_amb:
                res['flag'] = 'AMBIGUOUS'; res['alternatives'] = [{'name': h[1]['name'], 'lat': h[1]['lat'], 'lon': h[1]['lon']} for h in street_amb]
                res['explanation'] = 'More than one "%s" exists and no area narrows it down: %s.' % (street['name'], ', '.join(a['name'] for a in res['alternatives']))
            return res
        if area:
            res.update(lat=area['lat'], lon=area['lon'], radius_m=(400.0 if area_from_landmark else self.g.area_radius(area)), granularity='COLONY', flag='AREA-ONLY',
                       explanation='Only the area "%s" could be placed%s; %s. Go to the area, then ask.' % (
                           area['name'], ' (the area itself has no boundary on the map)' if area_from_landmark else '',
                           ('"%s" is not on the map' % ', '.join(res['not_found'])) if res['not_found'] else 'the street or landmark is not on the map'))
            return res
        hint = self.city_hint(parts['city'])
        if hint: res['hint'] = hint
        res.update(lat=None, lon=None, radius_m=None, granularity='CITY' if parts['city'] else 'NONE', flag='UNRESOLVED',
                   explanation=('Only the city (%s) was recognised' % parts['city'] if parts['city'] else 'No landmark, street or area was recognised') +
                               (' — not on the map: %s.' % ', '.join(res['not_found']) if res['not_found'] else '.') + ' Call the customer before dispatch.')
        return res

    def _finish(self, res, alt):
        if alt:
            res['flag'] = 'AMBIGUOUS'
            res['alternatives'] = [{'name': c['row']['name'], 'lat': c['row']['lat'], 'lon': c['row']['lon'], 'score': c['total']} for c in alt[:2]]
            far = max(hav(res['lat'], res['lon'], a['lat'], a['lon']) for a in res['alternatives'])
            res['radius_m'] = float(min(600.0, far / 2 + res['radius_m']))
            res['explanation'] = 'Two places match: %s or %s. Both are shown; please confirm with the customer.' % (res['matched']['landmark']['name'], res['alternatives'][0]['name'])
        return res


if __name__ == '__main__':
    import sys
    gc = Geocoder()
    tests = sys.argv[1:] or ['House 14, Gali 3, Masjid Ghousia ke peeche, Machine Mohalla No.1, Jhelum', 'Street A8, Satellite Town, Jhelum',
                             'Shop 5, Qureshi Market, Jhelum', 'A Block, Citi Housing, Jhelum', 'Near Sir Syed Model School, Bilal Town, Jhelum',
                             'Makan 7, Pak Uk Hospital ke samne, Jhelum', 'Gali 2, Model Colony, Jhelum', 'near the big plaza, Jhelum',
                             'Bilal Masjid ke peeche, Mujahidabad, Jhelum', 'مکان 5، گورنمنٹ بوائز ہائی اسکول کے پیچھے، دینہ', 'Faisal Chowk ke pass, Jhelum']
    for t in tests:
        r = gc.geocode(t)
        print('\n>>', t); print('   parts:', {k: v for k, v in r['parts'].items() if v and k != 'segments'})
        print('   ', r['flag'], r['granularity'], (round(r['lat'], 5), round(r['lon'], 5), int(r['radius_m'])) if r['lat'] else '-', '|', r['explanation'])
        if r['candidates']: print('    top:', [(c['name'], c['score']) for c in r['candidates'][:3]])
