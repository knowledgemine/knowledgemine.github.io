/* Khani Insights — hisab-kitab: a khata-style book for mines (parties, sales, purchases, expenses,
   money in/out, stock) plus the mining parts (production, royalty, DMG filings) and reports.
   Depends on app.js, views.js and account.js (SB, ACC, B.S. calendar helpers, ROYALTY, rs, isAdmin). */
"use strict";

const HB = { tab: "home", fy: null, entryKind: "sale", party: null, data: null, month: "" };

const KIND = {
  sale: { label: "Sale", np: "बिक्री", sign: 1 }, purchase: { label: "Purchase", np: "खरिद", sign: -1 },
  expense: { label: "Expense", np: "खर्च", sign: -1 }, payment_in: { label: "Money in", np: "पैसा आयो", sign: 1 },
  payment_out: { label: "Money out", np: "पैसा गयो", sign: -1 },
};
const PARTY_KINDS = { buyer: "Buyer", supplier: "Supplier", worker: "Worker", other: "Other" };
const EXP_CATS = { wages: "Wages", fuel: "Fuel", machinery: "Machinery and repairs", explosives: "Explosives", transport: "Transport",
  fees_taxes: "Fees and taxes", land_rent: "Land rent", environment: "Environment work", office: "Office", other: "Other" };
const MODES = { cash: "Cash", bank: "Bank", cheque: "Cheque", wallet: "eSewa / Khalti", credit: "Credit (pay later)" };
const FILING_KINDS = { renewal: "Licence renewal", annual_report: "Annual report", prospecting_report: "Prospecting progress report",
  env_study: "BES / IEE / EIA approval", extension: "Term extension", other: "Other" };
const TABS = [["home", "Home"], ["entries", "Entries"], ["parties", "Parties"], ["stock", "Stock"], ["royalty", "Royalty"], ["filings", "Filings"], ["reports", "Reports"]];

/* ---------- data ---------- */
async function hbLoad() {
  const c = ACC.company.id;
  const q = (t, order) => SB.from(t).select("*").eq("company_id", c).order(order, { ascending: false });
  const [parties, entries, production, royalty, filings] = await Promise.all([
    SB.from("parties").select("*").eq("company_id", c).order("name"),
    q("entries", "entry_date"), q("production", "bs_month"), q("royalty_payments", "bs_month"), q("filings", "done_on"),
  ]);
  for (const r of [parties, entries, production, royalty, filings]) if (r.error) { toast(r.error.message); }
  HB.data = { parties: parties.data || [], entries: entries.data || [], production: production.data || [],
    royalty: royalty.data || [], filings: filings.data || [] };
  HB.data.partyById = Object.fromEntries(HB.data.parties.map((p) => [p.id, p]));
}

// + means the party owes us (पाउनु पर्ने); - means we owe them (दिनु पर्ने)
function entryEffect(e) {
  const unpaid = num(e.amount) - num(e.paid_now);
  switch (e.kind) {
    case "sale": return unpaid;
    case "payment_in": return -num(e.amount);
    case "purchase": case "expense": return -unpaid;
    case "payment_out": return num(e.amount);
    default: return 0;
  }
}
function cashEffect(e) {   // money actually moved
  switch (e.kind) {
    case "sale": return num(e.paid_now);
    case "payment_in": return num(e.amount);
    case "purchase": case "expense": return -num(e.paid_now);
    case "payment_out": return -num(e.amount);
    default: return 0;
  }
}
function partyBalances() {
  const bal = Object.fromEntries(HB.data.parties.map((p) => [p.id, num(p.opening_balance)]));
  for (const e of HB.data.entries) if (e.party_id && e.party_id in bal) bal[e.party_id] += entryEffect(e);
  return bal;
}
const adRangeOfFy = () => { const ms = fyMonths(HB.fy); return [BSCAL[ms[0]], BSCAL[nextBsMonth(ms[11])]]; };
const inFy = (iso) => { const [a, b] = adRangeOfFy(); return iso >= a && iso < b; };
const fyEntries = () => HB.data.entries.filter((e) => inFy(e.entry_date));
const fyMonthSet = () => new Set(fyMonths(HB.fy));

function stockRows() {
  const rows = {};
  const key = (l, m, u) => `${l}|${(m || "").trim()}|${u}`;
  const get = (l, m, u) => rows[key(l, m, u)] || (rows[key(l, m, u)] = { licence: l, mineral: (m || "").trim(), unit: u, produced: 0, sold: 0, fyProduced: 0, fySold: 0 });
  const fyM = fyMonthSet();
  for (const p of HB.data.production) {
    const r = get(p.licence_no, p.mineral, p.unit); r.produced += num(p.produced);
    if (fyM.has(p.bs_month)) r.fyProduced += num(p.produced);
  }
  for (const e of HB.data.entries) if (e.kind === "sale" && e.mineral && e.unit) {
    const r = get(e.licence_no || "—", e.mineral, e.unit); r.sold += num(e.quantity);
    if (inFy(e.entry_date)) r.fySold += num(e.quantity);
  }
  return Object.values(rows);
}

function unpaidRoyalty() {
  const today = isoDate(TODAY);
  const paid = new Set(HB.data.royalty.map((r) => `${r.licence_no}|${r.bs_month}`));
  const due = {};
  for (const p of HB.data.production) {
    const amt = num(p.taken_out) * num(p.royalty_rate);
    if (amt > 0) due[`${p.licence_no}|${p.bs_month}`] = (due[`${p.licence_no}|${p.bs_month}`] || 0) + amt;
  }
  return Object.entries(due).filter(([k]) => !paid.has(k)).map(([k, amt]) => {
    const [no, m] = k.split("|"); const d = royaltyDue(m)?.due;
    return { no, m, amt, due: d, late: d && d < today, pct: d ? surchargePct(m, today) : 0 };
  }).sort((a, b) => a.m.localeCompare(b.m));
}

/* ---------- shell ---------- */
async function renderHisab() {
  const out = $("hisab-out");
  if (!SB) { out.innerHTML = `<section class="card"><h2>Hisab-kitab needs an account</h2><p class="note">Accounts are not switched on in this copy of the app.</p></section>`; return; }
  if (!ACC.ready) { out.innerHTML = `<p class="hint">Loading…</p>`; return; }
  if (!ACC.user || !ACC.company) { out.innerHTML = `<section class="card"><h2>Sign in to keep hisab</h2><p class="note">Hisab-kitab is private to your company.</p><a class="btn" href="#account">Sign in or create account</a></section>`; return; }
  await loadBsCalendar();
  HB.fy = HB.fy || fiscalYearOf(currentBsMonth());
  const s = +fiscalYearOf(currentBsMonth()).slice(0, 4);
  const fys = [0, 1, 2, 3].map((i) => `${s - i}/${String((s - i + 1) % 100).padStart(2, "0")}`);
  out.innerHTML = `<div class="hisab-head">
      <h2>${esc(ACC.company.name)}</h2>
      <label for="hb-fy" class="sr">Fiscal year</label>
      <select id="hb-fy">${fys.map((f) => `<option value="${f}"${f === HB.fy ? " selected" : ""}>FY ${f}</option>`).join("")}</select>
    </div>
    <nav class="hb-tabs" aria-label="Hisab sections">${TABS.map(([k, l]) => `<button type="button" class="chip" data-tab="${k}" aria-pressed="${k === HB.tab}">${l}</button>`).join("")}</nav>
    <div id="hb-body"><p class="hint">Loading…</p></div>`;
  $("hb-fy").onchange = (e) => { HB.fy = e.target.value; hbShow(); };
  out.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { HB.tab = b.dataset.tab; HB.party = null; renderHisab(); }));
  await hbLoad();
  hbShow();
}
function hbShow() {
  ({ home: hbHome, entries: hbEntries, parties: hbParties, stock: hbStock, royalty: hbRoyalty, filings: hbFilings, reports: hbReports })[HB.tab]();
}
function hbGo(tab, opts = {}) { HB.tab = tab; Object.assign(HB, opts); renderHisab(); window.scrollTo(0, 0); }

const licOptions = (sel, blank) => (blank ? `<option value="">${blank}</option>` : "") + ACC.licences.map((l) => {
  const p = D.lic.find((x) => x.l_license_no === l.licence_no);
  return `<option value="${esc(l.licence_no)}"${l.licence_no === sel ? " selected" : ""}>${esc(l.licence_no)}${p ? ` · ${esc(p.mp_name || "")}` : ""}</option>`;
}).join("");
const partyOptions = (kinds, sel) => `<option value="">No party (cash)</option>` + HB.data.parties
  .filter((p) => kinds.includes(p.kind)).map((p) => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("") +
  `<option value="__new">+ New party…</option>`;
const bsOf = (iso) => (iso ? adToBs(iso) : "");
const dateCell = (iso) => `${esc(bsOf(iso))}<div class="sub">${adLong(iso)}</div>`;

function csvDownload(name, rows) {
  if (!rows.length) return toast("Nothing to export");
  const cols = Object.keys(rows[0]).filter((k) => !["id", "company_id", "created_by"].includes(k));
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function printHTML(html) {
  let el = $("print-area");
  if (!el) { el = document.createElement("div"); el.id = "print-area"; document.body.appendChild(el); }
  el.innerHTML = html;
  document.body.classList.add("printing");
  setTimeout(() => { window.print(); document.body.classList.remove("printing"); }, 50);
}
function bindDeletes(root, after) {
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async (ev) => {
    ev.stopPropagation();
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; return; }
    const [t, id] = b.dataset.del.split("|");
    const { error } = await SB.from(t).delete().eq("id", id);
    if (error) return toast(error.message);
    toast("Deleted"); await hbLoad(); after();
  }));
}

/* ---------- home ---------- */
function hbHome() {
  const bal = partyBalances();
  const recv = Object.values(bal).filter((v) => v > 0), pay = Object.values(bal).filter((v) => v < 0);
  const month = currentBsMonth();
  const mEntries = HB.data.entries.filter((e) => bsOf(e.entry_date).slice(0, 7) === month);
  const sales = mEntries.filter((e) => e.kind === "sale").reduce((a, e) => a + num(e.amount), 0);
  const cashIn = mEntries.reduce((a, e) => a + Math.max(0, cashEffect(e)), 0);
  const cashOut = mEntries.reduce((a, e) => a + Math.max(0, -cashEffect(e)), 0);
  const unpaid = unpaidRoyalty().filter((u) => u.late || u.due);
  const stock = stockRows().filter((r) => r.produced - r.sold > 0).slice(0, 4);
  $("hb-body").innerHTML = `
    <section class="khata-top">
      <button class="khata-card recv" type="button" data-goto="parties"><span class="np">पाउनु पर्ने</span><span class="lbl">To receive</span>
        <b>${rs(recv.reduce((a, v) => a + v, 0))}</b><span class="note">${recv.length} part${recv.length === 1 ? "y" : "ies"}</span></button>
      <button class="khata-card pay" type="button" data-goto="parties"><span class="np">दिनु पर्ने</span><span class="lbl">To pay</span>
        <b>${rs(-pay.reduce((a, v) => a + v, 0))}</b><span class="note">${pay.length} part${pay.length === 1 ? "y" : "ies"}</span></button>
    </section>
    <section class="quick" aria-label="Add">
      ${Object.entries(KIND).map(([k, v]) => `<button class="qbtn q-${k}" type="button" data-new="${k}"><span class="np">${v.np}</span>${v.label}</button>`).join("")}
      <button class="qbtn q-prod" type="button" data-goto="stock"><span class="np">उत्पादन</span>Production</button>
    </section>
    <section class="kpis">
      <div class="kpi"><div class="v">${rs(sales)}</div><div class="k">Sales in ${monthName(month)}</div><div class="d">बिक्री</div></div>
      <div class="kpi"><div class="v">${rs(cashIn)}</div><div class="k">Money in</div><div class="d">${monthName(month)}</div></div>
      <div class="kpi"><div class="v">${rs(cashOut)}</div><div class="k">Money out</div><div class="d">${monthName(month)}</div></div>
      <div class="kpi ${unpaid.some((u) => u.late) ? "bad" : unpaid.length ? "warn" : ""}"><div class="v">${rs(unpaid.reduce((a, u) => a + u.amt, 0))}</div>
        <div class="k">Royalty not yet paid</div><div class="d">${unpaid.length} month${unpaid.length === 1 ? "" : "s"} · rule 21</div></div>
    </section>
    ${unpaid.length ? `<section class="card warnbox"><div class="card-head"><h2>Royalty to pay</h2><button class="linkbtn" data-goto="royalty">Record payment →</button></div>
      <ul class="checks">${unpaid.slice(0, 6).map((u) => `<li class="${u.late ? "bad" : "warn"}"><span class="ic">!</span><span>${esc(u.no)} · ${monthName(u.m)}: ${rs(u.amt)} + 10% local fee
        <small>${u.due ? `${u.late ? "Was due" : "Due"} ${adLong(u.due)}.` : ""} ${u.pct ? `Paying today adds ${u.pct}% (${rs(u.amt * u.pct / 100)}).` : ""}</small></span></li>`).join("")}</ul></section>` : ""}
    ${stock.length ? `<section class="card"><div class="card-head"><h2>In stock</h2><button class="linkbtn" data-goto="stock">All stock →</button></div>
      <div class="stockchips">${stock.map((r) => `<span class="stockchip"><b>${fmt(r.produced - r.sold)} ${UNITS[r.unit] || r.unit}</b> ${esc(r.mineral)}<span class="note">${esc(r.licence)}</span></span>`).join("")}</div></section>` : ""}
    <section class="card"><div class="card-head"><h2>Recent entries</h2><button class="linkbtn" data-goto="entries">Day book →</button></div>
      ${entryList(HB.data.entries.slice(0, 8))}</section>`;
  hbBindCommon($("hb-body"), hbHome);
}
function hbBindCommon(root, after) {
  root.querySelectorAll("[data-goto]").forEach((b) => (b.onclick = () => hbGo(b.dataset.goto)));
  root.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => hbGo("entries", { entryKind: b.dataset.new, openForm: true })));
  root.querySelectorAll("[data-party]").forEach((b) => (b.onclick = () => hbGo("parties", { party: b.dataset.party })));
  root.querySelectorAll("[data-bill]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); printBill(b.dataset.bill); }));
  bindDeletes(root, after);
}

function entryList(list, withParty = true) {
  if (!list.length) return `<p class="note">No entries yet. Use the buttons above to add a sale, purchase, expense or payment.</p>`;
  return `<ul class="daybook">${list.map((e) => {
    const p = HB.data.partyById[e.party_id];
    const k = KIND[e.kind];
    const due = num(e.amount) - num(e.paid_now);
    const detail = e.kind === "sale" && e.quantity ? `${fmt(e.quantity)} ${UNITS[e.unit] || e.unit || ""} ${esc(e.mineral || "")} × ${rs(e.rate)}`
      : e.kind === "expense" ? EXP_CATS[e.category] || "Expense" : (e.note || "");
    return `<li class="db-row k-${e.kind}">
      <span class="db-date">${esc(bsOf(e.entry_date).slice(5))}<small>${esc(bsOf(e.entry_date).slice(0, 4))}</small></span>
      <span class="db-main"><span class="pill kpill">${k.label}</span>
        ${withParty && p ? `<button class="linkbtn" type="button" data-party="${p.id}">${esc(p.name)}</button>` : ""}
        <span class="sub">${detail}${e.bill_no ? ` · bill ${esc(e.bill_no)}` : ""}${["sale", "purchase", "expense"].includes(e.kind) && due > 0 ? ` · <b class="${e.kind === "sale" ? "t-recv" : "t-pay"}">${rs(due)} on credit</b>` : ""}</span></span>
      <span class="db-amt ${k.sign > 0 ? "t-recv" : "t-pay"}">${rs(e.amount)}</span>
      <span class="db-act">${e.kind === "sale" ? `<button class="linkbtn" type="button" data-bill="${e.id}">Bill</button>` : ""}
        ${isAdmin() ? `<button class="linkbtn" type="button" data-del="entries|${e.id}">Delete</button>` : ""}</span>
    </li>`;
  }).join("")}</ul>`;
}

/* ---------- entries ---------- */
function hbEntries() {
  const kind = HB.entryKind || "sale";
  const months = [...new Set(HB.data.entries.map((e) => bsOf(e.entry_date).slice(0, 7)))].sort().reverse();
  const filt = HB.data.entries.filter((e) => (!HB.month || bsOf(e.entry_date).slice(0, 7) === HB.month) && (!HB.kindFilter || e.kind === HB.kindFilter));
  const totIn = filt.reduce((a, e) => a + Math.max(0, cashEffect(e)), 0), totOut = filt.reduce((a, e) => a + Math.max(0, -cashEffect(e)), 0);
  $("hb-body").innerHTML = `
    <section class="card" id="en-card">
      <div class="seg entry-kinds" role="tablist">${Object.entries(KIND).map(([k, v]) => `<button type="button" class="seg-btn${k === kind ? " on" : ""}" data-kind="${k}" role="tab" aria-selected="${k === kind}">${v.label}<small>${v.np}</small></button>`).join("")}</div>
      <form id="en-form" class="form grid-form">${entryFields(kind)}</form>
    </section>
    <section class="card"><div class="card-head"><h2>Day book</h2>
      <span class="filters"><label for="en-m" class="sr">Month</label><select id="en-m"><option value="">All months</option>${months.map((m) => `<option value="${m}"${m === HB.month ? " selected" : ""}>${monthName(m)}</option>`).join("")}</select>
      <label for="en-k" class="sr">Type</label><select id="en-k"><option value="">All types</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === HB.kindFilter ? " selected" : ""}>${v.label}</option>`).join("")}</select></span></div>
      <p class="note">${filt.length} entries · money in ${rs(totIn)} · money out ${rs(totOut)}</p>
      ${entryList(filt)}
      <div class="rowbtns"><button class="btn ghost" type="button" id="en-csv">Download CSV</button></div></section>`;
  const f = $("en-form");
  $("en-card").querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => { HB.entryKind = b.dataset.kind; hbEntries(); }));
  $("en-m").onchange = (e) => { HB.month = e.target.value; hbEntries(); };
  $("en-k").onchange = (e) => { HB.kindFilter = e.target.value; hbEntries(); };
  $("en-csv").onclick = () => csvDownload(`daybook_${HB.month || "all"}.csv`, filt.map((e) => ({ date_bs: bsOf(e.entry_date), date_ad: e.entry_date, type: KIND[e.kind].label,
    party: HB.data.partyById[e.party_id]?.name || "", licence: e.licence_no || "", mineral: e.mineral || "", quantity: e.quantity ?? "", unit: e.unit || "",
    rate: e.rate ?? "", amount: e.amount, paid_now: e.paid_now, mode: e.mode, category: EXP_CATS[e.category] || "", bill_no: e.bill_no || "", note: e.note || "" })));
  bindEntryForm(f, kind, () => hbEntries());
  hbBindCommon($("hb-body"), hbEntries);
  if (HB.openForm) { HB.openForm = false; f.querySelector("input:not([type=hidden]), select")?.focus(); }
}

function entryFields(kind, preset = {}) {
  const buyerKinds = ["buyer", "other"], supplierKinds = ["supplier", "worker", "other"];
  const pk = kind === "sale" || kind === "payment_in" ? buyerKinds : supplierKinds;
  const isBill = ["sale", "purchase", "expense"].includes(kind);
  return `
    <div><label for="en-date">Date</label><input id="en-date" name="entry_date" type="date" required value="${preset.date || isoDate(TODAY)}"><span class="sub" id="en-bs"></span></div>
    <div><label for="en-party">${kind === "sale" || kind === "payment_in" ? "Buyer" : "Supplier / worker"}</label><select id="en-party" name="party_id">${partyOptions(pk, preset.party)}</select></div>
    <div class="wide newparty" id="en-newparty" hidden>
      <div><label for="np-name">New party name</label><input id="np-name"></div>
      <div><label for="np-phone">Phone</label><input id="np-phone" type="tel"></div>
    </div>
    ${kind === "sale" ? `
      <div><label for="en-lic">Licence</label><select id="en-lic" name="licence_no">${licOptions("", "Not from a licence")}</select></div>
      <div><label for="en-min">Mineral</label><input id="en-min" name="mineral" list="en-minlist"><datalist id="en-minlist">${Object.keys(ROYALTY).map((m) => `<option value="${m}">`).join("")}</datalist></div>
      <div><label for="en-unit">Unit</label><select id="en-unit" name="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="en-qty">Quantity</label><input id="en-qty" name="quantity" type="number" min="0" step="any" inputmode="decimal"><span class="sub" id="en-stock"></span></div>
      <div><label for="en-rate">Rate (Rs per unit)</label><input id="en-rate" name="rate" type="number" min="0" step="any" inputmode="decimal"></div>` : ""}
    ${kind === "purchase" || kind === "expense" ? `
      <div><label for="en-cat">Category</label><select id="en-cat" name="category">${Object.entries(EXP_CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="en-lic">Licence (optional)</label><select id="en-lic" name="licence_no">${licOptions("", "Whole company")}</select></div>` : ""}
    <div><label for="en-amt">${isBill ? "Bill total (Rs)" : "Amount (Rs)"}</label><input id="en-amt" name="amount" type="number" min="0" step="any" inputmode="decimal" required value="${preset.amount ?? ""}"></div>
    ${isBill ? `<div><label for="en-paid">${kind === "sale" ? "Received now" : "Paid now"} (Rs)</label><input id="en-paid" name="paid_now" type="number" min="0" step="any" inputmode="decimal"><span class="sub">Leave empty if paid in full</span></div>` : ""}
    <div><label for="en-mode">Mode</label><select id="en-mode" name="mode">${Object.entries(MODES).filter(([k]) => isBill || k !== "credit").map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
    <div><label for="en-bill">${isBill ? "Bill no." : "Reference"}</label><input id="en-bill" name="bill_no"></div>
    <div class="wide"><label for="en-note">Note</label><input id="en-note" name="note"></div>
    <div class="wide calc" id="en-calc"></div>
    <div class="wide"><button class="btn" type="submit">Save ${KIND[kind].label.toLowerCase()}</button></div>
    <p id="en-msg" class="msg wide" hidden></p>`;
}

function bindEntryForm(f, kind, after) {
  const isBill = ["sale", "purchase", "expense"].includes(kind);
  const showBs = () => ($("en-bs").textContent = f.entry_date.value ? `${bsOf(f.entry_date.value)} B.S.` : "");
  const stockOf = () => {
    if (kind !== "sale") return null;
    const r = stockRows().find((x) => x.licence === (f.licence_no.value || "—") && x.mineral.toLowerCase() === f.mineral.value.trim().toLowerCase() && x.unit === f.unit.value);
    return r ? r.produced - r.sold : null;
  };
  const calc = () => {
    if (kind === "sale" && f.quantity.value && f.rate.value && !f.amount.dataset.touched) f.amount.value = (num(f.quantity.value) * num(f.rate.value)).toFixed(2);
    const amt = num(f.amount.value);
    const paid = isBill ? (f.mode.value === "credit" ? 0 : f.paid_now.value === "" ? amt : num(f.paid_now.value)) : amt;
    const credit = isBill ? amt - paid : 0;
    const st = stockOf();
    if ($("en-stock")) $("en-stock").textContent = st == null ? "" : `In stock: ${fmt(st)} ${UNITS[f.unit.value]}`;
    $("en-calc").innerHTML = isBill
      ? `Total <b>${rs(amt)}</b> · ${kind === "sale" ? "received" : "paid"} now <b>${rs(paid)}</b>${credit > 0 ? ` · <b class="${kind === "sale" ? "t-recv" : "t-pay"}">${rs(credit)} on credit</b> ${kind === "sale" ? "(buyer owes you)" : "(you owe them)"}` : ""}`
      + (kind === "sale" && st != null && num(f.quantity.value) > st ? `<br><span class="bad">Selling more than recorded stock. Record this month's production in Stock.</span>` : "")
      : `${KIND[kind].label}: <b>${rs(amt)}</b>`;
  };
  f.entry_date.onchange = showBs; showBs();
  f.party_id.onchange = () => { $("en-newparty").hidden = f.party_id.value !== "__new"; };
  if (kind === "sale") {
    const fillMineral = () => {
      const p = D.lic.find((x) => x.l_license_no === f.licence_no.value);
      if (p && !f.mineral.dataset.touched) f.mineral.value = p.mp_name || "";
      const r = rateFor(f.mineral.value); if (r) f.unit.value = r[1];
      calc();
    };
    f.licence_no.onchange = fillMineral;
    f.mineral.oninput = () => { f.mineral.dataset.touched = "1"; fillMineral(); };
    for (const k of ["quantity", "rate", "unit"]) f[k].oninput = f[k].onchange = () => { delete f.amount.dataset.touched; calc(); };
    if (ACC.licences.length) { f.licence_no.value = ACC.licences[0].licence_no; fillMineral(); }
  }
  f.amount.oninput = () => { f.amount.dataset.touched = "1"; calc(); };
  if (isBill) { f.paid_now.oninput = calc; f.mode.onchange = calc; }
  calc();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f);
    const amt = num(v.amount);
    if (!(amt > 0)) return setMsg("en-msg", "Enter the amount.", true);
    let partyId = v.party_id || null;
    if (partyId === "__new") {
      const name = $("np-name").value.trim();
      if (!name) return setMsg("en-msg", "Enter the new party's name.", true);
      const row = await guard(SB.from("parties").insert({ company_id: ACC.company.id, name, phone: $("np-phone").value.trim() || null,
        kind: kind === "sale" || kind === "payment_in" ? "buyer" : kind === "expense" ? "worker" : "supplier" }).select().single(), "en-msg");
      partyId = row.id;
    }
    const paid = isBill ? (v.mode === "credit" ? 0 : v.paid_now === "" ? amt : Math.min(num(v.paid_now), amt)) : 0;
    if (isBill && paid < amt && !partyId) return setMsg("en-msg", "Choose a party for the amount on credit, so you can track it.", true);
    if (!isBill && !partyId) return setMsg("en-msg", `Choose who the money ${kind === "payment_in" ? "came from" : "went to"}.`, true);
    await guard(SB.from("entries").insert({
      company_id: ACC.company.id, kind, entry_date: v.entry_date, party_id: partyId, licence_no: v.licence_no || null,
      mineral: kind === "sale" ? (v.mineral || "").trim() || null : null, unit: kind === "sale" ? v.unit : null,
      quantity: kind === "sale" && v.quantity !== "" ? num(v.quantity) : null, rate: kind === "sale" && v.rate !== "" ? num(v.rate) : null,
      amount: amt, paid_now: isBill ? paid : 0, mode: v.mode, category: kind === "purchase" || kind === "expense" ? v.category : null,
      bill_no: v.bill_no || null, note: v.note || null }), "en-msg");
    toast(`${KIND[kind].label} saved`);
    await hbLoad(); after();
  };
}

function printBill(id) {
  const e = HB.data.entries.find((x) => x.id === id); if (!e) return;
  const p = HB.data.partyById[e.party_id]; const c = ACC.company;
  printHTML(`<div class="bill"><div class="bill-head"><div><h1>${esc(c.name)}</h1><p>${esc([c.address, c.phone && `Phone ${c.phone}`, c.pan && `PAN ${c.pan}`].filter(Boolean).join(" · "))}</p></div>
    <div class="bill-meta"><b>Sales bill</b><br>${e.bill_no ? `No. ${esc(e.bill_no)}<br>` : ""}Date ${esc(bsOf(e.entry_date))} B.S.<br>${adLong(e.entry_date)}</div></div>
    <p><b>To:</b> ${esc(p?.name || "Cash sale")}${p?.address ? `, ${esc(p.address)}` : ""}${p?.pan ? ` · PAN ${esc(p.pan)}` : ""}</p>
    <table><thead><tr><th>Item</th><th>Licence</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody><tr><td>${esc(e.mineral || "Mineral")}</td><td>${esc(e.licence_no || "")}</td><td class="num">${e.quantity != null ? `${fmt(e.quantity)} ${UNITS[e.unit] || ""}` : ""}</td>
      <td class="num">${e.rate != null ? rs(e.rate) : ""}</td><td class="num">${rs(e.amount)}</td></tr></tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="num">${rs(e.amount)}</td></tr><tr><td colspan="4">Received</td><td class="num">${rs(e.paid_now)}</td></tr>
      <tr><td colspan="4"><b>Balance due</b></td><td class="num"><b>${rs(num(e.amount) - num(e.paid_now))}</b></td></tr></tfoot></table>
    ${e.note ? `<p>${esc(e.note)}</p>` : ""}<p class="bill-foot">Made with Khani Insights</p></div>`);
}

/* ---------- parties ---------- */
function hbParties() {
  if (HB.party) return hbPartyLedger(HB.party);
  const bal = partyBalances();
  const list = HB.data.parties.slice().sort((a, b) => Math.abs(bal[b.id]) - Math.abs(bal[a.id]));
  $("hb-body").innerHTML = `
    <section class="card"><h2>Add a party</h2>
      <form id="pa-form" class="form grid-form">
        <div><label for="pa-name">Name</label><input id="pa-name" name="name" required></div>
        <div><label for="pa-kind">Type</label><select id="pa-kind" name="kind">${Object.entries(PARTY_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><label for="pa-phone">Phone</label><input id="pa-phone" name="phone" type="tel"></div>
        <div><label for="pa-pan">PAN</label><input id="pa-pan" name="pan"></div>
        <div><label for="pa-addr">Address</label><input id="pa-addr" name="address"></div>
        <div><label for="pa-open">Opening balance (Rs)</label><input id="pa-open" name="opening_balance" type="number" step="any" inputmode="decimal">
          <span class="sub">Positive: they owe you. Negative: you owe them.</span></div>
        <div class="wide"><button class="btn" type="submit">Add party</button></div>
        <p id="pa-msg" class="msg wide" hidden></p>
      </form></section>
    <section class="card"><h2>Parties (${list.length})</h2>
      ${list.length ? `<ul class="parties">${list.map((p) => {
        const b = bal[p.id];
        return `<li><button type="button" class="party-row" data-party="${p.id}"><span class="pr-name">${esc(p.name)}<small>${PARTY_KINDS[p.kind]}${p.phone ? ` · ${esc(p.phone)}` : ""}</small></span>
          <span class="pr-bal ${b > 0 ? "t-recv" : b < 0 ? "t-pay" : ""}">${b === 0 ? "Settled" : rs(Math.abs(b))}<small>${b > 0 ? "पाउनु पर्ने · to receive" : b < 0 ? "दिनु पर्ने · to pay" : ""}</small></span></button></li>`;
      }).join("")}</ul>` : `<p class="note">No parties yet. Add your buyers (crushers, factories, contractors) and suppliers (fuel, explosives, transport).</p>`}
    </section>`;
  $("pa-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await guard(SB.from("parties").insert({ company_id: ACC.company.id, name: v.name.trim(), kind: v.kind, phone: v.phone || null,
      pan: v.pan || null, address: v.address || null, opening_balance: num(v.opening_balance) }), "pa-msg");
    toast("Party added"); await hbLoad(); hbParties();
  };
  hbBindCommon($("hb-body"), hbParties);
}

function hbPartyLedger(id) {
  const p = HB.data.partyById[id];
  if (!p) { HB.party = null; return hbParties(); }
  const rows = HB.data.entries.filter((e) => e.party_id === id).slice().sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
  let run = num(p.opening_balance);
  const lines = rows.map((e) => { run += entryEffect(e); return { e, run }; });
  const bal = run;
  const msg = bal > 0
    ? `Namaste ${p.name}, as of ${bsOf(isoDate(TODAY))} B.S. your balance with ${ACC.company.name} is ${rs(bal)}. Please arrange payment. Thank you.`
    : "";
  const phone = String(p.phone || "").replace(/\D/g, "");
  const wa = phone ? `https://wa.me/${phone.length === 10 ? "977" + phone : phone}?text=${encodeURIComponent(msg)}` : "";
  $("hb-body").innerHTML = `
    <button class="linkbtn" type="button" id="pl-back">← All parties</button>
    <section class="card">
      <div class="card-head"><h2>${esc(p.name)}</h2><span class="pill type">${PARTY_KINDS[p.kind]}</span></div>
      <p class="note">${esc([p.phone, p.address, p.pan && `PAN ${p.pan}`].filter(Boolean).join(" · ") || "No contact details")}</p>
      <div class="khata-top single"><div class="khata-card ${bal > 0 ? "recv" : bal < 0 ? "pay" : ""}">
        <span class="np">${bal > 0 ? "पाउनु पर्ने" : bal < 0 ? "दिनु पर्ने" : "हिसाब मिलेको"}</span><span class="lbl">${bal > 0 ? "They owe you" : bal < 0 ? "You owe them" : "Settled"}</span><b>${rs(Math.abs(bal))}</b></div></div>
      <div class="rowbtns">
        <button class="btn" type="button" data-new2="${p.kind === "buyer" ? "payment_in" : "payment_out"}">${p.kind === "buyer" ? "+ Money received" : "+ Money paid"}</button>
        <button class="btn ghost" type="button" data-new2="${p.kind === "buyer" ? "sale" : "purchase"}">${p.kind === "buyer" ? "+ Sale" : "+ Purchase"}</button>
        ${bal > 0 && wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener">Send reminder on WhatsApp</a>` : ""}
        ${bal > 0 ? `<button class="btn ghost" type="button" id="pl-copy">Copy reminder</button>` : ""}
        <button class="btn ghost" type="button" id="pl-print">Print statement</button>
      </div>
    </section>
    <section class="card"><h2>Ledger</h2>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Date (B.S.)</th><th>Entry</th><th class="num">They owe +</th><th class="num">You owe +</th><th class="num">Balance</th></tr></thead><tbody>
        <tr><td></td><td>Opening balance</td><td class="num"></td><td class="num"></td><td class="num">${rs(p.opening_balance)}</td></tr>
        ${lines.map(({ e, run }) => { const eff = entryEffect(e); return `<tr><td>${dateCell(e.entry_date)}</td>
          <td>${KIND[e.kind].label}${e.bill_no ? ` · ${esc(e.bill_no)}` : ""}${e.kind === "sale" && e.quantity ? `<div class="sub">${fmt(e.quantity)} ${UNITS[e.unit] || ""} ${esc(e.mineral || "")}</div>` : ""}</td>
          <td class="num">${eff > 0 ? rs(eff) : ""}</td><td class="num">${eff < 0 ? rs(-eff) : ""}</td>
          <td class="num ${run > 0 ? "t-recv" : run < 0 ? "t-pay" : ""}">${rs(run)}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="note">Balance above zero: they owe you. Below zero: you owe them. Cash paid at the time of a bill does not change the balance.</p></section>
    ${isAdmin() ? `<button class="linkbtn danger" type="button" data-del="parties|${p.id}">Delete this party</button>` : ""}`;
  $("pl-back").onclick = () => { HB.party = null; hbParties(); };
  $("hb-body").querySelectorAll("[data-new2]").forEach((b) => (b.onclick = () => {
    HB.entryKind = b.dataset.new2; HB.tab = "entries"; renderHisab().then(() => { const s = $("en-party"); if (s) { s.value = p.id; } });
  }));
  if ($("pl-copy")) $("pl-copy").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Reminder copied"); } catch { toast("Copy was blocked by the browser"); } };
  $("pl-print").onclick = () => printHTML(`<div class="bill"><div class="bill-head"><div><h1>${esc(ACC.company.name)}</h1><p>Statement of account</p></div>
      <div class="bill-meta"><b>${esc(p.name)}</b><br>As of ${esc(bsOf(isoDate(TODAY)))} B.S.</div></div>
      <table><thead><tr><th>Date (B.S.)</th><th>Entry</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>
      <tr><td></td><td>Opening balance</td><td></td><td class="num">${rs(p.opening_balance)}</td></tr>
      ${lines.map(({ e, run }) => `<tr><td>${esc(bsOf(e.entry_date))}</td><td>${KIND[e.kind].label}${e.bill_no ? ` ${esc(e.bill_no)}` : ""}</td><td class="num">${rs(e.amount)}</td><td class="num">${rs(run)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="3"><b>${bal >= 0 ? "Amount due to us" : "Amount we owe"}</b></td><td class="num"><b>${rs(Math.abs(bal))}</b></td></tr></tfoot></table>
      <p class="bill-foot">Made with Khani Insights</p></div>`);
  bindDeletes($("hb-body"), () => { HB.party = null; hbParties(); });
}

/* ---------- stock and production ---------- */
function hbStock() {
  const rows = stockRows();
  const prod = HB.data.production.filter((p) => fyMonthSet().has(p.bs_month));
  const lastMonth = prevBsMonth(currentBsMonth());
  const months = fyMonths(HB.fy);
  const defMonth = months.includes(lastMonth) ? lastMonth : months[0];
  $("hb-body").innerHTML = `
    <section class="card"><h2>Stock <span class="np">मौज्दात</span></h2>
      ${rows.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Licence</th><th>Mineral</th><th class="num">Produced (FY)</th><th class="num">Sold (FY)</th><th class="num">In stock now</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono">${esc(r.licence)}</td><td>${esc(r.mineral)}</td><td class="num">${fmt(r.fyProduced)} ${UNITS[r.unit] || r.unit}</td>
        <td class="num">${fmt(r.fySold)}</td><td class="num ${r.produced - r.sold < 0 ? "t-pay" : ""}">${fmt(r.produced - r.sold)} ${UNITS[r.unit] || r.unit}</td></tr>`).join("")}
      </tbody></table></div><p class="note">Stock = all production recorded minus all quantities sold. Sales are entered under Entries → Sale.</p>`
        : `<p class="note">Record production below; stock goes down automatically when you enter a sale.</p>`}</section>
    <section class="card"><h2>Record monthly production</h2>
      <p class="note">One row per licence, month and mineral. Royalty is due on the quantity taken out through the mine gate (rule 21).</p>
      <form id="pr-form" class="form grid-form">
        <div><label for="pr-lic">Licence</label><select id="pr-lic" name="licence_no">${licOptions()}</select></div>
        <div><label for="pr-month">Month (B.S.)</label><select id="pr-month" name="bs_month">${months.map((m) => `<option value="${m}"${m === defMonth ? " selected" : ""}>${monthName(m)}</option>`).join("")}</select></div>
        <div><label for="pr-min">Mineral</label><input id="pr-min" name="mineral" required list="pr-minlist"><datalist id="pr-minlist">${Object.keys(ROYALTY).map((m) => `<option value="${m}">`).join("")}</datalist></div>
        <div><label for="pr-unit">Unit</label><select id="pr-unit" name="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><label for="pr-prod">Produced</label><input id="pr-prod" name="produced" type="number" min="0" step="any" inputmode="decimal"></div>
        <div><label for="pr-out">Taken out of mine gate</label><input id="pr-out" name="taken_out" type="number" min="0" step="any" inputmode="decimal" required></div>
        <div><label for="pr-rate">Royalty rate (Rs per unit)</label><input id="pr-rate" name="royalty_rate" type="number" min="0" step="any" inputmode="decimal"></div>
        <div class="wide"><label for="pr-note">Note</label><input id="pr-note" name="note"></div>
        <div class="wide calc" id="pr-calc"></div>
        <div class="wide"><button class="btn" type="submit">Save month</button> <span class="note">Saving the same licence, month and mineral again updates it.</span></div>
        <p id="pr-msg" class="msg wide" hidden></p>
      </form></section>
    <section class="card"><h2>Production in FY ${HB.fy}</h2>
      ${prod.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Month</th><th>Licence</th><th>Mineral</th><th class="num">Produced</th><th class="num">Taken out</th><th class="num">Royalty</th>${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>
        ${prod.map((p) => `<tr><td>${monthName(p.bs_month)}</td><td class="mono">${esc(p.licence_no)}</td><td>${esc(p.mineral)}</td>
          <td class="num">${fmt(p.produced)} ${UNITS[p.unit] || p.unit}</td><td class="num">${fmt(p.taken_out)}</td><td class="num">${rs(num(p.taken_out) * num(p.royalty_rate))}</td>
          ${isAdmin() ? `<td><button class="linkbtn" data-del="production|${p.id}">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`
        : `<p class="note">Nothing recorded for FY ${HB.fy} yet.</p>`}</section>`;
  const f = $("pr-form");
  const fill = () => {
    const p = D.lic.find((x) => x.l_license_no === f.licence_no.value);
    if (p && !f.mineral.dataset.touched) f.mineral.value = p.mp_name || "";
    const r = rateFor(f.mineral.value);
    if (r && !f.royalty_rate.dataset.touched) { f.royalty_rate.value = r[0]; f.unit.value = r[1]; }
    calc();
  };
  const calc = () => {
    const roy = num(f.taken_out.value) * num(f.royalty_rate.value);
    const d = royaltyDue(f.bs_month.value); const r = rateFor(f.mineral.value);
    $("pr-calc").innerHTML = `Royalty <b>${rs(roy)}</b> + local development fee (10%) <b>${rs(roy * 0.1)}</b> = <b>${rs(roy * 1.1)}</b>
      ${d ? `· deposit by <b>${adLong(d.due)}</b> (${adToBs(d.due)} B.S.), voucher by ${adLong(d.voucher)}` : ""}
      <br><span class="note">${r ? `Schedule 10 rate for ${esc(f.mineral.value)}: Rs ${r[0]} per ${UNITS[r[1]]}.` : "No Schedule 10 rate found for this mineral: enter the rate DMG charges you."} Rates can change by gazette notice.</span>`;
  };
  f.mineral.oninput = () => { f.mineral.dataset.touched = "1"; fill(); };
  f.royalty_rate.oninput = () => { f.royalty_rate.dataset.touched = "1"; calc(); };
  f.licence_no.onchange = () => { delete f.mineral.dataset.touched; delete f.royalty_rate.dataset.touched; fill(); };
  for (const k of ["taken_out", "bs_month"]) f[k].oninput = f[k].onchange = calc;
  fill();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f);
    await guard(SB.from("production").upsert({ company_id: ACC.company.id, licence_no: v.licence_no, bs_month: v.bs_month, mineral: v.mineral.trim(),
      unit: v.unit, produced: num(v.produced), taken_out: num(v.taken_out), royalty_rate: v.royalty_rate === "" ? null : num(v.royalty_rate),
      note: v.note || null, updated_at: new Date().toISOString() }, { onConflict: "company_id,licence_no,bs_month,mineral" }), "pr-msg");
    toast(`Saved ${monthName(v.bs_month)}`); await hbLoad(); hbStock();
  };
  bindDeletes($("hb-body"), hbStock);
}

/* ---------- royalty ---------- */
function hbRoyalty() {
  const rows = HB.data.royalty.filter((r) => fyMonthSet().has(r.bs_month));
  const unpaid = unpaidRoyalty();
  const months = fyMonths(HB.fy);
  const first = unpaid[0];
  $("hb-body").innerHTML = `
    ${unpaid.length ? `<section class="card warnbox"><h2>Not yet recorded as paid</h2><ul class="checks">${unpaid.map((u) => `<li class="${u.late ? "bad" : "warn"}"><span class="ic">!</span>
      <span>${esc(u.no)} · ${monthName(u.m)}: ${rs(u.amt)} + ${rs(u.amt * 0.1)} local fee<small>${u.due ? `${u.late ? "Was due" : "Due"} ${adLong(u.due)}.` : ""} ${u.pct ? `Paying today adds ${u.pct}% surcharge (rule 21(3)).` : ""}</small></span></li>`).join("")}</ul></section>` : ""}
    <section class="card"><h2>Record a royalty payment</h2>
      <form id="ry-form" class="form grid-form">
        <div><label for="ry-lic">Licence</label><select id="ry-lic" name="licence_no">${licOptions(first?.no)}</select></div>
        <div><label for="ry-month">For month (B.S.)</label><select id="ry-month" name="bs_month">${[...new Set([...(first ? [first.m] : []), ...months])].map((m) => `<option value="${m}"${m === first?.m ? " selected" : ""}>${monthName(m)}</option>`).join("")}</select></div>
        <div><label for="ry-roy">Royalty (Rs)</label><input id="ry-roy" name="royalty" type="number" min="0" step="any" inputmode="decimal" required></div>
        <div><label for="ry-fee">Local development fee (Rs)</label><input id="ry-fee" name="local_fee" type="number" min="0" step="any" inputmode="decimal"></div>
        <div><label for="ry-paid">Paid on</label><input id="ry-paid" name="paid_on" type="date" required value="${isoDate(TODAY)}"></div>
        <div><label for="ry-sur">Late surcharge (Rs)</label><input id="ry-sur" name="surcharge" type="number" min="0" step="any" inputmode="decimal"></div>
        <div><label for="ry-vno">Voucher no.</label><input id="ry-vno" name="voucher_no"></div>
        <div><label for="ry-vsub">Voucher given to DMG on</label><input id="ry-vsub" name="voucher_submitted_on" type="date"></div>
        <div class="wide calc" id="ry-calc"></div>
        <div class="wide"><button class="btn" type="submit">Save payment</button></div>
        <p id="ry-msg" class="msg wide" hidden></p>
      </form></section>
    <section class="card"><h2>Payments in FY ${HB.fy}</h2>
      ${rows.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>For month</th><th>Licence</th><th class="num">Royalty</th><th class="num">Local fee</th><th class="num">Surcharge</th><th>Paid</th><th>Voucher</th>${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${monthName(r.bs_month)}</td><td class="mono">${esc(r.licence_no)}</td><td class="num">${rs(r.royalty)}</td><td class="num">${rs(r.local_fee)}</td>
          <td class="num">${rs(r.surcharge)}</td><td>${dateCell(r.paid_on)}</td><td>${esc(r.voucher_no || "")}</td>
          ${isAdmin() ? `<td><button class="linkbtn" data-del="royalty_payments|${r.id}">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`
        : `<p class="note">No payments recorded for FY ${HB.fy}.</p>`}</section>`;
  const f = $("ry-form");
  const suggest = () => {
    const due = HB.data.production.filter((p) => p.licence_no === f.licence_no.value && p.bs_month === f.bs_month.value)
      .reduce((a, p) => a + num(p.taken_out) * num(p.royalty_rate), 0);
    if (!f.royalty.dataset.touched) f.royalty.value = due ? due.toFixed(2) : "";
    if (!f.local_fee.dataset.touched) f.local_fee.value = due ? (due * 0.1).toFixed(2) : "";
    const pct = surchargePct(f.bs_month.value, f.paid_on.value);
    if (!f.surcharge.dataset.touched) f.surcharge.value = pct ? (num(f.royalty.value) * pct / 100).toFixed(2) : "0";
    const d = royaltyDue(f.bs_month.value);
    $("ry-calc").innerHTML = `${due ? `Recorded production gives royalty <b>${rs(due)}</b>. ` : "No production recorded for this month. "}
      ${d ? `Due by <b>${adLong(d.due)}</b>. ` : ""}${pct ? `<span class="bad">Paid late: ${pct}% surcharge (rule 21(3)).</span>` : "On time: no surcharge."}`;
  };
  for (const k of ["royalty", "local_fee", "surcharge"]) f[k].oninput = () => { f[k].dataset.touched = "1"; if (k === "royalty") suggest(); };
  for (const k of ["licence_no", "bs_month", "paid_on"]) f[k].onchange = () => { delete f.royalty.dataset.touched; delete f.local_fee.dataset.touched; delete f.surcharge.dataset.touched; suggest(); };
  suggest();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(f);
    await guard(SB.from("royalty_payments").insert({ company_id: ACC.company.id, licence_no: v.licence_no, bs_month: v.bs_month,
      royalty: num(v.royalty), local_fee: num(v.local_fee), surcharge: num(v.surcharge), paid_on: v.paid_on,
      voucher_no: v.voucher_no || null, voucher_submitted_on: v.voucher_submitted_on || null }), "ry-msg");
    toast("Payment saved"); await hbLoad(); hbRoyalty();
  };
  bindDeletes($("hb-body"), hbRoyalty);
}

/* ---------- filings ---------- */
function hbFilings() {
  const rows = HB.data.filings.filter((r) => inFy(r.done_on) || r.fiscal_year === HB.fy);
  const done = (kind) => new Set(HB.data.filings.filter((f) => f.kind === kind && f.fiscal_year === HB.fy).map((f) => f.licence_no));
  const ren = done("renewal"), rep = done("annual_report");
  $("hb-body").innerHTML = `
    <section class="card"><h2>FY ${HB.fy} checklist</h2>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Licence</th><th>Renewal</th><th>Annual report</th></tr></thead><tbody>
      ${ACC.licences.map((l) => `<tr><td class="mono">${esc(l.licence_no)}</td>
        <td>${ren.has(l.licence_no) ? `<span class="pill st-Approved">Done</span>` : `<span class="pill soon">Not recorded</span>`}</td>
        <td>${rep.has(l.licence_no) ? `<span class="pill st-Approved">Done</span>` : `<span class="pill soon">Not recorded</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="note">Both are due within 3 months after the fiscal year ends, i.e. by the end of Ashwin (rules 42 and 45). <a href="#law=annual-renewal">What the law says →</a></p></section>
    <section class="card"><h2>Record a filing</h2>
      <form id="fi-form" class="form grid-form">
        <div><label for="fi-lic">Licence</label><select id="fi-lic" name="licence_no">${licOptions()}</select></div>
        <div><label for="fi-kind">What</label><select id="fi-kind" name="kind">${Object.entries(FILING_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div><label for="fi-fy">For fiscal year</label><input id="fi-fy" name="fiscal_year" value="${HB.fy}" pattern="\\d{4}/\\d{2}"></div>
        <div><label for="fi-date">Done on</label><input id="fi-date" name="done_on" type="date" required value="${isoDate(TODAY)}"></div>
        <div><label for="fi-ref">Receipt / letter no.</label><input id="fi-ref" name="reference"></div>
        <div class="wide"><label for="fi-note">Note</label><input id="fi-note" name="note"></div>
        <div class="wide"><button class="btn" type="submit">Save filing</button></div>
        <p id="fi-msg" class="msg wide" hidden></p>
      </form></section>
    <section class="card"><h2>Filings</h2>
      ${rows.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Date</th><th>Licence</th><th>What</th><th>FY</th><th>Reference</th>${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${dateCell(r.done_on)}</td><td class="mono">${esc(r.licence_no)}</td><td>${FILING_KINDS[r.kind] || r.kind}</td><td>${esc(r.fiscal_year || "")}</td><td>${esc(r.reference || "")}</td>
          ${isAdmin() ? `<td><button class="linkbtn" data-del="filings|${r.id}">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`
        : `<p class="note">Nothing recorded for FY ${HB.fy}.</p>`}</section>`;
  $("fi-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await guard(SB.from("filings").insert({ company_id: ACC.company.id, licence_no: v.licence_no, kind: v.kind, fiscal_year: v.fiscal_year || null,
      done_on: v.done_on, reference: v.reference || null, note: v.note || null }), "fi-msg");
    toast("Filing saved"); await hbLoad(); hbFilings();
  };
  bindDeletes($("hb-body"), hbFilings);
}

/* ---------- reports ---------- */
function hbReports() {
  const es = fyEntries();
  const sum = (k, f = (e) => num(e.amount)) => es.filter((e) => e.kind === k).reduce((a, e) => a + f(e), 0);
  const sales = sum("sale"), purchases = sum("purchase");
  const expByCat = {};
  for (const e of es.filter((x) => x.kind === "expense")) expByCat[e.category || "other"] = (expByCat[e.category || "other"] || 0) + num(e.amount);
  const expenses = Object.values(expByCat).reduce((a, v) => a + v, 0);
  const roy = HB.data.royalty.filter((r) => fyMonthSet().has(r.bs_month)).reduce((a, r) => a + num(r.royalty) + num(r.local_fee) + num(r.surcharge), 0);
  const profit = sales - purchases - expenses - roy;
  const bal = partyBalances();
  const recv = HB.data.parties.filter((p) => bal[p.id] > 0).sort((a, b) => bal[b.id] - bal[a.id]);
  const pay = HB.data.parties.filter((p) => bal[p.id] < 0).sort((a, b) => bal[a.id] - bal[b.id]);
  const cashIn = es.reduce((a, e) => a + Math.max(0, cashEffect(e)), 0), cashOut = es.reduce((a, e) => a + Math.max(0, -cashEffect(e)), 0) + roy;
  // annual production (Schedule 9 style): production from the production table, sales from entries
  const ann = {};
  for (const p of HB.data.production.filter((x) => fyMonthSet().has(x.bs_month))) {
    const k = `${p.licence_no}|${p.mineral}|${p.unit}`;
    (ann[k] = ann[k] || { no: p.licence_no, mineral: p.mineral, unit: p.unit, produced: 0, sold: 0, value: 0 }).produced += num(p.produced);
  }
  for (const e of es.filter((x) => x.kind === "sale" && x.mineral)) {
    const k = `${e.licence_no || "—"}|${e.mineral}|${e.unit}`;
    const r = ann[k] = ann[k] || { no: e.licence_no || "—", mineral: e.mineral, unit: e.unit, produced: 0, sold: 0, value: 0 };
    r.sold += num(e.quantity); r.value += num(e.amount);
  }
  const plHTML = `<table class="tbl"><tbody>
      <tr><td>Sales <span class="np">बिक्री</span></td><td class="num">${rs(sales)}</td></tr>
      <tr><td>Purchases <span class="np">खरिद</span></td><td class="num">− ${rs(purchases)}</td></tr>
      ${Object.entries(expByCat).map(([k, v]) => `<tr><td>Expense: ${EXP_CATS[k] || k}</td><td class="num">− ${rs(v)}</td></tr>`).join("")}
      <tr><td>Royalty, local fee and surcharge paid</td><td class="num">− ${rs(roy)}</td></tr>
      <tr class="total"><td><b>${profit >= 0 ? "Profit" : "Loss"}</b> <span class="np">${profit >= 0 ? "नाफा" : "घाटा"}</span></td><td class="num"><b class="${profit >= 0 ? "t-recv" : "t-pay"}">${rs(Math.abs(profit))}</b></td></tr>
    </tbody></table>`;
  $("hb-body").innerHTML = `
    <section class="card"><div class="card-head"><h2>Profit and loss · FY ${HB.fy}</h2><button class="ghost" type="button" id="rp-pl">Print</button></div>
      <div class="tablewrap">${plHTML}</div>
      <p class="note">Simple cash-style view from your entries: sales billed, purchases and expenses billed, and royalty paid. Not a substitute for audited accounts.</p></section>
    <section class="card"><h2>Cash flow · FY ${HB.fy}</h2>
      <div class="kpis two"><div class="kpi"><div class="v t-recv">${rs(cashIn)}</div><div class="k">Money in</div></div>
        <div class="kpi"><div class="v t-pay">${rs(cashOut)}</div><div class="k">Money out (incl. royalty)</div></div></div></section>
    <div class="grid2">
      <section class="card"><h2>To receive <span class="np">पाउनु पर्ने</span></h2>${recv.length ? `<ul class="parties">${recv.map((p) => `<li><button type="button" class="party-row" data-party="${p.id}"><span class="pr-name">${esc(p.name)}</span><span class="pr-bal t-recv">${rs(bal[p.id])}</span></button></li>`).join("")}</ul>` : `<p class="note">Nobody owes you.</p>`}</section>
      <section class="card"><h2>To pay <span class="np">दिनु पर्ने</span></h2>${pay.length ? `<ul class="parties">${pay.map((p) => `<li><button type="button" class="party-row" data-party="${p.id}"><span class="pr-name">${esc(p.name)}</span><span class="pr-bal t-pay">${rs(-bal[p.id])}</span></button></li>`).join("")}</ul>` : `<p class="note">You owe nobody.</p>`}</section>
    </div>
    <section class="card"><div class="card-head"><h2>Annual production report · FY ${HB.fy}</h2><button class="ghost" type="button" id="rp-ann">Print</button></div>
      <p class="note">Totals for Schedule 9 of the Mines and Minerals Rules 2056, due by the end of Ashwin (rule 45(2)). Check against DMG's current form.</p>
      <div class="tablewrap" id="rp-ann-table"><table class="tbl"><thead><tr><th>Licence</th><th>Mineral</th><th class="num">Produced</th><th class="num">Sold</th><th class="num">Sales value</th><th class="num">Stock change</th></tr></thead><tbody>
        ${Object.values(ann).map((r) => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.mineral)}</td><td class="num">${fmt(r.produced)} ${UNITS[r.unit] || r.unit || ""}</td>
          <td class="num">${fmt(r.sold)}</td><td class="num">${rs(r.value)}</td><td class="num">${fmt(r.produced - r.sold)}</td></tr>`).join("") || `<tr><td colspan="6" class="sub">No production or sales recorded for this year.</td></tr>`}
      </tbody></table></div></section>
    <section class="card"><h2>Download</h2><div class="rowbtns">
      <button class="btn ghost" type="button" id="rp-csv-e">Day book (CSV)</button>
      <button class="btn ghost" type="button" id="rp-csv-p">Production (CSV)</button>
      <button class="btn ghost" type="button" id="rp-csv-r">Royalty payments (CSV)</button>
      <button class="btn ghost" type="button" id="rp-csv-pa">Party balances (CSV)</button></div></section>`;
  const fyTag = HB.fy.replace("/", "-");
  $("rp-pl").onclick = () => printHTML(`<div class="bill"><div class="bill-head"><div><h1>${esc(ACC.company.name)}</h1><p>Profit and loss · FY ${HB.fy}</p></div></div>${plHTML}<p class="bill-foot">Made with Khani Insights</p></div>`);
  $("rp-ann").onclick = () => printHTML(`<div class="bill"><div class="bill-head"><div><h1>${esc(ACC.company.name)}</h1><p>Annual production report · FY ${HB.fy}</p></div></div>${$("rp-ann-table").innerHTML}<p class="bill-foot">Made with Khani Insights</p></div>`);
  $("rp-csv-e").onclick = () => csvDownload(`daybook_${fyTag}.csv`, es.map((e) => ({ date_bs: bsOf(e.entry_date), date_ad: e.entry_date, type: KIND[e.kind].label,
    party: HB.data.partyById[e.party_id]?.name || "", licence: e.licence_no || "", mineral: e.mineral || "", quantity: e.quantity ?? "", unit: e.unit || "",
    rate: e.rate ?? "", amount: e.amount, paid_now: e.paid_now, mode: e.mode, category: EXP_CATS[e.category] || "", bill_no: e.bill_no || "", note: e.note || "" })));
  $("rp-csv-p").onclick = () => csvDownload(`production_${fyTag}.csv`, HB.data.production.filter((p) => fyMonthSet().has(p.bs_month)));
  $("rp-csv-r").onclick = () => csvDownload(`royalty_${fyTag}.csv`, HB.data.royalty.filter((r) => fyMonthSet().has(r.bs_month)));
  $("rp-csv-pa").onclick = () => csvDownload(`party_balances.csv`, HB.data.parties.map((p) => ({ name: p.name, type: PARTY_KINDS[p.kind], phone: p.phone || "",
    balance: bal[p.id], meaning: bal[p.id] > 0 ? "they owe us" : bal[p.id] < 0 ? "we owe them" : "settled" })));
  hbBindCommon($("hb-body"), hbReports);
}
