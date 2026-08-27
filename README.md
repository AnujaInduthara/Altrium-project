# Altrium — Recruitment Management Platform

## Step 0: HR Login

This stage implements only the authentication foundation: an HR login page,
Supabase Auth integration, HR role authorization, a protected dashboard
placeholder, and logout. No vacancy/applicant/CV features are implemented yet.

### Login flow

```
Login page (frontend/login.html)
      |  supabase.auth.signInWithPassword(email, password)
      v
Supabase Auth  ->  session (access_token)
      |
      v
Frontend calls GET /api/hr/me with "Authorization: Bearer <access_token>"
      |
      v
Express auth.middleware.js verifies the token with Supabase,
then checks the profiles table for role = 'hr'
      |
      v
200 -> redirect to dashboard.html      403/401 -> error shown on login page
```

The frontend authenticates directly against Supabase Auth (using the public
anon key), and only asks the backend to confirm HR authorization. The backend
never receives a password, and the frontend never decides who is HR — that
check happens server-side against the `profiles` table.

## PB-01: HR Creates a Job Vacancy

An authenticated HR user can create a job vacancy and save it as a **draft**.
Publishing, public application links, applicant storage and AI screening are
later backlog items and are **not** part of this step.

### Flow

```
Dashboard  ->  Job Vacancies (vacancies.html)  ->  Create New Vacancy (create-vacancy.html)
      |  fill the form, "Save Draft"
      v
Client validation (js/utils/vacancyValidators.js)
      |
      v
POST /api/vacancies   Authorization: Bearer <access_token>
      |
      v
authenticateUser -> requireHR -> validateVacancyInput -> vacancy.service -> Supabase
      |
      v
201 { success: true, data: { id, job_title, status: "draft", created_by, ... } }
      -> success screen ("Status: Draft")
```

### Database

Run [`backend/sql/002_create_job_vacancies.sql`](backend/sql/002_create_job_vacancies.sql)
in the Supabase SQL editor (after `001`). It creates `public.job_vacancies`:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `job_title` | text | not null, non-blank |
| `department` | text | not null, non-blank |
| `location` | text | not null, non-blank |
| `employment_type` | text | not null, non-blank |
| `experience_level` | text | not null, non-blank |
| `number_of_positions` | integer | not null, `>= 1` |
| `job_description` | text | not null, non-blank |
| `job_requirements` | jsonb | not null, must be a JSON array (e.g. `["Python","Git"]`) |
| `status` | text | not null, default `draft`, one of `draft`/`published`/`closed` |
| `created_by` | uuid | not null, FK -> `auth.users(id)` |
| `created_at` / `updated_at` | timestamptz | not null, `now()`; `updated_at` maintained by trigger |

Indexes on `created_by`, `status`, `created_at desc`. **RLS is enabled**: the
`authenticated` role may only `select` / `insert` rows where
`auth.uid() = created_by` (and inserts must be `status = 'draft'`). There is no
policy for the `anon` role. The backend uses the service-role key and enforces
authentication + HR authorization itself; the policies are defence in depth.

**Requirements representation:** stored as a JSONB array of short strings so the
future AI CV-screening step (PB-05) can consume it directly without a
normalized skills table.

### API — `POST /api/vacancies`

- **Auth:** `Authorization: Bearer <supabase access_token>`; caller must have
  `profiles.role = 'hr'`.
- **Body:**
  ```json
  {
    "job_title": "Software Engineer",
    "department": "Engineering",
    "location": "Colombo",
    "employment_type": "Full-time",
    "experience_level": "2+ Years",
    "number_of_positions": 2,
    "job_description": "We are looking for ...",
    "job_requirements": ["Python", "FastAPI", "PostgreSQL", "Git", "JavaScript"]
  }
  ```
  `job_requirements` may also be a newline-separated string. `id`, `status`,
  `created_by`, `created_at`, `updated_at` in the body are **ignored** — the
  server always sets `status = "draft"` and `created_by` = the authenticated
  user.
- **Responses:**
  | status | when |
  |---|---|
  | `201` | created — `{ success: true, data: <vacancy> }` |
  | `400` | validation — `{ success: false, error: { code: "VALIDATION_ERROR", message, fields: { <field>: <msg> } } }` |
  | `401` | missing / invalid / expired token |
  | `403` | authenticated but not HR |
  | `500` | database failure (generic message; details are logged server-side only) |

`GET /api/vacancies` (same auth) returns the caller's own vacancies, newest
first: `{ success: true, data: { vacancies: [...] } }`. It backs the minimal
Job Vacancies screen and does not implement search / filter / publish / close.

### Allowed dropdown values

Source of truth: [`backend/src/config/vacancyOptions.js`](backend/src/config/vacancyOptions.js)
(the frontend `<select>` options mirror it).

- **Department:** Engineering, Product, Design, Finance, Human Resources, Marketing, Sales, Operations, Customer Support, Legal
- **Employment Type:** Full-time, Part-time, Contract, Internship, Temporary
- **Experience Level:** Entry Level, 1+ Years, 2+ Years, 3+ Years, 5+ Years, 8+ Years

### Running it

1. Apply `backend/sql/002_create_job_vacancies.sql` in Supabase.
2. Start the backend (`cd backend && npm run dev`) and serve `frontend/`.
3. Log in as an HR user, go to **Vacancies -> Create New Vacancy**, fill the
   form, **Save Draft**.

## PB-02: HR Publishes a Job Vacancy

An HR user opens one of their **draft** vacancies and publishes it. Publishing
is a one-way `DRAFT -> PUBLISHED` transition that generates a stable public
application link. Applicant submission, CV upload and AI screening are later
backlog items and are **not** part of this step.

> **Migration required:** run `backend/sql/003_add_vacancy_publishing.sql` in
> the Supabase SQL editor (after `002`). It adds `public_token` and
> `published_at`; the vacancy API references these columns, so every vacancy
> endpoint needs it applied.

### Flow

```
Job Vacancies -> open a draft (vacancy.html?id=<uuid>)
      |  "Publish Vacancy" -> confirm in modal
      v
POST /api/vacancies/:id/publish   Authorization: Bearer <access_token>   (no body)
      |
      v
authenticateUser -> requireHR -> service:
      exists? -> owned by caller? -> status == 'draft'? -> vacancy complete?
      -> generate crypto-random public_token, set published_at,
         conditional UPDATE (... WHERE id = :id AND status = 'draft')
      v
200 { success: true, data: { ..., status: "published",
      public_token, published_at, public_url } }
      -> details page shows the public link + Copy
```

### Database (migration `003`)

Adds to `public.job_vacancies`:

| column | type | notes |
|---|---|---|
| `public_token` | text | URL-safe random token (`crypto.randomBytes(24).toString('base64url')`), **unique index**, NULL while draft, set once at publish |
| `published_at` | timestamptz | timestamp of the `DRAFT -> PUBLISHED` transition, NULL while draft |

Plus a `NOT VALID` check constraint: a `published` row must have both
`public_token` and `published_at`. `updated_at` is maintained by the existing
trigger. RLS is unchanged — publishing is backend-only (service role), and
there is deliberately **no** anon/public UPDATE or SELECT policy.

### API

**`POST /api/vacancies/:id/publish`** — HR only, **no request body**. Any
`status` / `public_token` / `created_by` sent in a body is ignored; the server
controls all of them.

| status | meaning |
|---|---|
| `200` | published — data includes `status: "published"`, `public_token`, `published_at`, `public_url` |
| `400` | `VACANCY_INCOMPLETE` — a required field is missing; stays `draft` |
| `401` | missing / invalid token |
| `403` | authenticated non-HR, **or** the vacancy belongs to another HR user |
| `404` | `VACANCY_NOT_FOUND` |
| `409` | `VACANCY_ALREADY_PUBLISHED` (re-publish) or `VACANCY_NOT_DRAFT` (e.g. closed) |

**`GET /api/vacancies/:id`** — HR only. Returns one vacancy the caller owns
(404 if unknown, 403 if owned by someone else), including `public_url` (null
until published). Backs the details page.

**`GET /api/public/vacancies/:token`** — **unauthenticated**. Resolves a
`published` vacancy by its token and returns only public-safe fields
(`job_title`, `department`, `location`, `employment_type`, `experience_level`,
`number_of_positions`, `job_description`, `job_requirements`, `published_at`).
Draft / closed / unknown tokens all return a plain `404`. Never exposes
`id`, `created_by`, `public_token` or audit timestamps.

### Public application link

`APP_URL` (see env table below; defaults to `FRONTEND_URL`) + the token:

```
${APP_URL}/apply.html#token=<public_token>
```

The token is in the URL **hash**, not the query string, so it survives the
`page.html` → `page` redirect that "clean URL" static servers (Live Server,
`serve`) perform — a `?token=…` would be dropped by that redirect. Internal
links (`vacancy.html#id=…`) use the hash for the same reason; `readParam()` in
`js/utils/urlParams.js` reads either.

`frontend/apply.html` is a minimal public page (no sign-in, no app shell) that
resolves the token and shows the role. **PB-03** will add the actual
application form and CV upload here — for now it shows the vacancy plus an
"applications open soon" notice.

### Running it

1. Apply `003_add_vacancy_publishing.sql` in Supabase.
2. Restart the backend, serve `frontend/`.
3. Log in, open **Vacancies**, click a draft, **Publish Vacancy**, confirm.
   Copy the public link; open it in any browser (no login) to see the vacancy.

## Project structure

```
frontend/   Static HTML + token-based CSS + vanilla ES-module JS (see frontend/README.md)
backend/    Node.js + Express API (token verification, HR authorization)
```

## Setup

### 1. Backend

```
cd backend
npm install
```

Copy `backend/.env` and fill in:

| Variable                    | Where to find it                                      |
|------------------------------|--------------------------------------------------------|
| `PORT`                       | Any free port, default `5000`                          |
| `FRONTEND_URL`                | Origin of your local static server, e.g. `http://127.0.0.1:5500` |
| `APP_URL`                     | Public base URL for the application link; usually same as `FRONTEND_URL`. Defaults to `FRONTEND_URL` if unset |
| `SUPABASE_URL`                | Supabase Dashboard > Project Settings > API             |
| `SUPABASE_ANON_KEY`           | Supabase Dashboard > Project Settings > API             |
| `SUPABASE_SERVICE_ROLE_KEY`   | Supabase Dashboard > Project Settings > API (**server-only, never commit**) |

Run:

```
npm run dev
```

### 2. Database

In the Supabase SQL editor, run the migrations in order:

1. [`backend/sql/001_create_profiles.sql`](backend/sql/001_create_profiles.sql) — `profiles` table (links `auth.users` to an HR role), RLS self-read only.
2. [`backend/sql/002_create_job_vacancies.sql`](backend/sql/002_create_job_vacancies.sql) — `job_vacancies` table (PB-01).
3. [`backend/sql/003_add_vacancy_publishing.sql`](backend/sql/003_add_vacancy_publishing.sql) — `public_token` + `published_at` (PB-02).

There is no self-service HR sign-up. To create your first HR user:

1. Create the user under Authentication > Users in the Supabase dashboard (or have them sign up).
2. Copy their user ID, then run:
   ```sql
   insert into public.profiles (auth_user_id, email, role)
   values ('<auth-user-uuid>', 'hr@example.com', 'hr');
   ```

### 3. Frontend

`frontend/js/config.js` holds the public (browser-safe) Supabase URL and anon
key — fill in the same two values from the table above:

```js
export const APP_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  API_BASE_URL: 'http://localhost:5000/api',
};
```

See [`frontend/README.md`](frontend/README.md) for the full folder layout and
conventions.

Serve the `frontend/` folder with any static file server, matching the port
you set as `FRONTEND_URL` in the backend `.env`. For example:

```
npx serve frontend -l 5500
```

or use the VS Code "Live Server" extension. Then open `http://127.0.0.1:5500/login.html`.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is read only in `backend/src/config/supabase.js` and never sent to the browser.
- Passwords are handled entirely by Supabase Auth; nothing here stores or hashes passwords.
- HR authorization is decided server-side by looking up `profiles.role`, not from anything the client sends.
- `profiles` and `job_vacancies` have RLS enabled with per-owner policies; there is no anon policy on either.
- The `DRAFT -> PUBLISHED` transition and the `public_token` are set only by the backend; a request body cannot influence them.
- The public application link contains only the random token — no internal id, no HR identity.
- Backend error responses never include stack traces, SQL errors, or Supabase internals.

## Remaining Sprint 1 work

Done: Step 0 (HR Login), PB-01 (Create Job Vacancy — draft), PB-02 (Publish
Vacancy — public link generated).

Not yet implemented: PB-03 applicant CV submission, PB-04 application storage,
PB-05 AI CV screening, PB-06 applicant review, PB-07 candidate selection,
PB-08 vacancy closing.
