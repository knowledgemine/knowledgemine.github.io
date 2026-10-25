"""Clip every layer to one local level plus a buffer, and draw a map."""
import difflib
import re
from pathlib import Path

import contextily as cx
import geopandas as gpd
import matplotlib
import pandas as pd

matplotlib.use("Agg")
import matplotlib.patches as mpatches  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

from .export import save_layer  # noqa: E402
from .layers import UTM  # noqa: E402

LICENCE_COLORS = {"Rokka General": "#F1230A", "Prospecting General": "#173FDF",
                  "Opening General": "#02920A", "Prospecting Special": "#77B2AA",
                  "Opening Special": "#88609E", "Opening Construction": "#BA6F02"}
CLIP_TO_AREA = ("chure_area", "national_parks_new", "national_parks_conservation")  # huge polygons
NOT_CLIPPED = ("international_boundary", "provinces")


def _norm(s):
    # "Vyas" and "Byas" are the same name in Nepali spelling
    return re.sub(r"[^a-z]", "", str(s).lower()).replace("v", "b").replace("w", "b")


def find_local_level(local_levels, name, district=None):
    ll = local_levels
    if district:
        ll = ll[ll["district"].map(_norm) == _norm(district)]
        if ll.empty:
            raise SystemExit(f"No district called {district!r}.")
    hit = ll[ll["gapa_napa"].map(_norm) == _norm(name)]
    if len(hit) == 1:
        return hit
    if len(hit) > 1:
        opts = ", ".join(f"{r.gapa_napa} ({r.district})" for r in hit.itertuples())
        raise SystemExit(f"{name!r} matches several local levels: {opts}. Add --district.")
    close = difflib.get_close_matches(_norm(name), ll["gapa_napa"].map(_norm).tolist(), n=5, cutoff=0.6)
    sugg = ll[ll["gapa_napa"].map(_norm).isin(close)]
    hint = ", ".join(f"{r.gapa_napa} ({r.district})" for r in sugg.itertuples()) or "none"
    raise SystemExit(f"No local level called {name!r}. Did you mean: {hint}?")


def clip_layers(layers, target_u, area_u):
    out = {}
    for name, g in layers.items():
        if name in NOT_CLIPPED:
            continue
        g = g.to_crs(UTM)
        g = g[g.intersects(area_u)].copy()
        if name in CLIP_TO_AREA:
            g = g.clip(area_u)
        if g.empty:
            continue
        overlap = g.intersection(target_u).area
        # >1 ha real overlap, so neighbours that only share an edge don't count as inside
        g["inside_target"] = (overlap > 1e4) | ((g.area == 0) & g.intersects(target_u))
        g["pct_in_target"] = (overlap / g.area.where(g.area > 0)).mul(100).round(1)
        g["dist_to_target_m"] = g.distance(target_u).round(0)
        out[name] = g.to_crs(4326)
    return out


def _label_point(geom, area):
    return geom.intersection(area).representative_point()


def draw_map(target, area, clipped, title, png: Path, pdf: Path):
    P = lambda g: g.to_crs(3857)  # noqa: E731
    area_m = P(area).union_all()
    fig, ax = plt.subplots(figsize=(11.7, 11.7))
    handles = []

    for name, color, label in (("chure_area", "#267e07", "Chure (Siwalik)"),
                               ("national_parks_new", "#cc6e05", "National parks"),
                               ("national_parks_conservation", "#1e6e05", "Conservation areas")):
        if name in clipped:
            P(clipped[name]).plot(ax=ax, color=color, alpha=0.25, lw=0)
            handles.append(mpatches.Patch(color=color, alpha=0.35, label=label))

    if "topo_sheets" in clipped:
        ts = P(clipped["topo_sheets"])
        ts.boundary.plot(ax=ax, color="#7a7a7a", lw=0.6, ls=":")
        for _, r in ts.iterrows():
            c = _label_point(r.geometry, area_m)
            ax.annotate(str(r.get("SHEET_ID", "")), (c.x, c.y), fontsize=7, color="#555", ha="center")
        handles.append(Line2D([], [], color="#7a7a7a", ls=":", label="Topo sheet (1:25k)"))

    if "local_levels" in clipped:
        ll = P(clipped["local_levels"])
        ll.boundary.plot(ax=ax, color="#444", lw=0.8)
        for _, r in ll.iterrows():
            c = _label_point(r.geometry, area_m)
            ax.annotate(r["gapa_napa"], (c.x, c.y), fontsize=8, color="#222", ha="center",
                        bbox=dict(fc="white", ec="none", alpha=0.6, pad=1))
        handles.append(Line2D([], [], color="#444", lw=0.8, label="Local level boundary"))

    if "ktft_alignment" in clipped:
        P(clipped["ktft_alignment"]).plot(ax=ax, color="#d62728", lw=2)
        handles.append(Line2D([], [], color="#d62728", lw=2, label="KTFT alignment"))

    P(area).boundary.plot(ax=ax, color="#1f4e9c", lw=2, ls="--")
    P(target).boundary.plot(ax=ax, color="#c00000", lw=2.5)
    handles += [Line2D([], [], color="#c00000", lw=2.5, label=target["gapa_napa"].iloc[0]),
                Line2D([], [], color="#1f4e9c", lw=2, ls="--", label="Buffer")]

    if "mining_licences" in clipped:
        L = P(clipped["mining_licences"])
        for ltype, color in LICENCE_COLORS.items():
            for status, ls in (("Approved", "-"), ("Under process", "--"), ("Inactive", ":")):
                s = L[(L.licence_type == ltype) & (L.status == status)]
                if s.empty:
                    continue
                s.plot(ax=ax, facecolor=color, alpha=0.35, edgecolor=color, lw=1.5, ls=ls)
                for _, r in s.iterrows():
                    c = r.geometry.representative_point()
                    ax.annotate(f"{r['l_license_no']}\n{r['mp_name']}", (c.x, c.y), fontsize=5.5,
                                ha="center", va="center", color="#111",
                                bbox=dict(fc="white", ec=color, lw=0.5, alpha=0.75, pad=0.8))
                handles.append(mpatches.Patch(facecolor=color, alpha=0.5, edgecolor=color, ls=ls,
                                              label=f"{ltype} – {status} ({len(s)})"))

    minx, miny, maxx, maxy = P(area).total_bounds
    pad = (maxx - minx) * 0.03
    ax.set_xlim(minx - pad, maxx + pad)
    ax.set_ylim(miny - pad, maxy + pad)
    # OSM's tile servers block scripted downloads, so use Esri's topo tiles
    cx.add_basemap(ax, source=cx.providers.Esri.WorldTopoMap, attribution_size=6)
    ax.set_axis_off()
    ax.legend(handles=handles, loc="lower left", fontsize=8, framealpha=0.9)
    ax.set_title(title, fontsize=12)
    ax.annotate("N ↑", xy=(0.96, 0.96), xycoords="axes fraction", fontsize=14, weight="bold")
    fig.tight_layout()
    fig.savefig(png, dpi=200)
    fig.savefig(pdf)
    plt.close(fig)


def make_area(layers, name, district, buffer_km, out_root: Path, downloaded: str):
    target = find_local_level(layers["local_levels"], name, district)
    t = target.iloc[0]
    target_u = target.to_crs(UTM).union_all()
    area_u = target_u.buffer(buffer_km * 1000)
    area = gpd.GeoDataFrame({"name": [f"{t.gapa_napa} + {buffer_km:g} km"]}, geometry=[area_u], crs=UTM).to_crs(4326)

    slug = f"{_norm(t.gapa_napa)}_{t.district.lower()}_{buffer_km:g}km"
    out = out_root / slug
    out.mkdir(parents=True, exist_ok=True)

    clipped = clip_layers(layers, target_u, area_u)
    target.to_file(out / "boundary.geojson", driver="GeoJSON")
    area.to_file(out / "buffer.geojson", driver="GeoJSON")
    for lname, g in clipped.items():
        save_layer(lname, g, out)

    rows = [dict(layer=k, features_in_area=len(g), inside=int(g.inside_target.sum()),
                 only_in_buffer=int((~g.inside_target).sum())) for k, g in clipped.items()]
    pd.DataFrame(rows).to_csv(out / "summary.csv", index=False)

    if "mining_licences" in clipped:
        L = clipped["mining_licences"].sort_values(["inside_target", "dist_to_target_m"], ascending=[False, True])
        first = ["l_license_no", "licence_type", "status", "mp_name", "district", "local_level", "l_address",
                 "l_total_area", "area_ha_calc", "l_map_no", "l_from_date", "l_to_date", "lh_name",
                 "lh_address", "approved", "inside_target", "pct_in_target", "dist_to_target_m"]
        cols = [c for c in first if c in L] + [c for c in L.columns if c not in first + ["geometry"]]
        L[cols].to_csv(out / "mining_licences.csv", index=False, encoding="utf-8-sig")

    kind = "Municipality" if "Nagar" in str(t.type_gn) else "Rural Municipality"
    title = (f"{t.gapa_napa} {kind}, {t.district.title()} – DMG GIS data within {buffer_km:g} km\n"
             f"Source: gis.dmgnepal.gov.np · downloaded {downloaded}")
    draw_map(target, area, clipped, title, out / "map.png", out / "map.pdf")
    return out, rows
