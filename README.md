# AddressIQ — landmark-relative address geocoding for Pakistan (FYP prototype)

Turns informal Pakistani addresses ("House 14, Gali 3, Jamia Masjid ke peeche, Islampura") into a map pin,
an honest radius and a plain-word flag, dispatches orders to riders by zone, and learns from every delivery.
Multi-organization: each courier / restaurant / shop has its own logins, zones, riders and orders; the learning
store (address text + GPS only, never a name or phone) is shared across organizations.

## Run (Windows)
Double-click `start.bat` (or run the two commands below in two terminals), then open http://localhost:5173
Phones on the same Wi-Fi: use the "Network" URL printed by the web server (e.g. http://192.168.18.7:5173).

    cd backend  && python -X utf8 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    cd frontend && npm run dev

## Demo accounts
| role | login | what you see |
|---|---|---|
| platform admin | `admin / admin123` | Organizations page: create orgs, dispatcher logins, enable/disable, rider join codes, stats |
| dispatcher (Zaid Traders) | `seller / seller123` | dashboard, orders, 4 zones, riders ahmed/bilal/faisal/usman (+ hamza without a zone) |
| dispatcher (Leopard Courier) | `leopard / leopard123` | its own empty console, one city-wide zone, rider tariq |
| dispatcher (Chaaye Khaana) | `chaaye / chaaye123` | a fresh organization with no zones yet |
| riders | `ahmed`, `bilal`, `faisal`, `usman`, `tariq` / `rider123` | the rider app (own stops only) |

Riders self-register at `/register` with the organization's join code (shown on the admin page).
Sample orders: `data/sample_orders.csv` (15 real Jhelum / Dina addresses, Roman Urdu + Urdu script).

## Layout
    backend/app/normalise.py   normaliser (Roman Urdu / Urdu script / English -> one matching form, phonetic keys)
    backend/app/geocoder.py    tagger -> gazetteer retrieval -> relation geometry -> ranking -> flag + radius
    backend/app/db.py          app database (organizations, users, zones, orders, shared learning store, collection), seed
    backend/app/main.py        FastAPI endpoints (auth, geocode, orders, zones, riders, learning, collect, admin)
    scripts/fetch_osm.py       Overpass download of every named feature in Jhelum + Dina
    scripts/build_gazetteer.py builds data/gazetteer.sqlite (FTS5) from the download
    frontend/                  React + Vite + Tailwind + MapLibre (admin page, seller console, rider PWA, collection form)

## Rebuild the map data
    python scripts/fetch_osm.py && python scripts/build_gazetteer.py

## Production build (single server)
    cd frontend && npm run build        # then the API serves the app at http://localhost:8000
