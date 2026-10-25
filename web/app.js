/* Khani Insights — shared data/helpers and the Map view. views.js adds the insight pages and the router. */
"use strict";

// fixed categorical order, validated for colour-blind separation (see README)
const TYPE_COLORS = {
  "Prospecting General": "#2a78d6", "Rokka General": "#eb6834", "Opening General": "#1baf7a",
  "Opening Construction": "#eda100", "Opening Special": "#e87ba4", "Prospecting Special": "#008300",
};
const STATUS_DASH = { "Approved": null, "Under process": "6 4", "Inactive": "2 4" };
const STATUSES = Object.keys(STATUS_DASH);

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "").replace(/[vw]/g, "b"); // Vyas == Byas
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const title = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (n) => Number(n).toLocaleString("en-IN");

const D = {};
const META = {};
const TODAY = new Date(new Date().toDateString());

/* ---------- licence term ---------- */
function daysLeft(p) {
  if (!p.to_date_ad) return null;
  return Math.round((new Date(p.to_date_ad) - TODAY) / 864e5);
}
function termState(p) {
  const d = daysLeft(p);
  if (d == null) return "none";
  if (d < 0) return "expired";
  if (d <= 365) return "soon";
  return "valid";
}
function humanDays(d) {
  const a = Math.abs(d);
  if (a < 60) return `${a} day${a === 1 ? "" : "s"}`;
  if (a < 730) return `${Math.round(a / 30.4)} months`;
  return `${(a / 365.25).toFixed(1)} years`;
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/* ---------- loading ---------- */
const FILES = ["mining_licences", "local_levels", "districts", "topo_sheets", "chure_area",
  "national_parks_new", "national_parks_conservation", "ktft_alignment"];

async function loadData() {
  const [meta, ...layers] = await Promise.all([
    fetch("data/meta.json").then((r) => r.json()).catch(() => ({})),
    ...FILES.map((f) => fetch(`data/${f}.geojson`).then((r) => {
      if (!r.ok) throw new Error(`data/${f}.geojson missing`);
      return r.json();
    })),
  ]);
  Object.assign(META, meta);
  FILES.forEach((f, i) => (D[f] = layers[i]));
  for (const f of D.mining_licences.features) {
    const p = f.properties;
    p._f = f;
    p._bbox = turf.bbox(f);
    p._c = [p.lon, p.lat];
    p._days = daysLeft(p);
    p._term = termState(p);
  }
  for (const f of D.local_levels.features) f.properties._n = norm(f.properties.gapa_napa);
  D.lic = D.mining_licences.features.map((f) => f.properties);
}

/* ---------- shared licence bits ---------- */
const TERM_PILL = { expired: ["exp", "End date passed"], soon: ["soon", "Ends within 1 yr"] };
function pills(p, r) {
  const st = p.status.split(" ")[0];
  let h = `<span class="pill st-${st}">${esc(p.status)}</span>`;
  if (r && r.inside) h = `<span class="pill in">${mapState.mode === "point" ? "At point" : "Inside"}</span>` + h;
  const v = TERM_PILL[p._term];
  if (v) h += `<span class="pill ${v[0]}">${v[1]}</span>`;
  return h;
}
function licLink(p) { return `#licence=${encodeURIComponent(p.l_license_no)}`; }

/* ---------- distances (edge to edge, km) ---------- */
const bboxHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function boundaryLines(poly) {
  const l = turf.polygonToLine(poly);
  return l.type === "FeatureCollection" ? l.features : [l];
}
function polyDistanceKm(a, b) {
  if (turf.booleanIntersects(a, b)) return 0;
  const la = boundaryLines(a), lb = boundaryLines(b);
  let m = Infinity;
  for (const pt of turf.coordAll(a)) for (const ln of lb) m = Math.min(m, turf.pointToLineDistance(pt, ln, { units: "kilometers" }));
  for (const pt of turf.coordAll(b)) for (const ln of la) m = Math.min(m, turf.pointToLineDistance(pt, ln, { units: "kilometers" }));
  return m;
}
function neighbours(p, km) {
  const pad = km / 100 + 0.01; // degrees, generous
  const box = [p._bbox[0] - pad, p._bbox[1] - pad, p._bbox[2] + pad, p._bbox[3] + pad];
  const out = [];
  for (const q of D.lic) {
    if (q === p || !bboxHit(q._bbox, box)) continue;
    const d = polyDistanceKm(p._f, q._f);
    if (d <= km) out.push({ q, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

/* =================== MAP VIEW =================== */
const mapState = {
  mode: "place", place: null, point: null, km: 5,
  status: new Set(STATUSES), types: new Set(Object.keys(TYPE_COLORS)), mineral: "", validity: "",
};
let map = null, base = null;
let results = [];
const groups = {};
const ctx = {};
const layerById = new Map();

function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true, minZoom: 6, maxBounds: [[25.5, 79], [31.2, 89.2]] })
    .fitBounds([[26.35, 80.05], [30.45, 88.2]]);
  const BASES = {
    topo: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles © Esri" }),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri, Maxar" }),
    light: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }),
  };
  base = BASES.topo.addTo(map);
  map.attributionControl.addAttribution('Data: <a href="http://gis.dmgnepal.gov.np" target="_blank" rel="noopener">DMG Nepal</a>');
  $("basemap").addEventListener("change", (e) => { map.removeLayer(base); base = BASES[e.target.value].addTo(map); });

  map.createPane("context"); map.getPane("context").style.zIndex = 350;
  map.createPane("area"); map.getPane("area").style.zIndex = 380;
  map.createPane("lic"); map.getPane("lic").style.zIndex = 420;
  groups.area = L.layerGroup().addTo(map);
  groups.lic = L.layerGroup().addTo(map);

  buildContext();
  buildMapControls();
  map.on("click", (e) => {
    if (mapState.mode !== "point") return;
    mapState.point = [e.latlng.lng, e.latlng.lat];
    $("point-at").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    updateMap(true);
  });
}

function buildContext() {
  const tip = (text) => (f, l) => l.bindTooltip(esc(text(f.properties)), { sticky: true, className: "lbl-tip" });
  ctx.ll = L.geoJSON(D.local_levels, { pane: "context", style: { color: "#47555c", weight: 0.7, opacity: 0.7, fill: false }, interactive: false });
  ctx.dist = L.geoJSON(D.districts, { pane: "context", style: { color: "#2c3a40", weight: 1.6, fill: false }, interactive: false });
  ctx.chure = L.geoJSON(D.chure_area, { pane: "context", style: { color: "#2f7d1a", weight: 0.8, fillColor: "#3d9a24", fillOpacity: 0.18 }, interactive: false });
  ctx.parks = L.featureGroup([
    L.geoJSON(D.national_parks_conservation, { pane: "context", style: { color: "#8a5a12", weight: 1, fillColor: "#c58a2b", fillOpacity: 0.15 },
      onEachFeature: tip((p) => `${p.PARKNAME || ""}${p.TYPES ? " · " + p.TYPES : ""}`) }),
    L.geoJSON(D.national_parks_new, { pane: "context", style: { color: "#8a5a12", weight: 1, dashArray: "3 3", fillColor: "#c58a2b", fillOpacity: 0.1 },
      onEachFeature: tip((p) => `${p.PAS_NAME || ""}${p.Name1_1 ? " · " + p.Name1_1 : ""}`) }),
  ]);
  ctx.topo = L.geoJSON(D.topo_sheets, { pane: "context", style: { color: "#6b6b6b", weight: 0.7, dashArray: "2 3", fill: true, fillOpacity: 0 },
    onEachFeature: tip((p) => `Sheet ${p.SHEET_ID}`) });
  ctx.ktft = L.geoJSON(D.ktft_alignment, { pane: "context", style: { color: "#d62728", weight: 3 }, onEachFeature: tip(() => "Kathmandu–Terai Fast Track") });
  const bind = (id, key) => {
    const cb = $(id);
    const apply = () => (cb.checked ? ctx[key].addTo(map) : map.removeLayer(ctx[key]));
    cb.addEventListener("change", apply); apply();
  };
  bind("lyr-ll", "ll"); bind("lyr-dist", "dist"); bind("lyr-chure", "chure");
  bind("lyr-parks", "parks"); bind("lyr-topo", "topo"); bind("lyr-ktft", "ktft");
}

function buildMapControls() {
  const counts = (key) => D.lic.reduce((m, p) => (m[p[key]] = (m[p[key]] || 0) + 1, m), {});
  const sc = counts("status"), tc = counts("licence_type"), mc = counts("mp_name");
  $("status-chips").innerHTML = STATUSES.map((s) =>
    `<button class="chip" type="button" data-status="${s}" aria-pressed="true">${s} <span class="n">${sc[s] || 0}</span></button>`).join("");
  $("type-chips").innerHTML = Object.entries(TYPE_COLORS).map(([t, c]) =>
    `<button class="chip" type="button" data-type="${t}" aria-pressed="true"><span class="sw" style="background:${c}"></span>${t} <span class="n">${tc[t] || 0}</span></button>`).join("");
  const toggle = (set, val, btn) => { set.has(val) ? set.delete(val) : set.add(val); btn.setAttribute("aria-pressed", set.has(val)); updateMap(); };
  $("status-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-status]"); if (b) toggle(mapState.status, b.dataset.status, b); });
  $("type-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) toggle(mapState.types, b.dataset.type, b); });

  $("mineral").insertAdjacentHTML("beforeend", Object.entries(mc).sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `<option value="${esc(m)}">${esc(m)} (${n})</option>`).join(""));
  $("mineral").value = mapState.mineral;
  $("mineral").addEventListener("change", (e) => { mapState.mineral = e.target.value; updateMap(); });
  $("validity").addEventListener("change", (e) => { mapState.validity = e.target.value; updateMap(); });

  $("place-list").innerHTML = D.local_levels.features
    .map((f) => `${f.properties.gapa_napa}, ${title(f.properties.district)}`).sort()
    .map((s) => `<option value="${esc(s)}"></option>`).join("");
  const onPlace = () => findPlace($("place").value);
  $("place").addEventListener("change", onPlace);
  $("place").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onPlace(); } });
  $("km").addEventListener("input", (e) => { mapState.km = +e.target.value; $("km-out").textContent = `${mapState.km} km`; });
  $("km").addEventListener("change", () => updateMap());
  for (const m of ["place", "point", "all"]) $(`mode-${m}`).addEventListener("click", () => setMapMode(m));

  $("copy-csv").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(toCSV()); toast(`Copied ${results.length} rows`); }
    catch { toast("Copy was blocked by the browser. Use Download CSV."); }
  });
  $("dl-csv").addEventListener("click", () => {
    const blob = new Blob(["﻿" + toCSV()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${areaSlug()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest(".item"); if (!b) return;
    const r = results[+b.dataset.i];
    document.querySelectorAll(".item.sel").forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
    const lyr = layerById.get(r.f);
    map.fitBounds(lyr.getBounds(), { maxZoom: 15, padding: [40, 40] });
    lyr.openPopup();
    if (window.matchMedia("(max-width: 760px)").matches) map.getContainer().scrollIntoView({ behavior: "smooth" });
  });
  $("legend").innerHTML =
    Object.entries(TYPE_COLORS).map(([t, c]) => `<div class="r"><span class="sq" style="border-color:${c};background:${c}33"></span>${t}</div>`).join("") +
    `<div class="r"><span class="ln" style="border-top-color:currentColor"></span>Approved</div>
     <div class="r"><span class="ln" style="border-top-style:dashed;border-top-color:currentColor"></span>Under process</div>
     <div class="r"><span class="ln" style="border-top-style:dotted;border-top-color:currentColor"></span>Inactive</div>`;
}

function setMapMode(m, fit = true) {
  mapState.mode = m;
  for (const x of ["place", "point", "all"]) {
    $(`mode-${x}`).classList.toggle("on", x === m);
    $(`mode-${x}`).setAttribute("aria-selected", x === m);
  }
  $("place-box").hidden = m !== "place";
  $("point-box").hidden = m !== "point";
  $("radius-box").hidden = m === "all";
  map.getContainer().style.cursor = m === "point" ? "crosshair" : "";
  updateMap(fit);
}

function findPlace(text) {
  $("place-choices").hidden = true; $("place-msg").hidden = true;
  const [name, dist] = String(text).split(",").map((s) => s.trim());
  if (!name) return;
  let hits = D.local_levels.features.filter((f) => f.properties._n === norm(name));
  if (dist) hits = hits.filter((f) => norm(f.properties.district) === norm(dist));
  if (hits.length === 1) { mapState.place = hits[0]; setMapMode("place"); return; }
  if (hits.length > 1) {
    $("place-choices").innerHTML = hits.map((f, i) =>
      `<button type="button" data-i="${i}">${esc(f.properties.gapa_napa)}, ${esc(title(f.properties.district))}</button>`).join("");
    $("place-choices").hidden = false;
    $("place-choices").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      mapState.place = hits[+b.dataset.i];
      $("place").value = b.textContent; $("place-choices").hidden = true; setMapMode("place");
    };
    return;
  }
  const n = norm(name);
  const close = D.local_levels.features.filter((f) => f.properties._n.startsWith(n.slice(0, 4)) || f.properties._n.includes(n)).slice(0, 6);
  $("place-msg").hidden = false;
  $("place-msg").textContent = close.length
    ? `No exact match for “${name}”. Try: ${close.map((f) => `${f.properties.gapa_napa} (${title(f.properties.district)})`).join(", ")}`
    : `No municipality called “${name}”. Check the spelling, or pick from the list as you type.`;
}

function currentArea() {
  if (mapState.mode === "place" && mapState.place) {
    const target = mapState.place;
    const area = mapState.km > 0 ? turf.buffer(target, mapState.km, { units: "kilometers" }) : target;
    return { target, area, kind: "place" };
  }
  if (mapState.mode === "point" && mapState.point) {
    const target = turf.point(mapState.point);
    const area = turf.circle(mapState.point, Math.max(mapState.km, 0.1), { units: "kilometers", steps: 96 });
    return { target, area, kind: "point" };
  }
  return null;
}

function analyse() {
  const A = currentArea();
  const pass = (p) => mapState.status.has(p.status) && mapState.types.has(p.licence_type) &&
    (!mapState.mineral || p.mp_name === mapState.mineral) &&
    (!mapState.validity || (mapState.validity === "valid" ? (p._term === "valid" || p._term === "soon") : p._term === mapState.validity));
  const out = [];
  if (!A) {
    for (const f of D.mining_licences.features) if (pass(f.properties)) out.push({ f, inside: null, dist: null });
    out.sort((a, b) => String(a.f.properties.district).localeCompare(b.f.properties.district));
    return { A, out };
  }
  const abox = turf.bbox(A.area);
  const lines = A.kind === "place" ? boundaryLines(A.target) : null;
  for (const f of D.mining_licences.features) {
    const p = f.properties;
    if (!pass(p) || !bboxHit(p._bbox, abox) || !turf.booleanIntersects(f, A.area)) continue;
    let inside, dist;
    if (A.kind === "place") {
      const ov = turf.intersect(f, A.target);
      inside = !!ov && turf.area(ov) > 1e4; // >1 ha real overlap, not a shared edge
      dist = inside || turf.booleanIntersects(f, A.target) ? 0
        : Math.min(...turf.coordAll(f).flatMap((pt) => lines.map((ln) => turf.pointToLineDistance(pt, ln, { units: "kilometers" }))));
    } else {
      inside = turf.booleanPointInPolygon(A.target, f);
      dist = inside ? 0 : Math.min(...boundaryLines(f).map((ln) => turf.pointToLineDistance(A.target, ln, { units: "kilometers" })));
    }
    out.push({ f, inside, dist });
  }
  out.sort((a, b) => (b.inside - a.inside) || (a.dist - b.dist));
  return { A, out };
}

function licStyle(p, dim) {
  const c = TYPE_COLORS[p.licence_type] || "#555";
  return { pane: "lic", color: p.status === "Inactive" ? "#7c868a" : c, weight: dim ? 1 : 2,
    dashArray: STATUS_DASH[p.status], fillColor: c, fillOpacity: dim ? 0.12 : 0.3, opacity: dim ? 0.55 : 1 };
}

function popupHTML(p) {
  const [lng, lat] = p._c;
  const d = p._days;
  const rows = [
    ["Type", p.licence_type], ["Holder", p.lh_name],
    ["Place", [p.l_address, p.local_level, title(p.district)].filter(Boolean).join(", ")],
    ["Area", p.area_ha_calc ? `${p.area_ha_calc} ha` : ""], ["Map sheet", p.l_map_no],
    ["Term", p.l_to_date ? `${p.l_from_date || "?"} → ${p.l_to_date} B.S.` : ""],
    ["Days left", d == null ? "" : d < 0 ? `End date passed ${humanDays(d)} ago` : `${fmt(d)} (${humanDays(d)})`],
  ].filter(([, v]) => v);
  return `<div class="pop">
    <div class="min">${esc(p.mp_name || "Unknown mineral")}</div>
    <h3>${esc(p.l_license_no)}</h3>
    <div class="tags">${pills(p)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="links"><a href="${licLink(p)}">Full licence check →</a>
      <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Google Maps</a></div>
  </div>`;
}

function updateMap(fit = false) {
  if (!map) return;
  const { A, out } = analyse();
  results = out;
  groups.area.clearLayers(); groups.lic.clearLayers(); layerById.clear();
  if (A) {
    L.geoJSON(A.area, { pane: "area", style: { color: cssVar("--accent"), weight: 2, dashArray: "8 6", fillOpacity: 0.04, fillColor: cssVar("--accent") }, interactive: false }).addTo(groups.area);
    if (A.kind === "place") L.geoJSON(A.target, { pane: "area", style: { color: "#b3261e", weight: 3, fill: false }, interactive: false }).addTo(groups.area);
    else L.circleMarker([mapState.point[1], mapState.point[0]], { pane: "area", radius: 6, color: "#b3261e", weight: 3, fillOpacity: 1, fillColor: "#fff" }).addTo(groups.area);
  }
  const inSet = new Set(out.map((r) => r.f));
  const near = A ? turf.bbox(turf.buffer(A.area, 15, { units: "kilometers" })) : null;
  for (const f of D.mining_licences.features) {
    const hit = inSet.has(f);
    if (!hit && (!A || !bboxHit(f.properties._bbox, near))) continue;
    const lyr = L.geoJSON(f, { style: licStyle(f.properties, !hit) }).bindPopup(() => popupHTML(f.properties), { maxWidth: 340 });
    lyr.addTo(groups.lic);
    if (hit) layerById.set(f, lyr);
  }
  renderMapList(A, out);
  if (fit && A) map.fitBounds(L.geoJSON(A.area).getBounds(), { padding: [20, 20] });
  if (fit && !A) map.fitBounds(out.length && mapState.mineral ? L.geoJSON({ type: "FeatureCollection", features: out.map((r) => r.f) }).getBounds() : [[26.35, 80.05], [30.45, 88.2]], { padding: [20, 20] });
  writeMapHash();
}

function renderMapList(A, out) {
  const nIn = out.filter((r) => r.inside).length;
  let where;
  if (!A) where = mapState.mode === "point" ? "in all of Nepal. Click the map to set a point" : "in all of Nepal";
  else if (A.kind === "place") where = `${mapState.km ? `within ${mapState.km} km of` : "in"} ${esc(A.target.properties.gapa_napa)}, ${esc(title(A.target.properties.district))}`;
  else where = `within ${mapState.km} km of the point`;
  $("summary").innerHTML = `<strong>${fmt(out.length)}</strong> licence${out.length === 1 ? "" : "s"} ${where}` +
    (A && A.kind === "place" ? ` · ${nIn} inside` : "");
  const byT = {};
  for (const r of out) byT[r.f.properties.licence_type] = (byT[r.f.properties.licence_type] || 0) + 1;
  $("bytype").innerHTML = Object.entries(byT).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span><i style="background:${TYPE_COLORS[t]}"></i>${t} <b class="mono">${n}</b></span>`).join("");
  const CAP = 300;
  $("list").innerHTML = out.slice(0, CAP).map((r, i) => {
    const p = r.f.properties;
    const d = !r.dist ? "" : r.dist < 1 ? `${(r.dist * 1000).toFixed(0)} m` : `${r.dist.toFixed(1)} km`;
    return `<li><button class="item" type="button" data-i="${i}">
      <span class="bar" style="background:${TYPE_COLORS[p.licence_type]}"></span>
      <span class="body">
        <span class="top"><span class="no">${esc(p.l_license_no)}</span><span class="dist">${d}</span></span>
        <span><span class="min">${esc(p.mp_name || "—")}</span> · ${esc(p.licence_type)}</span>
        <span class="meta">${esc([p.lh_name, p.local_level, title(p.district)].filter(Boolean).join(" · "))}</span>
        <span class="tags">${pills(p, r)}</span>
      </span></button></li>`;
  }).join("");
  $("more").hidden = out.length <= CAP;
  $("more").textContent = `Showing the first ${CAP} of ${fmt(out.length)}. Narrow the filters, or use Download CSV for all.`;
}

const CSV_COLS = ["l_license_no", "licence_type", "status", "mp_name", "province", "district", "local_level", "l_address",
  "area_ha_calc", "l_map_no", "l_from_date", "l_to_date", "to_date_ad", "lh_name", "lh_address",
  "chure_pct", "park", "ktft_km", "near_all", "near_same_mineral", "near_pending", "lat", "lon"];
function toCSV(rows = results.map((r) => ({ p: r.f.properties, r }))) {
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = [...CSV_COLS, "days_left", "inside", "distance_km"];
  const body = rows.map(({ p, r }) => [...CSV_COLS.map((c) => p[c]), p._days ?? "", r?.inside ?? "",
    r?.dist == null ? "" : r.dist.toFixed(2)].map(q).join(","));
  return [head.join(","), ...body].join("\n");
}
function areaSlug() {
  if (mapState.mode === "place" && mapState.place) return `licences_${norm(mapState.place.properties.gapa_napa)}_${mapState.km}km`;
  if (mapState.mode === "point" && mapState.point) return `licences_point_${mapState.km}km`;
  return mapState.mineral ? `licences_${norm(mapState.mineral)}` : "licences_nepal";
}
function writeMapHash() {
  let h = "map";
  if (mapState.mode === "place" && mapState.place) h = `place=${mapState.place.properties.gapa_napa}|${mapState.place.properties.district}|${mapState.km}`;
  else if (mapState.mode === "point" && mapState.point) h = `point=${mapState.point[1].toFixed(5)}|${mapState.point[0].toFixed(5)}|${mapState.km}`;
  else if (mapState.mode === "all") h = mapState.mineral ? `all=${mapState.mineral}` : "all";
  history.replaceState(null, "", "#" + encodeURIComponent(h).replace(/%3D/g, "="));
}

/* entry points used by the router and other views */
function openMapFromHash(h) {
  initMap();
  map.invalidateSize(); // the view was just unhidden; measure before fitting bounds
  let m;
  if ((m = /^all(?:=(.+))?$/.exec(h))) {
    mapState.mineral = m[1] || ""; $("mineral").value = mapState.mineral;
    return setMapMode("all");
  }
  if ((m = /^(place|point)=(.+)\|(.+)\|([\d.]+)$/.exec(h))) {
    mapState.km = +m[4]; $("km").value = mapState.km; $("km-out").textContent = `${mapState.km} km`;
    if (m[1] === "point") {
      mapState.point = [+m[3], +m[2]]; $("point-at").textContent = `${m[2]}, ${m[3]}`;
      return setMapMode("point");
    }
    const f = D.local_levels.features.find((x) => x.properties.gapa_napa === m[2] && x.properties.district === m[3]);
    if (f) { mapState.place = f; $("place").value = `${f.properties.gapa_napa}, ${title(f.properties.district)}`; return setMapMode("place"); }
  }
  if (!mapState.place && mapState.mode === "place") {
    $("place").value = "Byas, Tanahu"; findPlace("Byas, Tanahu"); // worked example
  } else updateMap();
}
