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

/* hisab-kitab lives in hisab.js */

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
