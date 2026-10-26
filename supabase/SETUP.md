# Switching on accounts and hisab-kitab

Khani Insights uses [Supabase](https://supabase.com) for sign-in and the company database. The free plan
is enough to start. Until `web/config.js` is filled in, the app runs without accounts.

## 1. Create the project (owner of the app does this once)

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Organization: a neutral name such as `knowledgemine` (it is not shown to users).
3. Project name: `khani-insights`. Choose a strong database password and keep it safe; it is not needed in the app.
4. Region: **Southeast Asia (Singapore)**, the closest to Nepal.

## 2. Create the tables and security rules

1. In the project: **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It should finish with "Success. No rows returned".
   It is safe to run again later.

## 3. Sign-in settings

**Authentication → URL Configuration**

- Site URL: `https://knowledgemine.github.io`
- Redirect URLs: add `https://knowledgemine.github.io/**` and, for local testing, `http://127.0.0.1:8765/**`

**Authentication → Providers → Email**: keep Email enabled and **Confirm email** on.

Supabase's built-in email sender only sends a few emails per hour. That is fine for testing; before inviting
all operators, add your own SMTP sender under **Authentication → Emails → SMTP Settings** (for example a
Gmail/Google Workspace, Zoho or Brevo account).

## 4. Connect the app

**Project Settings → API** (or the **Connect** button) shows two values. Put them in `web/config.js`:

```js
window.KHANI_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseAnonKey: "eyJ… (the anon / publishable key)",
};
```

Only the **anon / publishable** key goes here; it is meant to be public, and the database rules in
`schema.sql` protect each company's data. Never put the **service_role / secret** key in the app or in Git.

Commit and push; the site rebuilds in about 2 minutes.

## How the data is protected

- Every table has Row Level Security: people only see and change rows of companies they belong to.
- The owner (whoever created the company) and admins can edit company details, invite people and delete records.
  Staff can add and view records.
- People join a company only through an invite to their confirmed email address.
- `supabase/test_rls.mjs` tests these rules on a local Postgres (PGlite):
  `npm install @electric-sql/pglite && node supabase/test_rls.mjs`.
