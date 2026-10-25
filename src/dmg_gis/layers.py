"""Read the raw downloads into GeoDataFrames (EPSG:4326)."""
import html
import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import GeometryCollection
from shapely.ops import unary_union

UTM = 32645  # WGS 84 / UTM 45N, used for areas and distances

ATTR = re.compile(r'atr-name">([^<]+)</span>:</strong>\s*<span class="atr-value">(.*?)</span>', re.S)

KML_NAMES = {"states": "provinces", "districts": "districts", "locallevels": "local_levels",
             "topomapsheets": "topo_sheets", "Alignment": "ktft_alignment", "Chainage": "ktft_chainage"}
STATIC_NAMES = {"siwalik": "chure_area", "nationalparks": "national_parks_new",
                "conservations": "national_parks_conservation", "intlboundary": "international_boundary"}


def _clean_geom(g):
    # KML placemarks can be GeometryCollection(label point + shape); keep the shape
    if isinstance(g, GeometryCollection):
        parts = [p for p in g.geoms if p.geom_type != "Point"] or list(g.geoms)
        return unary_union(parts)
    return g


def read_kml(path: Path) -> gpd.GeoDataFrame:
    g = gpd.read_file(path)
    # GeoServer puts the attributes in the HTML description, not ExtendedData
    rows = [{k: html.unescape(v).strip() for k, v in ATTR.findall(html.unescape(d or ""))}
            for d in g["description"]]
    a = pd.DataFrame(rows)
    for c in a.columns:
        try:
            a[c] = pd.to_numeric(a[c])
        except (ValueError, TypeError):
            pass
    out = gpd.GeoDataFrame(a, geometry=g.geometry.apply(_clean_geom).values, crs=4326)
    out.insert(0, "fid", g["id"].values)
    return out


def read_static(path: Path) -> gpd.GeoDataFrame:
    g = gpd.read_file(path)
    g = g.set_crs(4326) if g.crs is None else g.to_crs(4326)
    return g.drop(columns=[c for c in ("description",) if c in g.columns])


def read_licences(raw: Path) -> gpd.GeoDataFrame:
    parts = []
    for p in sorted(raw.glob("lic_*.json")):
        try:
            _, ltype, cat, verify, active = p.stem.split("_")
        except ValueError:
            raise SystemExit("Licence files are in the old format. Run:  dmg-gis download")
        # dates are Bikram Sambat (e.g. day 32), so parse JSON by hand to keep them as text
        fc = json.loads(p.read_text())["features"]
        if fc:
            g = gpd.GeoDataFrame.from_features(fc, crs=4326)
            g["licence_type"] = f"{ltype} {cat}"
            g["status"] = ("Inactive" if active == "N"
                           else "Approved" if verify == "Y" else "Under process")
            g["approved"] = verify == "Y"  # still meaningful for inactive licences
            parts.append(g)
    lic = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=4326)
    lic["area_ha_calc"] = lic.to_crs(UTM).area.div(1e4).round(2)
    return lic


def load_all(raw: Path) -> dict[str, gpd.GeoDataFrame]:
    layers = {"mining_licences": read_licences(raw)}
    for src, name in KML_NAMES.items():
        layers[name] = read_kml(raw / f"{src}.kml")
    for src, name in STATIC_NAMES.items():
        layers[name] = read_static(raw / f"static_{src}.geojson")
    return layers
