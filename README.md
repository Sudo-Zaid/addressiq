# AddressIQ — landmark-relative address geocoding for Pakistan (FYP prototype)

Turns informal Pakistani addresses ("House 14, Gali 3, Jamia Masjid ke peeche, Islampura") into a map pin,
an honest radius and a plain-word flag, dispatches orders to riders by zone, and learns from every delivery.
Multi-organization: each courier / restaurant / shop has its own logins, zones, riders and orders; the learning
store (address text + GPS only, never a name or phone) is shared across organizations.

**Live demo: https://addressiq.live** — sign in with one of the demo accounts listed below. The link is online whenever
the project server is running; for now that is a team laptop, so it is not up 24 hours a day.

## Team
Final Year Project, BS Computer Science, FCIT, University of the Punjab (Jhelum Campus).

- Muhammad Zaid — [Sudo-Zaid](https://github.com/Sudo-Zaid)
- Kaif Ahmad — [Kaifi-Ahmad](https://github.com/Kaifi-Ahmad)
- Ans Abbas — [ansabbas56](https://github.com/ansabbas56)

How we work together (one branch per person, pull requests into `master`): see [CONTRIBUTING.md](CONTRIBUTING.md).

## Install (first time)
Needs Python 3.11+ and Node 20.19+ (or 22.12+).

    pip install -r backend/requirements.txt
    cd frontend && npm install

`package.json` is in `frontend/`. The map data (`data/gazetteer.sqlite`) is in the repository; the app database
(`data/app.sqlite`) is created and seeded with the demo accounts on the first start.

## Run on your own computer (Windows)
Double-click `start.bat` (or run the two commands below in two terminals). The app then opens at `http://localhost:5173`.
That address works only on the computer that is running it; phones on the same Wi-Fi use the "Network" address printed
in the web window. Everyone else uses the live demo link above.

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
    cd frontend && npm run build        # then the API serves the app on port 8000 of that machine

After the build the API serves the web app and `/api` together on ONE port, so only port 8000 has to be exposed.

## Public link (https://addressiq.live)
Double-click `share.bat` on the computer that hosts the demo. It builds the web app, starts the API if needed and opens
a Cloudflare tunnel, so https://addressiq.live works from any network over HTTPS (phone GPS and the microphone work
too). The link is up only while that window and the API window stay open.

One-time setup on a new host: run `tunnel-setup.bat` (signs in to Cloudflare and creates the tunnel) and put
`tools\cloudflared.exe` in place (cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases,
not kept in git). Without that setup `share.bat` still works and prints a temporary `https://….trycloudflare.com` address.

## Deploy on a server (always-on link)
    docker build -t addressiq .
    docker run -p 8000:8000 -e ADDRESSIQ_SECRET=<long random text> -e ADDRESSIQ_DB=/data/app.sqlite -v addressiq-data:/data addressiq

The `Dockerfile` builds the frontend and runs the API on `$PORT` (default 8000), so it works as-is on Docker hosts
such as Render, Railway, Fly.io or a VPS. Settings (environment variables):

| variable | what it does |
|---|---|
| `ADDRESSIQ_SECRET` | signs the login tokens. Set it to a long random text on any public server (the default is a dev value). |
| `ADDRESSIQ_DB` | path of the app database. Point it at a mounted disk, otherwise orders and learned addresses are lost when the container is rebuilt. |
| `PORT` | port to listen on (Docker only). |

Without Docker: install as above, `npm run build`, then `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`.
The backend keeps everything in SQLite files, so run ONE instance (no horizontal scaling).
Before sharing a public link, change the demo passwords: the login page lists them.
