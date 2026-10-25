# DMG Nepal GIS Data

Download, export and map the open data published by the Department of Mines and Geology (DMG) at
<http://gis.dmgnepal.gov.np>: mining licences, administrative boundaries, topo sheets, Chure,
national parks and the Kathmandu–Terai Fast Track alignment.

## Setup

Needs [uv](https://docs.astral.sh/uv/).

```bash
uv sync
```

## Usage

```bash
uv run dmg-gis download                          # fetch every layer into data/raw (~110 MB)
uv run dmg-gis export                            # all of Nepal -> output/nepal
uv run dmg-gis area Vyas --district Tanahu       # one local level + 5 km -> output/areas/byas_tanahu_5km
uv run dmg-gis area Kamalamai --buffer-km 2      # any local level, any buffer
uv run dmg-gis list --district Tanahu            # local-level names to use with `area`
```

## Khani Map (web app)

An interactive map explorer in `web/`:

```bash
uv run dmg-gis web        # builds web/data from data/raw, then opens http://127.0.0.1:8765
```

- **Municipality**: type a name (spelling-tolerant), choose a distance from 0 to 25 km, and see every licence inside it and nearby. Licences are flagged "Inside" and sorted by distance.
- **Point on map**: click anywhere to see licences within the chosen distance of that spot.
- **All Nepal**: browse all 1,414 licences.
- **Filters**: status, licence type, mineral, and validity judged from the B.S. end date (still valid, ends within 1 year, date passed).
- **Licence details**: click a licence for holder, place, area, map sheet, UTM corners, B.S. dates and a Google Maps link.
- **Export**: copy or download the current results as CSV.
- **Map layers**: municipality and district boundaries, Chure, national parks and buffer zones, topo sheets, Fast Track; topographic, satellite or plain background.
- **Links**: the address bar keeps the current search (e.g. `#place=Byas|TANAHU|5`), so a view can be bookmarked.

Today's B.S. date is estimated from the computer's clock, so expiry can be a day or two off.
Map tiles load from Esri and CARTO, so the background needs internet; the licence data itself is local.

Run `download` again whenever you want fresh data; the other commands read from `data/raw`.
Names are matched loosely ("Vyas" finds "Byas"). If a name exists in two districts, the tool
asks for `--district`; if it finds nothing, it suggests close names.

## Outputs

**`output/nepal/`**: the whole country

| Path | Contents |
|---|---|
| `DMG_Nepal_all_data.xlsx` | licences, summaries by type, district and mineral, admin tables |
| `csv/` | every layer's attribute table plus the summaries |
| `geojson/` | every layer, EPSG:4326 |
| `shapefile/` | every layer; column names cut to 10 characters |

**`output/areas/<name>_<district>_<km>km/`**: one area

| Path | Contents |
|---|---|
| `map.png`, `map.pdf` | map with licences labelled by number and mineral |
| `mining_licences.csv` | licences in the area, nearest first |
| `summary.csv` | feature counts per layer |
| `geojson/`, `shapefile/`, `csv/` | each layer clipped to the area |

Area tables add three columns:

- `inside_target`: overlaps the chosen local level by more than 1 ha (sharing a border doesn't count)
- `pct_in_target`: percentage of the feature inside it
- `dist_to_target_m`: metres to its boundary (0 means touching or inside)

## Layers

| Layer | Features | Source on the portal |
|---|---|---|
| mining_licences | 1,414 | `POST /home/view_license` (6 types × approved / under process × active / inactive) |
| provinces, districts, local_levels | 7, 77, 777 | GeoServer `dmg:states`, `dmg:districts`, `dmg:locallevels` |
| topo_sheets | 687 | GeoServer `dmg:topomapsheets` |
| ktft_alignment, ktft_chainage | 3, 894 | GeoServer `dmg:Alignment`, `dmg:Chainage` |
| chure_area, national_parks_new, national_parks_conservation, international_boundary | 2,350, 45, 23, 1 | `/public/static/*` |

Counts are from the 2026-10-25 download.

## Limits

- Licence `status` is **Approved**, **Under process** or **Inactive**. The 13 inactive licences
  are hidden on the portal's map, but the endpoint still returns them. For inactive rows, the
  `approved` column says whether the licence had been approved. Older expired or cancelled
  licences are not available.
- Licence dates are in **Bikram Sambat** and are kept as text.
- Holder contacts, documents and royalty data need a DMG User Portal login and are not included.
- The portal's WFS service is broken, so GeoServer layers are exported through WMS as KML.
  These are full vector shapes, not images.
- Basemap tiles come from Esri World Topo, because OpenStreetMap's tile servers block scripted downloads.
