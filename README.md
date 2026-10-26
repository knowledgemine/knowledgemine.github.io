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

**Live: <https://knowledgemine.github.io/>** (data refreshed every Sunday)

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

**Law** (`#law`, or `#law=monthly-royalty` for one duty): what licence holders must do under the Mines and
Minerals Act 2042, Mines and Minerals Rules 2056, Environment Protection Act 2076 / Rules 2077 and Local
Government Operation Act 2074: what to do, when, the section or rule, and what happens if it isn't done,
with links to the official PDFs. Key dates (royalty, renewal and annual report) are worked out from the B.S.
calendar at each build. Each licence page also shows **What the law requires now**: extension deadline,
start-work deadline for new licences, royalty and renewal dates, and Chure or national park reminders.
The legal text lives in `web/law.json`; update its `checked` date whenever it is reviewed. It is a
plain-language guide, not legal advice; the Mines and Minerals Bill 2083 may change these duties.

**On phones**: tabs sit at the bottom within thumb reach, the licence page shows days left and the risk
check before the details, and operators can tap **☆ Save** on their licences. Saved licences appear at the
top of Home with warnings, stored on that phone only (no account). The site can be added to the home
screen (Share → Add to Home Screen on iPhone, menu → Add to Home screen on Android) and opens like an app.

Notes on the numbers:
- **Rokka** licences are large areas DMG holds in reserve (1.6 million ha, no holder). They are left out
  of business figures and shown instead as a risk on licences that overlap them.
- The licence number's fiscal year (`076/77` → FY 2076/77) is used as the issue year.
- Holders are grouped by a cleaned company name, so spelling variants may still split one company.
- Map tiles load from Esri and CARTO, so the background needs internet.

**Account and Hisab-kitab** (`#account`, `#hisab`): sign in with email, create a company, invite staff
(owner / admin / staff), and keep the company's licences in sync across devices. Hisab-kitab works like a
Nepali khata app (inspired by Karobar) with mining built in:
- **Parties**: buyers (crushers, factories, contractors), suppliers, workers, each with a running ledger,
  पाउनु पर्ने / दिनु पर्ने balances, a WhatsApp reminder and a printable statement
- **Entries**: sale (mineral, quantity, rate, cash or credit, printable bill), purchase, expense by category,
  money in, money out; a day book by month
- **Stock**: production by licence and month; sales reduce stock
- **Royalty**: due from mine-gate quantity × Schedule 10 rate + 10% local fee, B.S. due dates, automatic
  10 / 20 / 30% late surcharge (rule 21), unpaid-month warnings
- **Filings**: renewal, annual report, BES/IEE/EIA, extension, with a yearly checklist
- **Reports**: profit and loss, cash flow, receivables and payables, Schedule 9-style annual production report,
  CSV downloads
Runs on Supabase; off until `web/config.js` is filled in. Setup: [supabase/SETUP.md](supabase/SETUP.md).

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
