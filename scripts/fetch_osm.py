# -*- coding: utf-8 -*-
"""Fetch every named map feature for Jhelum + Dina from Overpass and save raw JSON (data/osm_raw.json)."""
import json, sys, time, requests
BBOX = (32.86, 73.55, 33.08, 73.82)   # south, west, north, east  (Jhelum city + Dina)
Q = """
[out:json][timeout:180];
(
  node["name"](%s);
  way["name"](%s);
  way["highway"]["name"](%s);
  relation["name"]["type"!="route"](%s);
);
out body center qt;
>;
out skel qt;
""" % ((",".join(map(str, BBOX)),) * 4)
for url in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]:
    try:
        r = requests.post(url, data={"data": Q}, headers={"User-Agent": "AddressIQ-FYP/0.1 (student project, Jhelum)"}, timeout=240)
        if r.status_code == 200 and r.text.strip().startswith("{"):
            d = r.json(); json.dump(d, open("data/osm_raw.json", "w", encoding="utf-8"))
            els = d.get("elements", [])
            print("OK from", url, "| elements:", len(els), "| named:", sum(1 for e in els if "tags" in e and "name" in e["tags"]))
            sys.exit(0)
        print("fail", url, r.status_code, r.text[:120].replace("\n", " "))
    except Exception as ex:
        print("error", url, ex)
    time.sleep(3)
sys.exit(1)
