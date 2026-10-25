"""Build the small GeoJSON files the map explorer (web/) loads, and serve it locally."""
import functools
import http.server
import json
import webbrowser
from pathlib import Path

import geopandas as gpd

from .enrich import NEAR_KM, enrich, today_bs

# simplify tolerance in degrees (0.001° ≈ 100 m); keeps the page under ~10 MB
SIMPLIFY = {"local_levels": 0.0006, "districts": 0.0015, "provinces": 0.003,
            "chure_area": 0.0015, "national_parks_new": 0.0008,
            "national_parks_conservation": 0.0008, "ktft_alignment": 0.0002}
KEEP = {
    "mining_licences": ["l_license_no", "licence_type", "status", "approved", "mp_name", "state", "district",
                        "local_level", "l_address", "l_total_area", "area_ha_calc", "l_map_no",
                        "l_easting_from", "l_easting_to", "l_northing_from", "l_northing_to",
                        "l_from_date", "l_to_date", "lh_name", "lh_address",
                        # added by enrich.py
                        "to_date_ad", "from_date_ad", "issue_year_bs", "province", "holder_key", "lat", "lon",
                        "chure_pct", "park", "park_type", "park_pct", "ktft_km", "rokka_overlap",
                        "near_all", "near_same_mineral", "near_pending"],
    "local_levels": ["gapa_napa", "district", "type_gn", "province"],
    "districts": ["district"],
    "provinces": ["Province"],
    "topo_sheets": ["SHEET_ID"],
    "chure_area": [],
    "national_parks_new": ["PAS_NAME", "Name1_1"],
    "national_parks_conservation": ["PARKNAME", "TYPES"],
    "ktft_alignment": [],
}


def _write(g: gpd.GeoDataFrame, path: Path):
    g.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=5, RFC7946="YES")


def build_web_data(layers: dict[str, gpd.GeoDataFrame], out: Path, downloaded: str):
    out.mkdir(parents=True, exist_ok=True)
    layers = {**layers, "mining_licences": enrich(layers["mining_licences"], layers)}
    for name, cols in KEEP.items():
        g = layers[name].copy()
        if name == "chure_area":  # 2,350 ward pieces -> one shape
            g = gpd.GeoDataFrame(geometry=[g.union_all()], crs=4326).explode(index_parts=False)
        g = g[[c for c in cols if c in g.columns] + ["geometry"]]
        if name in SIMPLIFY:
            g["geometry"] = g.geometry.simplify(SIMPLIFY[name], preserve_topology=True)
        g = g[~g.geometry.is_empty]
        _write(g, out / f"{name}.geojson")
        print(f"{name}: {len(g):,} features, {(out / f'{name}.geojson').stat().st_size / 1e6:.1f} MB")
    (out / "meta.json").write_text(json.dumps({"downloaded": downloaded, "built_bs": today_bs(), "near_km": NEAR_KM}))


class _NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):  # always serve the latest build
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve(web: Path, port: int):
    handler = functools.partial(_NoCache, directory=str(web))
    for p in range(port, port + 20):  # an earlier run may still hold the port
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", p), handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"Ports {port}-{port + 19} are all busy. Close other copies, or pass --port.")
    url = f"http://127.0.0.1:{p}/"
    if p != port:
        print(f"Port {port} is busy (another copy is probably still running), using {p}.", flush=True)
    print(f"Map explorer running at {url}\nOpen that address in your browser. Press Ctrl+C to stop.", flush=True)
    webbrowser.open(url)
    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
