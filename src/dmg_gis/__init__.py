"""Command-line tool for the DMG Nepal GIS portal (gis.dmgnepal.gov.np)."""
import argparse
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # project folder, so data/ and output/ land there from any cwd


def main():
    p = argparse.ArgumentParser(prog="dmg-gis", description=__doc__)
    p.add_argument("--data", type=Path, default=ROOT / "data" / "raw", help="where downloads go")
    p.add_argument("--out", type=Path, default=ROOT / "output", help="where results go")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("download", help="fetch every public layer from the portal")
    sub.add_parser("export", help="write all of Nepal as GeoJSON, Shapefile, CSV and Excel")
    a = sub.add_parser("area", help="clip all layers to one local level + buffer and draw a map")
    a.add_argument("name", help='local level name, e.g. "Vyas" or "Kamalamai"')
    a.add_argument("--district", help="needed when the name exists in more than one district")
    a.add_argument("--buffer-km", type=float, default=5)
    ls = sub.add_parser("list", help="list local levels (optionally in one district)")
    ls.add_argument("--district")
    w = sub.add_parser("web", help="build the map explorer's data and open it in the browser")
    w.add_argument("--port", type=int, default=8765)
    w.add_argument("--no-serve", action="store_true", help="only build web/data")
    args = p.parse_args()

    if args.cmd == "download":
        from .download import download
        download(args.data)
        (args.data / "DOWNLOADED").write_text(dt.date.today().isoformat())
        return

    if not (args.data / "DOWNLOADED").exists():
        raise SystemExit("No data yet. Run:  dmg-gis download")
    downloaded = (args.data / "DOWNLOADED").read_text().strip()

    if args.cmd == "list":
        from .layers import read_kml
        ll = read_kml(args.data / "locallevels.kml")
        if args.district:
            ll = ll[ll.district.str.lower() == args.district.lower()]
        for r in ll.sort_values(["district", "gapa_napa"]).itertuples():
            print(f"{r.district:<15} {r.gapa_napa:<25} {r.type_gn}")
        return

    from .layers import load_all
    layers = load_all(args.data)
    if args.cmd == "export":
        from .export import export_all
        export_all(layers, args.out / "nepal")
    elif args.cmd == "web":
        from .web import build_web_data, serve
        build_web_data(layers, ROOT / "web" / "data", downloaded)
        if not args.no_serve:
            serve(ROOT / "web", args.port)
    elif args.cmd == "area":
        from .area import make_area
        out, rows = make_area(layers, args.name, args.district, args.buffer_km, args.out / "areas", downloaded)
        for r in rows:
            print(f"{r['layer']:<30} {r['features_in_area']:>4} in area ({r['inside']} inside)")
        print(f"Saved to {out}")
