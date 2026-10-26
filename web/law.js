/* Khani Insights — Law page and the per-licence legal checklist. Content lives in law.json. Depends on app.js. */
"use strict";

const LAW_KINDS = [["all", "All duties"], ["mining", "Mining licence"], ["prospecting", "Prospecting licence"], ["construction", "Stone, sand, gravel"]];
let lawKind = "all";

function licenceKind(p) {
  const t = String(p.licence_type);
  if (t.startsWith("Rokka")) return "rokka";
  if (t.startsWith("Prospecting")) return "prospecting";
  return "mining";
}

function lawRefs(refs) {
  const src = Object.fromEntries((D.law?.sources || []).map((s) => [s.id, s]));
  const short = { act: "Mines Act 2042", rules: "Mines Rules 2056", epa: "Environment Act 2076", epr: "Environment Rules 2077", lgoa: "Local Govt Act 2074" };
  return refs.map(([id, ref]) => `<a class="ref" href="${esc(src[id]?.url || "#")}" target="_blank" rel="noopener"
      title="${esc(src[id]?.title || "")}">${esc(short[id] || id)} · ${esc(ref)}</a>`).join("");
}

function daysUntil(iso) { return Math.round((new Date(iso) - TODAY) / 864e5); }
function dueText(iso) {
  const d = daysUntil(iso);
  if (d < 0) return `passed ${humanDays(d)} ago`;
  if (d === 0) return "today";
  return `in ${humanDays(d)}`;
}
const addDays = (iso, n) => { const x = new Date(iso); x.setDate(x.getDate() + n); return x; };
const addMonths = (iso, n) => { const x = new Date(iso); x.setMonth(x.getMonth() + n); return x; };
const isoOf = (d) => d.toISOString().slice(0, 10);

/* ---------- Law page ---------- */
function renderLawDates() {
  const ld = META.law_dates;
  if (!ld) { $("law-dates").hidden = true; return; }
  const row = (cls, title, bs, ad, note, link) => `<li class="${cls}">
      <span class="when"><b>${esc(bs)}</b> B.S.<small>${adLong(ad)} · ${dueText(ad)}</small></span>
      <span>${title}<small>${note} <a href="#law=${link}">Rule →</a></small></span></li>`;
  const royaltyPassed = daysUntil(ld.royalty.ad) < 0;
  $("law-dates").innerHTML = `<div class="card-head"><h2>Key dates</h2><span class="note">Today ${esc(ld.today_bs)} B.S. · FY ${esc(ld.fy)}</span></div>
    <ul class="datelist">
      ${royaltyPassed
        ? row("", "Royalty for last month", "7th of each month", ld.royalty.ad, "Deposit within 7 days after each B.S. month ends; voucher by the 15th.", "monthly-royalty")
        : row(daysUntil(ld.royalty.ad) <= 7 ? "warn" : "", `Royalty for month ${esc(ld.royalty.for_month)}`, ld.royalty.bs, ld.royalty.ad,
          `Deposit by this date; voucher with monthly production by ${esc(ld.voucher.bs)}.`, "monthly-royalty")}
      ${row(daysUntil(ld.renewal.ad) <= 60 ? "warn" : "", `Licence renewal and annual report for FY ${esc(ld.renewal.for_fy)}`, ld.renewal.bs, ld.renewal.ad,
        "Within 3 months after the fiscal year ends.", "annual-renewal")}
    </ul>
    ${ld.renewal.for_fy === ld.fy ? (() => {
      const y = +String(ld.fy).slice(0, 4);
      return `<p class="note">The FY ${y - 1}/${String(y).slice(2)} renewal was due at the end of Ashwin ${y}. If it is not done, renew now: an unrenewed licence can be cancelled (Rule 43(ga)).</p>`;
    })() : ""}`;
}

function renderLaw(focus) {
  if (!D.law) {
    $("law-out").innerHTML = `<p class="hint">The law information could not be loaded. Check your connection and reload.</p>`;
    return;
  }
  renderLawDates();
  $("law-filter").innerHTML = LAW_KINDS.map(([k, l]) =>
    `<button class="chip" type="button" data-kind="${k}" aria-pressed="${k === lawKind}">${l}</button>`).join("");
  $("law-filter").onclick = (e) => {
    const b = e.target.closest("[data-kind]");
    if (b) { lawKind = b.dataset.kind; renderLaw(); }
  };
  const shows = (it) => lawKind === "all" || it.applies.includes("all") || it.applies.includes(lawKind) ||
    (lawKind === "mining" && it.applies.includes("pending"));
  $("law-out").innerHTML = `<p class="note law-status">${esc(D.law.status_note)} Checked ${esc(D.law.checked)}.</p>` +
    D.law.topics.map((t) => {
      const items = t.items.filter(shows);
      if (!items.length) return "";
      return `<section class="law-topic" id="law-${esc(t.id)}"><h2>${esc(t.title)}</h2>
        ${items.map((it) => `<article class="card law-item" id="law-${esc(it.id)}">
          <h3>${esc(it.title)}</h3>
          ${it.when ? `<p class="when"><b>When:</b> ${esc(it.when)}</p>` : ""}
          <p>${esc(it.do)}</p>
          ${it.fees ? `<p class="fees">${esc(it.fees)}</p>` : ""}
          <div class="refs">${lawRefs(it.law)}</div>
          ${it.ifnot ? `<div class="ifnot"><b>If you don't:</b> ${esc(it.ifnot)}<div class="refs">${lawRefs(it.ifnot_law)}</div></div>` : ""}
        </article>`).join("")}</section>`;
    }).join("");
  $("law-sources").innerHTML = `<h2>Official sources</h2>
    <p class="note">Read the full text before acting. This page explains the law in plain language and is not legal advice;
      confirm with DMG, your municipality or a lawyer.</p>
    <ul class="sources">${D.law.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
      <span class="note">${esc(s.np)}</span></li>`).join("")}</ul>`;
  if (focus) {
    const el = document.getElementById(`law-${focus}`);
    if (el) { el.classList.add("focus"); setTimeout(() => el.scrollIntoView({ block: "start" }), 0); }
  }
}

/* ---------- per-licence checklist ---------- */
// Each row: [state, title, when-text, law item id, refs]; state: bad | warn | ok | info
function lawChecklist(p) {
  const kind = licenceKind(p);
  const ld = META.law_dates;
  const rows = [];
  if (kind === "rokka") return rows;
  const R = (id, ref) => [[id, ref]];

  if (p.status === "Under process") {
    rows.push(["info", "When approved, collect the licence within 30 days", "Otherwise it is cancelled automatically.",
      "collect-licence", R("rules", kind === "prospecting" ? "Rule 7(2)–(3)" : "Rule 15(2)–(3)")]);
  }

  const pending = p.status === "Under process"; // dates on applications are only proposed
  if (pending) { /* term rows start once approved */ } else if (p._term === "expired") {
    rows.push(["bad", "The term has ended", `${humanDays(p._days)} ago. A licence ends when its period ends; mining after that counts as mining without a licence. Confirm any renewal or extension with DMG, or close and restore the site within 6 months.`,
      kind === "mining" ? "mining-term" : "prospecting-term", [["rules", "Rule 43(cha)"], ["act", "Section 25(1)"], ["rules", "Rule 19(da)"]]]);
  } else if (p.to_date_ad) {
    const ext = isoOf(addMonths(p.to_date_ad, -3));
    const d = daysUntil(ext);
    if (d < 0) {
      rows.push(["bad", "Extension deadline has passed", `Apply at least 3 months before the end date (${esc(p.l_to_date)} B.S.); that was ${humanDays(d)} ago. Contact DMG now.`,
        kind === "mining" ? "mining-term" : "prospecting-term", R("rules", kind === "mining" ? "Rule 17(2)" : "Rule 9(2)")]);
    } else if (d <= 365) {
      rows.push(["warn", `Apply for extension by ${adLong(ext)}`, `${dueText(ext)} · 3 months before the term ends on ${esc(p.l_to_date)} B.S.${kind === "prospecting" ? " Or apply for the mining licence before expiry." : ""}`,
        kind === "mining" ? "mining-term" : "prospecting-term", R("rules", kind === "mining" ? "Rule 17(2)" : "Rule 9(2)")]);
    } else {
      rows.push(["ok", "Term running", `Extension application due by ${adLong(ext)} (3 months before ${esc(p.l_to_date)} B.S.).`,
        kind === "mining" ? "mining-term" : "prospecting-term", R("rules", kind === "mining" ? "Rule 17(2)" : "Rule 9(2)")]);
    }
  }

  // start-work deadline only for new licences: issued in the same or previous fiscal year as the start date
  const fromBS = +String(p.l_from_date || "").slice(0, 4);
  const isNew = p.issue_year_bs && fromBS && fromBS - p.issue_year_bs <= 1;
  if (p.from_date_ad && p.status === "Approved" && p._term !== "expired" && isNew) {
    const start = kind === "mining" ? addMonths(p.from_date_ad, 24) : addMonths(p.from_date_ad, 6);
    if (start > TODAY) {
      rows.push(["info", `Start ${kind === "mining" ? "mining" : "prospecting"} by ${adLong(isoOf(start))}`,
        `${dueText(isoOf(start))} · ${kind === "mining" ? "2 years" : "6 months"} from the licence date, or DMG can cancel it.`,
        kind === "mining" ? "start-mining" : "start-prospecting", R("rules", kind === "mining" ? "Rule 18(1)–(2)" : "Rule 10(1)–(2)")]);
    }
  }

  if (p.status === "Approved" && p._term !== "expired" && ld) {
    rows.push([daysUntil(ld.renewal.ad) <= 60 ? "warn" : "ok", `Renew and file the annual report by ${esc(ld.renewal.bs)} B.S.`,
      `${dueText(ld.renewal.ad)} · for FY ${esc(ld.renewal.for_fy)}. Not renewing is a ground for cancellation.`,
      "annual-renewal", [["rules", "Rule 42(1)"], ["rules", "Rule 45(2)–(3)"], ["rules", "Rule 43(ga)"]]]);
    if (kind === "mining" && daysUntil(ld.royalty.ad) >= 0) {
      rows.push(["info", `Royalty for month ${esc(ld.royalty.for_month)} by ${esc(ld.royalty.bs)} B.S.`,
        `${dueText(ld.royalty.ad)} · voucher with monthly production by ${esc(ld.voucher.bs)} B.S. Late: +10% / +20% / +30%.`,
        "monthly-royalty", [["rules", "Rule 21(2)–(3)"]]]);
    }
    if (kind === "prospecting" && p.from_date_ad) {
      let next = new Date(p.from_date_ad);
      while (next <= TODAY) next.setMonth(next.getMonth() + 5);
      rows.push(["info", `Next prospecting progress report around ${adLong(isoOf(next))}`, "Every 5 months during the licence.",
        "prospecting-report", R("rules", "Rule 45(1)")]);
    }
  }

  if (p.park) {
    rows.push(["bad", "Inside a national park or buffer zone", "Mining here needs separate approval, and the environmental study thresholds for conservation areas apply.",
      "env-study", [["epr", "Schedules 1–3"]]]);
  }
  if (p.chure_pct > 0) {
    rows.push(["warn", "In the Chure area", "Extra environmental protection applies. Check that your approved BES/IEE/EIA covers this part.",
      "env-study", [["epr", "Rule 3"], ["act", "Section 11A"]]]);
  }
  if (kind === "mining") {
    rows.push(["info", "Approved environmental study needed", "BES, IEE or EIA depending on daily output. Working without it: fine up to Rs 5 / 10 / 50 lakh.",
      "env-study", [["epr", "Rule 3"], ["epa", "Section 35(1)"]]]);
  }
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  return rows.sort((a, b) => order[a[0]] - order[b[0]]);
}

function lawChecklistHTML(p) {
  const rows = lawChecklist(p);
  if (!rows.length) return "";
  const icon = { bad: "!", warn: "!", info: "i", ok: "✓" };
  const urgent = rows.filter((r) => r[0] === "bad" || r[0] === "warn").length;
  return `<section class="card o2b"><div class="card-head"><h2>What the law requires now</h2>
      <span class="pill ${urgent ? "soon" : "st-Approved"}">${urgent ? `${urgent} need attention` : "Up to date"}</span></div>
    <ul class="checks">${rows.map(([s, t, w, id, refs]) => `<li class="${s === "info" ? "info" : s}"><span class="ic">${icon[s]}</span>
      <span>${t}<small>${w} <a href="#law=${id}">What the law says →</a></small><span class="refs">${lawRefs(refs)}</span></span></li>`).join("")}</ul>
    <p class="note">Plain-language guide, not legal advice. Dates are worked out from DMG's published dates; confirm with DMG.</p>
  </section>`;
}
