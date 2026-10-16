# Deep Skilling Training

Student mobilization and enrolment registration platform.

Plain **HTML + CSS + JavaScript + Bootstrap 5 + Bootstrap Icons**, backed by
**Supabase** (Postgres, Auth, Storage, Edge Functions), exporting with
**SheetJS**, hosted on **Vercel**. No React, Angular or Vue.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Project structure](#2-project-structure)
3. [Supabase setup](#3-supabase-setup)
4. [Vercel deployment](#4-vercel-deployment)
5. [Local development](#5-local-development)
6. [How the Ma Foi ID stays correct](#6-how-the-ma-foi-id-stays-correct)
7. [Security model](#7-security-model)
8. [Admin guide](#8-admin-guide)
9. [Testing](#9-testing)
10. [Spec reconciliation notes](#10-spec-reconciliation-notes)

---

## 1. What it does

**Public page (`index.html`)** — a two-section registration form (Mobilization,
Enrolment) with 21 data fields and up to 3 document uploads. On success the
student sees an animated confirmation with the Ma Foi ID assigned by the server.

**Admin page (`admin.html`)** — reachable only by pressing **Ctrl + Shift + M**
on the public page. There is no admin link anywhere in the UI. Shows summary
counts, a searchable/filterable registration table, secure document access,
Excel export, and a delete action that reindexes every subsequent Ma Foi ID and
renames the corresponding documents automatically.

The system guarantees that these four are always identical:

```
Database Ma Foi ID = Dashboard Ma Foi ID = Excel Ma Foi ID = Document filename Ma Foi ID
```

---

## 2. Project structure

```
.
├── index.html                     Public registration page
├── admin.html                     Admin login + dashboard
├── css/
│   └── styles.css                 Blue/white theme, responsive, success animation
├── js/
│   ├── config.example.js          Credential template (copy to config.js locally)
│   ├── config.js                  Generated at build time — git-ignored
│   ├── supabase-client.js         Client bootstrap + shared helpers
│   ├── validation.js              Client validation rules + field error rendering
│   ├── registration.js            Form controller, uploads, submission
│   ├── app.js                     Ctrl+Shift+M shortcut
│   ├── admin.js                   Auth, table, search, filter, delete
│   └── excel.js                   XLSX export with correct cell types
├── scripts/
│   └── generate-config.js         Writes js/config.js from env vars at build
├── supabase/
│   ├── schema.sql                 Tables, constraints, RLS, functions, bucket
│   ├── config.toml                Edge Function settings
│   ├── tests/
│   │   └── integrity-tests.sql    Destructive dev-only test suite
│   └── functions/
│       ├── _shared/               constants · http · validation · reindex
│       ├── register/index.ts      Upload slots + validated atomic submit
│       └── admin-delete-reindex/index.ts
├── vercel.json
├── package.json
└── README.md
```

---

## 3. Supabase setup

### 3.1 Create the project

<https://supabase.com/dashboard> → **New project**. Choose a region close to
Tamil Nadu / Andhra Pradesh (e.g. `ap-south-1`). Save the database password.

### 3.2 Run the schema

**SQL Editor → New query** → paste the whole of `supabase/schema.sql` → **Run**.

This creates:

| Object | Purpose |
|---|---|
| `registrations` | One row per student, with every validation rule as a `CHECK` |
| `admin_users` | Authorization allow-list (separate from Auth) |
| `maintenance_state` | Server-side lock used during delete + reindex |
| `create_registration()` | Atomic serial + Ma Foi ID allocation |
| `compute_reindex_plan()` / `apply_delete_reindex()` | Two-phase delete + renumber |
| `acquire_maintenance_lock()` / `release_maintenance_lock()` | Compare-and-swap lock |
| `registration_status()` | The only function `anon` may call |
| Storage bucket `deep-skilling-documents` | Private, 10 MB cap, PDF/JPEG only |

> If the last statement (`create policy … on storage.objects`) errors with
> *"must be owner of table objects"*, create it from the dashboard instead:
> **Storage → Policies → deep-skilling-documents → New policy → SELECT**, target
> role `authenticated`, using expression:
> `bucket_id = 'deep-skilling-documents' and public.is_admin(auth.uid())`

### 3.3 Verify the Storage bucket

**Storage** → confirm `deep-skilling-documents` exists and **Public** is off.
The schema creates it; verify rather than recreate.

### 3.4 Create the admin user

**Authentication → Users → Add user → Create new user.** Enter the
administrator's email and a strong password, and tick **Auto Confirm User**.
Copy the resulting **User UID**.

### 3.5 Authorize that user

Authentication alone grants nothing. Add the UID to the allow-list:

```sql
insert into public.admin_users (user_id, email)
values ('PASTE-THE-USER-UID-HERE', 'admin@example.com');
```

Repeat for each additional administrator. To revoke access, delete the row —
the user can still sign in but sees *"This account is not authorised…"*.

### 3.6 Deploy the Edge Functions

Install the CLI once: <https://supabase.com/docs/guides/cli>

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

supabase functions deploy register              --no-verify-jwt
supabase functions deploy admin-delete-reindex  --no-verify-jwt
```

`--no-verify-jwt` is deliberate and safe:

* `register` is a public endpoint — students are not signed in. Every field,
  file type and relationship is validated inside the function.
* `admin-delete-reindex` verifies the caller's JWT itself with
  `auth.getUser(token)` and then checks `admin_users`. Doing it manually keeps
  it working with both legacy anon keys and the newer publishable key format.

**Secrets.** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into
Edge Functions automatically — you do not need to set them. If you are running
functions locally, add them to `supabase/.env.local` (git-ignored).

### 3.7 Collect the frontend credentials

**Project Settings → API**:

* **Project URL** → `SUPABASE_URL`
* **anon / publishable key** → `SUPABASE_ANON_KEY`

Never copy the **service_role** key anywhere near the frontend or Vercel.

---

## 4. Vercel deployment

1. Push this repository to GitHub (`js/config.js` is git-ignored — correct).
2. **Vercel → Add New → Project → Import** the repository.
3. Framework preset: **Other**. Build command and output directory come from
   `vercel.json` (`node scripts/generate-config.js`, output `.`).
4. **Settings → Environment Variables** — add to *Production*, *Preview* and
   *Development*:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | your anon / publishable key |

5. **Deploy.**

The build writes `js/config.js` from those variables. If either is missing the
build fails loudly rather than shipping a broken site, and it aborts outright if
`SUPABASE_SERVICE_ROLE_KEY` is ever found in the project environment.

**After the first deploy**, add your Vercel domain in Supabase under
**Authentication → URL Configuration → Site URL / Redirect URLs**.

---

## 5. Local development

```bash
cp js/config.example.js js/config.js   # then paste your URL + anon key
npx serve . -l 3000                    # or: python3 -m http.server 3000
```

Open <http://localhost:3000>. Do not open `index.html` via `file://` — the
Supabase client needs an `http(s)` origin.

---

## 6. How the Ma Foi ID stays correct

### Allocation

`create_registration()` runs entirely inside one transaction that begins with
`pg_advisory_xact_lock(771001)`. Only one registration can be allocating at a
time, so `MAX(serial_no) + 1` is safe here — the classic race is closed by the
lock, not by hope. There is no sequence to drift out of step after a deletion:
because reindexing always leaves serials as a contiguous `1..N`, the next ID is
always `N + 1`.

*Verified:* 24 simultaneous registrations across 24 connections produced exactly
`DS001`–`DS024` — no duplicates, no gaps.

### Deletion and reindexing

Deletion is a five-step server-side operation. **Storage is renamed before the
database is touched**, which is what makes a failure safe:

```
1. acquire_maintenance_lock()      compare-and-swap; blocks new registrations
                                   and any second admin deletion
2. compute_reindex_plan(id)        read-only: files to delete, renames to do,
                                   new serials, and a fingerprint of the plan
3. storage.move(from → to)         every affected document, tracked as it goes
4. apply_delete_reindex(id, fp)    one transaction: delete row → offset serials
                                   by +1,000,000 → write final serials, Ma Foi
                                   IDs, document names and paths → assert 1..N
5. remove the deleted row's files, then release the lock
```

If any rename in step 3 fails, every completed rename is moved back and the
function returns an error — **the database was never modified**. If the table
changed between steps 2 and 4 (a student slipped a registration in), the
fingerprint no longer matches, `apply` raises `PLAN_STALE`, the renames are
rolled back and the admin is told to try again. Nothing is half-done either way.

The `+1,000,000` offset pass exists so no intermediate state can ever collide on
`UNIQUE(serial_no)` / `UNIQUE(mafoi_id)`. Those two constraints are additionally
declared `DEFERRABLE INITIALLY DEFERRED` as a second line of defence.

*Verified:* deleting from the end, the middle and the start of a 10-row table
each renumbered correctly and renamed every education, EWS and PWD document; the
next registration then continued at `N + 1`.

### Filenames

Names are generated by one Postgres function and stored in the database. The
dashboard, the Excel export and Storage all read that same stored value —
nothing is reconstructed in JavaScript.

```
{MafoiID}_Educational Document_{First Last}.{ext}
{MafoiID}_EWS Certificate_{First Last}.{ext}
{MafoiID}_PWD Certificate_{First Last}.{ext}
```

Physical objects live under `registrations/{uuid}/…`, keyed by the permanent
UUID, so a Ma Foi ID change only ever renames the file — never moves the folder.

---

## 7. Security model

| Layer | Rule |
|---|---|
| `anon` role | No table access at all. Its only privilege is `registration_status()`. |
| `authenticated` role | `SELECT` on `registrations`, filtered by RLS to `is_admin(auth.uid())`. |
| Writes | Impossible from the browser. Every insert, update and delete goes through an Edge Function using the service-role key. |
| Storage bucket | Private. Uploads use short-lived signed upload URLs into a staging folder whose path the **server** builds. Admin reads use short-lived signed download URLs. |
| Service-role key | Lives only in the Edge Function runtime. Never in HTML, CSS, JS, git or Vercel — the build script aborts if it finds it. |
| Admin authorization | Two independent checks: RLS on every read, and an explicit `admin_users` lookup inside the Edge Function on every write. |

**File safety.** Extension, declared MIME type and size are checked in the
browser; then re-checked server-side against Storage metadata; then the first
bytes of the object are sniffed for `%PDF-` / `FF D8 FF`. A `.pdf` that is
actually something else is rejected. Filenames from the browser are never used
to build a Storage path.

**Validation happens three times** — in `js/validation.js` for instant feedback,
in `_shared/validation.ts` on the server, and as `CHECK` constraints in Postgres.
The database is the final authority; bypassing the UI changes nothing.

---

## 8. Admin guide

**Getting in.** Press **Ctrl + Shift + M** anywhere on the registration page.
The shortcut works while a field is focused and never submits the form. Visiting
`/admin.html` directly only ever shows the login screen.

**Deleting a registration.** Click the bin icon → a modal shows the Ma Foi ID,
name and email → **Delete & Reindex**. While it runs, the public form displays
*"Updating registrations. Please wait..."* and refuses new submissions; a second
admin attempting a delete is told another operation is in progress. When it
finishes the table, the counts and every document name are already updated.

**Excel.** **Download Excel** re-queries the database first, so the file can
never contain stale IDs. Ma Foi IDs, ID proofs and mobile numbers are written as
text cells (so `DS001` stays `DS001`), and dates as real Excel dates.

Filename: `Deep_Skilling_Training_Registrations_YYYY-MM-DD.xlsx`

**Search** matches Ma Foi ID, first name, last name, email and contact number.
**Filter** narrows by domain course. Both are display-only — the export always
contains every registration.

---

## 9. Testing

### Database

`supabase/tests/integrity-tests.sql` reproduces §75 of the specification.
**It truncates `registrations`, so run it on a development project only.**

Covered and passing: sequential allocation (`DS001`, `DS002`, `DS003`) · age 17
reject / 18 accept / 36 accept / 37 reject · `dhanabal@gmail.com` accept,
`Dhanabal@gmail.com`, `dhanabal@GMAIL.com`, `dhanabal@yahoo.com` reject ·
10-digit mobile rules · TamilNadu↔Chennai and Andhra Pradesh↔Vishak/Vijayawada ·
occupation/institution pairing · PWD certificate pairing · duplicate ID proof and
duplicate email · maintenance lock · delete from end/middle/start with document
renaming · next ID continuing at `N + 1` · stale-plan rejection.

### Browser checklist

* Register at 320 / 375 / 390 / 414 / 768 / 1024 / 1366 / 1920 px — no
  horizontal scrolling on the public page.
* Upload from Android Chrome and iPhone Safari.
* Change state → district clears. Change occupation away from `4-Student` →
  institution clears and disables. Change PWD to `No - 2` → certificate clears.
* Double-click Submit → one registration.
* Delete a middle registration → confirm the dashboard, a re-downloaded Excel
  file and the document names in Storage all agree.

---

## 10. Spec reconciliation notes

A few places in the specification stated the same thing two ways. Decisions
taken, all conservative:

1. **Id proof helper text** — §7.2 and §73 differ slightly. §73 is used, since it
   is the section headed *"EXACT DESCRIPTIONS"*.
2. **Date of Birth helper text** — §73's longer version is used, as above.
3. **EWS question** — §7.11 puts *"(Income below 8 Lakh per annum)"* inside the
   label, and §73 lists it as a description. It appears once, in the label, to
   avoid printing the same sentence twice.
4. **Email uniqueness** — §41 said to "consider" it. It is enforced. Remove the
   `reg_email_unique` constraint from `schema.sql` and the second duplicate check
   in `create_registration()` if one email should be allowed to register twice.
5. **Minimum ID proof length** — the browser asks for at least 4 digits as a
   typo guard. The database enforces digits-only with no length rule, exactly as
   specified.
6. **Palette** — the spec's blue/white direction is anchored on the ProSculpt
   brand blues (`#0E4BFF`, `#0A3ED1`) so this sits alongside the rest of the
   platform. Red appears only in validation states.
