# Altrium — Recruitment Management Platform

## Backlog status at a glance

| ID | Item | Sprint | Status |
|---|---|---|---|
| Step 0 | HR login (Supabase Auth + HR authorization) | 1 | ✅ Done |
| PB-01 | HR creates a job vacancy | 1 | ✅ Done |
| PB-02 | HR publishes a job vacancy | 1 | ⚠️ Update needed — see [Sprint 1 update](#sprint-1-update--public-applicant-portal) |
| PB-03 | Applicant views and submits a job application | 1 | ⚠️ Update needed — see [Sprint 1 update](#sprint-1-update--public-applicant-portal) |
| PB-04 | System stores submitted applications | 1 | ✅ Done |
| PB-05 | System filters CVs using AI | 1 | ✅ Done |
| PB-06 | HR reviews AI-filtered applicants | 1 | ✅ Done |
| PB-07 | HR selects candidates for interviews | 1 | ❌ Not started |
| PB-08 | HR closes a job vacancy | 1 | ❌ Not started |
| PB-09 | HR selects the candidate's interview level | 2 | ❌ Not started |
| PB-10 | System displays default interview stages | 2 | ❌ Not started |
| PB-11 | HR customizes the interview stages | 2 | ❌ Not started |
| PB-12 | HR configures interviewer requirements per stage | 2 | ❌ Not started |
| PB-13 | Interviewer manages availability via calendar | 2 | ❌ Not started |
| PB-14 | HR views interviewer availability | 2 | ❌ Not started |
| PB-15 | HR assigns available interviewers | 2 | ❌ Not started |
| PB-16 | HR schedules interviews | 2 | ❌ Not started |
| PB-17 | System sends interview notifications | 2 | ❌ Not started |
| PB-18 | Interviewer views assigned interviews | 2 | ❌ Not started |
| PB-19 | Interviewer records ratings and feedback | 2 | ❌ Not started |
| PB-20 | Hiring Manager reviews interview results | 2 | ❌ Not started |
| PB-21 | Hiring Manager makes the final hiring decision | 2 | ❌ Not started |
| PB-22 | System sends the final decision to HR + candidate | 2 | ❌ Not started |
| PB-23 | Management views recruitment dashboard/pipeline | 2 | ❌ Not started |
| PB-24 | Management generates recruitment reports | 2 | ❌ Not started |

Sprint 1's original design had HR copy a vacancy's public link and share it
manually. That is being replaced with a public **Applicant Portal** listing —
see [Sprint 1 update](#sprint-1-update--public-applicant-portal) below for
exactly what changes and what's still missing. Sprint 2 (PB-09…PB-24) is fully
specced further down but **no code exists for it yet**; see
[Sprint 2 — Interview, Hiring & Management](#sprint-2--interview-hiring--management-not-started).

> 🛠 **Building the rest?** [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) is the
> step-by-step implementation playbook for everything still outstanding — 22
> ordered steps across 7 phases, each with its deliverables, API contract,
> definition of done, and a ready-to-paste prompt for Claude Code. This README
> describes what exists; that file describes how to build what doesn't.

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

> ⚠️ **Spec update pending.** This step currently implements the *old* design
> (HR copies a public link and shares it manually). The current backlog
> replaces manual sharing with a public **Applicant Portal** listing — the
> underlying `DRAFT -> PUBLISHED` transition below is still correct and does
> not need to change, but a vacancy-listing endpoint/page still needs to be
> added. See [Sprint 1 update](#sprint-1-update--public-applicant-portal).

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

`frontend/apply.html` is a public page (no sign-in, no app shell) that resolves
the token, shows the vacancy, and hosts the PB-03 application form.

### Running it

1. Apply `003_add_vacancy_publishing.sql` in Supabase.
2. Restart the backend, serve `frontend/`.
3. Log in, open **Vacancies**, click a draft, **Publish Vacancy**, confirm.
   Copy the public link; open it in any browser (no login) to see the vacancy.

## PB-03: Applicant Submits a CV Application

> ⚠️ **Spec update pending.** The submission flow below (form → validate →
> upload CV → store) is unchanged. What changes is *how the applicant gets
> here*: today the only way in is a link HR shares manually; the backlog now
> expects the applicant to find the vacancy by browsing a public portal
> listing first. See [Sprint 1 update](#sprint-1-update--public-applicant-portal).

An **external applicant** — no account, no login — opens a published vacancy's
public link (`apply.html#token=<public_token>`), reviews the role, fills a short
form, uploads a CV (PDF or DOCX) and submits. The application is stored with
status `submitted`. AI screening (PB-05) and HR review (PB-06) are **not** part
of this step.

> **Migration required:** run `backend/sql/004_create_applications.sql` in the
> Supabase SQL editor (after `003`). It creates `public.applications` and the
> **private** `candidate-cvs` storage bucket.

### Flow

```
apply.html#token=<public_token>
      |  GET /api/public/vacancies/:token   -> published vacancy (public fields only)
      v
Applicant fills the form + attaches a CV
      |  client validation (js/utils/applicantValidators.js)
      v
POST /api/public/vacancies/:token/applications   (multipart/form-data, no auth)
      |
      v
rate limit -> parse CV (multer, memory) -> confirm vacancy is PUBLISHED
      -> validate fields -> verify CV bytes (magic number, not just MIME)
      -> recent-duplicate check -> upload CV to private bucket
      -> insert applications row  (delete the CV if the insert fails)
      v
201 { success: true, data: { reference: "APP-XXXXXXXX", job_title, status: "submitted" } }
      -> success screen with the application reference
```

### Database (migration `004`)

`public.applications`:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` — **never exposed** |
| `vacancy_id` | uuid | not null, FK -> `job_vacancies(id)` |
| `reference` | text | not null, **unique** — public-facing `APP-XXXXXXXX` shown to the applicant |
| `full_name` / `email` / `phone` / `location` | text | not null, non-blank; email is lower-cased, whitespace collapsed |
| `cv_path` | text | not null — object key inside the private `candidate-cvs` bucket |
| `cv_original_name` / `cv_size_bytes` / `cv_content_type` | | retained for later HR review |
| `status` | text | not null, default `submitted`; check allows the later PB-06/07 values |
| `created_at` / `updated_at` | timestamptz | `now()`; `updated_at` via the shared trigger |

Indexes on `vacancy_id`, `lower(email)`, `(vacancy_id, lower(email))`,
`created_at desc`. **RLS is enabled with no policies** — exactly like
`job_vacancies`, all access is backend-only via the service-role key. A leaked
anon/authenticated key cannot read applicant PII or CVs.

### Storage

Private bucket **`candidate-cvs`** (`public = false`), 5 MiB limit,
`application/pdf` + `.docx` MIME types only, **no** `storage.objects` policies —
so anon/authenticated cannot list, read or upload. CVs are written by the
backend to `applications/<vacancy-id>/<uuid>.<ext>` (the applicant's filename is
never used as a key). Reading a CV later (PB-06) will go through the backend or
a short-lived signed URL.

### API

**`GET /api/public/vacancies/:token`** — unchanged from PB-02 (public fields
only; `404` for draft/closed/unknown).

**`POST /api/public/vacancies/:token/applications`** — **unauthenticated**,
`multipart/form-data` with `full_name`, `email`, `phone`, `location` and a `cv`
file.

| status | when |
|---|---|
| `201` | created — `{ success: true, data: { reference, job_title, status: "submitted" } }` |
| `400` | field validation — `{ error: { code: "VALIDATION_ERROR", message, fields } }`, or a missing/unreadable CV |
| `404` | token unknown, or the vacancy is not `published` |
| `409` | `DUPLICATE_APPLICATION` — same email already applied to this vacancy in the last 10 minutes |
| `413` | `CV_TOO_LARGE` |
| `415` | `CV_UNSUPPORTED_TYPE` — not a real PDF / DOCX |
| `429` | per-IP rate limit (8 submissions / 10 min; 60 lookups / min) |
| `500` | unexpected — generic message only, details logged server-side |

### Validation & file security

- Both sides validate. The **backend is authoritative**: it re-trims/normalizes
  every field and never trusts the browser's MIME type, extension or filename.
- The CV is verified by **magic bytes** (`%PDF-` for PDF; ZIP header +
  `[Content_Types].xml` for DOCX), not just its claimed type.
- Storage key is a server-generated UUID path — no path traversal, no
  collisions, no malicious filenames.
- CV upload + row insert are not one transaction; if the insert fails the
  backend deletes the just-uploaded CV (best-effort compensation, logged).

### Env

Optional: `CV_MAX_BYTES` (bytes) overrides the 5 MiB CV size limit. Keep it in
sync with the bucket's `file_size_limit` and `frontend/js/config.js`
(`MAX_CV_MB`). No new secrets.

### Tests

`cd backend && npm test` runs `backend/test/applicationValidation.test.js`
(Node's built-in test runner) — field validation and CV magic-byte checks.

## Sprint 1 update — public Applicant Portal

The original Sprint 1 design made HR responsible for distributing every
vacancy link by hand:

```
HR -> Create Vacancy -> Publish -> Get Public Link -> Copy Link
   -> Manually share link -> Applicant opens link -> Apply
```

That's not a practical recruitment-portal design — HR shouldn't have to push a
link out through email/WhatsApp/LinkedIn every time a role opens. The fix
keeps everything else in Sprint 1 the same and only changes how an applicant
*finds* a published vacancy:

```
HR -> Create Vacancy -> Publish Vacancy -> Applicant Portal
   -> Applicant views vacancy -> Applicant applies
```

Published vacancies appear on a public, browsable **Applicant Portal**
instead of (or in addition to) a token link that must be shared manually.

### What does and doesn't change

| PB | Change |
|---|---|
| PB-01 (create vacancy) | No change. |
| PB-02 (publish vacancy) | HR still clicks **Publish**; the `DRAFT -> PUBLISHED` transition, `public_token` and `published_at` all stay as implemented. What's added: the vacancy must also become visible in a public **listing**, not just reachable by a token link. |
| PB-03 (applicant applies) | No change to the submission form/flow. What's added: the applicant's entry point is browsing the portal and clicking a vacancy card, rather than only opening a link HR sent them. |
| PB-04 → PB-08 | No change. |

### Portal example (from the brief)

```
ALTRIUM CAREERS
Open Positions
────────────────────────
Junior Software Engineer
IT Department · Junior Level
[View Job]
────────────────────────
Accountant
Finance Department · Junior Level
[View Job]
```

### Gap analysis — what's missing today

- **Backend:** there is no list endpoint for published vacancies. `GET
  /api/public/vacancies/:token` (`backend/src/controllers/public.controller.js`)
  only resolves **one** vacancy by its private token; it can't back a
  "browse all open roles" page. A new unauthenticated endpoint is needed,
  e.g. `GET /api/public/vacancies` → public-safe fields for every
  `status = 'published'` vacancy (same projection PB-02 already uses: no
  `id`, `created_by`, or `public_token` leakage — a public listing needs a
  stable, non-guessable-but-shareable identifier per card, most simply the
  existing `public_token` used as the detail-page link).
- **Frontend:** there is no public "careers" / portal page. `apply.html`
  today assumes the applicant already has a `#token=` in the URL; nothing in
  `frontend/*.html` lists open vacancies for someone arriving with no link at
  all.
- **Not required:** no applicant account system — the brief is explicit that
  applicants still don't need to log in to browse or apply.

### Suggested implementation shape

1. `GET /api/public/vacancies` — unauthenticated, returns published vacancies
   only, same public-safe field set as the existing token endpoint, ordered
   by `published_at desc`.
2. A new public page (e.g. `frontend/portal.html` + `portal.css` +
   `portalPage.js`) — the unauthenticated landing page that lists cards and
   links each one to `apply.html#token=<public_token>` (reuse the existing
   apply flow unchanged).
3. Keep the direct token link working (HR can still share it if they want to,
   e.g. sponsored posts) — the portal is an additional, primary discovery
   path, not a replacement for the URL scheme already built.

## PB-04 (partial): HR reviews applications

An HR user opens **Applications** in the sidebar, picks one of their vacancies,
and sees the CV applications submitted to it — applicant name, email, phone,
location, submission date and reference — with a **View CV** action. AI
screening, status changes and candidate selection are still later backlog items;
this is only the review list + CV access.

### Flow

```
Applications (applications.html)  — or  Vacancy details -> "View applications"
      |  pick a vacancy
      v
GET /api/vacancies/:id/applications      Authorization: Bearer <access_token>
      |  authenticateUser -> requireHR -> getVacancyForUser (owner check)
      v
{ vacancy: {...}, applications: [ { reference, full_name, email, phone,
  location, status, cv_original_name, cv_size_bytes, cv_content_type,
  created_at }, ... ] }        (never cv_path)
      |
      |  "View CV"
      v
GET /api/applications/:id/cv             Authorization: Bearer <access_token>
      |  owner-checked via the parent vacancy
      v
{ url: "<signed URL, 120s>", file_name, content_type }   -> opened in a new tab
```

### API

| endpoint | notes |
|---|---|
| `GET /api/vacancies/:id/applications` | HR only; `403` if the vacancy belongs to another HR user, `404` if unknown. Returns public-safe applicant fields only. |
| `GET /api/applications/:id/cv` | HR only; `404` (not `403`) if the application belongs to another HR user's vacancy, so nothing leaks. Returns a **short-lived signed URL** (120s) into the private `candidate-cvs` bucket — the CV is never served through a public URL or a raw storage key. |

No schema or storage changes — this reads the `applications` table and bucket
created by migration `004`.

## PB-05: System filters CVs using AI

After PB-04 stores a submitted application + CV, the system automatically runs
an **AI-assisted screening pass**. The AI is an **assistant, not a decision
maker** — it never hires, rejects, shortlists or selects anyone. It produces
advisory signals (a 0–100 *AI Screening Score*, an *AI Recommendation*, matched
/ missing skills, an experience and education assessment, an *AI Screening
Summary*). The application's own `status` stays `submitted`; HR makes every
recruitment decision (PB-06/07).

> **Migration required:** run
> [`backend/sql/005_create_application_screenings.sql`](backend/sql/005_create_application_screenings.sql)
> after `004`.
>
> **AI key optional:** with no `GROQ_API_KEY` set (for the default `groq`
> provider), screening rows are created as `pending` and the pipeline is inert —
> PB-01…PB-04 are unaffected.

### Flow

```
PB-03/PB-04: application + CV stored
      |  screenApplicationInBackground(applicationId)   (fire-and-forget, after the HTTP response)
      v
ensure a screening row (pending)                        [idempotent — UNIQUE(application_id)]
      |  claim: pending|failed -> processing            [atomic conditional UPDATE — one worker]
      v
load + verify dependencies (application, vacancy, CV; application belongs to vacancy)
      |
      v
download CV from the private bucket (service role)  ->  extract text (PDF: pdf-parse, DOCX: mammoth)
      |  normalize, guard against unreadable/scanned CVs, truncate very large CVs
      v
build a vacancy-specific prompt   (CV wrapped as UNTRUSTED DATA, delimiters neutralized)
      |
      v
AI provider  (services/ai — provider abstraction; Groq (default) + Anthropic impls; bounded retries + backoff)
      |
      v
validate structured JSON  (0<=score<=100, enums, array types, string caps; reject 120 / "ninety")
      |
      v
recompute the score server-side  = weighted sum of skills/experience/requirements/education
      |
      v
persist COMPLETED   (or FAILED with a safe error_code; the application + CV are never touched)
      v
GET /api/vacancies/:id/applications  now returns each application's `screening` summary  (PB-06)
```

### Database (migration `005`)

`public.application_screenings` — one row per application
(`application_id` **UNIQUE** = the idempotency guard). Key columns: `status`
(`pending`/`processing`/`completed`/`failed`), `score` (`0..100` check),
`recommendation` / `experience_match` / `education_match` (enum checks),
`skills` / `matched_skills` / `missing_skills` (JSONB arrays), `summary`,
`score_breakdown` (per-dimension sub-scores + weights), `model_provider` /
`model_name` / `screening_version`, `error_code`, `attempts`. Indexes on
`vacancy_id`, `status`, `(vacancy_id, score desc)`. **RLS enabled with no
policies** — backend-only via the service-role key, exactly like `applications`.
There is deliberately **no** `hired`/`rejected`/`selected` value: this table
cannot express a hiring decision.

### API

| endpoint | notes |
|---|---|
| `GET /api/vacancies/:id/applications` | unchanged shape + each application now carries a `screening` object (`status`, `score`, `recommendation`, `matched_skills`, `missing_skills`, `summary`, `ai_screening_rank`, `processed_at`, …). |
| `GET /api/applications/:id/screening` | HR only, owner-checked; the full screening result for one application. `{ screening: { status: "not_started" } }` if it has not run. |
| `POST /api/applications/:id/screening/retry` | HR only, owner-checked; (re)queues one application's screening — covers **failed**, still-**pending** (e.g. submitted before the AI key was set), and re-running a **completed** one. `503 SCREENING_UNAVAILABLE` if no provider key is configured. |
| `POST /api/vacancies/:id/screenings/run-pending` | HR only, owner-checked; bulk-queues every application under the vacancy whose screening has not completed. Returns `{ queued, total }`. Backs the "Run pending screenings" button on the AI Screening page. |

Initial screening is still automatic and fire-and-forget after an application is stored; these endpoints only let HR re-drive it. Results surface both inline on **Applications** and, ranked by score, on the dedicated **AI Screening** page (`ai-screening.html`).

### Security

- AI API keys and `SUPABASE_SERVICE_ROLE_KEY` are read **server-side only**;
  the browser never sees them and AI calls only happen on the backend.
- The CV is downloaded privately, converted to **text**, and only the
  job-relevant text is sent to the AI provider — never the file, never to the
  frontend.
- CV content is **untrusted**: it is wrapped in explicit delimiters, the
  delimiter/instruction-fence tokens are stripped from the CV text, and the
  system prompt tells the model to treat everything inside as data.
- The model's output is **not trusted**: it is schema-validated and the score
  is recomputed server-side from weighted dimensions before anything is stored.
- CV contents, extracted text, prompts and API keys are **never logged** —
  structured logs carry ids, provider/model names, score and duration only.
- Screening results are internal HR data — applicants can never read them (RLS,
  no anon policy, backend-only).
- Fairness: the prompt forbids using protected characteristics and the
  candidate name/contact details; scoring dimensions are job-relevant only.

### Tests

`cd backend && npm test` also runs `screeningResultValidation`,
`cvTextExtraction` (real PDF/DOCX fixtures), `screeningPrompt` and
`screeningPipeline` (the full extract → prompt → validate → score pipeline with
an injected fake provider — no network).

## PB-06: HR reviews the AI-filtered applicants

The **human review** stage. HR opens a vacancy's **AI Screening** page, sees its
applicants ranked by the AI CV-match score PB-05 already stored, and opens an
individual **Applicant Review**. Everything here is **read-only** — opening an
applicant never re-runs AI screening and never changes the application, its
status, the score, the ranking or the summary. Candidate selection is PB-07 and
is deliberately absent: there is no hire / reject / shortlist / "move to
interview" action.

### Flow

```
Vacancies → open a published vacancy → "View AI screening"
      │      (or the AI Screening sidebar item → pick a vacancy)
      ▼
ai-screening.html#vacancy=<id>
      │  GET /api/vacancies/:id/applications   (owner-checked; each row carries its `screening`)
      ▼
Applicants ranked by score (highest first); summary shows
count / screened / average score / top match
      │  "View" on a row
      ▼
applicant-review.html#id=<applicationId>&vacancy=<vacancyId>
      │  GET /api/applications/:id/review    (owner-checked)
      ▼
Applicant details + AI Screening Score + rank + recommendation
+ matched / missing skills + experience & education match + AI summary
      │  "View CV" / "Download CV"
      ▼
GET /api/applications/:id/cv[?download=1]  →  short-lived signed URL (120s, private bucket)
```

### API

| endpoint | notes |
|---|---|
| `GET /api/applications/:id/review` | **new.** HR only, owner-checked via the parent vacancy. Returns `{ application, vacancy, screening }` — applicant contact details, the vacancy summary, and the stored screening result (via the same public-safe projection and advisory `ai_screening_rank` as the list). An application under another HR user's vacancy is reported as `404`, so nothing leaks. Read-only. |
| `GET /api/applications/:id/cv` | unchanged, plus an optional `?download=1` that mints the signed URL with a `download` disposition (used by "Download CV" and for DOCX files browsers cannot preview inline). |
| `GET /api/vacancies/:id/applications` | unchanged — already returns each application's `screening` summary; the AI Screening list now also shows the vacancy header (title · department · location) and average / top score. |

### Database

**No schema changes.** `application_screenings` (migration `005`) already stores
the score, recommendation, matched / missing skills, experience & education
match and summary. Ranking is derived deterministically from the persisted
score (highest first; unscored last) — the same ordering the list and the
review page share.

### Security

- Every PB-06 route is `authenticateUser` + `requireHR`, then an explicit
  "caller owns the parent vacancy" check (`getVacancyForUser`) before any
  applicant data or CV is returned. Changing `vacancyId` / `applicationId` in a
  URL to someone else's data returns `404`.
- CVs stay in the **private** `candidate-cvs` bucket and are only ever reached
  through a 120-second signed URL minted server-side; the service-role key is
  never exposed to the browser.
- The review payload is a deliberate projection — no `cv_path`, no
  `error_detail`, no internal screening diagnostics.

### Frontend

- `ai-screening.html` / `aiScreeningPage.js` — the ranked list (from PB-05) gains
  a vacancy header, average / top-score summary items, a per-row **View** action
  and a footer reminder that the results are advisory.
- `applicant-review.html` / `applicantReviewPage.js` / `css/pages/applicant-review.css`
  — **new** read-only applicant review screen (breadcrumb, applicant info, AI
  score + meter + rank, matched / missing skill chips, experience & education
  match, AI summary, View / Download CV, loading / empty-pending / error /
  CV-unavailable states, "recommendations only" disclaimer).
- `vacancy.html` — the published panel gains a **View AI screening** link.

## PB-07 & PB-08 — not yet implemented

Both are the last pieces of Sprint 1 and are currently **not started**:

- **PB-07 — HR selects candidates for interviews.** This is the bridge
  between Sprint 1 and Sprint 2: HR reviews the AI-ranked, human-checked
  applicants from PB-06 and picks who moves forward. It needs an application
  status transition (e.g. `submitted -> shortlisted`/`selected`) that nothing
  currently writes — PB-06 is deliberately read-only today. Once PB-07
  exists, "selected candidate" is the input to PB-09 (interview level
  selection) in Sprint 2.
- **PB-08 — HR closes a job vacancy.** A `PUBLISHED -> CLOSED` transition
  (mirroring the `DRAFT -> PUBLISHED` one PB-02 already implements), after
  which the vacancy should stop accepting new applications and drop off the
  Applicant Portal listing (see the Sprint 1 update above) while still being
  visible to HR.

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

Copy `backend/.env.example` to `backend/.env` and fill in the Supabase values.
The rest are optional:

| Variable                    | Where to find it                                      |
|------------------------------|--------------------------------------------------------|
| `PORT`                       | Any free port, default `5000`                          |
| `SUPABASE_URL`               | Supabase Dashboard > Project Settings > API             |
| `SUPABASE_ANON_KEY`          | Supabase Dashboard > Project Settings > API             |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase Dashboard > Project Settings > API (**server-only, never commit**) |
| `FRONTEND_URL`               | *(optional)* frontend origin; localhost + private-LAN origins are allowed automatically |
| `CORS_ORIGINS`               | *(optional)* extra allowed browser origins, comma-separated (e.g. a deployed URL) |
| `CORS_ALLOW_ANY`             | *(optional)* `true` reflects every origin — only behind a trusted proxy |
| `APP_URL`                    | *(optional)* fallback base URL for the application link when a request has no `Origin` header |
| `CV_MAX_BYTES`               | *(optional)* max CV upload size in bytes; defaults to `5242880` (5 MiB)     |
| `AI_PROVIDER`                | *(PB-05)* AI provider for CV screening; `groq` (default) or `anthropic`     |
| `AI_MODEL`                   | *(PB-05)* provider model id; default `openai/gpt-oss-120b` (Groq)           |
| `GROQ_API_KEY`               | *(PB-05)* **server-only secret** for the default `groq` provider. Leave blank to keep AI screening inactive (rows stay `pending`) |
| `ANTHROPIC_API_KEY`          | *(PB-05)* **server-only secret**, only when `AI_PROVIDER=anthropic`        |
| `AI_EFFORT` / `AI_MAX_OUTPUT_TOKENS` / `AI_REQUEST_TIMEOUT_MS` / `AI_TEMPERATURE` / `AI_SCORE_WEIGHTS` / `AI_SCREENING_ENABLED` | *(PB-05, optional)* screening tuning — see `.env.example` |

Run:

```
npm run dev
```

### 2. Database

In the Supabase SQL editor, run the migrations in order:

1. [`backend/sql/001_create_profiles.sql`](backend/sql/001_create_profiles.sql) — `profiles` table (links `auth.users` to an HR role), RLS self-read only.
2. [`backend/sql/002_create_job_vacancies.sql`](backend/sql/002_create_job_vacancies.sql) — `job_vacancies` table (PB-01).
3. [`backend/sql/003_add_vacancy_publishing.sql`](backend/sql/003_add_vacancy_publishing.sql) — `public_token` + `published_at` (PB-02).
4. [`backend/sql/004_create_applications.sql`](backend/sql/004_create_applications.sql) — `applications` table + private `candidate-cvs` storage bucket (PB-03).
5. [`backend/sql/005_create_application_screenings.sql`](backend/sql/005_create_application_screenings.sql) — `application_screenings` table (PB-05 AI CV screening results), RLS with no policies.

There is no self-service HR sign-up. To create your first HR user:

1. Create the user under Authentication > Users in the Supabase dashboard (or have them sign up).
2. Copy their user ID, then run:
   ```sql
   insert into public.profiles (auth_user_id, email, role)
   values ('<auth-user-uuid>', 'hr@example.com', 'hr');
   ```

### 3. Frontend

`frontend/js/config.js` holds the public (browser-safe) Supabase URL and anon
key — fill in the same two values from the table above. You do **not** need to
set an API URL: the frontend calls the backend on **the same host that served
the page, port 5000**, so it works from `localhost`, `127.0.0.1` or the
machine's LAN IP with no edits.

Serve the `frontend/` folder with any static file server. For example:

```
npx serve frontend -l 5500
```

or use the VS Code "Live Server" extension. Then open
`http://localhost:5500/login.html` (or `http://<your-lan-ip>:5500/login.html`).

See [`frontend/README.md`](frontend/README.md) for the full folder layout and
conventions.

### 4. Seed demo data (optional, development only)

`backend/scripts/seed.js` fills a development database with a realistic
end-to-end scenario using the same service-layer functions the API itself
calls, so it stays valid however far the schema has been built out:

- 1 HR user, 1 hiring manager, 1 management user, and 4 employees spanning
  Engineering, Finance and Human Resources at junior/mid/senior/lead seniority.
- 3 vacancies owned by the HR user: one draft, one published, one closed.
- 6 applications against the published vacancy, each with a small generated
  PDF CV uploaded to the private `candidate-cvs` bucket.
- Availability slots for every employee across the next 14 days.
- One full interview process for a selected candidate: 3 default stages, one
  scheduled interview, and one submitted evaluation.

Run it from `backend/`:

```
npm run seed -- --force
```

(or set `SEED_ALLOW=true` instead of passing `--force`). It refuses to run
when `NODE_ENV=production`, and refuses without one of those two flags
otherwise — this is a safety gate, not a suggestion, since it writes real rows
and Supabase Auth users into whatever project `backend/.env` points at.

Re-running it is safe: every person, vacancy and application is looked up by
a stable `@altrium-seed.test` email or a `[Seed] …` title first and only
created if missing, so it never duplicates data.

**Demo login credentials** (development only — never use in a real
deployment): every seeded account uses the password `Altrium-Seed-2026!`.
Login emails follow the pattern `<role>@altrium-seed.test`, e.g.
`hr@altrium-seed.test`, `hiring-manager@altrium-seed.test`,
`management@altrium-seed.test`, `employee-1@altrium-seed.test`. The script
prints the exact list (and the current employees' departments/seniority) at
the end of each run.

### Runs on any laptop

There is nothing machine-specific to change:

- **CORS** — the backend allows `localhost`, `127.0.0.1` and private-LAN origins
  (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) on any port automatically
  (`backend/src/config/cors.js`). Set `CORS_ORIGINS` (comma-separated) only to
  add a non-local origin such as a deployed URL.
- **API URL** — resolved from `window.location` at runtime. Override with
  `?apiBase=http://host:5000/api` in the URL (remembered afterwards) or
  `window.__ALTRIUM_API_BASE__` if the backend runs on a different host/port.
- **Public application link** — built from the HR user's own browser origin, so
  the copied `apply.html#token=…` link points at the host they are using.

> **Getting a CORS error?** Restart the backend after editing `backend/.env`,
> and make sure the API request and the page use hosts that resolve to the same
> machine (both `localhost`, or both the LAN IP — not one of each).

## Security notes

Audited end-to-end in Step 7.2 of `DEVELOPMENT_PLAN.md` against every route,
every table and every response projection added through Phase 6; two
ownership-leak findings from that audit are fixed and covered by
`backend/test/vacancyOwnershipError.test.js`.

**Secrets and auth**
- `SUPABASE_SERVICE_ROLE_KEY` is read only in `backend/src/config/supabase.js` and never sent to the browser; `frontend/js/config.js` holds only the anon key, which is designed to be public (access is enforced by the backend + RLS, not by keeping it secret).
- Passwords are handled entirely by Supabase Auth; nothing here stores or hashes passwords.
- Every role (`hr`, `employee`, `hiring_manager`, `management`) is decided server-side by looking up `profiles.role` (`auth.middleware.js`'s `requireRole`), never from anything the client sends. An "interviewer" is not a separate role — any active `employee`/`hr`/`hiring_manager` profile that meets a stage's requirements can be assigned one.

**Authorization pattern**
- Every non-public route is `authenticateUser` → `requireRole(...)` → an explicit ownership or assignment check inside the service (vacancy ownership via `created_by`, interview-assignment via `interview_interviewers`, pipeline membership via `candidate_interview_processes`). Reading or acting on someone else's record returns **404, not 403** — a 403 there would itself confirm the record exists. `backend/src/utils/vacancyOwnershipError.js` centralises this translation for every caller of `vacancyService.getVacancyForUser`/`publishVacancy`/`closeVacancy`.
- Role separation is enforced per route, not just per resource: `hiring_manager`/`management` can read the hiring pipeline but HR cannot (`hiring.routes.js`), and only `hiring_manager` (never `management`) can record a hire/reject decision (`hiring.routes.js`'s stricter `requireRole` on the decision route).

**Database**
- Every table has RLS **enabled**. `profiles` and `job_vacancies` have narrow per-owner `select`/`insert` policies (self-read, own-vacancy-only); every other table (`applications`, `application_screenings`, `notifications`, `interview_availability`, `interviews`, `interview_interviewers`, `interview_evaluations`, `hiring_decisions`, the interview-process tables, …) has RLS enabled with **no** policies at all — access is backend-only via the service-role key. A leaked anon/authenticated key can read or write none of them.
- CVs live in a **private** storage bucket behind short-lived (120s) signed URLs, minted only after an ownership or assignment check; `cv_path` itself is never returned in any API response.

**Candidate privacy boundary**
- A candidate never has an authenticated session — every candidate-facing surface is either the public, rate-limited `/api/public/*` routes or a notification. Both are deliberate, explicit-allow-list projections, never a copy of an internal row with fields deleted: the public vacancy listing/detail exposes only job-posting fields plus the vacancy's own `public_token` (no internal id, no HR identity); candidate notification payloads (interview scheduled/cancelled, hiring decision) carry only what the template explicitly reads off its context, so an AI score, rank, interviewer name/comment, HR note, other candidate's data, or the hiring decision's own `reason` text can never reach one even if it were accidentally attached upstream — asserted by polluted-context tests in `backend/test/notificationTemplates.test.js`.
- An interviewer (an ordinary employee) sees a candidate's name, the vacancy, the schedule and the CV — never the AI screening score/recommendation/skills, other candidates, or another interviewer's evaluation (`backend/test/interviewVisibility.test.js`). A Hiring Manager, whose job is to weigh that evidence, is the one role allowed to see the AI summary and every interviewer's feedback together — but still never `cv_path` or an application it doesn't have a `candidate_interview_process` for.
- The `DRAFT -> PUBLISHED` transition and the `public_token` are set only by the backend; a request body cannot influence them.
- Applicant submissions never touch Supabase directly; the browser only talks to the backend, which validates every field and the CV bytes (magic-byte + extension check, not just the claimed MIME type) before anything is stored.

**Input handling**
- CSV export (`backend/src/utils/csv.js`) neutralises spreadsheet formula injection: any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe *before* quoting.
- Every `LIKE`/`ilike` search term is escaped for both the wildcard characters (`%`, `_`) and PostgREST's `or()` grammar (quotes, backslashes) before being interpolated into a filter.
- CV storage paths are a fresh UUID per upload, never derived from the applicant's filename — no path traversal or collision is possible.
- Both public, unauthenticated write/read endpoints under `/api/public` are per-IP rate-limited (`backend/src/middleware/rateLimit.js`); every other route requires a valid Supabase bearer token first.

**Operational**
- Backend error responses never include stack traces, SQL errors, or Supabase internals — the generic handler always returns a fixed message, with details only in the server-side console log (as ids and short messages, never CV text, prompts, or full request bodies).
- CORS reflects an origin only if it is explicitly configured, a localhost/private-LAN address, or the deployed frontend's own origin; arbitrary public internet origins are rejected unless added to `CORS_ORIGINS`.

## Remaining Sprint 1 work

Done: Step 0 (HR Login), PB-01 (Create Job Vacancy — draft), PB-02 (Publish
Vacancy — public link generated), PB-03 (Applicant submits a CV application),
PB-04 (HR reviews the application list + opens CVs), PB-05 (AI-assisted
CV screening — score, recommendation, matched/missing skills, summary stored per
application; advisory only), PB-06 (HR reviews the AI-filtered applicants —
ranked AI Screening list + read-only Applicant Review with secure CV access).

Still to do, in rough order — each links to its build step in
[`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md):

- [ ] **PB-02/PB-03 update** (plan Steps 1.1 + 1.2) — public `GET /api/public/vacancies` list
  endpoint + a public Applicant Portal listing page, so applicants discover
  vacancies by browsing instead of only via a manually shared link (see
  [Sprint 1 update](#sprint-1-update--public-applicant-portal)).
- [ ] **PB-07** (plan Step 1.3) — HR selects candidates for interviews (new
  application status transition; this is the bridge into Sprint 2).
- [ ] **PB-08** (plan Step 1.4) — HR closes a job vacancy (`PUBLISHED ->
  CLOSED`; removes it from the Applicant Portal).

Application `status` stays `submitted` today — neither the AI screening
pipeline nor PB-06 changes it, and no HR status transitions exist yet.

## Sprint 2 — Interview, Hiring & Management (not started)

Sprint 2 takes an HR-selected candidate (PB-07) through a configurable,
per-vacancy interview process, schedules interviews against real employee
availability, collects structured interviewer evaluations, and lets a Hiring
Manager make the final call. **None of this is implemented yet** — no tables,
no routes, no pages. This section is the full spec to build against, carried
over from the updated product backlog.

**To build it:** [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) Phases 2–6 break
this spec into 13 ordered steps (schema → API → UI per capability), each with a
copy-paste prompt. Start with plan Step 2.1 (roles) and 2.2 (interview process
schema) — everything else depends on those two.

### How Sprint 1 hands off to Sprint 2

```
Applicant -> Application -> CV -> AI Screening -> HR Review -> Candidate Selected   (Sprint 1, PB-07)
Candidate Selected -> Interview Process -> Interviews -> Interview Results
   -> Hiring Manager -> Hire / Reject                                              (Sprint 2)
```

### PB-09 — HR selects the candidate's interview level

After PB-07 selects a candidate, HR picks an interview level:
**Internship/Entry, Junior, Mid-Level, or Senior**. The level drives which
default interview stages load next (PB-10) — an internship candidate doesn't
need the same process as a senior hire.

### PB-10 — System displays default interview stages

Given a vacancy + level, the system loads a default stage list. Defaults are
**per vacancy**, not hard-coded per level — e.g. "Junior" for a Software
Engineer role might default to `HR/Behavioural -> Technical -> Hiring
Manager`, while "Junior" for an Accountant role might default to
`HR/Behavioural -> Accounting Knowledge -> Hiring Manager`. Do not hard-code
`Junior = Technical Interview` globally.

### PB-11 — HR customizes the interview stages

Defaults are a starting point, not a fixed process. HR can:

- **Add** a stage (e.g. insert a System Design round)
- **Remove** a stage
- **Reorder** stages (move up / move down)

`Default → HR customizes → Final interview process` per vacancy+candidate.

### PB-12 — HR configures each interview stage

For every stage, HR sets who's allowed to interview:

- Department (e.g. IT)
- Minimum seniority (e.g. Senior)
- Number of interviewers required (usually 1; see the two-interviewer note
  below)
- Duration (e.g. 60 minutes)

Example: *Technical Interview → IT dept, Senior+, 1 interviewer, 60 min* means
"find an existing IT employee with Senior-level experience."

**What is an interviewer?** Not a separate account/role — any existing
employee. When HR assigns an employee to a stage, that employee *becomes* the
interviewer for that one interview. No duplicate accounts, no new login.

```
EMPLOYEE -> assigned to an interview -> INTERVIEWER (for that interview only)
```

### PB-13 — Interviewer manages availability

An employee (e.g. a Senior Software Engineer with existing dev work,
meetings, etc.) logs into their **existing** account and opens an *Interview
Availability Calendar* to add slots (date + start time + end time), and can
hold multiple slots across multiple days. This is self-service so HR isn't
manually chasing "are you free Wednesday?" over chat.

### PB-14 — HR views interviewer availability

When scheduling a stage, HR sees which employees matching that stage's
requirements (PB-12) are available and when, via a scheduling calendar.
**Important:** availability must be checked against *already-scheduled
interviews too*, not just the raw slots the employee marked — otherwise two
candidates could get double-booked into the same interviewer/hour. Booked
time should show as unavailable even inside a marked-available window.

### PB-15 — HR assigns an interviewer

HR picks a suitable, available employee and assigns them to the
candidate+stage. This creates the relationship
`Interviewer -> assigned to -> Stage -> Candidate`.

Some stages may need **two interviewers** (e.g. a System Design round with a
Senior Engineer + a Technical Lead) — scheduling then needs a time where
*both* are available (the overlap of their slots). This is a stretch goal:
build the schema so it's supported, but shipping single-interviewer
assignment first is acceptable if time is short.

### PB-16 — HR schedules the interview

Once candidate + stage + interviewer + date + time are all chosen, HR clicks
**Schedule Interview**, which stores a scheduled `Interview` row (status
`scheduled`).

### PB-17 — System sends interview notifications

On scheduling, both sides get notified:

- **Candidate:** role, stage, date, time.
- **Interviewer:** candidate name, stage, date, time.

HR can also see the scheduled interview from their side.

### PB-18 — Interviewer views assigned interviews

The employee's existing dashboard gains an "Upcoming Interviews" panel
(candidate, position, stage, date/time, a "View Interview" action). No new
account needed — same login as PB-13.

### PB-19 — Interviewer records interview ratings and feedback

After conducting the interview, the interviewer submits a **structured**
evaluation rather than a single good/bad flag — per-dimension ratings (e.g.
Technical Knowledge, Problem Solving, Communication, Role Knowledge, each out
of 5), an overall rating, and free-text comments. This is the interviewer's
last responsibility in the flow; everything after this belongs to the Hiring
Manager.

### PB-20 — Hiring Manager reviews interview results and candidate progress

The Hiring Manager's dashboard lists candidates currently in process per
vacancy, with the AI score (PB-05) alongside every completed stage's rating
(HR interview, Technical, System Design, etc.). Drilling into a candidate
shows, per stage: interviewer, rating, comments, status.

### PB-21 — Hiring Manager makes the final hiring decision

A binary decision — **Hire** or **Reject** — sets `Candidate Status` to
`HIRED` or `REJECTED`.

### PB-22 — System sends the final decision to HR and the candidate

- HR is told the outcome (hired/not selected) plainly.
- The candidate gets a simple congratulations/thank-you message.
- The candidate must **never** see internal data: other candidates' scores,
  AI ranking, interviewer comments, or internal HR notes.

### PB-23 — Management views recruitment dashboard and pipeline

A funnel view of the whole process for a period, e.g.
`Applications -> AI Screening -> HR Selected -> Interviews -> Final Review -> Hired/Rejected`,
plus summary cards (Open Vacancies, Applications, Shortlisted, Interviews,
Hired, Rejected).

### PB-24 — Management generates recruitment reports

A report (vacancies created, applications, AI-shortlisted, HR-selected,
interviews completed, hired, rejected) for a given period. Export format
(PDF/Excel/on-screen only) is left to the team's capacity — nothing here
requires a specific format.

### Database shape for Sprint 2

These are the relationships to design around, not a final migration —
finalize exact types/constraints when Sprint 2 work starts (following the
`00N_description.sql` numbering already used in `backend/sql/`).

| Table | Key columns | Purpose |
|---|---|---|
| `employees` | `employee_id`, `name`, `email`, `department`, `job_position`, `seniority_level` | The existing workforce; interviewers are employees, not a separate account type. Likely maps onto (or extends) the existing `profiles` table rather than being wholly new. |
| `interview_stages` | `stage_id`, `stage_name`, `description` | Reusable stage catalogue (HR/Behavioural, Technical, System Design, …). |
| `vacancy_interview_stages` | `id`, `vacancy_id`, `stage_id`, `stage_order` | The **per-vacancy, per-candidate** ordered stage list — what makes PB-10/11 possible without hard-coding stages per level. |
| `interviewer_requirements` | `id`, `stage_id`, `department`, `minimum_seniority`, `required_number` | PB-12 — what kind of employee a stage needs; drives the PB-14 search. |
| `interview_availability` | `availability_id`, `employee_id`, `date`, `start_time`, `end_time` | PB-13 — self-service slots; powers the PB-14 calendar. |
| `interviews` | `interview_id`, `candidate_id`, `vacancy_id`, `stage_id`, `interviewer_id`, `date`, `start_time`, `end_time`, `status` | PB-15/16 — the scheduled event connecting candidate + vacancy + stage + interviewer + time. |
| `interview_evaluations` | `evaluation_id`, `interview_id`, `interviewer_id`, `technical_rating`, `problem_solving_rating`, `communication_rating`, `overall_rating`, `comments` | PB-19 — the interviewer's structured result. |
| `hiring_decisions` | `decision_id`, `candidate_id`, `hiring_manager_id`, `decision`, `decision_date` | PB-21 — the final Hire/Reject record. |

### Full Sprint 2 pipeline

```
SELECT INTERVIEW LEVEL (PB-09)
        |
LOAD DEFAULT STAGES (PB-10)
        |
HR CUSTOMIZES STAGES (PB-11)
        |
CONFIGURE EACH STAGE / INTERVIEWER REQUIREMENTS (PB-12)
        |
FIND SUITABLE EMPLOYEES -> CHECK AVAILABILITY CALENDAR (PB-13/14)
        |
ASSIGN INTERVIEWER (PB-15)
        |
SCHEDULE INTERVIEW (PB-16)
        |
NOTIFICATION (PB-17) -> candidate + interviewer
        |
CONDUCT INTERVIEW -> RATING + COMMENTS -> SUBMIT EVALUATION (PB-18/19)
        |
========================================================
HIRING MANAGER REVIEWS RESULTS + PIPELINE (PB-20)
        |
FINAL HIRING DECISION: HIRE / REJECT (PB-21)
        |
NOTIFY HR + CANDIDATE (PB-22)
        |
MANAGEMENT DASHBOARD: PIPELINE (PB-23) + REPORTS (PB-24)
```

### Suggested developer split (from the brief)

- **Applicant/HR side** — Sprint 1 (as built) plus the Sprint 2 HR flows:
  select candidate/level, view/add/remove/reorder stages, configure each
  stage, find interviewers, view availability, assign, schedule.
- **Employee/Interviewer side** — availability calendar (add/edit), view
  assigned interviews, view candidate/interview detail, submit evaluation.
  Reuses the existing employee/HR login — no new account type.
- **Hiring Manager side** — dashboard, candidate pipeline, candidate detail,
  interview results + interviewer feedback, final decision (hire/reject).
- **Dashboard / Reporting / Integration** — wires Applications → AI Results →
  HR Selection → Interviews → Evaluations → Hiring Decisions into the
  recruitment dashboard, candidate pipeline, and recruitment reports
  (PB-23/24).


