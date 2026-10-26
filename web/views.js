/* Khani Insights — Overview, Licence check, Minerals, and the router. Depends on app.js. */
"use strict";

const active = () => D.lic.filter((p) => p.status !== "Inactive");
// Rokka = areas DMG holds in reserve (huge, no holder); business figures use company licences only
const isRokka = (p) => String(p.licence_type).startsWith("Rokka");
const ops = () => active().filter((p) => !isRokka(p));
const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const groupBy = (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const bsYear = (s) => (/^(\d{4})/.exec(s || "") || [])[1];
const curBS = () => +(META.built_bs || "2083").slice(0, 4);
const fyLabel = (y) => `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
const ha = (n) => `${fmt(Math.round(n))} ha`;

/* ---------- "My licences": saved on this device only ---------- */
const SAVE_KEY = "khani.saved.v1";
function getSaved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch { return []; } }
function setSaved(a) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(a)); } catch { toast("This browser blocks saving. Bookmark the licence page instead."); } }
function toggleSaved(no) {
  const s = getSaved(), i = s.indexOf(no);
  i >= 0 ? s.splice(i, 1) : s.push(no);
  setSaved(s);
  return i < 0;
}
const riskCount = (p) => (p.chure_pct > 0) + !!p.park + !!p.rokka_overlap + (p.ktft_km != null && p.ktft_km < 2);

function renderSaved(el) {
  const list = getSaved().map((no) => D.lic.find((p) => p.l_license_no === no)).filter(Boolean)
    .sort((a, b) => (a._days ?? 1e9) - (b._days ?? 1e9));
  if (!list.length) { el.hidden = true; return; }
  const exp = list.filter((p) => p._term === "expired").length, soon = list.filter((p) => p._term === "soon").length;
  const risky = list.filter((p) => riskCount(p)).length;
  const alerts = [exp && `<span class="pill exp">${exp} end date passed</span>`, soon && `<span class="pill soon">${soon} ending within 1 yr</span>`,
    risky && `<span class="pill soon">${risky} with risk flags</span>`].filter(Boolean).join("");
  el.hidden = false;
  el.innerHTML = `<div class="card-head"><h2>My licences (${list.length})</h2><span class="note">Saved on this device</span></div>
    ${alerts ? `<div class="tags">${alerts}</div>` : `<p class="note">All saved licences are running with no risk flags.</p>`}
    <div class="portfolio">${list.map(pcard).join("")}</div>`;
}

/* ---------- tooltip for [data-tip] ---------- */
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest && e.target.closest("[data-tip]");
  const tip = $("tip");
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip; tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`;
});
document.addEventListener("pointerleave", () => ($("tip").hidden = true));

/* ---------- chart helpers ---------- */
function stackedBars(el, rows, { onClickHash } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.a + r.u));
  el.innerHTML = rows.map((r) => {
    const tag = onClickHash ? "button" : "div";
    const attrs = onClickHash ? ` type="button" data-hash="${esc(onClickHash(r))}"` : "";
    const tip = `<b>${esc(r.name)}</b><br>Approved ${r.a} · Under process ${r.u}`;
    return `<${tag} class="hb"${attrs} data-tip="${esc(tip)}">
      <span class="name">${esc(r.name)}</span>
      <span class="track">
        ${r.a ? `<span class="seg" style="width:${(r.a / max) * 100}%;background:var(--s1)"></span>` : ""}
        ${r.u ? `<span class="seg" style="width:${(r.u / max) * 100}%;background:var(--s2)"></span>` : ""}
      </span>
      <span class="val">${r.a + r.u}</span></${tag}>`;
  }).join("");
  if (onClickHash) el.onclick = (e) => { const b = e.target.closest("[data-hash]"); if (b) location.hash = b.dataset.hash; };
}
const STACK_LEGEND = `<span><i style="background:var(--s1)"></i>Approved</span><span><i style="background:var(--s2)"></i>Under process</span>`;

function columns(el, rows, { hi = () => false, partial = () => false, unit = "licences" } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  el.innerHTML = rows.map((r) => `<div class="col" data-tip="<b>${esc(r.label)}</b><br>${r.n} ${unit}${partial(r) ? " so far" : ""}">
      <span class="n">${r.n || ""}</span>
      <span class="bar${hi(r) ? " hi" : ""}${partial(r) ? " partial" : ""}" style="height:${(r.n / max) * 100}%"></span></div>`).join("");
  if (el.nextElementSibling?.classList.contains("col-labels")) el.nextElementSibling.remove();
  el.insertAdjacentHTML("afterend", `<div class="col-labels">${rows.map((r) => `<span>${esc(r.short ?? r.label)}</span>`).join("")}</div>`);
}

function statusSplit(list) {
  return { a: list.filter((p) => p.status === "Approved").length, u: list.filter((p) => p.status === "Under process").length };
}
function holderName(list) {
  const c = {};
  for (const p of list) if (p.lh_name) c[p.lh_name.trim()] = (c[p.lh_name.trim()] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown holder";
}
function topKeys(list, key, n = 3) {
  return Object.entries(groupBy(list, (p) => p[key] || "—")).sort((a, b) => b[1].length - a[1].length).slice(0, n).map(([k]) => k);
}

/* =================== OVERVIEW =================== */
let overviewDone = false;
function renderOverview() {
  if (overviewDone) return;
  overviewDone = true;
  const A = ops();
  const R = active().filter(isRokka);
  const appr = A.filter((p) => p.status === "Approved");
  const pend = A.filter((p) => p.status === "Under process");
  const soon = A.filter((p) => p._term === "soon");
  const exp = A.filter((p) => p._term === "expired");
  const holders = new Set(A.map((p) => p.holder_key).filter(Boolean));
  const districts = new Set(A.map((p) => p.district));

  $("kpis").innerHTML = [
    ["", fmt(appr.length), "Approved company licences", `${fmt(holders.size)} holders · ${districts.size} districts`, "#all"],
    ["", fmt(pend.length), "Applications under process", "Waiting for approval at DMG", "#all"],
    ["warn", fmt(soon.length), "End within 12 months", "Renewal files to prepare now", "#expiring"],
    ["bad", fmt(exp.length), "End date already passed", "Still listed by DMG; check renewal", "#expired"],
  ].map(([cls, v, k, d, href]) => `<div class="kpi ${cls}"><a href="${href}"><div class="v">${v}</div><div class="k">${k}</div><div class="d">${d}</div></a></div>`).join("");

  // key findings, computed from the data
  const byMin = Object.entries(groupBy(A, (p) => p.mp_name || "Unknown")).sort((a, b) => b[1].length - a[1].length);
  const [topMin, topList] = byMin[0];
  const fy = groupBy(D.lic.filter((p) => p.issue_year_bs && !isRokka(p)), (p) => p.issue_year_bs);
  const cy = curBS();
  const base = [];
  for (let y = cy - 11; y <= cy - 3; y++) base.push((fy[y] || []).length);
  const baseAvg = Math.round(sum(base, (x) => x) / base.length);
  const lastFull = cy - 1;
  const wave = A.filter((p) => { const y = +bsYear(p.l_to_date); return y >= cy + 1 && y <= cy + 4; });
  const chure = A.filter((p) => p.chure_pct > 0);
  const park = A.filter((p) => p.park);
  const byHolderArea = Object.entries(groupBy(appr.filter((p) => p.holder_key), (p) => p.holder_key))
    .map(([k, l]) => sum(l, (p) => p.area_ha_calc)).sort((a, b) => b - a);
  const top10 = sum(byHolderArea.slice(0, 10), (x) => x), allArea = sum(appr, (p) => p.area_ha_calc);
  const busiest = Object.entries(groupBy(pend, (p) => title(p.district))).sort((a, b) => b[1].length - a[1].length)[0];

  $("findings").innerHTML = [
    `<b>${esc(topMin)}</b> is the most licensed mineral: <b>${topList.length}</b> licences (${pct(topList.length, A.length)}% of all), mostly in ${topKeys(topList, "district").map(title).join(", ")}.`,
    `New company licences are rising fast: about <b>${baseAvg}</b> a year from FY ${fyLabel(cy - 11)} to ${fyLabel(cy - 3)}, then <b>${(fy[cy - 2] || []).length}</b> in ${fyLabel(cy - 2)} and <b>${(fy[lastFull] || []).length}</b> in ${fyLabel(lastFull)}. Expect more competition for good sites.`,
    `<b>${R.length}</b> Rokka areas (land DMG holds in reserve) cover ${ha(sum(R, (p) => p.area_ha_calc))}, and <b>${A.filter((p) => p.rokka_overlap).length}</b> company licences overlap one.`,
    `A renewal wave is coming: <b>${wave.length}</b> licences reach their end date between ${cy + 1} and ${cy + 4} B.S.`,
    `<b>${exp.length}</b> licences that DMG still lists have an end date that has passed. If one is yours, confirm the renewal is on record.`,
    `<b>${chure.length}</b> licences overlap the Chure area and <b>${park.length}</b> overlap a national park or buffer zone, where extra restrictions apply.`,
    `The 10 largest holders hold <b>${pct(top10, allArea)}%</b> of all approved licensed area (${ha(top10)} of ${ha(allArea)}).`,
    busiest ? `<b>${esc(busiest[0])}</b> has the most applications under process (<b>${busiest[1].length}</b>), so it is the busiest district for new entrants.` : "",
  ].filter(Boolean).map((s) => `<li>${s}</li>`).join("");

  $("lg-mineral").innerHTML = STACK_LEGEND;
  $("lg-prov").innerHTML = STACK_LEGEND;
  stackedBars($("ch-mineral"), byMin.slice(0, 12).map(([name, l]) => ({ name, ...statusSplit(l) })),
    { onClickHash: (r) => `mineral=${r.name}` });
  const byProv = Object.entries(groupBy(A, (p) => p.province || "Unknown")).sort((a, b) => b[1].length - a[1].length);
  stackedBars($("ch-prov"), byProv.map(([name, l]) => ({ name, ...statusSplit(l) })));

  const ends = groupBy(A.filter((p) => p.l_to_date), (p) => +bsYear(p.l_to_date));
  const er = [];
  for (let y = cy; y <= cy + 12; y++) er.push({ label: `${y} B.S.`, short: String(y).slice(2), y, n: (ends[y] || []).length });
  columns($("ch-expiry"), er, { hi: (r) => r.y >= cy + 1 && r.y <= cy + 4, unit: "licences end" });

  const fr = [];
  for (let y = cy - 13; y <= cy; y++) fr.push({ label: `FY ${fyLabel(y)}`, short: String(y).slice(2), y, n: (fy[y] || []).length });
  columns($("ch-fy"), fr, { partial: (r) => r.y === cy, unit: "new licence numbers" });

  const holderRows = Object.entries(groupBy(A.filter((p) => p.holder_key), (p) => p.holder_key))
    .map(([k, l]) => ({ k, l, n: l.length, area: sum(l.filter((p) => p.status === "Approved"), (p) => p.area_ha_calc) }))
    .sort((a, b) => b.n - a.n || b.area - a.area).slice(0, 12);
  $("tb-holders").innerHTML = `<thead><tr><th>Holder</th><th class="num">Licences</th><th class="num">Approved area</th><th class="hide-sm">Minerals</th></tr></thead><tbody>` +
    holderRows.map((r) => `<tr class="click" data-hash="holder=${esc(r.k)}"><td>${esc(holderName(r.l))}<div class="sub">${topKeys(r.l, "district", 2).map(title).join(", ")}</div></td>
      <td class="num">${r.n}</td><td class="num">${ha(r.area)}</td><td class="hide-sm">${esc(topKeys(r.l, "mp_name").join(", "))}</td></tr>`).join("") + "</tbody>";

  const distRows = Object.entries(groupBy(A, (p) => p.district)).map(([d, l]) => ({ d, l, ...statusSplit(l) }))
    .sort((a, b) => b.u - a.u).slice(0, 10);
  $("tb-pending").innerHTML = `<thead><tr><th>District</th><th class="num">Under process</th><th class="num">Approved</th><th>Most applied for</th></tr></thead><tbody>` +
    distRows.map((r) => `<tr><td>${esc(title(r.d))}</td><td class="num">${r.u}</td><td class="num">${r.a}</td>
      <td>${esc(topKeys(r.l.filter((p) => p.status === "Under process"), "mp_name", 2).join(", "))}</td></tr>`).join("") + "</tbody>";
  for (const t of ["tb-holders"]) $(t).onclick = (e) => { const r = e.target.closest("[data-hash]"); if (r) location.hash = r.dataset.hash; };
}

/* =================== LICENCE CHECK =================== */
let licenceInit = false;
function initLicence() {
  if (licenceInit) return;
  licenceInit = true;
  const names = [...new Set(D.lic.map((p) => p.lh_name && p.lh_name.trim()).filter(Boolean))].sort();
  $("lic-list").innerHTML = [...D.lic.map((p) => p.l_license_no), ...names].map((s) => `<option value="${esc(s)}"></option>`).join("");
  const go = () => searchLicence($("lic-q").value);
  $("lic-go").addEventListener("click", go);
  $("lic-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  $("lic-q").addEventListener("change", go);
}

function searchLicence(q) {
  q = String(q || "").trim();
  $("lic-msg").hidden = true;
  if (!q) return;
  const key = q.toLowerCase().replace(/\s+/g, "");
  const exact = D.lic.filter((p) => String(p.l_license_no).toLowerCase().replace(/\s+/g, "") === key);
  if (exact.length === 1) { location.hash = `licence=${exact[0].l_license_no}`; return; }
  const hk = q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(pvt|p|private|ltd|limited|co|company|industries|industry|udhyog|uddhyog)\b/g, " ").replace(/\s+/g, " ").trim();
  const byHolder = D.lic.filter((p) => p.holder_key && hk && p.holder_key.includes(hk));
  const keys = [...new Set(byHolder.map((p) => p.holder_key))];
  if (keys.length === 1) { location.hash = `holder=${keys[0]}`; return; }
  const partial = exact.length ? exact : D.lic.filter((p) => String(p.l_license_no).toLowerCase().includes(q.toLowerCase()));
  const list = keys.length > 1 ? keys.map((k) => D.lic.find((p) => p.holder_key === k)) : partial;
  if (!list.length) {
    $("lic-msg").hidden = false;
    $("lic-msg").textContent = `Nothing matches “${q}”. Try the licence number as written on the certificate (e.g. 10/076/77) or part of the company name.`;
    return;
  }
  $("lic-out").innerHTML = `<section class="card"><h2>${list.length} matches</h2><div class="portfolio">${
    list.slice(0, 60).map((p) => keys.length > 1
      ? `<a class="pcard" href="#holder=${esc(p.holder_key)}"><span class="min">${esc(holderName(D.lic.filter((x) => x.holder_key === p.holder_key)))}</span><span class="meta">${D.lic.filter((x) => x.holder_key === p.holder_key).length} licences</span></a>`
      : pcard(p)).join("")}</div></section>`;
}

const TERM_CLS = { expired: "bad", soon: "warn", valid: "ok", none: "none" };
function pcard(p) {
  const d = p._days;
  const when = d == null ? "No end date" : d < 0 ? `Ended ${humanDays(d)} ago` : `${humanDays(d)} left`;
  const r = riskCount(p);
  return `<a class="pcard" href="${licLink(p)}">
    <span class="pc-top"><span class="no">${esc(p.l_license_no)}</span><span class="days ${TERM_CLS[p._term]}">${when}</span></span>
    <span class="min">${esc(p.mp_name || "—")} · ${esc(p.licence_type)}</span>
    <span class="meta">${esc([p.local_level, title(p.district)].filter(Boolean).join(", "))}</span>
    <span class="tags">${pills(p)}${r ? `<span class="pill soon">${r} risk flag${r > 1 ? "s" : ""}</span>` : ""}</span></a>`;
}

function adLong(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

function renderLicence(no, isExample = false) {
  initLicence();
  const p = D.lic.find((x) => x.l_license_no === no) || D.lic.find((x) => String(x.l_license_no).toLowerCase() === String(no).toLowerCase());
  if (!p) { $("lic-out").innerHTML = ""; $("lic-msg").hidden = false; $("lic-msg").textContent = `No licence numbered “${no}”.`; return; }
  $("lic-q").value = isExample ? "" : p.l_license_no;
  const d = p._days;
  let big, bigCls, line, prog = null, progCls = "";
  if (d == null) { big = "No end date"; bigCls = "none"; line = p.licence_type.startsWith("Rokka") ? "Rokka (reserved) areas have no term published." : "DMG has not published an end date for this licence."; }
  else if (d < 0) { big = `${humanDays(d)} ago`; bigCls = "bad"; progCls = "bad"; line = `The end date passed, but DMG still lists this licence as ${p.status.toLowerCase()}. Confirm the renewal is on record with DMG.`; }
  else if (d <= 365) { big = humanDays(d); bigCls = "warn"; progCls = "warn"; line = `Ends in ${fmt(d)} days. Start the renewal file now.`; }
  else { big = humanDays(d); bigCls = "ok"; line = `${fmt(d)} days left on the current term.`; }
  if (p.from_date_ad && p.to_date_ad) {
    const s = new Date(p.from_date_ad), e = new Date(p.to_date_ad);
    prog = Math.max(0, Math.min(100, ((TODAY - s) / (e - s)) * 100));
  }

  const checks = [];
  checks.push(p.chure_pct > 0
    ? ["warn", "!", `Overlaps the Chure (Siwalik) area by ${p.chure_pct}%`, "Chure is under extra environmental protection. Check what is allowed on this part."]
    : ["ok", "✓", "Outside the Chure area", ""]);
  checks.push(p.park
    ? ["bad", "!", `Overlaps ${esc(p.park)}${p.park_type ? ` (${esc(p.park_type)})` : ""} by ${p.park_pct}%`, "Protected areas and buffer zones need separate approval."]
    : ["ok", "✓", "Outside national parks and buffer zones", ""]);
  if (!isRokka(p)) checks.push(p.rokka_overlap
    ? ["warn", "!", `Overlaps a Rokka (reserved) area: ${esc(p.rokka_overlap)}`, "DMG holds this land in reserve. Check the overlap before investing."]
    : ["ok", "✓", "No overlap with Rokka (reserved) areas", ""]);
  checks.push(p.ktft_km != null && p.ktft_km < 2
    ? ["warn", "!", `${p.ktft_km} km from the Kathmandu–Terai Fast Track`, "Close to a national project corridor."]
    : ["ok", "✓", "Away from the Fast Track", p.ktft_km != null ? `${p.ktft_km} km away` : ""]);
  checks.push(p.near_pending > 0
    ? ["warn", p.near_pending, `${p.near_pending} application${p.near_pending > 1 ? "s" : ""} under process within ${META.near_km || 5} km`, "New operators may start nearby."]
    : ["ok", "✓", `No pending applications within ${META.near_km || 5} km`, ""]);

  const nb = neighbours(p, META.near_km || 5);
  const mine = p.holder_key ? D.lic.filter((x) => x.holder_key === p.holder_key && x !== p) : [];
  const [lng, lat] = p._c;

  const flags = checks.filter((c) => c[0] !== "ok").length;
  const saved = getSaved().includes(p.l_license_no);
  const dist = (d) => (d === 0 ? "touching" : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

  $("lic-out").innerHTML = `
  ${isExample ? `<p class="example">Example licence. Search above for yours.</p>` : ""}
  <div class="lic-grid">
    <div class="lic-col">
      <section class="card o1">
        <div class="lic-head">
          <div class="lic-title">
            <span class="min">${esc(p.mp_name || "Unknown mineral")}</span>
            <span class="no">${esc(p.l_license_no)}</span>
          </div>
          <button class="save" id="lic-save" type="button" aria-pressed="${saved}">${saved ? "★ Saved" : "☆ Save"}</button>
        </div>
        <span class="tags"><span class="pill type">${esc(p.licence_type)}</span>${pills(p)}</span>
        <div class="term">
          <span class="big ${bigCls}">${big}</span>
          <span>${d == null || d < 0 ? "" : "left on this term"}</span>
          <span class="note">${line}</span>
        </div>
        ${prog != null ? `<div class="progress ${progCls}" data-tip="${Math.round(prog)}% of the term used"><i style="width:${prog}%"></i></div>
        <div class="dates"><span>Started ${esc(p.l_from_date)} B.S. · ${adLong(p.from_date_ad)}</span><span>Ends ${esc(p.l_to_date)} B.S. · ${adLong(p.to_date_ad)}</span></div>` : ""}
        <div class="rowbtns">
          <a class="btn" href="#point=${lat.toFixed(5)}|${lng.toFixed(5)}|5">Show on map</a>
          <button class="btn ghost" type="button" id="lic-copy">Copy summary</button>
          <a class="btn ghost" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">Google Maps</a>
          ${typeof companyButtonHTML === "function" ? companyButtonHTML(p) : ""}
        </div>
      </section>
      <section class="card o3"><h2>Details</h2>
        <dl class="facts">
          <dt>Holder</dt><dd>${esc(p.lh_name || "Not published")}${p.lh_address ? `, ${esc(p.lh_address)}` : ""}</dd>
          <dt>Place</dt><dd>${esc([p.l_address, p.local_level, title(p.district), p.province].filter(Boolean).join(", "))}</dd>
          <dt>Area</dt><dd>${p.area_ha_calc} ha on the map${p.l_total_area ? ` · DMG record ${(+p.l_total_area * 100).toFixed(2)} ha` : ""}</dd>
          ${p.l_map_no ? `<dt>Map sheet</dt><dd>${esc(p.l_map_no)}</dd>` : ""}
          ${p.l_easting_from ? `<dt>UTM corners</dt><dd class="mono">E ${p.l_easting_from}–${p.l_easting_to}<br>N ${p.l_northing_from}–${p.l_northing_to}</dd>` : ""}
          ${p.issue_year_bs ? `<dt>Issued in</dt><dd>FY ${fyLabel(p.issue_year_bs)}</dd>` : ""}
          <dt>Location</dt><dd class="mono">${lat.toFixed(5)}, ${lng.toFixed(5)}</dd>
        </dl>
      </section>
      ${mine.length ? `<section class="card o5"><h2>Other licences of this holder (${mine.length})</h2>
        <p class="note">Soonest end date first. <a href="#holder=${esc(p.holder_key)}">Open the full portfolio →</a></p>
        <div class="portfolio">${mine.sort((a, b) => (a._days ?? 1e9) - (b._days ?? 1e9)).slice(0, 8).map(pcard).join("")}</div></section>` : ""}
    </div>
    <div class="lic-col">
      <section class="card o2"><div class="card-head"><h2>Risk check</h2>
          <span class="pill ${flags ? "soon" : "st-Approved"}">${flags ? `${flags} to check` : "No flags"}</span></div>
        <ul class="checks">${checks.map(([c, ic, t, s]) => `<li class="${c}"><span class="ic">${ic}</span><span>${t}${s ? `<small>${s}</small>` : ""}</span></li>`).join("")}</ul>
      </section>
      ${lawChecklistHTML(p)}
      <section class="card o4"><h2>Within ${META.near_km || 5} km</h2>
        <div class="nstats">
          <div><b>${nb.length}</b><span>licences</span></div>
          <div><b>${nb.filter((x) => x.q.mp_name === p.mp_name).length}</b><span>same mineral</span></div>
          <div><b>${nb.filter((x) => x.q.status === "Under process").length}</b><span>under process</span></div>
        </div>
        <ul class="nlist">${nb.slice(0, 12).map(({ q, d }) => `<li><a href="${licLink(q)}">
            <span class="top"><span class="no">${esc(q.l_license_no)}</span><span class="dist">${dist(d)}</span></span>
            <span><b>${esc(q.mp_name || "—")}</b>${q.mp_name === p.mp_name ? ` <span class="pill same">same mineral</span>` : ""} · ${esc(q.status)}</span>
            <span class="meta">${esc(q.lh_name || "Holder not published")}</span></a></li>`).join("")
          || `<li class="note">No other licences within ${META.near_km || 5} km.</li>`}</ul>
      </section>
    </div>
  </div>`;
  $("lic-save").onclick = (e) => {
    const on = toggleSaved(p.l_license_no);
    e.currentTarget.setAttribute("aria-pressed", on);
    e.currentTarget.textContent = on ? "★ Saved" : "☆ Save";
    toast(on ? "Saved to My licences" : "Removed from My licences");
  };
  $("lic-copy").onclick = async () => {
    const txt = [`Licence ${p.l_license_no} · ${p.mp_name} · ${p.licence_type} · ${p.status}`,
      `Holder: ${p.lh_name || "-"}`, `Place: ${[p.l_address, p.local_level, title(p.district)].filter(Boolean).join(", ")}`,
      p.l_to_date ? `Term: ${p.l_from_date} to ${p.l_to_date} B.S. (${d < 0 ? "end date passed" : fmt(d) + " days left"})` : "Term: no end date published",
      `Area: ${p.area_ha_calc} ha · Map sheet ${p.l_map_no || "-"}`,
      `Risk: ${checks.map((c) => (c[0] === "ok" ? "" : c[2])).filter(Boolean).join("; ") || "no flags"}`,
      `Within ${META.near_km || 5} km: ${nb.length} licences, ${nb.filter((x) => x.q.status === "Under process").length} under process`,
      `Map: https://www.google.com/maps?q=${lat},${lng}`, `Source: DMG Nepal GIS data, ${META.downloaded || ""}`].join("\n");
    try { await navigator.clipboard.writeText(txt); toast("Summary copied"); } catch { toast("Copy was blocked by the browser"); }
  };
}

function renderHolder(key) {
  initLicence();
  const list = D.lic.filter((p) => p.holder_key === key).sort((a, b) => (a._days ?? 1e9) - (b._days ?? 1e9));
  if (!list.length) { $("lic-out").innerHTML = ""; $("lic-msg").hidden = false; $("lic-msg").textContent = "No licences found for that holder."; return; }
  const name = holderName(list);
  $("lic-q").value = name;
  const s = statusSplit(list);
  const next = list.find((p) => p._days != null && p._days >= 0);
  const flags = list.filter((p) => p.chure_pct > 0 || p.park).length;
  $("lic-out").innerHTML = `
    <section class="kpis">
      <div class="kpi"><div class="v">${list.length}</div><div class="k">Licences</div><div class="d">${s.a} approved · ${s.u} under process</div></div>
      <div class="kpi"><div class="v">${fmt(Math.round(sum(list, (p) => p.area_ha_calc)))}</div><div class="k">Hectares</div><div class="d">${esc(topKeys(list, "mp_name").join(", "))}</div></div>
      <div class="kpi ${next && next._days <= 365 ? "warn" : ""}"><div class="v">${next ? humanDays(next._days) : "—"}</div><div class="k">Next end date</div><div class="d">${next ? `${esc(next.l_license_no)} · ${esc(next.l_to_date)} B.S.` : "No upcoming end dates"}</div></div>
      <div class="kpi ${flags ? "warn" : ""}"><div class="v">${flags}</div><div class="k">With Chure or park overlap</div><div class="d">${list.filter((p) => p._term === "expired").length} with end date passed</div></div>
    </section>
    <section class="card"><div class="card-head"><h2>${esc(name)}</h2><button class="ghost" type="button" id="hold-csv">Copy CSV</button></div>
      <p class="note">All licences under this name, soonest end date first. Names are matched loosely, so check that each one is yours.</p>
      <div class="portfolio">${list.map(pcard).join("")}</div></section>`;
  $("hold-csv").onclick = async () => {
    try { await navigator.clipboard.writeText(toCSV(list.map((p) => ({ p })))); toast(`Copied ${list.length} rows`); }
    catch { toast("Copy was blocked by the browser"); }
  };
}

/* =================== MINERALS =================== */
let mineralInit = false;
function renderMineral(name) {
  if (!mineralInit) {
    mineralInit = true;
    const byMin = Object.entries(groupBy(ops(), (p) => p.mp_name || "Unknown")).sort((a, b) => b[1].length - a[1].length);
    $("min-sel").innerHTML = byMin.map(([m, l]) => `<option value="${esc(m)}">${esc(m)} (${l.length})</option>`).join("");
    $("min-sel").addEventListener("change", (e) => (location.hash = `mineral=${e.target.value}`));
    $("min-map").addEventListener("click", () => (location.hash = `all=${$("min-sel").value}`));
  }
  if (!name) name = $("min-sel").options[0].value;
  $("min-sel").value = name;
  const L_ = ops().filter((p) => (p.mp_name || "Unknown") === name);
  const appr = L_.filter((p) => p.status === "Approved"), pend = L_.filter((p) => p.status === "Under process");
  const holders = new Set(L_.map((p) => p.holder_key).filter(Boolean));
  const soon = L_.filter((p) => p._days != null && p._days >= 0 && p._days <= 730).sort((a, b) => a._days - b._days);
  const cy = curBS();
  const fy = groupBy(D.lic.filter((p) => p.issue_year_bs && !isRokka(p) && (p.mp_name || "Unknown") === name), (p) => p.issue_year_bs);

  $("min-out").innerHTML = `
    <section class="kpis">
      <div class="kpi"><div class="v">${appr.length}</div><div class="k">Approved</div><div class="d">${ha(sum(appr, (p) => p.area_ha_calc))} licensed</div></div>
      <div class="kpi"><div class="v">${pend.length}</div><div class="k">Under process</div><div class="d">New supply in the pipeline</div></div>
      <div class="kpi"><div class="v">${holders.size}</div><div class="k">Holders</div><div class="d">in ${new Set(L_.map((p) => p.district)).size} districts</div></div>
      <div class="kpi ${soon.length ? "warn" : ""}"><div class="v">${soon.length}</div><div class="k">End within 2 years</div><div class="d">Sites that may change hands or renew</div></div>
    </section>
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>Districts</h2><span class="legend-inline">${STACK_LEGEND}</span></div>
        <div id="mch-dist" class="hbars"></div></section>
      <section class="card"><div class="card-head"><h2>New licences by fiscal year</h2></div>
        <p class="note">From the fiscal year in the licence number. The latest year is still running.</p>
        <div id="mch-fy" class="cols"></div></section>
    </div>
    <div class="grid2">
      <section class="card"><h2>Largest holders</h2>
        <div class="tablewrap"><table class="tbl" id="mtb-hold"></table></div></section>
      <section class="card"><h2>Ending within 2 years</h2>
        <div class="tablewrap"><table class="tbl" id="mtb-soon"></table></div></section>
    </div>
    <section class="card"><h2>Newest applications under process</h2>
      <p class="note">Who is entering this mineral, newest licence numbers first.</p>
      <div class="tablewrap"><table class="tbl" id="mtb-pend"></table></div></section>`;

  stackedBars($("mch-dist"), Object.entries(groupBy(L_, (p) => title(p.district))).map(([n, l]) => ({ name: n, ...statusSplit(l) }))
    .sort((a, b) => b.a + b.u - (a.a + a.u)).slice(0, 12));
  const fr = [];
  for (let y = cy - 13; y <= cy; y++) fr.push({ label: `FY ${fyLabel(y)}`, short: String(y).slice(2), y, n: (fy[y] || []).length });
  columns($("mch-fy"), fr, { partial: (r) => r.y === cy, unit: "new licence numbers" });

  const hr = Object.entries(groupBy(L_.filter((p) => p.holder_key), (p) => p.holder_key))
    .map(([k, l]) => ({ k, l, n: l.length, area: sum(l.filter((p) => p.status === "Approved"), (p) => p.area_ha_calc) }))
    .sort((a, b) => b.area - a.area || b.n - a.n).slice(0, 10);
  const totA = sum(appr, (p) => p.area_ha_calc);
  $("mtb-hold").innerHTML = `<thead><tr><th>Holder</th><th class="num">Licences</th><th class="num">Approved area</th><th class="num">Share</th></tr></thead><tbody>` +
    (hr.map((r) => `<tr class="click" data-hash="holder=${esc(r.k)}"><td>${esc(holderName(r.l))}</td><td class="num">${r.n}</td><td class="num">${ha(r.area)}</td><td class="num">${pct(r.area, totA)}%</td></tr>`).join("")
      || `<tr><td colspan="4" class="sub">No holder names published for this mineral.</td></tr>`) + "</tbody>";
  $("mtb-soon").innerHTML = `<thead><tr><th>Licence</th><th>Holder · district</th><th class="num">Ends (B.S.)</th></tr></thead><tbody>` +
    (soon.slice(0, 12).map((p) => `<tr class="click" data-hash="licence=${esc(p.l_license_no)}"><td class="mono">${esc(p.l_license_no)}</td>
      <td>${esc(p.lh_name || "—")}<div class="sub">${esc(title(p.district))}</div></td><td class="num">${esc(p.l_to_date)}<div class="sub">${humanDays(p._days)}</div></td></tr>`).join("")
      || `<tr><td colspan="3" class="sub">None end within 2 years.</td></tr>`) + "</tbody>";
  const pr = pend.slice().sort((a, b) => (b.issue_year_bs || 0) - (a.issue_year_bs || 0)).slice(0, 12);
  $("mtb-pend").innerHTML = `<thead><tr><th>Licence</th><th>Applicant</th><th class="hide-sm">Place</th><th class="num">FY</th></tr></thead><tbody>` +
    (pr.map((p) => `<tr class="click" data-hash="licence=${esc(p.l_license_no)}"><td class="mono">${esc(p.l_license_no)}</td><td>${esc(p.lh_name || "—")}</td>
      <td class="hide-sm">${esc([p.local_level, title(p.district)].filter(Boolean).join(", "))}</td><td class="num">${p.issue_year_bs ? fyLabel(p.issue_year_bs) : "—"}</td></tr>`).join("")
      || `<tr><td colspan="4" class="sub">No applications under process.</td></tr>`) + "</tbody>";
  $("min-out").querySelectorAll("[data-hash]").forEach((r) => (r.onclick = () => (location.hash = r.dataset.hash)));
}

/* =================== ROUTER =================== */
const VIEWS = ["overview", "licence", "mineral", "law", "account", "hisab", "map"];
function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll(".tabs a, .bottomnav a").forEach((a) => { if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.body.classList.toggle("is-map", view === "map");
  if (view !== "map") window.scrollTo(0, 0);
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const [k, ...rest] = h.split("=");
  const v = rest.join("=");
  $("saved-lic").hidden = true;
  if (!h || k === "overview") { show("overview"); renderOverview(); renderSaved($("saved-home")); if (typeof renderAccountHome === "function") renderAccountHome(); return; }
  if (k === "account") { show("account"); renderAccount(); return; }
  if (k === "hisab") { show("hisab"); renderHisab(); return; }
  if (k === "licence" && v) { show("licence"); renderLicence(v); return; }
  if (k === "licence") {
    show("licence"); initLicence(); $("lic-msg").hidden = true;
    renderSaved($("saved-lic"));
    if ($("saved-lic").hidden) renderLicence("10/076/77", true); // nothing saved yet: show a worked example
    else { $("lic-out").innerHTML = ""; $("lic-q").value = ""; }
    return;
  }
  if (k === "holder") { show("licence"); renderHolder(v); return; }
  if (k === "mineral") { show("mineral"); renderMineral(v); return; }
  if (k === "law") { show("law"); renderLaw(v); return; }
  if (k === "expiring" || k === "expired") {
    show("map"); initMap();
    mapState.validity = k === "expiring" ? "soon" : "expired"; $("validity").value = mapState.validity;
    openMapFromHash("all"); return;
  }
  if (["map", "all", "place", "point"].includes(k)) { show("map"); openMapFromHash(h); return; }
  show("overview"); renderOverview();
}

loadData().then(() => {
  $("asof").textContent = META.downloaded ? `DMG data of ${META.downloaded}` : "";
  window.addEventListener("hashchange", route);
  if (typeof initAccounts === "function") initAccounts();
  initLicence(); // fills the licence/company suggestions used by the home search too
  $("quick-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("quick-q").value.trim();
    if (!q) return;
    history.replaceState(null, "", "#licence");
    show("licence"); $("lic-q").value = q; searchLicence(q);
  });
  route();
}).catch((err) => {
  console.error(err);
  document.querySelector("#view-overview").hidden = false;
  $("findings").innerHTML = `<li>${/missing/.test(err.message)
    ? 'Map data not found. Run <code>uv run dmg-gis web</code> from the project folder.'
    : esc(`Something went wrong: ${err.message}`)}</li>`;
});
