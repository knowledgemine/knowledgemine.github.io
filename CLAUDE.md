# DMG Nepal GIS Data

CLI (`uv run dmg-gis …`) that scrapes the public DMG Nepal GIS portal and exports/maps it. See README.md for usage.

- Code: `src/dmg_gis/` — `download.py` (HTTP), `layers.py` (raw → GeoDataFrames), `export.py` (all-Nepal files), `area.py` (clip + map), `__init__.py` (CLI).
- Web app "Khani Map": `web/index.html`, `web/style.css`, `web/app.js` (Leaflet 1.9.4 + Turf 6.5.0 from cdnjs, no build step). `dmg-gis web` writes simplified layers to `web/data/` (`src/dmg_gis/web.py`) and serves on :8765. Browser spatial logic mirrors `area.py`: >1 ha overlap = inside, distances edge-to-edge.
- `data/`, `output/` and `web/data/` are gitignored; regenerate with `download` then `export` / `area`.
- Portal quirks to keep in mind:
  - GeoServer WFS GetFeature fails server-side; use WMS GetMap with `format=application/vnd.google-earth.kml+xml` and `KMATTR:true`. Attributes arrive as HTML in `<description>` and are parsed by regex in `layers.read_kml`.
  - The licence endpoint returns nothing unless `active` is sent (`Y`, or `N` for the few inactive ones). Raw files are named `lic_<type>_<category>_<verify>_<active>.json`.
  - Licence dates are Bikram Sambat (day 32 exists); don't let GDAL parse them as dates — read the JSON by hand.
  - OSM tile servers return "Access blocked"; use `cx.providers.Esri.WorldTopoMap`.
- Areas and distances use UTM 45N (EPSG:32645); files are written in EPSG:4326.
- Local-level names are matched with `_norm` (lowercase, letters only, v/w → b), so "Vyas" finds "Byas".
