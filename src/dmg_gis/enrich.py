"""Add business facts to each licence: AD dates, issue year, risk overlaps and neighbours."""
import datetime as dt
import re

import geopandas as gpd
import nepali_datetime as nd
import pandas as pd

from .layers import UTM

PROVINCES = {1: "Koshi", 2: "Madhesh", 3: "Bagmati", 4: "Gandaki", 5: "Lumbini", 6: "Karnali", 7: "Sudurpashchim"}
NEAR_KM = 5


def bs_to_ad(s):
    """'2083-04-32' or '2091/09/04' (B.S.) -> date (A.D.), or None if unreadable."""
    m = re.match(r"^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$", str(s or ""))
    if not m:
        return None
    y, mo, d = map(int, m.groups())
    if not 1 <= mo <= 12 or not 1 <= d <= 32:
        return None
    extra_years = 0
    if y > 2100:  # the converter stops at 2100 B.S.; 17+ years out, a year shift is close enough
        extra_years, y = y - 2100, 2100
    for day in [d] + [x for x in (31, 30, 29) if x < d]:  # a day the month doesn't have -> month end
        try:
            ad = nd.date(y, mo, day).to_datetime_date()
            break
        except ValueError:
            continue
    else:
        return None
    if extra_years:
        try:
            ad = ad.replace(year=ad.year + extra_years)
        except ValueError:  # 29 Feb
            ad = ad.replace(year=ad.year + extra_years, day=28)
    return ad


def issue_year(licence_no):
    """'10/076/77' -> 2076, 'Sand/Dh1/071/072' -> 2071, '39/2061/062' -> 2061. Fiscal year the number was issued in."""
    # lookahead so "10/076/77" yields both 10/076 and 076/77
    for a, b in reversed(re.findall(r"(?<!\d)(?=(\d{2,4})\s*/\s*(\d{2,3})(?!\d))", str(licence_no))):
        y = int(a)
        y = y + 2000 if y < 100 else y
        if 2040 <= y <= 2090 and (int(b) % 100) == (y + 1) % 100:
            return y
    return None


def holder_key(name):
    s = re.sub(r"[^a-z0-9 ]", " ", str(name or "").lower())
    s = re.sub(r"\b(pvt|p|private|ltd|limited|co|company|industries|industry|udhyog|uddhyog)\b", " ", s)
    return " ".join(s.split())


def enrich(lic: gpd.GeoDataFrame, layers: dict[str, gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    lic = lic.copy().reset_index(drop=True)
    u = lic.to_crs(UTM)
    area = u.area

    lic["to_date_ad"] = lic["l_to_date"].map(bs_to_ad).map(lambda d: d.isoformat() if d else None)
    lic["from_date_ad"] = lic["l_from_date"].map(bs_to_ad).map(lambda d: d.isoformat() if d else None)
    lic["issue_year_bs"] = lic["l_license_no"].map(issue_year).astype("Int64")
    lic["province"] = pd.to_numeric(lic["state"], errors="coerce").map(PROVINCES)
    lic["holder_key"] = lic["lh_name"].map(holder_key).replace("", None)
    c = u.centroid.to_crs(4326)
    lic["lat"], lic["lon"] = c.y.round(6), c.x.round(6)

    chure = layers["chure_area"].to_crs(UTM).union_all()
    lic["chure_pct"] = (u.intersection(chure).area / area * 100).round(1)

    parks = pd.concat([
        layers["national_parks_conservation"].to_crs(UTM).assign(
            park=lambda g: g["PARKNAME"], park_type=lambda g: g["TYPES"])[["park", "park_type", "geometry"]],
        layers["national_parks_new"].to_crs(UTM).assign(
            park=lambda g: g["PAS_NAME"], park_type=lambda g: g["Name1_1"])[["park", "park_type", "geometry"]],
    ], ignore_index=True)
    parks = gpd.GeoDataFrame(parks, crs=UTM)
    hit = gpd.sjoin(u[["geometry"]], parks, predicate="intersects")
    hit["pct"] = [u.geometry[i].intersection(parks.geometry[j]).area / area[i] * 100
                  for i, j in zip(hit.index, hit["index_right"])]
    best = hit[hit.pct > 0.5].sort_values("pct", ascending=False).groupby(level=0).first()
    lic["park"] = best["park"].reindex(lic.index)
    lic["park_type"] = best["park_type"].reindex(lic.index)
    lic["park_pct"] = best["pct"].round(1).reindex(lic.index)

    # Rokka = areas DMG holds in reserve; flag company licences that overlap one by more than 1 ha
    is_rokka = lic["licence_type"].str.startswith("Rokka") & (lic["status"] != "Inactive")
    rk = gpd.sjoin(u[~is_rokka][["geometry"]], u[is_rokka][["geometry"]], predicate="intersects")
    rk = rk[[u.geometry[i].intersection(u.geometry[j]).area > 1e4 for i, j in zip(rk.index, rk["index_right"])]]
    lic["rokka_overlap"] = (rk.assign(no=lic["l_license_no"].to_numpy()[rk["index_right"]])
                            .groupby(level=0)["no"].agg(lambda s: "; ".join(map(str, s))).reindex(lic.index))

    ktft = layers["ktft_alignment"].to_crs(UTM).union_all()
    lic["ktft_km"] = (u.distance(ktft) / 1000).round(2)

    # neighbours within NEAR_KM of each licence's edge
    near = gpd.sjoin(gpd.GeoDataFrame(geometry=u.buffer(NEAR_KM * 1000), crs=UTM), u[["geometry"]], predicate="intersects")
    near = near[near.index != near["index_right"]]
    j = near["index_right"].to_numpy()
    same = lic["mp_name"].to_numpy()[j] == lic["mp_name"].to_numpy()[near.index]
    pending = lic["status"].to_numpy()[j] == "Under process"
    lic["near_all"] = near.groupby(level=0).size().reindex(lic.index, fill_value=0)
    lic["near_same_mineral"] = pd.Series(same, index=near.index).groupby(level=0).sum().reindex(lic.index, fill_value=0)
    lic["near_pending"] = pd.Series(pending, index=near.index).groupby(level=0).sum().reindex(lic.index, fill_value=0)

    lic["l_to_date"] = lic["l_to_date"].where(lic["l_to_date"].astype(str).str.match(r"^\d{4}"), None)
    return lic


def today_bs():
    return nd.date.from_datetime_date(dt.date.today()).strftime("%Y-%m-%d")


def _month_end(y, m):
    nxt = nd.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def bs_calendar(first=2070, last=2099):
    """{'2083-07': '2026-10-18', ...}: A.D. date of the 1st of every B.S. month, for converting dates in the browser."""
    return {f"{y}-{m:02d}": nd.date(y, m, 1).to_datetime_date().isoformat()
            for y in range(first, last + 1) for m in range(1, 13)}


def law_dates(today=None):
    """Next statutory deadlines in B.S. (Rules 2056: rule 21(2) royalty, rules 42 and 45 renewal/annual report)."""
    t = nd.date.from_datetime_date(today or dt.date.today())
    fy_start = t.year if t.month >= 4 else t.year - 1  # fiscal year starts 1 Shrawan (month 4)
    # renewal + annual report: within 3 months after the fiscal year ends (end of Asar) = end of Ashwin
    ashwin_end = _month_end(fy_start, 6)
    if t <= ashwin_end:
        renew, renew_fy = ashwin_end, fy_start - 1
    else:
        renew, renew_fy = _month_end(fy_start + 1, 6), fy_start
    # royalty: deposit within 7 days after each month ends, voucher within 15 days
    if t.day <= 7:
        roy = nd.date(t.year, t.month, 7)
        pm = (t.year - (t.month == 1), (t.month - 2) % 12 + 1)
    else:
        ny, nm = t.year + (t.month == 12), t.month % 12 + 1
        roy, pm = nd.date(ny, nm, 7), (t.year, t.month)
    voucher = nd.date(roy.year, roy.month, 15)
    iso = lambda d: d.to_datetime_date().isoformat()  # noqa: E731
    fy = lambda y: f"{y}/{str(y + 1)[-2:]}"  # noqa: E731
    return {
        "today_bs": t.strftime("%Y-%m-%d"),
        "fy": fy(fy_start),
        "renewal": {"bs": renew.strftime("%Y-%m-%d"), "ad": iso(renew), "for_fy": fy(renew_fy)},
        "royalty": {"bs": roy.strftime("%Y-%m-%d"), "ad": iso(roy), "for_month": f"{pm[0]}-{pm[1]:02d}"},
        "voucher": {"bs": voucher.strftime("%Y-%m-%d"), "ad": iso(voucher)},
    }
