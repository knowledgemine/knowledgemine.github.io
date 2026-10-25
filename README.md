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

## Khani Insights (web app for mine operators)

A web app in `web/` that turns DMG's data into business information for licence holders:

```bash
uv run dmg-gis web        # builds web/data from data/raw, then opens http://127.0.0.1:8765
```

**Overview**: national picture for company licences. Key findings written from the data, licences by
mineral and province, the renewal wave (end dates by B.S. year), new licences by fiscal year, the largest
holders, and the districts where applications are piling up.

**Licence check** (`#licence=10/076/77`, or search by number or company name):
- days left on the term, from the exact B.S. end date converted to A.D., with a progress bar
- risk check: overlap with Chure, national parks and buffer zones, Rokka (reserved) areas,
  distance to the Fast Track, pending applications within 5 km
- every licence within 5 km (same mineral marked), and the holder's other licences
- copy a plain-text summary to share, or open it on the map or Google Maps

**Company portfolio** (`#holder=...`): all licences under one name, soonest end date first.

**Mineral market** (`#mineral=Limestone`): approved and pending counts, districts, new licences by year,
largest holders and their share of area, licences ending within 2 years, newest applicants.

**Map**: search a municipality or click a point, set a radius, filter, export CSV.

Notes on the numbers:
- **Rokka** licences are large areas DMG holds in reserve (1.6 million ha, no holder). They are left out
  of business figures and shown instead as a risk on licences that overlap them.
- The licence number's fiscal year (`076/77` → FY 2076/77) is used as the issue year.
- Holders are grouped by a cleaned company name, so spelling variants may still split one company.
- Map tiles load from Esri and CARTO, so the background needs internet.

### Publishing for operators

`.github/workflows/pages.yml` downloads fresh DMG data every Sunday (and on each push), rebuilds the app
and publishes it with GitHub Pages. It needs Pages turned on with **Source: GitHub Actions** in the
repository settings, and the repository must be public unless the account has a paid plan.

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
