# DMG Nepal GIS Data

CLI (`uv run dmg-gis …`) that scrapes the public DMG Nepal GIS portal and exports/maps it. See README.md for usage.

- Code: `src/dmg_gis/` — `download.py` (HTTP), `layers.py` (raw → GeoDataFrames), `export.py` (all-Nepal files), `area.py` (clip + map), `__init__.py` (CLI).
- Web app "Khani Insights": `web/index.html`, `web/style.css`, `web/app.js` (shared data + Map view), `web/views.js` (Overview, Licence check, Holder, Mineral, hash router). Leaflet 1.9.4 + Turf 6.5.0 from cdnjs, no build step. `dmg-gis web` runs `enrich.py` (B.S.→A.D. dates via nepali-datetime, issue FY from licence no, Chure/park/Rokka overlaps, Fast Track distance, neighbour counts) and writes simplified layers to `web/data/`, then serves on :8765 (next free port if busy).
- Business figures exclude Rokka (DMG reserve areas, huge, no holder); keep that split when adding stats.
- Licence-type colours are a validated categorical palette in fixed order (`TYPE_COLORS` in app.js); don't reorder or add hues.
- Law content: `web/law.json` (hand-written from the official texts; every item cites section/rule) rendered by `web/law.js` (Law page + `lawChecklist(p)` on licence pages). `enrich.law_dates()` puts the next royalty and renewal deadlines (B.S.) into `meta.json`. Never add a legal claim without checking the official text.
- Accounts/hisab: `web/account.js` + Supabase (`supabase/schema.sql` with RLS; `supabase/test_rls.mjs` tests it on PGlite). `web/config.js` holds only the project URL and anon key (empty = accounts off). Never commit a service_role key. B.S. month starts come from `web/data/bs_calendar.json` (built by `dmg-gis web`).
- `.github/workflows/pages.yml` rebuilds and deploys to GitHub Pages weekly and on push.
- `data/`, `output/` and `web/data/` are gitignored; regenerate with `download` then `export` / `area`.
- Portal quirks to keep in mind:
  - GeoServer WFS GetFeature fails server-side; use WMS GetMap with `format=application/vnd.google-earth.kml+xml` and `KMATTR:true`. Attributes arrive as HTML in `<description>` and are parsed by regex in `layers.read_kml`.
  - The licence endpoint returns nothing unless `active` is sent (`Y`, or `N` for the few inactive ones). Raw files are named `lic_<type>_<category>_<verify>_<active>.json`.
  - Licence dates are Bikram Sambat (day 32 exists); don't let GDAL parse them as dates — read the JSON by hand.
  - OSM tile servers return "Access blocked"; use `cx.providers.Esri.WorldTopoMap`.
- Areas and distances use UTM 45N (EPSG:32645); files are written in EPSG:4326.
- Local-level names are matched with `_norm` (lowercase, letters only, v/w → b), so "Vyas" finds "Byas".
