// Tests supabase/schema.sql against a local Postgres (PGlite) with stand-ins for Supabase's auth schema.
// Run: node supabase/test_rls.mjs   (needs: npm install @electric-sql/pglite)
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) process.exitCode = 1; };

// --- minimal Supabase stand-ins: auth.users, auth.uid(), auth.jwt(), roles
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;
`);
await db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
await db.exec(`grant all on all tables in schema public to authenticated;`);

const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b",
      C = "00000000-0000-0000-0000-00000000000c";
await db.exec(`insert into auth.users values ('${A}','a@x.np'),('${B}','b@y.np'),('${C}','c@z.np');`);

async function as(uid, email, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false),
                 set_config('request.jwt.claim.email','${email}',false); set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
}

// A creates company; becomes owner
let r = await as(A, "a@x.np", `insert into companies (name) values ('Alpha Minerals') returning id`);
ok(!r.error, `A creates a company ${r.error || ""}`);
const ca = r.rows[0].id;
r = await as(A, "a@x.np", `select role from company_members where company_id = $1`, [ca]);
ok(r.rows?.[0]?.role === "owner", "A is owner of Alpha");

// B creates own company
r = await as(B, "b@y.np", `insert into companies (name) values ('Beta Mines') returning id`);
const cb = r.rows[0].id;

// A writes hisab for Alpha
r = await as(A, "a@x.np", `insert into production (company_id, licence_no, bs_month, mineral, unit, produced, taken_out)
  values ($1, '10/076/77', '2083-07', 'Dolomite', 'tonne', 500, 450)`, [ca]);
ok(!r.error, `A records production ${r.error || ""}`);

// B cannot see or write Alpha's data
r = await as(B, "b@y.np", `select * from production where company_id = $1`, [ca]);
ok(r.rows?.length === 0, "B sees none of Alpha's production");
r = await as(B, "b@y.np", `select * from companies where id = $1`, [ca]);
ok(r.rows?.length === 0, "B cannot see Alpha's company");
r = await as(B, "b@y.np", `insert into production (company_id, licence_no, bs_month, mineral, unit) values ($1,'x','2083-07','Sand','m3')`, [ca]);
ok(!!r.error, "B cannot add production to Alpha");
r = await as(B, "b@y.np", `insert into company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [ca, B]);
ok(!!r.error, "B cannot make itself a member of Alpha");

// invites: A invites C as staff; C accepts on sign-in
r = await as(A, "a@x.np", `insert into company_invites (company_id, email, role) values ($1, 'c@z.np', 'staff')`, [ca]);
ok(!r.error, `A invites C ${r.error || ""}`);
r = await as(B, "b@y.np", `insert into company_invites (company_id, email, role) values ($1, 'b@y.np', 'admin')`, [ca]);
ok(!!r.error, "B cannot invite itself into Alpha");
r = await as(C, "c@z.np", `select accept_invites() as n`);
ok(r.rows?.[0]?.n === 1, "C joins Alpha by accepting the invite");
r = await as(C, "c@z.np", `select count(*)::int n from production where company_id = $1`, [ca]);
ok(r.rows?.[0]?.n === 1, "C (staff) reads Alpha's production");
r = await as(C, "c@z.np", `delete from production where company_id = $1 returning id`, [ca]);
ok(r.rows?.length === 0, "C (staff) cannot delete records");
r = await as(C, "c@z.np", `update companies set name = 'Hacked' where id = $1 returning id`, [ca]);
ok(r.rows?.length === 0, "C (staff) cannot rename the company");
r = await as(C, "c@z.np", `delete from company_members where company_id = $1 and role = 'owner' returning user_id`, [ca]);
ok(r.rows?.length === 0, "C cannot remove the owner");
r = await as(A, "a@x.np", `delete from production where company_id = $1 returning id`, [ca]);
ok(r.rows?.length === 1, "A (owner) can delete a record");

// signed-out (anon) sees nothing
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role anon;`);
try { const x = await db.query(`select * from companies`); ok(x.rows.length === 0, "anon sees no companies"); }
catch { ok(true, "anon has no access to companies"); }

// schema can be re-run safely
await db.exec(`reset role;`);
try { await db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8")); ok(true, "schema.sql runs a second time"); }
catch (e) { ok(false, "schema.sql re-run: " + e.message); }
