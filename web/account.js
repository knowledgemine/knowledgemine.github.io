/* Khani Insights — accounts (Supabase auth), company, team, licences, and hisab-kitab.
   Depends on app.js (D, META, $, esc, fmt, title, toast, humanDays, TODAY) and views.js (pcard, licLink). */
"use strict";

const CFG = window.KHANI_CONFIG || {};
const SB = CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const ACC = { user: null, companies: [], company: null, role: null, licences: [], ready: false };
const COMPANY_KEY = "khani.company.v1";

/* ---------- B.S. calendar (month starts in A.D., built by dmg-gis web) ---------- */
let BSCAL = null, BSKEYS = [];
async function loadBsCalendar() {
  if (BSCAL) return;
  try { BSCAL = await (await fetch("data/bs_calendar.json")).json(); BSKEYS = Object.keys(BSCAL).sort(); }
  catch { BSCAL = {}; }
}
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function adToBs(iso) {
  let k = null;
  for (const key of BSKEYS) { if (BSCAL[key] <= iso) k = key; else break; }
  if (!k) return "";
  const day = Math.round((new Date(iso) - new Date(BSCAL[k])) / 864e5) + 1;
  return `${k}-${String(day).padStart(2, "0")}`;
}
function nextBsMonth(m) { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; }
function prevBsMonth(m) { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; }
function royaltyDue(bsMonth) {   // rule 21(2): deposit within 7 days after the month ends, voucher within 15
  const start = BSCAL[nextBsMonth(bsMonth)];
  if (!start) return null;
  const d = new Date(start);
  const due = new Date(d); due.setDate(due.getDate() + 6);
  const voucher = new Date(d); voucher.setDate(voucher.getDate() + 14);
  return { due: isoDate(due), voucher: isoDate(voucher) };
}
function surchargePct(bsMonth, paidIso) {   // rule 21(3)
  const dd = royaltyDue(bsMonth);
  if (!dd || !paidIso || paidIso <= dd.due) return 0;
  const due = new Date(dd.due);
  const m3 = new Date(due); m3.setMonth(m3.getMonth() + 3);
  const m6 = new Date(due); m6.setMonth(m6.getMonth() + 6);
  const paid = new Date(paidIso);
  return paid <= m3 ? 10 : paid <= m6 ? 20 : 30;
}
const todayBs = () => adToBs(isoDate(TODAY));
const currentBsMonth = () => todayBs().slice(0, 7);
function fiscalYearOf(bsMonth) {   // FY starts in Shrawan (month 4)
  const [y, m] = bsMonth.split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${s}/${String((s + 1) % 100).padStart(2, "0")}`;
}
function fyMonths(fy) {
  const s = +fy.slice(0, 4), out = [];
  for (let i = 0; i < 12; i++) { const m = ((3 + i) % 12) + 1; out.push(`${m >= 4 ? s : s + 1}-${String(m).padStart(2, "0")}`); }
  return out;
}
const BS_MONTHS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
const monthName = (bm) => bm ? `${BS_MONTHS[+bm.slice(5, 7) - 1]} ${bm.slice(0, 4)}` : "";
const rs = (n) => `Rs ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ---------- Schedule 10 royalty rates (2072 gazette revision); editable per entry ---------- */
const ROYALTY = {
  Limestone: [60, "tonne"], Dolomite: [50, "tonne"], Calcite: [60, "tonne"], Talc: [100, "tonne"], Salt: [5, "tonne"],
  Ochre: [25, "tonne"], Quartz: [100, "tonne"], "Silica sand": [50, "tonne"], Magnesite: [75, "tonne"], Mica: [1000, "tonne"],
  Coal: [175, "tonne"], Lignite: [20, "tonne"], Clay: [35, "m3"], Soil: [25, "m3"], Stone: [25, "m3"], Slate: [5, "m2"],
  Aggregate: [60, "m3"], Sand: [20, "m3"], Gravel: [15, "m3"], Granite: [2140, "m3"], Marble: [2140, "m3"],
  Gold: [100, "gram"], Silver: [500, "kg"], Copper: [5, "kg"], Zinc: [3, "kg"], Lead: [1, "kg"], Iron: [40, "tonne"],
};
const UNITS = { tonne: "tonne", m3: "m³", kg: "kg", gram: "gram", m2: "m²" };
const rateFor = (mineral) => ROYALTY[Object.keys(ROYALTY).find((k) => k.toLowerCase() === String(mineral || "").toLowerCase())] || null;

/* ---------- small helpers ---------- */
function setMsg(id, text, bad = false) {
  const el = $(id); if (!el) return;
  el.hidden = !text; el.textContent = text || ""; el.classList.toggle("bad", bad);
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
const num = (v) => (v === "" || v == null ? 0 : Number(v));
async function guard(promise, msgId) {
  const { data, error } = await promise;
  if (error) { setMsg(msgId, error.message, true); error.__shown = true; throw error; }
  return data;
}
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.__shown) e.preventDefault(); });
const isAdmin = () => ACC.role === "owner" || ACC.role === "admin";

/* ================= session ================= */
async function initAccounts() {
  document.querySelectorAll("[data-acc-link]").forEach((a) => (a.hidden = !SB));
  if (!SB) return;
  await loadBsCalendar();
  const { data } = await SB.auth.getSession();
  await onSession(data.session);
  SB.auth.onAuthStateChange((_e, session) => {
    if ((session?.user?.id || null) !== (ACC.user?.id || null)) onSession(session);
  });
}

async function onSession(session) {
  ACC.user = session?.user || null;
  ACC.companies = []; ACC.company = null; ACC.role = null; ACC.licences = [];
  if (ACC.user) {
    try { await SB.rpc("accept_invites"); } catch { /* not fatal */ }
    await loadCompanies();
  }
  ACC.ready = true;
  updateAccountBadge();
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("account")) renderAccount();
  if (h.startsWith("hisab")) renderHisab();
  if (h.startsWith("overview") || !h) renderAccountHome();
}

async function loadCompanies() {
  const { data, error } = await SB.from("company_members").select("role, companies(id, name, pan, address, phone)")
    .eq("user_id", ACC.user.id);
  if (error) { toast(error.message); return; }
  ACC.companies = (data || []).filter((r) => r.companies).map((r) => ({ ...r.companies, role: r.role }));
  let pick = null;
  try { pick = localStorage.getItem(COMPANY_KEY); } catch { /* ignore */ }
  const c = ACC.companies.find((x) => x.id === pick) || ACC.companies[0] || null;
  await selectCompany(c);
}

async function selectCompany(c) {
  ACC.company = c; ACC.role = c?.role || null; ACC.licences = [];
  if (!c) return;
  try { localStorage.setItem(COMPANY_KEY, c.id); } catch { /* ignore */ }
  const { data } = await SB.from("company_licences").select("licence_no, note, added_at").eq("company_id", c.id).order("added_at");
  ACC.licences = data || [];
}

function updateAccountBadge() {
  const a = $("acc-link"); if (!a) return;
  a.textContent = ACC.user ? (ACC.company?.name || "My account") : "Sign in";
  a.classList.toggle("signed", !!ACC.user);
}

/* ================= account page ================= */
function renderAccount() {
  const out = $("acc-out");
  if (!SB) {
    out.innerHTML = `<section class="card"><h2>Accounts are not switched on yet</h2>
      <p class="note">This copy of the app has no account server configured. Everything else works without an account.</p></section>`;
    return;
  }
  if (!ACC.ready) { out.innerHTML = `<p class="hint">Loading…</p>`; return; }
  if (!ACC.user) return renderSignIn(out);
  if (!ACC.company) return renderNewCompany(out);
  renderCompany(out);
}

function renderSignIn(out, mode = "signin") {
  const signup = mode === "signup";
  out.innerHTML = `<section class="card auth-card">
    <h2>${signup ? "Create your account" : "Sign in"}</h2>
    <p class="note">${signup ? "One account per person. You can then create your company or join one you are invited to." : "Use the email and password you signed up with."}</p>
    <form id="auth-form" class="form" novalidate>
      ${signup ? `<label for="au-name">Full name</label><input id="au-name" name="name" autocomplete="name" required>` : ""}
      <label for="au-email">Email</label>
      <input id="au-email" name="email" type="email" autocomplete="email" inputmode="email" required>
      <label for="au-pass">Password</label>
      <input id="au-pass" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required>
      ${signup ? `<p class="note">At least 8 characters.</p>` : ""}
      <button class="btn" type="submit">${signup ? "Create account" : "Sign in"}</button>
      <p id="au-msg" class="msg" hidden></p>
    </form>
    <div class="auth-alt">
      ${signup ? `<button class="linkbtn" type="button" data-mode="signin">I already have an account</button>`
               : `<button class="linkbtn" type="button" data-mode="signup">Create an account</button>
                  <button class="linkbtn" type="button" id="au-forgot">Forgot password?</button>`}
    </div></section>`;
  out.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => renderSignIn(out, b.dataset.mode)));
  const forgot = $("au-forgot");
  if (forgot) forgot.onclick = async () => {
    const email = $("au-email").value.trim();
    if (!email) return setMsg("au-msg", "Enter your email first, then tap Forgot password.", true);
    const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#account=reset` });
    setMsg("au-msg", error ? error.message : "We sent a password reset link to your email.", !!error);
  };
  $("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.email || !f.password || f.password.length < 8) return setMsg("au-msg", "Enter your email and a password of at least 8 characters.", true);
    setMsg("au-msg", signup ? "Creating your account…" : "Signing in…");
    if (signup) {
      const { data, error } = await SB.auth.signUp({ email: f.email, password: f.password,
        options: { data: { full_name: f.name || "" }, emailRedirectTo: `${location.origin}${location.pathname}#account` } });
      if (error) return setMsg("au-msg", error.message, true);
      if (!data.session) return setMsg("au-msg", `Check ${f.email} for a confirmation link, then come back and sign in.`);
    } else {
      const { error } = await SB.auth.signInWithPassword({ email: f.email, password: f.password });
      if (error) return setMsg("au-msg", error.message === "Invalid login credentials" ? "Email or password is wrong." : error.message, true);
    }
  };
}

function renderNewCompany(out) {
  out.innerHTML = `${userBar()}
    <section class="card"><h2>Create your company</h2>
      <p class="note">If your company already uses Khani Insights, ask its owner to invite ${esc(ACC.user.email)} instead.</p>
      <form id="co-form" class="form">${companyFields({})}
        <button class="btn" type="submit">Create company</button><p id="co-msg" class="msg" hidden></p></form></section>`;
  bindUserBar();
  $("co-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if ((f.name || "").trim().length < 2) return setMsg("co-msg", "Enter the company name.", true);
    const row = await guard(SB.from("companies").insert({ name: f.name.trim(), pan: f.pan || null, address: f.address || null, phone: f.phone || null })
      .select().single(), "co-msg");
    await loadCompanies();
    await selectCompany({ ...row, role: "owner" });
    await offerSavedLicences();
    updateAccountBadge(); renderAccount(); toast("Company created");
  };
}

function companyFields(c) {
  return `<label for="co-name">Company name</label><input id="co-name" name="name" required value="${esc(c.name || "")}">
    <div class="row2"><div><label for="co-pan">PAN / VAT no.</label><input id="co-pan" name="pan" value="${esc(c.pan || "")}"></div>
    <div><label for="co-phone">Phone</label><input id="co-phone" name="phone" type="tel" value="${esc(c.phone || "")}"></div></div>
    <label for="co-addr">Address</label><input id="co-addr" name="address" value="${esc(c.address || "")}">`;
}

function userBar() {
  const opts = ACC.companies.map((c) => `<option value="${c.id}"${c.id === ACC.company?.id ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  return `<section class="userbar">
    <span>Signed in as <b>${esc(ACC.user.email)}</b></span>
    ${ACC.companies.length > 1 ? `<label for="co-pick" class="sr">Company</label><select id="co-pick">${opts}</select>` : ""}
    <button class="ghost" type="button" id="acc-out-btn">Sign out</button></section>`;
}
function bindUserBar() {
  $("acc-out-btn").onclick = async () => { await SB.auth.signOut(); toast("Signed out"); };
  const pick = $("co-pick");
  if (pick) pick.onchange = async () => { await selectCompany(ACC.companies.find((c) => c.id === pick.value)); updateAccountBadge(); renderAccount(); };
}

async function offerSavedLicences() {
  const saved = (typeof getSaved === "function" ? getSaved() : []).filter((no) => !ACC.licences.some((l) => l.licence_no === no));
  if (!saved.length || !ACC.company) return;
  await SB.from("company_licences").insert(saved.map((no) => ({ company_id: ACC.company.id, licence_no: no })));
  await selectCompany(ACC.company);
  toast(`Added ${saved.length} saved licence${saved.length > 1 ? "s" : ""} to ${ACC.company.name}`);
}

async function renderCompany(out) {
  const c = ACC.company;
  const lic = ACC.licences.map((l) => D.lic.find((p) => p.l_license_no === l.licence_no) || { l_license_no: l.licence_no, _missing: true });
  out.innerHTML = `${userBar()}
    <section class="card">
      <div class="card-head"><h2>${esc(c.name)}</h2><span class="pill type">${esc(ACC.role)}</span></div>
      <p class="note">${esc([c.pan && `PAN ${c.pan}`, c.address, c.phone].filter(Boolean).join(" · ") || "No details yet")}</p>
      <div class="rowbtns"><a class="btn" href="#hisab">Open hisab-kitab</a>
        ${isAdmin() ? `<button class="btn ghost" type="button" id="co-edit">Edit details</button>` : ""}
        <button class="btn ghost" type="button" id="co-new">New company</button></div>
      <form id="co-form" class="form" hidden>${companyFields(c)}<button class="btn" type="submit">Save</button><p id="co-msg" class="msg" hidden></p></form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Licences (${lic.length})</h2><span class="note">Shared with everyone in the company</span></div>
      <form id="cl-form" class="searchrow inline">
        <label for="cl-no" class="sr">Licence number</label>
        <input id="cl-no" type="search" list="lic-list" placeholder="Add a licence number" autocomplete="off">
        <button class="btn" type="submit">Add</button></form>
      <p id="cl-msg" class="msg" hidden></p>
      <div class="portfolio">${lic.map((p) => p._missing
        ? `<div class="pcard"><span class="no">${esc(p.l_license_no)}</span><span class="meta">Not in DMG's current list</span>${isAdmin() ? `<button class="linkbtn" data-rm="${esc(p.l_license_no)}">Remove</button>` : ""}</div>`
        : `<div class="pwrap">${pcard(p)}${isAdmin() ? `<button class="linkbtn" data-rm="${esc(p.l_license_no)}">Remove</button>` : ""}</div>`).join("")
        || `<p class="note">No licences yet. Add your licence numbers to see their deadlines and keep hisab for them.</p>`}</div>
    </section>
    <section class="card" id="team-card"><h2>Team</h2><p class="hint">Loading…</p></section>`;
  bindUserBar();
  $("co-new").onclick = () => renderNewCompany(out);
  if ($("co-edit")) $("co-edit").onclick = () => ($("co-form").hidden = !$("co-form").hidden);
  $("co-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const row = await guard(SB.from("companies").update({ name: f.name.trim(), pan: f.pan || null, address: f.address || null, phone: f.phone || null })
      .eq("id", c.id).select().single(), "co-msg");
    Object.assign(ACC.company, row); updateAccountBadge(); renderAccount(); toast("Saved");
  };
  $("cl-form").onsubmit = async (e) => {
    e.preventDefault();
    const no = $("cl-no").value.trim();
    if (!no) return;
    const p = D.lic.find((x) => x.l_license_no.toLowerCase() === no.toLowerCase());
    if (!p) return setMsg("cl-msg", `“${no}” is not in DMG's list. Check the number as written on the licence.`, true);
    await guard(SB.from("company_licences").upsert({ company_id: c.id, licence_no: p.l_license_no }), "cl-msg");
    await selectCompany(c); renderAccount(); toast("Licence added");
  };
  out.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    await SB.from("company_licences").delete().eq("company_id", c.id).eq("licence_no", b.dataset.rm);
    await selectCompany(c); renderAccount();
  }));
  renderTeam();
}

async function renderTeam() {
  const c = ACC.company;
  const [{ data: members }, { data: invites }] = await Promise.all([
    SB.from("company_members").select("user_id, role, email").eq("company_id", c.id).order("added_at"),
    isAdmin() ? SB.from("company_invites").select("id, email, role").eq("company_id", c.id) : Promise.resolve({ data: [] }),
  ]);
  const el = $("team-card"); if (!el) return;
  el.innerHTML = `<h2>Team</h2>
    <ul class="team">${(members || []).map((m) => `<li><span>${esc(m.email || "member")}${m.user_id === ACC.user.id ? " (you)" : ""}</span>
      <span class="pill type">${esc(m.role)}</span>
      ${isAdmin() && m.role !== "owner" && m.user_id !== ACC.user.id ? `<button class="linkbtn" data-rmm="${m.user_id}">Remove</button>` : ""}</li>`).join("")}
      ${(invites || []).map((i) => `<li><span>${esc(i.email)} <span class="note">invited, not signed in yet</span></span>
        <span class="pill type">${esc(i.role)}</span><button class="linkbtn" data-rmi="${i.id}">Cancel</button></li>`).join("")}</ul>
    ${isAdmin() ? `<form id="inv-form" class="searchrow inline">
        <label for="inv-email" class="sr">Email to invite</label><input id="inv-email" type="email" placeholder="colleague@example.com" required>
        <label for="inv-role" class="sr">Role</label><select id="inv-role"><option value="staff">Staff</option><option value="admin">Admin</option></select>
        <button class="btn" type="submit">Invite</button></form>
      <p class="note">They join automatically when they sign in with this email. Staff can add and view records; admins can also delete records and manage the team.</p>
      <p id="inv-msg" class="msg" hidden></p>` : ""}`;
  if ($("inv-form")) $("inv-form").onsubmit = async (e) => {
    e.preventDefault();
    await guard(SB.from("company_invites").insert({ company_id: c.id, email: $("inv-email").value.trim().toLowerCase(), role: $("inv-role").value }), "inv-msg");
    toast("Invite added. Ask them to sign up with that email."); renderTeam();
  };
  el.querySelectorAll("[data-rmm]").forEach((b) => (b.onclick = async () => {
    await SB.from("company_members").delete().eq("company_id", c.id).eq("user_id", b.dataset.rmm); renderTeam();
  }));
  el.querySelectorAll("[data-rmi]").forEach((b) => (b.onclick = async () => {
    await SB.from("company_invites").delete().eq("id", b.dataset.rmi); renderTeam();
  }));
}

/* Home: company licences replace device-saved ones when signed in */
function renderAccountHome() {
  if (!SB || !ACC.user || !ACC.company || !ACC.licences.length) return;
  const el = $("saved-home"); if (!el) return;
  const list = ACC.licences.map((l) => D.lic.find((p) => p.l_license_no === l.licence_no)).filter(Boolean)
    .sort((a, b) => (a._days ?? 1e9) - (b._days ?? 1e9));
  el.hidden = false;
  el.innerHTML = `<div class="card-head"><h2>${esc(ACC.company.name)} · licences (${list.length})</h2><a href="#hisab" class="note">Hisab-kitab →</a></div>
    <div class="portfolio">${list.map(pcard).join("")}</div>`;
}

/* ================= hisab-kitab ================= */
let HISAB_TAB = "summary";
let HISAB_FY = null;

async function renderHisab() {
  const out = $("hisab-out");
  if (!SB) { out.innerHTML = `<section class="card"><h2>Hisab-kitab needs an account</h2><p class="note">Accounts are not switched on in this copy of the app.</p></section>`; return; }
  if (!ACC.ready) { out.innerHTML = `<p class="hint">Loading…</p>`; return; }
  if (!ACC.user || !ACC.company) { out.innerHTML = `<section class="card"><h2>Sign in to keep hisab</h2><p class="note">Hisab-kitab is private to your company.</p><a class="btn" href="#account">Sign in or create account</a></section>`; return; }
  await loadBsCalendar();
  HISAB_FY = HISAB_FY || fiscalYearOf(currentBsMonth());
  const fys = [];
  for (let i = 0; i < 4; i++) { const s = +HISAB_FY.slice(0, 4); fys.push(`${s + 1 - i}/${String((s + 2 - i) % 100).padStart(2, "0")}`); }
  const tabs = [["summary", "Summary"], ["production", "Production"], ["royalty", "Royalty"], ["expenses", "Expenses"], ["filings", "Filings"]];
  out.innerHTML = `<div class="hisab-head">
      <h2>${esc(ACC.company.name)}</h2>
      <label for="hb-fy" class="sr">Fiscal year</label>
      <select id="hb-fy">${fys.map((f) => `<option${f === HISAB_FY ? " selected" : ""}>${f}</option>`).join("")}</select>
    </div>
    <div class="seg hisab-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="seg-btn${k === HISAB_TAB ? " on" : ""}" role="tab" aria-selected="${k === HISAB_TAB}" data-tab="${k}">${l}</button>`).join("")}</div>
    <div id="hb-body"><p class="hint">Loading…</p></div>`;
  $("hb-fy").onchange = (e) => { HISAB_FY = e.target.value; renderHisab(); };
  out.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { HISAB_TAB = b.dataset.tab; renderHisab(); }));
  if (!ACC.licences.length) {
    $("hb-body").innerHTML = `<section class="card"><p>Add your licences on the <a href="#account">account page</a> first.</p></section>`;
    return;
  }
  ({ summary: hisabSummary, production: hisabProduction, royalty: hisabRoyalty, expenses: hisabExpenses, filings: hisabFilings })[HISAB_TAB]();
}

const licOptions = (sel) => ACC.licences.map((l) => {
  const p = D.lic.find((x) => x.l_license_no === l.licence_no);
  return `<option value="${esc(l.licence_no)}"${l.licence_no === sel ? " selected" : ""}>${esc(l.licence_no)}${p ? ` · ${esc(p.mp_name || "")}` : ""}</option>`;
}).join("");
const monthOptions = (sel) => fyMonths(HISAB_FY).map((m) => `<option value="${m}"${m === sel ? " selected" : ""}>${monthName(m)}</option>`).join("");
const fyRange = () => { const ms = fyMonths(HISAB_FY); return [ms[0], ms[11]]; };
const adRangeOfFy = () => { const ms = fyMonths(HISAB_FY); return [BSCAL[ms[0]], BSCAL[nextBsMonth(ms[11])]]; };

async function fetchFy(table, dateCol = "bs_month") {
  const c = ACC.company.id;
  let q = SB.from(table).select("*").eq("company_id", c);
  if (dateCol === "bs_month") { const [a, b] = fyRange(); q = q.gte("bs_month", a).lte("bs_month", b); }
  else { const [a, b] = adRangeOfFy(); if (a && b) q = q.gte(dateCol, a).lt(dateCol, b); }
  const { data, error } = await q;
  if (error) { toast(error.message); return []; }
  return data || [];
}

function csvDownload(name, rows) {
  if (!rows.length) return toast("Nothing to export");
  const cols = Object.keys(rows[0]).filter((k) => !["id", "company_id", "created_by"].includes(k));
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function hisabSummary() {
  const [prod, roy, exp, fil] = await Promise.all([fetchFy("production"), fetchFy("royalty_payments"), fetchFy("expenses", "spent_on"), fetchFy("filings", "done_on")]);
  const byLic = {};
  for (const l of ACC.licences) byLic[l.licence_no] = { due: 0, paid: 0, produced: {}, sales: 0, unpaid: [] };
  for (const p of prod) {
    const s = byLic[p.licence_no] || (byLic[p.licence_no] = { due: 0, paid: 0, produced: {}, sales: 0, unpaid: [] });
    const r = num(p.taken_out) * num(p.royalty_rate);
    s.due += r * 1.1;                          // royalty + 10% local development fee
    s.produced[p.unit] = (s.produced[p.unit] || 0) + num(p.produced);
    s.sales += num(p.sale_value);
    s.months = s.months || {}; s.months[p.bs_month] = (s.months[p.bs_month] || 0) + r;
  }
  for (const r of roy) {
    const s = byLic[r.licence_no]; if (!s) continue;
    s.paid += num(r.royalty) + num(r.local_fee) + num(r.surcharge);
    s.paidMonths = s.paidMonths || new Set(); s.paidMonths.add(r.bs_month);
  }
  const today = isoDate(TODAY);
  for (const s of Object.values(byLic)) {
    for (const [m, amt] of Object.entries(s.months || {})) {
      const due = royaltyDue(m)?.due;
      if (amt > 0 && !(s.paidMonths && s.paidMonths.has(m)) && due && due < today) s.unpaid.push({ m, amt, pct: surchargePct(m, today) });
    }
  }
  const totalExp = exp.reduce((a, e) => a + num(e.amount), 0);
  const totalSales = Object.values(byLic).reduce((a, s) => a + s.sales, 0);
  const totalDue = Object.values(byLic).reduce((a, s) => a + s.due, 0);
  const totalPaid = Object.values(byLic).reduce((a, s) => a + s.paid, 0);
  const unpaid = Object.entries(byLic).flatMap(([no, s]) => s.unpaid.map((u) => ({ no, ...u })));
  const filedRenewal = new Set(fil.filter((f) => f.kind === "renewal").map((f) => f.licence_no));
  const filedReport = new Set(fil.filter((f) => f.kind === "annual_report").map((f) => f.licence_no));

  $("hb-body").innerHTML = `
    <section class="kpis">
      <div class="kpi"><div class="v">${rs(totalSales)}</div><div class="k">Sales</div><div class="d">FY ${HISAB_FY}</div></div>
      <div class="kpi"><div class="v">${rs(totalDue)}</div><div class="k">Royalty + local fee due</div><div class="d">From recorded mine-gate quantities</div></div>
      <div class="kpi ${totalPaid + 1 < totalDue ? "warn" : ""}"><div class="v">${rs(totalPaid)}</div><div class="k">Paid</div><div class="d">Including surcharge</div></div>
      <div class="kpi"><div class="v">${rs(totalExp)}</div><div class="k">Expenses</div><div class="d">${rs(totalSales - totalExp)} sales minus expenses</div></div>
    </section>
    ${unpaid.length ? `<section class="card warnbox"><h2>Royalty not recorded as paid (${unpaid.length})</h2>
      <ul class="checks">${unpaid.map((u) => `<li class="bad"><span class="ic">!</span><span>${esc(u.no)} · ${monthName(u.m)}: ${rs(u.amt)} royalty
        <small>Due ${adLong(royaltyDue(u.m).due)}. Paying today adds ${u.pct}% (${rs(u.amt * u.pct / 100)}). Rule 21(3).</small></span></li>`).join("")}</ul></section>` : ""}
    <section class="card"><h2>By licence</h2><div class="tablewrap"><table class="tbl">
      <thead><tr><th>Licence</th><th class="num">Produced</th><th class="num">Sales</th><th class="num">Due</th><th class="num">Paid</th><th>Filed this FY</th></tr></thead><tbody>
      ${Object.entries(byLic).map(([no, s]) => `<tr><td class="mono">${esc(no)}</td>
        <td class="num">${Object.entries(s.produced).map(([u, q]) => `${fmt(q)} ${UNITS[u] || u}`).join("<br>") || "—"}</td>
        <td class="num">${rs(s.sales)}</td><td class="num">${rs(s.due)}</td><td class="num">${rs(s.paid)}</td>
        <td>${filedRenewal.has(no) ? `<span class="pill st-Approved">Renewal</span>` : `<span class="pill soon">Renewal</span>`}
            ${filedReport.has(no) ? `<span class="pill st-Approved">Annual report</span>` : `<span class="pill soon">Annual report</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="note">Due = mine-gate quantity × royalty rate, plus the 10% local development fee (rules 21–22). Green = recorded in Filings for FY ${HISAB_FY}.</p>
      <div class="rowbtns"><button class="btn ghost" type="button" id="hb-annual">Annual production report (Schedule 9 style)</button>
        <button class="btn ghost" type="button" id="hb-csv">Download all FY data (CSV)</button></div></section>
    <section class="card" id="hb-annual-out" hidden></section>`;
  $("hb-csv").onclick = () => { csvDownload(`production_${HISAB_FY.replace("/", "-")}.csv`, prod); if (roy.length) csvDownload(`royalty_${HISAB_FY.replace("/", "-")}.csv`, roy); if (exp.length) csvDownload(`expenses_${HISAB_FY.replace("/", "-")}.csv`, exp); };
  $("hb-annual").onclick = () => {
    const el = $("hb-annual-out"); el.hidden = false;
    const rows = {};
    for (const p of prod) {
      const k = `${p.licence_no}|${p.mineral}|${p.unit}`;
      const r = rows[k] || (rows[k] = { no: p.licence_no, mineral: p.mineral, unit: p.unit, produced: 0, dom: 0, exp: 0, val: 0 });
      r.produced += num(p.produced); r.dom += num(p.sold_domestic); r.exp += num(p.sold_export); r.val += num(p.sale_value);
    }
    el.innerHTML = `<div class="card-head"><h2>Annual production report · FY ${HISAB_FY}</h2><button class="ghost" type="button" onclick="window.print()">Print</button></div>
      <p class="note">${esc(ACC.company.name)}. Totals for Schedule 9 of the Mines and Minerals Rules 2056; due by the end of Ashwin (rule 45(2)). Check against DMG's current form.</p>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Licence</th><th>Mineral</th><th>Unit</th><th class="num">Produced</th><th class="num">Sold in Nepal</th><th class="num">Exported</th><th class="num">Sales value</th><th class="num">Stock change</th></tr></thead><tbody>
      ${Object.values(rows).map((r) => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.mineral)}</td><td>${UNITS[r.unit] || r.unit}</td>
        <td class="num">${fmt(r.produced)}</td><td class="num">${fmt(r.dom)}</td><td class="num">${fmt(r.exp)}</td><td class="num">${rs(r.val)}</td>
        <td class="num">${fmt(r.produced - r.dom - r.exp)}</td></tr>`).join("") || `<tr><td colspan="8" class="sub">No production recorded for this year.</td></tr>`}
      </tbody></table></div>`;
    el.scrollIntoView({ behavior: "smooth" });
  };
}

function recordList(rows, cols, table) {
  if (!rows.length) return `<p class="note">Nothing recorded for FY ${HISAB_FY} yet.</p>`;
  return `<div class="tablewrap"><table class="tbl"><thead><tr>${cols.map(([, h, cls]) => `<th class="${cls || ""}">${h}</th>`).join("")}${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${cols.map(([k, , cls, f]) => `<td class="${cls || ""}">${f ? f(r[k], r) : esc(r[k] ?? "")}</td>`).join("")}
      ${isAdmin() ? `<td><button class="linkbtn" data-del="${table}|${r.id}">Delete</button></td>` : ""}</tr>`).join("")}
    </tbody></table></div>`;
}
function bindDeletes(after) {
  $("hb-body").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; return; }
    const [t, id] = b.dataset.del.split("|");
    const { error } = await SB.from(t).delete().eq("id", id);
    if (error) return toast(error.message);
    toast("Deleted"); after();
  }));
}

async function hisabProduction() {
  const rows = (await fetchFy("production")).sort((a, b) => b.bs_month.localeCompare(a.bs_month));
  const lastMonth = prevBsMonth(currentBsMonth());
  const defMonth = fyMonths(HISAB_FY).includes(lastMonth) ? lastMonth : fyMonths(HISAB_FY)[0];
  $("hb-body").innerHTML = `<section class="card"><h2>Record monthly production</h2>
    <form id="pr-form" class="form grid-form">
      <div><label for="pr-lic">Licence</label><select id="pr-lic" name="licence_no">${licOptions()}</select></div>
      <div><label for="pr-month">Month (B.S.)</label><select id="pr-month" name="bs_month">${monthOptions(defMonth)}</select></div>
      <div><label for="pr-min">Mineral</label><input id="pr-min" name="mineral" required></div>
      <div><label for="pr-unit">Unit</label><select id="pr-unit" name="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="pr-prod">Produced</label><input id="pr-prod" name="produced" type="number" min="0" step="any" inputmode="decimal"></div>
      <div><label for="pr-out">Taken out of mine gate</label><input id="pr-out" name="taken_out" type="number" min="0" step="any" inputmode="decimal" required></div>
      <div><label for="pr-dom">Sold in Nepal</label><input id="pr-dom" name="sold_domestic" type="number" min="0" step="any" inputmode="decimal"></div>
      <div><label for="pr-exp">Exported</label><input id="pr-exp" name="sold_export" type="number" min="0" step="any" inputmode="decimal"></div>
      <div><label for="pr-val">Sales value (Rs)</label><input id="pr-val" name="sale_value" type="number" min="0" step="any" inputmode="decimal"></div>
      <div><label for="pr-rate">Royalty rate (Rs per unit)</label><input id="pr-rate" name="royalty_rate" type="number" min="0" step="any" inputmode="decimal"></div>
      <div class="wide"><label for="pr-note">Note</label><input id="pr-note" name="note"></div>
      <div class="wide calc" id="pr-calc"></div>
      <div class="wide"><button class="btn" type="submit">Save month</button> <span class="note">Saving the same licence, month and mineral again updates it.</span></div>
      <p id="pr-msg" class="msg wide" hidden></p>
    </form></section>
    <section class="card"><div class="card-head"><h2>Recorded</h2></div>${recordList(rows, [
      ["bs_month", "Month", "", (v) => monthName(v)], ["licence_no", "Licence", "mono"], ["mineral", "Mineral"],
      ["taken_out", "Taken out", "num", (v, r) => `${fmt(v)} ${UNITS[r.unit] || r.unit}`],
      ["royalty_rate", "Royalty", "num", (v, r) => rs(num(r.taken_out) * num(v))], ["sale_value", "Sales", "num", (v) => rs(v)],
    ], "production")}</section>`;
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
    const d = royaltyDue(f.bs_month.value);
    const r = rateFor(f.mineral.value);
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
    const row = { company_id: ACC.company.id, licence_no: v.licence_no, bs_month: v.bs_month, mineral: v.mineral.trim(), unit: v.unit,
      produced: num(v.produced), taken_out: num(v.taken_out), sold_domestic: num(v.sold_domestic), sold_export: num(v.sold_export),
      sale_value: num(v.sale_value), royalty_rate: v.royalty_rate === "" ? null : num(v.royalty_rate), note: v.note || null, updated_at: new Date().toISOString() };
    await guard(SB.from("production").upsert(row, { onConflict: "company_id,licence_no,bs_month,mineral" }), "pr-msg");
    toast(`Saved ${monthName(v.bs_month)}`); hisabProduction();
  };
  bindDeletes(hisabProduction);
}

async function hisabRoyalty() {
  const [rows, prod] = await Promise.all([fetchFy("royalty_payments"), fetchFy("production")]);
  rows.sort((a, b) => b.bs_month.localeCompare(a.bs_month));
  const lastMonth = prevBsMonth(currentBsMonth());
  const defMonth = fyMonths(HISAB_FY).includes(lastMonth) ? lastMonth : fyMonths(HISAB_FY)[0];
  $("hb-body").innerHTML = `<section class="card"><h2>Record a royalty payment</h2>
    <form id="ry-form" class="form grid-form">
      <div><label for="ry-lic">Licence</label><select id="ry-lic" name="licence_no">${licOptions()}</select></div>
      <div><label for="ry-month">For month (B.S.)</label><select id="ry-month" name="bs_month">${monthOptions(defMonth)}</select></div>
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
    <section class="card"><h2>Payments</h2>${recordList(rows, [
      ["bs_month", "For month", "", (v) => monthName(v)], ["licence_no", "Licence", "mono"],
      ["royalty", "Royalty", "num", (v) => rs(v)], ["local_fee", "Local fee", "num", (v) => rs(v)], ["surcharge", "Surcharge", "num", (v) => rs(v)],
      ["paid_on", "Paid", "", (v) => `${esc(v)}<div class="sub">${adToBs(v)} B.S.</div>`], ["voucher_no", "Voucher"],
    ], "royalty_payments")}</section>`;
  const f = $("ry-form");
  const suggest = () => {
    const due = prod.filter((p) => p.licence_no === f.licence_no.value && p.bs_month === f.bs_month.value)
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
    toast("Payment saved"); hisabRoyalty();
  };
  bindDeletes(hisabRoyalty);
}

const EXP_CATS = { wages: "Wages", fuel: "Fuel", machinery: "Machinery and repairs", explosives: "Explosives", transport: "Transport",
  fees_taxes: "Fees and taxes", land_rent: "Land rent", environment: "Environment work", office: "Office", other: "Other" };
async function hisabExpenses() {
  const rows = (await fetchFy("expenses", "spent_on")).sort((a, b) => b.spent_on.localeCompare(a.spent_on));
  const byCat = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + num(r.amount);
  $("hb-body").innerHTML = `<section class="card"><h2>Add an expense</h2>
    <form id="ex-form" class="form grid-form">
      <div><label for="ex-date">Date</label><input id="ex-date" name="spent_on" type="date" required value="${isoDate(TODAY)}"></div>
      <div><label for="ex-cat">Category</label><select id="ex-cat" name="category">${Object.entries(EXP_CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="ex-amt">Amount (Rs)</label><input id="ex-amt" name="amount" type="number" min="0" step="any" inputmode="decimal" required></div>
      <div><label for="ex-lic">Licence (optional)</label><select id="ex-lic" name="licence_no"><option value="">Whole company</option>${licOptions()}</select></div>
      <div class="wide"><label for="ex-note">Note</label><input id="ex-note" name="note"></div>
      <div class="wide"><button class="btn" type="submit">Add expense</button></div>
      <p id="ex-msg" class="msg wide" hidden></p>
    </form></section>
    ${Object.keys(byCat).length ? `<section class="card"><h2>By category · FY ${HISAB_FY}</h2><div class="hbars">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v], _i, all) =>
      `<div class="hb"><span class="name">${EXP_CATS[k]}</span><span class="track"><span class="seg" style="width:${(v / all[0][1]) * 100}%;background:var(--s1)"></span></span><span class="val">${rs(v)}</span></div>`).join("")}</div></section>` : ""}
    <section class="card"><h2>Expenses</h2>${recordList(rows, [
      ["spent_on", "Date", "", (v) => `${esc(v)}<div class="sub">${adToBs(v)} B.S.</div>`], ["category", "Category", "", (v) => EXP_CATS[v] || v],
      ["amount", "Amount", "num", (v) => rs(v)], ["licence_no", "Licence", "mono", (v) => esc(v || "—")], ["note", "Note"],
    ], "expenses")}</section>`;
  $("ex-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await guard(SB.from("expenses").insert({ company_id: ACC.company.id, spent_on: v.spent_on, category: v.category, amount: num(v.amount),
      licence_no: v.licence_no || null, note: v.note || null }), "ex-msg");
    toast("Expense added"); hisabExpenses();
  };
  bindDeletes(hisabExpenses);
}

const FILING_KINDS = { renewal: "Licence renewal", annual_report: "Annual report", prospecting_report: "Prospecting progress report",
  env_study: "BES / IEE / EIA approval", extension: "Term extension", other: "Other" };
async function hisabFilings() {
  const rows = (await fetchFy("filings", "done_on")).sort((a, b) => b.done_on.localeCompare(a.done_on));
  $("hb-body").innerHTML = `<section class="card"><h2>Record a filing</h2>
    <p class="note">Keep proof of renewals, reports and approvals. The summary shows which licences still need their renewal and annual report this year.</p>
    <form id="fi-form" class="form grid-form">
      <div><label for="fi-lic">Licence</label><select id="fi-lic" name="licence_no">${licOptions()}</select></div>
      <div><label for="fi-kind">What</label><select id="fi-kind" name="kind">${Object.entries(FILING_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div><label for="fi-fy">For fiscal year</label><input id="fi-fy" name="fiscal_year" value="${HISAB_FY}" pattern="\\d{4}/\\d{2}"></div>
      <div><label for="fi-date">Done on</label><input id="fi-date" name="done_on" type="date" required value="${isoDate(TODAY)}"></div>
      <div><label for="fi-ref">Receipt / letter no.</label><input id="fi-ref" name="reference"></div>
      <div class="wide"><label for="fi-note">Note</label><input id="fi-note" name="note"></div>
      <div class="wide"><button class="btn" type="submit">Save filing</button></div>
      <p id="fi-msg" class="msg wide" hidden></p>
    </form></section>
    <section class="card"><h2>Filings</h2>${recordList(rows, [
      ["done_on", "Date", "", (v) => `${esc(v)}<div class="sub">${adToBs(v)} B.S.</div>`], ["licence_no", "Licence", "mono"],
      ["kind", "What", "", (v) => FILING_KINDS[v] || v], ["fiscal_year", "FY"], ["reference", "Reference"],
    ], "filings")}</section>`;
  $("fi-form").onsubmit = async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await guard(SB.from("filings").insert({ company_id: ACC.company.id, licence_no: v.licence_no, kind: v.kind, fiscal_year: v.fiscal_year || null,
      done_on: v.done_on, reference: v.reference || null, note: v.note || null }), "fi-msg");
    toast("Filing saved"); hisabFilings();
  };
  bindDeletes(hisabFilings);
}

/* "Add to my company" on licence pages */
function companyButtonHTML(p) {
  if (!SB || !ACC.user || !ACC.company) return "";
  const has = ACC.licences.some((l) => l.licence_no === p.l_license_no);
  return has ? `<a class="btn ghost" href="#hisab">Hisab for this licence</a>`
    : `<button class="btn ghost" type="button" data-addco="${esc(p.l_license_no)}">Add to ${esc(ACC.company.name)}</button>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-addco]");
  if (!b || !ACC.company) return;
  const { error } = await SB.from("company_licences").upsert({ company_id: ACC.company.id, licence_no: b.dataset.addco });
  if (error) return toast(error.message);
  await selectCompany(ACC.company);
  b.outerHTML = `<a class="btn ghost" href="#hisab">Hisab for this licence</a>`;
  toast(`Added to ${ACC.company.name}`);
});
