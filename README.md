# AddressIQ — landmark-relative address geocoding for Pakistan (FYP prototype)

Turns informal Pakistani addresses ("House 14, Gali 3, Jamia Masjid ke peeche, Islampura") into a map pin,
an honest radius and a plain-word flag, dispatches orders to riders by zone, and learns from every delivery.

## Run (Windows)
Double-click `start.bat` (or run the two commands below in two terminals), then open http://localhost:5173

    cd backend  && python -X utf8 -m uvicorn app.main:app --port 8000 --reload
    cd frontend && npm run dev

Demo accounts: `seller / seller123` (dispatch console), riders `ahmed`, `bilal`, `faisal`, `usman` (all `rider123`),
`hamza / rider123` (registered, no zone yet). Sample orders: `data/sample_orders.csv` (also the "Sample CSV" button).

## Layout
    backend/app/normalise.py   normaliser (Roman Urdu / Urdu script / English -> one matching form, phonetic keys)
    backend/app/geocoder.py    tagger -> gazetteer retrieval -> relation geometry -> ranking -> flag + radius
    backend/app/db.py          app database (users, zones, orders, learning store, collection records), seed data
    backend/app/main.py        FastAPI endpoints (auth, geocode, orders, zones, riders, learning, collect)
    scripts/fetch_osm.py       Overpass download of every named feature in Jhelum + Dina
    scripts/build_gazetteer.py builds data/gazetteer.sqlite (FTS5) from the download
    frontend/                  React + Vite + Tailwind + MapLibre (seller console, rider PWA, collection form)

## Rebuild the map data
    python scripts/fetch_osm.py && python scripts/build_gazetteer.py

## Production build (single server)
    cd frontend && npm run build        # then the API serves the app at http://localhost:8000
