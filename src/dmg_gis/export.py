"""Write every layer for all of Nepal as GeoJSON, Shapefile, CSV and one Excel workbook."""
from pathlib import Path

import geopandas as gpd
import pandas as pd


def _shapefile_columns(columns):
    seen, out = set(), []
    for c in columns:  # shapefile 10-char limit, kept unique
        s = c if c == "geometry" else c[:10]
        i = 1
        while s in seen:
            s, i = f"{c[:8]}_{i}", i + 1
        seen.add(s)
        out.append(s)
    return out


def save_layer(name: str, g: gpd.GeoDataFrame, out: Path):
    for d in ("geojson", "shapefile", "csv"):
        (out / d).mkdir(parents=True, exist_ok=True)
    g.to_file(out / "geojson" / f"{name}.geojson", driver="GeoJSON")
    shp = g.copy()
    shp.columns = _shapefile_columns(shp.columns)
    family = shp.geom_type.str.replace("Multi", "")  # a shapefile holds one geometry family
    for fam in sorted(set(family)):
        suffix = "" if family.nunique() == 1 else f"_{fam.lower()}"
        shp[family == fam].to_file(out / "shapefile" / f"{name}{suffix}.shp", encoding="utf-8")
    g.drop(columns="geometry").to_csv(out / "csv" / f"{name}.csv", index=False, encoding="utf-8-sig")


def licence_summaries(lic: gpd.GeoDataFrame) -> dict[str, pd.DataFrame]:
    return {
        "Licences by type": lic.groupby(["licence_type", "status"]).size().unstack(fill_value=0),
        "Licences by district": lic.groupby(["district", "status"]).size().unstack(fill_value=0)
                                   .sort_values("Approved", ascending=False),
        "Licences by mineral": lic.groupby("mp_name").size().sort_values(ascending=False)
                                  .rename("count").to_frame(),
    }


def export_all(layers: dict[str, gpd.GeoDataFrame], out: Path):
    out.mkdir(parents=True, exist_ok=True)
    for name, g in layers.items():
        save_layer(name, g, out)
        print(f"{name}: {len(g):,} features")

    sums = licence_summaries(layers["mining_licences"])
    for title, df in sums.items():
        df.to_csv(out / "csv" / f"{title.lower().replace(' ', '_')}.csv", encoding="utf-8-sig")

    with pd.ExcelWriter(out / "DMG_Nepal_all_data.xlsx") as xw:
        layers["mining_licences"].drop(columns="geometry").to_excel(xw, sheet_name="Mining licences", index=False)
        for title, df in sums.items():
            df.to_excel(xw, sheet_name=title)
        for name in ("local_levels", "districts", "provinces", "topo_sheets"):
            layers[name].drop(columns="geometry").to_excel(
                xw, sheet_name=name.replace("_", " ").title(), index=False)
    print(sums["Licences by type"])
