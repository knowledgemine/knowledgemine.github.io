/* Khani Map — explore DMG Nepal mining licences around a municipality or a point. */
"use strict";

const TYPE_COLORS = {
  "Rokka General": "#e2412f", "Prospecting General": "#2f55d4", "Opening General": "#13924a",
  "Prospecting Special": "#3f9c93", "Opening Special": "#8a5aa6", "Opening Construction": "#c27a10",
};
const STATUS_DASH = { "Approved": null, "Under process": "6 4", "Inactive": "2 4" };
const STATUSES = Object.keys(STATUS_DASH);

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "").replace(/[vw]/g, "b"); // Vyas == Byas
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const title = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const D = {};               // loaded layers
const state = {
  mode: "place", place: null, point: null, km: 5,
  status: new Set(STATUSES), types: new Set(Object.keys(TYPE_COLORS)), mineral: "", validity: "",
};
let results = [];
let selected = null;

/* ---------- Bikram Sambat "today" (approximate, good to the day or two) ---------- */
// B.S. new year falls on about 14 April; months average 30.4 days.
function todayBS() {
  const now = new Date();
  const y = now.getFullYear();
  const ny = new Date(y, 3, 14);
  const start = now >= ny ? ny : new Date(y - 1, 3, 14);
  const bsYear = (now >= ny ? y : y - 1) + 57;
  const days = Math.floor((now - start) / 864e5);
  const month = Math.min(12, Math.floor(days / 30.44) + 1);
  const day = Math.min(32, Math.floor(days - (month - 1) * 30.44) + 1);
  return [bsYear, month, day];
}
const TODAY = todayBS();
const bsKey = (a) => a[0] * 400 + a[1] * 32 + a[2];
function parseBS(s) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(s || "").trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function validity(p) {
  const end = parseBS(p.l_to_date);
  if (!end) return "unknown";
  const k = bsKey(end), t = bsKey(TODAY);
  if (k < t) return "expired";
  if (k < t + 400) return "soon";
  return "valid";
}
const todayStr = `${TODAY[0]}-${String(TODAY[1]).padStart(2, "0")}-${String(TODAY[2]).padStart(2, "0")}`;

/* ---------- map ---------- */
const map = L.map("map", { zoomControl: true, minZoom: 6, maxBounds: [[25.5, 79], [31.2, 89.2]] })
  .fitBounds([[26.35, 80.05], [30.45, 88.2]]);
const BASES = {
  topo: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Tiles © Esri" }),
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "Imagery © Esri, Maxar" }),
  light: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }),
};
let base = BASES.topo.addTo(map);
map.attributionControl.addAttribution('Data: <a href="http://gis.dmgnepal.gov.np" target="_blank" rel="noopener">DMG Nepal</a>');

map.createPane("context"); map.getPane("context").style.zIndex = 350;
map.createPane("area"); map.getPane("area").style.zIndex = 380;
map.createPane("lic"); map.getPane("lic").style.zIndex = 420;

const groups = { area: L.layerGroup().addTo(map), lic: L.layerGroup().addTo(map) };
const ctx = {};

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------- loading ---------- */
const FILES = ["mining_licences", "local_levels", "districts", "topo_sheets", "chure_area",
  "national_parks_new", "national_parks_conservation", "ktft_alignment"];

async function load() {
  const [meta, ...layers] = await Promise.all([
    fetch("data/meta.json").then((r) => r.json()).catch(() => ({})),
    ...FILES.map((f) => fetch(`data/${f}.geojson`).then((r) => {
      if (!r.ok) throw new Error(`data/${f}.geojson missing`);
      return r.json();
    })),
  ]);
  FILES.forEach((f, i) => (D[f] = layers[i]));
  if (meta.downloaded) $("asof").textContent = `· downloaded ${meta.downloaded}`;

  for (const f of D.mining_licences.features) {
    const p = f.properties;
    p._bbox = turf.bbox(f);
    p._c = turf.centroid(f).geometry.coordinates;
    p._valid = validity(p);
  }
  for (const f of D.local_levels.features) {
    f.properties._n = norm(f.properties.gapa_napa);
    f.properties._bbox = turf.bbox(f);
  }
}

/* ---------- context layers ---------- */
function buildContext() {
  const line = (color, w, dash) => ({ pane: "context", color, weight: w, dashArray: dash, fill: false, interactive: false });
  ctx.ll = L.geoJSON(D.local_levels, { pane: "context", style: { color: "#47555c", weight: 0.7, opacity: 0.7, fill: false }, interactive: false });
  ctx.dist = L.geoJSON(D.districts, { style: line("#2c3a40", 1.6) });
  ctx.chure = L.geoJSON(D.chure_area, { pane: "context", style: { color: "#2f7d1a", weight: 0.8, fillColor: "#3d9a24", fillOpacity: 0.18 }, interactive: false });
  ctx.parks = L.featureGroup([
    L.geoJSON(D.national_parks_conservation, { pane: "context", style: { color: "#8a5a12", weight: 1, fillColor: "#c58a2b", fillOpacity: 0.15 },
      onEachFeature: (f, l) => l.bindTooltip(esc(`${f.properties.PARKNAME || ""} ${f.properties.TYPES ? "· " + f.properties.TYPES : ""}`), { sticky: true, className: "lbl-tip" }) }),
    L.geoJSON(D.national_parks_new, { pane: "context", style: { color: "#8a5a12", weight: 1, dashArray: "3 3", fillColor: "#c58a2b", fillOpacity: 0.1 },
      onEachFeature: (f, l) => l.bindTooltip(esc(`${f.properties.PAS_NAME || ""} ${f.properties.Name1_1 ? "· " + f.properties.Name1_1 : ""}`), { sticky: true, className: "lbl-tip" }) }),
  ]);
  ctx.topo = L.geoJSON(D.topo_sheets, { pane: "context", style: { color: "#6b6b6b", weight: 0.7, dashArray: "2 3", fill: true, fillOpacity: 0 },
    onEachFeature: (f, l) => l.bindTooltip(`Sheet ${esc(f.properties.SHEET_ID)}`, { sticky: true, className: "lbl-tip" }) });
  ctx.ktft = L.geoJSON(D.ktft_alignment, { pane: "context", style: { color: "#d62728", weight: 3 },
    onEachFeature: (f, l) => l.bindTooltip("Kathmandu–Terai Fast Track", { sticky: true, className: "lbl-tip" }) });

  const bind = (id, key) => {
    const cb = $(id);
    const apply = () => (cb.checked ? ctx[key].addTo(map) : map.removeLayer(ctx[key]));
    cb.addEventListener("change", apply); apply();
  };
  bind("lyr-ll", "ll"); bind("lyr-dist", "dist"); bind("lyr-chure", "chure");
  bind("lyr-parks", "parks"); bind("lyr-topo", "topo"); bind("lyr-ktft", "ktft");
  $("basemap").addEventListener("change", (e) => { map.removeLayer(base); base = BASES[e.target.value].addTo(map); });
}

/* ---------- controls ---------- */
function buildControls() {
  const counts = (key) => D.mining_licences.features.reduce((m, f) => (m[f.properties[key]] = (m[f.properties[key]] || 0) + 1, m), {});
  const sc = counts("status"), tc = counts("licence_type"), mc = counts("mp_name");

  $("status-chips").innerHTML = STATUSES.map((s) =>
    `<button class="chip" type="button" data-status="${s}" aria-pressed="true">${s} <span class="n">${sc[s] || 0}</span></button>`).join("");
  $("type-chips").innerHTML = Object.entries(TYPE_COLORS).map(([t, c]) =>
    `<button class="chip" type="button" data-type="${t}" aria-pressed="true"><span class="sw" style="background:${c}"></span>${t} <span class="n">${tc[t] || 0}</span></button>`).join("");
  const toggle = (set, val, btn) => {
    set.has(val) ? set.delete(val) : set.add(val);
    btn.setAttribute("aria-pressed", set.has(val));
    update();
  };
  $("status-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-status]"); if (b) toggle(state.status, b.dataset.status, b); });
  $("type-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) toggle(state.types, b.dataset.type, b); });

  $("mineral").insertAdjacentHTML("beforeend", Object.entries(mc).sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `<option value="${esc(m)}">${esc(m)} (${n})</option>`).join(""));
  $("mineral").addEventListener("change", (e) => { state.mineral = e.target.value; update(); });
  $("validity").addEventListener("change", (e) => { state.validity = e.target.value; update(); });

  $("place-list").innerHTML = D.local_levels.features
    .map((f) => `${f.properties.gapa_napa}, ${title(f.properties.district)}`).sort()
    .map((s) => `<option value="${esc(s)}"></option>`).join("");
  const onPlace = () => findPlace($("place").value);
  $("place").addEventListener("change", onPlace);
  $("place").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onPlace(); } });

  $("km").addEventListener("input", (e) => { state.km = +e.target.value; $("km-out").textContent = `${state.km} km`; });
  $("km").addEventListener("change", () => update());

  for (const m of ["place", "point", "all"]) $(`mode-${m}`).addEventListener("click", () => setMode(m));
  map.on("click", (e) => {
    if (state.mode !== "point") return;
    state.point = [e.latlng.lng, e.latlng.lat];
    $("point-at").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    update(true);
  });

  $("copy-csv").addEventListener("click", async () => {
    const csv = toCSV();
    try { await navigator.clipboard.writeText(csv); toast(`Copied ${results.length} rows`); }
    catch { toast("Copy blocked by the browser; use Download CSV"); }
  });
  $("dl-csv").addEventListener("click", () => {
    const blob = new Blob(["﻿" + toCSV()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${areaSlug()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("legend").innerHTML =
    Object.entries(TYPE_COLORS).map(([t, c]) => `<div class="r"><span class="sq" style="border-color:${c};background:${c}33"></span>${t}</div>`).join("") +
    `<div class="r"><span class="ln" style="border-top-color:currentColor"></span>Approved</div>
     <div class="r"><span class="ln" style="border-top-style:dashed;border-top-color:currentColor"></span>Under process</div>
     <div class="r"><span class="ln" style="border-top-style:dotted;border-top-color:currentColor"></span>Inactive</div>`;
}

function setMode(m) {
  state.mode = m;
  for (const x of ["place", "point", "all"]) {
    $(`mode-${x}`).classList.toggle("on", x === m);
    $(`mode-${x}`).setAttribute("aria-selected", x === m);
  }
  $("place-box").hidden = m !== "place";
  $("point-box").hidden = m !== "point";
  $("radius-box").hidden = m === "all";
  map.getContainer().style.cursor = m === "point" ? "crosshair" : "";
  update(true);
}

function findPlace(text) {
  $("place-choices").hidden = true; $("place-msg").hidden = true;
  const [name, dist] = String(text).split(",").map((s) => s.trim());
  if (!name) return;
  let hits = D.local_levels.features.filter((f) => f.properties._n === norm(name));
  if (dist) hits = hits.filter((f) => norm(f.properties.district) === norm(dist));
  if (hits.length === 1) { state.place = hits[0]; setMode("place"); return; }
  if (hits.length > 1) {
    $("place-choices").innerHTML = hits.map((f, i) =>
      `<button type="button" data-i="${i}">${esc(f.properties.gapa_napa)}, ${esc(title(f.properties.district))}</button>`).join("");
    $("place-choices").hidden = false;
    $("place-choices").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.place = hits[+b.dataset.i];
      $("place").value = b.textContent; $("place-choices").hidden = true; setMode("place");
    };
    return;
  }
  // nothing exact: suggest names that start the same or contain it
  const n = norm(name);
  const close = D.local_levels.features.filter((f) => f.properties._n.startsWith(n.slice(0, 4)) || f.properties._n.includes(n)).slice(0, 6);
  $("place-msg").hidden = false;
  $("place-msg").textContent = close.length
    ? `No exact match for “${name}”. Try: ${close.map((f) => `${f.properties.gapa_napa} (${title(f.properties.district)})`).join(", ")}`
    : `No municipality called “${name}”. Check the spelling, or pick from the list as you type.`;
}

/* ---------- analysis ---------- */
function currentArea() {
  if (state.mode === "place" && state.place) {
    const target = state.place;
    const area = state.km > 0 ? turf.buffer(target, state.km, { units: "kilometers" }) : target;
    return { target, area, kind: "place" };
  }
  if (state.mode === "point" && state.point) {
    const target = turf.point(state.point);
    const area = turf.circle(state.point, Math.max(state.km, 0.1), { units: "kilometers", steps: 96 });
    return { target, area, kind: "point" };
  }
  return null;
}

const bboxHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function boundaryLines(poly) {
  const l = turf.polygonToLine(poly);
  return l.type === "FeatureCollection" ? l.features : [l];
}

function analyse() {
  const A = currentArea();
  const pass = (p) => state.status.has(p.status) && state.types.has(p.licence_type) &&
    (!state.mineral || p.mp_name === state.mineral) &&
    (!state.validity || (state.validity === "valid" ? p._valid !== "expired" : p._valid === state.validity));

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
        : Math.min(...turf.coordAll(f)
            .flatMap((pt) => lines.map((ln) => turf.pointToLineDistance(pt, ln, { units: "kilometers" }))));
    } else {
      inside = turf.booleanPointInPolygon(A.target, f);
      dist = inside ? 0 : Math.min(...boundaryLines(f).map((ln) => turf.pointToLineDistance(A.target, ln, { units: "kilometers" })));
    }
    out.push({ f, inside, dist });
  }
  out.sort((a, b) => (b.inside - a.inside) || (a.dist - b.dist));
  return { A, out };
}

/* ---------- rendering ---------- */
function licStyle(p, dim) {
  const c = TYPE_COLORS[p.licence_type] || "#555";
  return { pane: "lic", color: p.status === "Inactive" ? "#7c868a" : c, weight: dim ? 1 : 2,
    dashArray: STATUS_DASH[p.status], fillColor: c, fillOpacity: dim ? 0.12 : 0.3, opacity: dim ? 0.55 : 1 };
}

const VALID_LABEL = { expired: ["exp", "Date passed"], soon: ["soon", "Ends within 1 yr"] };

function pills(p, r) {
  const st = p.status.split(" ")[0];
  let h = `<span class="pill st-${st}">${esc(p.status)}</span>`;
  if (r && r.inside) h = `<span class="pill in">${state.mode === "point" ? "At point" : "Inside"}</span>` + h;
  const v = VALID_LABEL[p._valid];
  if (v) h += `<span class="pill ${v[0]}">${v[1]}</span>`;
  return h;
}

function popupHTML(p) {
  const [lng, lat] = p._c;
  const ha = p.l_total_area != null && p.l_total_area !== "" ? `${(+p.l_total_area * 100).toFixed(2)} ha (DMG)` : "";
  const utm = p.l_easting_from ? `E ${p.l_easting_from}–${p.l_easting_to}<br>N ${p.l_northing_from}–${p.l_northing_to}` : "";
  const rows = [
    ["Type", p.licence_type], ["Holder", p.lh_name], ["Holder address", p.lh_address],
    ["Place", [p.l_address, p.local_level, title(p.district)].filter(Boolean).join(", ")],
    ["Area", [ha, p.area_ha_calc ? `${p.area_ha_calc} ha (map)` : ""].filter(Boolean).join(" · ")],
    ["Map sheet", p.l_map_no], ["UTM corners", utm],
    ["Valid", p.l_from_date || p.l_to_date ? `${p.l_from_date || "?"} → ${p.l_to_date || "?"} B.S.` : ""],
  ].filter(([, v]) => v);
  return `<div class="pop">
    <div class="min">${esc(p.mp_name || "Unknown mineral")}</div>
    <h3>${esc(p.l_license_no)}</h3>
    <div class="tags">${pills(p)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${k === "UTM corners" ? v : esc(v)}</dd>`).join("")}</dl>
    <div class="links mono">${lat.toFixed(5)}, ${lng.toFixed(5)} ·
      <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Google Maps</a></div>
  </div>`;
}

const layerById = new Map();

function update(fit = false) {
  if (!D.mining_licences) return;
  const { A, out } = analyse();
  results = out;
  groups.area.clearLayers(); groups.lic.clearLayers(); layerById.clear();

  if (A) {
    L.geoJSON(A.area, { pane: "area", style: { color: cssVar("--accent"), weight: 2, dashArray: "8 6", fillOpacity: 0.04, fillColor: cssVar("--accent") }, interactive: false }).addTo(groups.area);
    if (A.kind === "place") {
      L.geoJSON(A.target, { pane: "area", style: { color: "#b3261e", weight: 3, fill: false }, interactive: false }).addTo(groups.area);
    } else {
      L.circleMarker([state.point[1], state.point[0]], { pane: "area", radius: 6, color: "#b3261e", weight: 3, fillOpacity: 1, fillColor: "#fff" }).addTo(groups.area);
    }
  }
  const inSet = new Set(out.map((r) => r.f));
  // in an area: show everything else faintly for context; nationwide: show the filtered set only
  for (const f of D.mining_licences.features) {
    const hit = inSet.has(f);
    if (!hit && !A) continue;
    if (!hit && A && !bboxHit(f.properties._bbox, map.getBounds().pad(1).toBBoxString().split(",").map(Number))) continue;
    const lyr = L.geoJSON(f, { style: licStyle(f.properties, !hit) }).bindPopup(popupHTML(f.properties), { maxWidth: 340 });
    lyr.addTo(groups.lic);
    if (hit) layerById.set(f, lyr);
  }

  renderList(A, out);
  if (fit && A) map.fitBounds(L.geoJSON(A.area).getBounds(), { padding: [20, 20] });
  if (fit && !A) map.fitBounds([[26.35, 80.05], [30.45, 88.2]]);
  writeHash();
}

function renderList(A, out) {
  const nIn = out.filter((r) => r.inside).length;
  let where;
  if (!A) where = state.mode === "all" ? "in all of Nepal" : state.mode === "point" ? "in all of Nepal. Click the map to set a point" : "in all of Nepal";
  else if (A.kind === "place") where = `${state.km ? `within ${state.km} km of` : "in"} ${esc(A.target.properties.gapa_napa)}, ${esc(title(A.target.properties.district))}`;
  else where = `within ${state.km} km of the point`;
  $("summary").innerHTML = `<strong>${out.length.toLocaleString()}</strong> licence${out.length === 1 ? "" : "s"} ${where}` +
    (A && A.kind === "place" ? ` · ${nIn} inside` : "");

  const byT = {};
  for (const r of out) byT[r.f.properties.licence_type] = (byT[r.f.properties.licence_type] || 0) + 1;
  $("bytype").innerHTML = Object.entries(byT).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span><i style="background:${TYPE_COLORS[t]}"></i>${t} <b class="mono">${n}</b></span>`).join("");

  const CAP = 300;
  $("list").innerHTML = out.slice(0, CAP).map((r, i) => {
    const p = r.f.properties;
    const d = r.dist == null ? "" : r.dist === 0 ? "" : `${r.dist < 1 ? (r.dist * 1000).toFixed(0) + " m" : r.dist.toFixed(1) + " km"}`;
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
  $("more").textContent = `Showing the first ${CAP} of ${out.length.toLocaleString()}. Narrow the filters, or use Download CSV for all.`;
}

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

/* ---------- CSV + link state ---------- */
const CSV_COLS = ["l_license_no", "licence_type", "status", "mp_name", "district", "local_level", "l_address",
  "l_total_area", "area_ha_calc", "l_map_no", "l_from_date", "l_to_date", "lh_name", "lh_address",
  "l_easting_from", "l_easting_to", "l_northing_from", "l_northing_to"];
function toCSV() {
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = [...CSV_COLS, "date_check_vs_" + todayStr, "inside", "distance_km", "lat", "lon"];
  const rows = results.map((r) => {
    const p = r.f.properties;
    return [...CSV_COLS.map((c) => p[c]), p._valid, r.inside ?? "", r.dist == null ? "" : r.dist.toFixed(2),
      p._c[1].toFixed(6), p._c[0].toFixed(6)].map(q).join(",");
  });
  return [head.join(","), ...rows].join("\n");
}
function areaSlug() {
  if (state.mode === "place" && state.place) return `licences_${norm(state.place.properties.gapa_napa)}_${state.km}km`;
  if (state.mode === "point" && state.point) return `licences_point_${state.km}km`;
  return "licences_nepal";
}
function writeHash() {
  let h = "";
  if (state.mode === "place" && state.place) h = `place=${state.place.properties.gapa_napa}|${state.place.properties.district}|${state.km}`;
  else if (state.mode === "point" && state.point) h = `point=${state.point[1].toFixed(5)}|${state.point[0].toFixed(5)}|${state.km}`;
  else if (state.mode === "all") h = "all";
  history.replaceState(null, "", h ? "#" + encodeURIComponent(h) : location.pathname);
}
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "all") return setMode("all");
  const m = /^(place|point)=(.+)\|(.+)\|([\d.]+)$/.exec(h);
  if (!m) return false;
  state.km = +m[4]; $("km").value = state.km; $("km-out").textContent = `${state.km} km`;
  if (m[1] === "point") {
    state.point = [+m[3], +m[2]]; $("point-at").textContent = `${m[2]}, ${m[3]}`; setMode("point"); return true;
  }
  const f = D.local_levels.features.find((x) => x.properties.gapa_napa === m[2] && x.properties.district === m[3]);
  if (!f) return false;
  state.place = f; $("place").value = `${f.properties.gapa_napa}, ${title(f.properties.district)}`; setMode("place");
  return true;
}

/* ---------- start ---------- */
load().then(() => {
  buildContext();
  buildControls();
  if (!readHash()) {
    // open on a worked example: Vyas Municipality, Tanahun, 5 km
    $("place").value = "Byas, Tanahu";
    findPlace("Byas, Tanahu");
  }
}).catch((err) => {
  console.error(err);
  $("summary").textContent = /missing/.test(err.message)
    ? `Map data not found. Run "uv run dmg-gis web" from the project folder.`
    : `Something went wrong: ${err.message}`;
});
