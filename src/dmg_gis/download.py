"""Fetch every public layer from gis.dmgnepal.gov.np into data/raw."""
import time
from pathlib import Path

import requests

BASE = "http://gis.dmgnepal.gov.np"
WMS = f"{BASE}:8080/geoserver/dmg/wms"
NEPAL_BBOX = "80,26.3,88.3,30.5"

# (licence_type, licence_category) pairs shown on the portal's map
LICENCE_KINDS = [
    ("Rokka", "General"), ("Prospecting", "General"), ("Opening", "General"),
    ("Prospecting", "Special"), ("Opening", "Special"), ("Opening", "Construction"),
]
STATIC_LAYERS = ["siwalik", "nationalparks", "conservations", "intlboundary"]
# The server's WFS is broken ("Unsupported class file major version 59"),
# so vector layers come out of WMS GetMap as KML with attributes.
GEOSERVER_LAYERS = ["states", "districts", "locallevels", "topomapsheets", "Alignment", "Chainage"]


def _fetch(method, url, dest, tries=3, **kw):
    for attempt in range(1, tries + 1):
        try:
            r = requests.request(method, url, timeout=600, **kw)
            r.raise_for_status()
            dest.write_bytes(r.content)
            return len(r.content)
        except requests.RequestException as e:
            if attempt == tries:
                raise
            print(f"  retry {attempt} for {dest.name}: {e}")
            time.sleep(5 * attempt)


def download(raw: Path):
    raw.mkdir(parents=True, exist_ok=True)

    for old in raw.glob("lic_*.json"):  # file naming changed when inactive licences were added
        old.unlink()
    for ltype, cat in LICENCE_KINDS:
        for active in ("Y", "N"):  # N = inactive; the portal's map only shows active ones
            for verify in ("Y", "N"):  # Y = approved, N = under process
                dest = raw / f"lic_{ltype}_{cat}_{verify}_{active}.json"
                n = _fetch("POST", f"{BASE}/home/view_license", dest, data={
                    "active": active, "verify": verify, "license_type": ltype, "license_category": cat})
                print(f"{dest.name}: {n:,} bytes")

    for name in STATIC_LAYERS:
        dest = raw / f"static_{name}.geojson"
        n = _fetch("GET", f"{BASE}/public/static/{name}", dest)
        print(f"{dest.name}: {n:,} bytes")

    for layer in GEOSERVER_LAYERS:
        dest = raw / f"{layer}.kml"
        n = _fetch("GET", WMS, dest, params={
            "service": "WMS", "version": "1.1.1", "request": "GetMap",
            "layers": f"dmg:{layer}", "styles": "", "srs": "EPSG:4326", "bbox": NEPAL_BBOX,
            "width": 1000, "height": 600, "format": "application/vnd.google-earth.kml+xml",
            "format_options": "KMSCORE:100;KMATTR:true;mode:download"})
        print(f"{dest.name}: {n:,} bytes")
