# Altrium — Recruitment Management Platform

## Backlog status at a glance

| ID | Item | Sprint | Status |
|---|---|---|---|
| Step 0 | HR login (Supabase Auth + HR authorization) | 1 | ✅ Done |
| PB-01 | HR creates a job vacancy | 1 | ✅ Done |
| PB-02 | HR publishes a job vacancy | 1 | ✅ Done |
| PB-03 | Applicant views and submits a job application | 1 | ✅ Done |
| PB-04 | System stores submitted applications | 1 | ✅ Done |
| PB-05 | System filters CVs using AI | 1 | ✅ Done |
| PB-06 | HR reviews AI-filtered applicants | 1 | ✅ Done |
| PB-07 | HR selects candidates for interviews | 1 | ✅ Done |
| PB-08 | HR closes a job vacancy | 1 | ✅ Done |
| PB-09 | HR selects the candidate's interview level | 2 | ✅ Done |
| PB-10 | System displays default interview stages | 2 | ✅ Done |
| PB-11 | HR customizes the interview stages | 2 | ✅ Done |
| PB-12 | HR configures interviewer requirements per stage | 2 | ✅ Done |
| PB-13 | Interviewer manages availability via calendar | 2 | ✅ Done |
| PB-14 | HR views interviewer availability | 2 | ✅ Done |
| PB-15 | HR assigns available interviewers | 2 | ✅ Done |
| PB-16 | HR schedules interviews | 2 | ✅ Done |
| PB-17 | System sends interview notifications | 2 | ✅ Done |
| PB-18 | Interviewer views assigned interviews | 2 | ✅ Done |
| PB-19 | Interviewer records ratings and feedback | 2 | ✅ Done |
| PB-20 | Hiring Manager reviews interview results | 2 | ✅ Done |
| PB-21 | Hiring Manager makes the final hiring decision | 2 | ✅ Done |
| PB-22 | System sends the final decision to HR + candidate | 2 | ✅ Done |
| PB-23 | Management views recruitment dashboard/pipeline | 2 | ✅ Done |
| PB-24 | Management generates recruitment reports | 2 | ✅ Done |

Every backlog item is implemented and covered by the automated test suite
(`cd backend && npm test`). PB-01…PB-08 are documented in place below; PB-09…
PB-24 (Sprint 2 — interview process, scheduling, the interviewer/Hiring
Manager/management experiences) are documented in
[Sprint 2 — Interview, Hiring & Management](#sprint-2--interview-hiring--management).
See [End-to-end verification](#end-to-end-verification) for a single script
that exercises the whole pipeline start to finish.

> 🛠 **How it was built.** [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) is the
> step-by-step implementation playbook this was built against — 7 phases, each
> with its deliverables, API contract, definition of done, and the prompt used
> to build it. It also tracks completion status and anything deliberately
> deferred. This README describes the system as it stands; that file describes
> how each piece came to be.

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

> The public link below still works exactly as described, and HR can still
> copy and share it directly. Applicants no longer depend on that link alone,
> though: published vacancies also appear on the public Applicant Portal
> listing — see [Sprint 1 update](#sprint-1-update--public-applicant-portal).

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
| `403` | authenticated but not HR |
| `404` | `VACANCY_NOT_FOUND` — unknown id, **or** the vacancy belongs to another HR user (reported identically, never `403`, so nothing about someone else's vacancy leaks — see [Security notes](#security-notes)) |
| `409` | `VACANCY_ALREADY_PUBLISHED` (re-publish) or `VACANCY_NOT_DRAFT` (e.g. closed) |

**`GET /api/vacancies/:id`** — HR only. Returns one vacancy the caller owns
(`404` if unknown, **or** `404` if owned by someone else — never `403`, which
would confirm it exists), including `public_url` (null until published).
Backs the details page.

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

> The applicant can arrive at this form two ways: browsing the public
> Applicant Portal and clicking a vacancy card, or opening a link HR shared
> directly. Both land on the same `apply.html#token=…` flow described below.
> See [Sprint 1 update](#sprint-1-update--public-applicant-portal).

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

Sprint 1's original design made HR responsible for distributing every vacancy
link by hand. That's not a practical recruitment-portal design — HR shouldn't
have to push a link out through email/WhatsApp/LinkedIn every time a role
opens. Published vacancies also appear on a public, browsable **Applicant
Portal**, so an applicant can find a role by browsing instead of only via a
link HR sent them:

```
HR -> Create Vacancy -> Publish Vacancy -> Applicant Portal (frontend/portal.html)
   -> Applicant browses / searches / filters by department -> clicks a card
   -> apply.html#token=<public_token>  (same PB-03 form + CV upload, unchanged)
```

The direct token link (PB-02) still works unchanged — the portal is an
additional discovery path, not a replacement for it.

### What changed, concretely

- **`GET /api/public/vacancies?q=&department=&limit=&offset=`** — new,
  unauthenticated (`public.controller.js` / `vacancy.service.js`'s
  `listPublishedVacancies`). Returns every `status = 'published'` vacancy,
  newest-first by `published_at`, with the **same public-safe field set** PB-02's
  token endpoint already used (`job_title`, `department`, `location`,
  `employment_type`, `experience_level`, `number_of_positions`,
  `job_description`, `job_requirements`, `published_at`) plus `public_token`
  (each card's link to `apply.html`) — never `id`, `created_by`, or any other
  internal field. `q` searches `job_title`/`department` (case-insensitive,
  wildcard- and quote-escaped before use); `department` is an exact match
  against one of the fixed department values; `limit`/`offset` paginate
  (validated by `backend/src/utils/vacancyListQuery.js`, covered by
  `vacancyListQuery.test.js`). Rate-limited like every other `/api/public`
  route.
- **`frontend/portal.html` + `portalPage.js` + `portal.css`** — the
  unauthenticated landing page: a search box, a department filter populated
  from the results themselves, one card per vacancy, and a link straight into
  the existing `apply.html#token=…` flow.
- No applicant account system was added or is needed — applicants still never
  log in to browse or apply, on the portal or via a direct link.

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
| `GET /api/vacancies/:id/applications` | HR only; `404` if unknown, **or** if the vacancy belongs to another HR user (never `403`, which would confirm it exists). Returns public-safe applicant fields only. |
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

## PB-07: HR selects candidates for interviews

The bridge from Sprint 1 into Sprint 2. HR moves an applicant through a status
lifecycle and, once `selected`, that application becomes the "candidate" Sprint
2's interview process (PB-09+) operates on. The AI never writes any of these
transitions — PB-05's screening result stays exactly as computed, whatever HR
decides.

### State machine (`backend/src/utils/applicationStatus.js`, pure)

```
submitted ──► under_review ──► shortlisted ──► selected ──► hired      (PB-21)
     │             │                │                   └─► rejected   (PB-21)
     └─────────────┴────────────────┴──────────────────────► rejected
rejected ──► under_review        (re-open a rejection)
```

`selected -> hired` / `selected -> rejected` are only ever reached through the
Hiring Manager's audited decision (PB-21) — the ordinary status endpoint below
refuses `hired` as a target even though the shared transition table allows it,
so a hire can never happen without a `hiring_decisions` row behind it.

### Two ways to select

- **Bulk, from the AI Screening list** (`candidates.html` /
  `POST /api/vacancies/:id/candidates/select`, body `{ applicationIds: [...] }`)
  — `submitted`/`shortlisted` → `selected` for every id given, atomically and
  idempotently (a duplicate/concurrent call never double-selects). Every id must
  belong to the vacancy the caller owns, or the whole request is rejected.
- **One at a time, from Applicant Review** (`applicant-review.html`'s decision
  panel / `PATCH /api/applications/:id/status`, body `{ status, hr_note? }`) —
  any transition in the state machine above, with an optional internal note
  (never shown to the candidate). Buttons shown are derived from
  `ALLOWED_TRANSITIONS`, mirrored in the frontend.

### Database (migrations `006` + `008`)

`006_add_candidate_selection.sql` adds `selected_at` / `selected_by` (audit
pair, required exactly when `status = 'selected'`) and the
`(vacancy_id, status)` index. `008_add_application_status_audit.sql` adds
`status_updated_at` / `status_updated_by` / `hr_note` (an optional, internal-only
note, max 1000 chars) — the audit trail for every transition after that,
including the bulk-select path.

### API

| endpoint | notes |
|---|---|
| `POST /api/vacancies/:id/candidates/select` | HR only, owner-checked. Body `{ applicationIds }`. Returns the refreshed `selected` list with each one's screening summary. |
| `PATCH /api/applications/:id/status` | HR only, owner-checked. Body `{ status, hr_note? }`. `409 INVALID_STATUS_TRANSITION` for an illegal move (including same-state); the update is a single conditional `UPDATE ... WHERE status = <current>`, so it's atomic under concurrency. |

## PB-08: HR closes a job vacancy

A one-way `PUBLISHED -> CLOSED` transition (migration
`007_add_vacancy_closing.sql`, adding `closed_at`/`closed_by` with the same
required-exactly-when-closed audit constraint PB-02's `published_at` uses).
Closing never deletes anything: the vacancy, its applications, CVs, screening
results and selected candidates all stay exactly as they were, fully visible
to the owning HR user. The only externally-visible effects are that
`getApplicableVacancyByToken` (PB-03's submission check) and the Applicant
Portal listing (PB-02's Sprint 1 update) both stop treating it as open — the
public token link itself stays resolvable and shows a "no longer accepting
applications" state instead of the form.

**`POST /api/vacancies/:id/close`** — HR only, owner-checked, no body.
`evaluateCloseTransition` (`backend/src/utils/vacancyClosure.js`, pure) decides
the transition: `409 VACANCY_NOT_PUBLISHED` for a draft (nothing to close),
`409 VACANCY_ALREADY_CLOSED` for one already closed — no re-closing, no
re-opening, ever.

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

In the Supabase SQL editor, run every migration in `backend/sql/` **in
order** — each one is append-only and safe to re-run (`if not exists` /
`if exists` throughout):

1. [`001_create_profiles.sql`](backend/sql/001_create_profiles.sql) — `profiles` table (links `auth.users` to a role), RLS self-read only.
2. [`002_create_job_vacancies.sql`](backend/sql/002_create_job_vacancies.sql) — `job_vacancies` table (PB-01).
3. [`003_add_vacancy_publishing.sql`](backend/sql/003_add_vacancy_publishing.sql) — `public_token` + `published_at` (PB-02).
4. [`004_create_applications.sql`](backend/sql/004_create_applications.sql) — `applications` table + private `candidate-cvs` storage bucket (PB-03).
5. [`005_create_application_screenings.sql`](backend/sql/005_create_application_screenings.sql) — `application_screenings` table (PB-05 AI CV screening results), RLS with no policies.
6. [`006_add_candidate_selection.sql`](backend/sql/006_add_candidate_selection.sql) — `selected_at`/`selected_by` audit columns (PB-07 bulk select).
7. [`007_add_vacancy_closing.sql`](backend/sql/007_add_vacancy_closing.sql) — `closed_at`/`closed_by` audit columns (PB-08).
8. [`008_add_application_status_audit.sql`](backend/sql/008_add_application_status_audit.sql) — `status_updated_at`/`status_updated_by`/`hr_note` (PB-07's full status lifecycle).
9. [`009_extend_profiles_employees.sql`](backend/sql/009_extend_profiles_employees.sql) — the employee directory: `full_name`/`department`/`job_position`/`seniority_level`/`is_active` + the `employee`/`hiring_manager`/`management`/`admin` roles.
10. [`010_create_interview_process.sql`](backend/sql/010_create_interview_process.sql) — the interview stage catalogue/defaults (template) + per-candidate process/stages (instance) (PB-09…12).
11. [`011_create_interview_availability.sql`](backend/sql/011_create_interview_availability.sql) — `interview_availability`, with a GiST exclusion constraint against overlapping slots (PB-13).
12. [`012_create_interviews.sql`](backend/sql/012_create_interviews.sql) — `interviews` + `interview_interviewers`, with a GiST exclusion constraint against double-booking an interviewer (PB-15/16).
13. [`013_create_notifications.sql`](backend/sql/013_create_notifications.sql) — `notifications` (PB-17).
14. [`014_create_interview_evaluations.sql`](backend/sql/014_create_interview_evaluations.sql) — `interview_evaluations` (PB-19).
15. [`015_create_hiring_decisions.sql`](backend/sql/015_create_hiring_decisions.sql) — `hiring_decisions`, **and** widens the `applications` status check to allow `hired` + loosens the migration-006 selection-audit constraint (PB-21) — see [PB-20…PB-22](#pb-20pb-22--hiring-manager-review-and-the-final-decision).

Every table has RLS **enabled**; only `profiles` and `job_vacancies` have any
policy (both narrow, self-/owner-scoped) — see [Security notes](#security-notes).
There is no self-service sign-up for any role. To create your first HR user:

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

## End-to-end verification

A single manual script covering the whole pipeline, start to finish, on a
fresh database. `npm run seed -- --force` (see [Setup](#4-seed-demo-data-optional-development-only))
can create the HR/employee/hiring-manager accounts, a published vacancy and
its applications for you — skip straight to step 6 if you use it, using its
printed login emails / `Altrium-Seed-2026!` password. Each row is one page,
one action, and what you should see happen.

| # | Page | Action | Expected result |
|---|---|---|---|
| 1 | `login.html` | Sign in as the HR user. | Redirected to `dashboard.html`; header shows the HR user's email. |
| 2 | `create-vacancy.html` | Fill in the vacancy form, **Save Draft**. | Success screen; the vacancy appears on `vacancies.html` with a **Draft** badge. |
| 3 | `vacancy.html?id=…` | Open the draft, **Publish Vacancy**, confirm. | Badge flips to **Published**; a public link (`apply.html#token=…`) is shown with a Copy button. |
| 4 | `portal.html` (no login — open in a private/incognito window) | Browse the Applicant Portal, optionally search or filter by department. | The vacancy's card appears with its title/department/location; clicking **View Job** opens `apply.html#token=…`. |
| 5 | `apply.html#token=…` | Fill in the applicant's details, attach a PDF or DOCX CV, submit. | Success screen with an `APP-XXXXXXXX` reference. No login was ever required. |
| 6 | *(background)* | Wait a few seconds (or configure `GROQ_API_KEY`/`ANTHROPIC_API_KEY` first if you haven't). | AI screening runs automatically after submission; if no AI key is configured, screening stays `pending` and every later step still works with an unscored applicant. |
| 7 | `ai-screening.html` | As HR, pick the vacancy. | The applicant appears in the ranked list with a score/recommendation (once screening completes) and a status badge. |
| 8 | `applicant-review.html#id=…` | Click **View** on the applicant. | Full AI result (score, matched/missing skills, summary) plus the CV, all read-only. |
| 9 | Same page — Selection Decision panel | Click **Select for Interview** (or **Shortlist** then **Select**). | Status badge updates to **Selected**; a "Set up interviews" link appears. |
| 10 | `interview-setup.html#id=…` | Pick an interview level (e.g. Junior); optionally add/remove/reorder the loaded default stages and adjust each stage's department/seniority/duration. | The stage list saves and shows each stage as **Pending**. |
| 11 | *(new browser session)* `login.html` → `my-availability.html` | Sign in as an employee who matches a stage's requirements; add an availability slot covering **today**, e.g. `00:00`–`02:00` (see the tip below). | The slot appears on the employee's calendar. |
| 12 | Back in the HR session, `interview-setup.html#id=…` | On the first stage, **Find Interviewers**, pick the employee from step 11, choose a time inside their published slot, **Schedule**. | Stage flips to **Scheduled**; the interview appears on HR's `interviews.html`. |
| 13 | Either session — click the 🔔 bell in the header | Check notifications. | The candidate has an email-intent row logged (see `notification.transport.js`); the interviewer has an in-app "New interview assigned" notification with an unread dot. |
| 14 | Employee session, `employee-dashboard.html` → `interview-detail.html#id=…` | Open **My Interviews**, click the scheduled interview, then submit the four rating dimensions + comments. | If the scheduled time hasn't passed yet, a note explains the form isn't available yet instead — see the tip below. Once submitted, a read-only summary with the computed overall rating replaces the form. |
| 15 | `login.html` → `hiring-dashboard.html` | Sign in as the hiring manager. | The candidate appears in the pipeline with the AI score, this stage's rating, and "1 of *N* stages" progress. |
| 16 | `hiring-candidate.html#id=…` | Open the candidate; if any stage is incomplete, check "I understand…" and give a reason; choose **Hire** or **Reject**, confirm. | The page re-renders in its decided state (badge, who decided, when, reason); the application's status becomes `hired`/`rejected`. |
| 17 | HR's and the candidate's notifications | Check the bell (HR) / the logged intent (candidate). | HR sees who decided and the outcome; the candidate's own message names only the job title and the outcome — never a score, rank, or anyone else's data. |
| 18 | `reports.html` (HR or management) and `dashboard.html` (HR) | Load the report for a range covering today. | The funnel's Applications/AI Screening/HR Selected/Interviews/Hired-or-Rejected counts, the summary cards, and the per-vacancy CSV row all reflect this one candidate's journey. |

> **Tip — scheduling something you can evaluate immediately.** Steps 11/14 need
> the interview's scheduled time to already be in the past before its
> evaluation form appears (`evaluation.service.js` refuses one for an
> interview that "hasn't started yet"). The simplest way to see step 14
> immediately, rather than waiting: give the interviewer an availability slot
> for **today** covering an early hour (e.g. `00:00`–`02:00`), then schedule
> the interview inside that window — exactly what `backend/scripts/seed.js`
> does for its own one-interview demo.

## Security notes

Audited end-to-end in Step 7.2 of `DEVELOPMENT_PLAN.md` against every route,
every table and every response projection added through Phase 6; the one
HIGH finding from that audit (a 403-vs-404 ownership leak on 4 endpoints) is
fixed and covered by `backend/test/vacancyOwnershipError.test.js`.

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

## Sprint 2 — Interview, Hiring & Management

Sprint 2 takes an HR-selected candidate (PB-07) through a configurable,
per-vacancy interview process, schedules interviews against real employee
availability, collects structured interviewer evaluations, and lets a Hiring
Manager make the final call — then feeds the outcome into a management
dashboard and report. It was built in the 13 steps tracked in
[`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) Phases 2–6; this section
documents the result grouped by capability rather than by individual backlog
item, since several PB numbers were built together as one feature.

```
Applicant -> Application -> CV -> AI Screening -> HR Review -> Candidate Selected      (Sprint 1, PB-07)
        |
Interview process configured (PB-09…12) -> Interviewer available & scheduled (PB-13…16)
        |                                          -> both sides notified (PB-17)
        v
Interviewer conducts + evaluates (PB-18/19)
        |
Hiring Manager reviews every stage's feedback + the AI score, decides (PB-20/21)
        |
HR + candidate notified (PB-22) -> Management dashboard + report reflect the outcome (PB-23/24)
```

**Interviewers are not a separate account type.** Every person in this
pipeline — HR, employee, hiring manager, management — signs in through the
same `login.html` / Supabase Auth flow as Sprint 1. `profiles.role` (migration
`009`) gained `employee` / `hiring_manager` / `management` / `admin` alongside
`hr`, plus `full_name` / `department` / `job_position` / `seniority_level` /
`is_active`. An "interviewer" is just any active `employee`/`hr`/`hiring_manager`
profile that meets a stage's department + seniority requirement — assigning
one to a stage doesn't change their account or role.

### PB-09…PB-12 — the interview process (level, default stages, customization, per-stage requirements)

HR picks a level (`intern`/`junior`/`mid`/`senior`) for a selected candidate;
the system loads that vacancy's default stage list (falling back to a global
default for the level if the vacancy has none), and HR can add/remove/reorder
stages and set each one's department, minimum seniority, interviewer count and
duration before anything is scheduled.

**Database** (`010_create_interview_process.sql`) — two layers: a **template**
(`interview_stages` catalogue + `interview_stage_defaults`, seeded with global
defaults per level) and an **instance**, copied from the template into
`candidate_interview_processes` + `candidate_interview_stages` the moment HR
picks a level — so editing the template later can never rewrite a process
already underway, and two candidates for the same vacancy can end up with
different stage lists.

**API** (all under `/api/applications/:id/interview-process`, HR only,
owner-checked): `POST /` (create, body `{ interview_level }`), `GET /` (the
process + ordered stages), `PUT /stages` (full replacement — a stage already
`scheduled`/`completed` can be edited in place but never removed or reordered
out from under a live booking), `DELETE /` (cancel, refused if any stage is
already locked). Frontend: `interview-setup.html`.

### PB-13…PB-16 — availability and scheduling

Any employee publishes their own free time; HR finds who's both **qualified**
(department + seniority) and **actually free** for a stage, then books it.

**Database** (`011_create_interview_availability.sql`,
`012_create_interviews.sql`) — `interview_availability` (one row per
self-published slot; a GiST exclusion constraint is the real guarantee that
one employee never has two overlapping slots), `interviews` + the
`interview_interviewers` join table (supports a panel of interviewers per
interview from day one, though scheduling ships single-interviewer). A second
GiST exclusion constraint on `interview_interviewers` is what actually
prevents double-booking an interviewer across two different candidates — the
"is this slot free" check in the API is only a friendly pre-check for that
same guarantee.

**API:** `GET/POST /api/availability`, `DELETE /api/availability/:id` (an
employee's own calendar only — never another employee's, and never deletable
once it has a booked interview). `GET
/api/interview-stages/:stageId/available-interviewers?from=&to=` — qualified
employees plus their real free time (published availability **minus**
already-booked interviews, so a marked-available hour that's since been
double-committed never shows as free). `POST
/api/interview-stages/:stageId/schedule` (body `{ scheduled_date, start_time,
interviewer_ids }`; `end_time` is always derived from the stage's own
duration, never accepted from the client) and `POST /api/interviews/:id/cancel`
(frees the interviewer's time immediately). `GET /api/interviews` — HR's own
upcoming interviews across every vacancy they own. Frontend:
`my-availability.html`, `interview-setup.html` (find + assign + schedule),
`interviews.html` (HR's list + cancel).

### PB-17 — interview notifications

Scheduling or cancelling an interview notifies both the candidate and every
assigned interviewer, in the background — a notification failure can never
turn a successful booking into an error response. **Database**
(`013_create_notifications.sql`): one `notifications` table for both in-app
recipients (`recipient_profile_id`) and candidates (`recipient_email`, since
they have no account). There's no real email provider wired up yet —
`notification.transport.js` persists the row (which is what powers the bell)
and logs only the notification type and a **hash** of the recipient email,
never the address or the message content; a real provider (SES, Postmark, …)
plugs into that one seam later without any call site changing.

The **candidate template is a hard privacy boundary**: it's built by
explicitly reading only `job_title`/`stage_name`/`scheduled_date`/`start_time`
off its context, never by copying an internal row and deleting fields — so an
AI score, another candidate's data, an interviewer's name/comment, or an HR
note can never reach a candidate's notification even if one were accidentally
attached upstream. Asserted by a polluted-context test in
`backend/test/notificationTemplates.test.js`. **API:** `GET
/api/notifications?unread_only=`, `POST /api/notifications/:id/read` — any
signed-in role, scoped to the caller's own notifications. Frontend:
`js/components/NotificationBell.js`, mounted into every signed-in page's
header by `AppShell.js`.

### PB-18…PB-19 — the interviewer experience

An employee assigned to an interview sees it on their dashboard and can open
its detail — candidate name, the vacancy, the schedule, and the candidate's CV
— then, once the scheduled time has passed, submits a structured evaluation.
**They see nothing else**: no AI screening score/recommendation/skills, no
other candidate, no other interviewer's evaluation, no HR note. Not being
assigned to an interview returns `404`, never `403` (a `403` there would
itself confirm the interview exists).

**Database** (`014_create_interview_evaluations.sql`) — `interview_evaluations`:
four 1–5 dimension ratings (technical, problem-solving, communication, role
knowledge), `overall_rating` (**always computed server-side** as their mean,
never accepted from the client — the same principle PB-05 already applies to
the AI score), free-text comments, one row per `(interview, interviewer)`
ever. **API:** `GET /api/interviews/mine?scope=upcoming|past`, `GET
/api/interviews/:id` (assignment-checked detail, plus a CV signed-URL route
shared with HR's own). `POST/GET /api/interviews/:id/evaluation` — submitting
before the interview's start time returns `409 INTERVIEW_NOT_STARTED`; a
second submission returns `409 EVALUATION_EXISTS`; once every assigned
interviewer has submitted, the interview and its stage both flip to
`completed` automatically. Frontend: `employee-dashboard.html` ("My
Interviews"), `interview-detail.html` (detail + evaluation form).

### PB-20…PB-22 — Hiring Manager review and the final decision

A `hiring_manager` (never HR — role separation is deliberate here) sees every
candidate with an active interview process, ranked decision-pending-first,
with the AI score alongside a rating for every completed stage. Drilling into
one candidate shows every interviewer's full feedback for every stage, the AI
screening summary, and the candidate's CV — the Hiring Manager is the one role
allowed to see AI results and interviewer feedback together, since weighing
them is the whole point of the role. They then record **Hire** or **Reject**,
once, with an optional reason (required if any stage is still incomplete).

**Database** (`015_create_hiring_decisions.sql`) — `hiring_decisions`, unique
per application; this migration also had to widen the `applications` status
check to allow `hired` (an easy-to-miss migration gotcha the tests specifically
cover) and loosen a stale two-way audit constraint from migration `006` that
would otherwise have wiped the `selected_at`/`selected_by` audit trail the
moment a candidate was decided. **API:** `GET /api/hiring/candidates?vacancy_id=&status=`
and `GET /api/hiring/candidates/:applicationId` (`hiring_manager` **or**
`management`), `GET .../cv` (pipeline-membership checked, same signed-URL
mechanism as HR's), `POST /api/hiring/candidates/:applicationId/decision`
(`hiring_manager` only — `management` is read-only everywhere in this
phase). Deciding while stages are incomplete requires an explicit
`acknowledge_incomplete: true` plus a reason, else `409 STAGES_INCOMPLETE`; a
second decision returns `409 DECISION_EXISTS`; decision and application status
are updated together and compensated (the decision row is removed) if a
concurrent change ever makes the two disagree. The decision notifies the
vacancy's HR owner (who + when + the outcome) and the candidate (a short
congratulations/thank-you naming only the job title — never the AI score,
rank, interviewer comments, HR notes, other candidates, the decision's own
reason text, or any internal id; asserted the same way PB-17's templates are).
Frontend: `hiring-dashboard.html`, `hiring-candidate.html`.

### PB-23…PB-24 — the management dashboard and reports

A funnel — `Applications -> AI Screening -> HR Selected -> Interviews -> Final
Review -> Hired / Rejected` — plus summary cards (Open Vacancies,
Applications, Shortlisted, Interviews, Hired, Rejected), for a date range, for
`management` (everything) or `hr` (their own vacancies only — HR needs its own
numbers too). No charting library: every bar is a CSS-width `<div>` driven by
a percentage already computed server-side, every figure is also plain text,
and the funnel has a visually-hidden `<table>` equivalent for screen readers.

**"HR Selected"** counts `shortlisted`/`selected`/`hired`, and `rejected`
**only** when a `hiring_decisions` row shows it was rejected after being
selected — an application rejected earlier in the funnel (before ever being
selected) never reached that stage and must not count there. This distinction,
and every other funnel rule, lives in one pure, exhaustively-tested module
(`backend/src/utils/pipelineMetrics.js`) so the dashboard and the CSV export
below can never disagree with each other.

**API:** `GET /api/reports/pipeline?from=&to=&vacancy_id=` (the funnel +
cards; no schema — everything is computed from existing tables in a small
fixed number of batched queries, never a per-vacancy loop). `GET
/api/reports/recruitment[?format=csv]` — the same period as a totals row plus
a per-vacancy breakdown; `?format=csv` downloads it with a sanitized filename.
**CSV formula injection is explicitly neutralised**: any cell whose value
starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an
apostrophe *before* quoting (`backend/src/utils/csv.js`), so a vacancy titled
e.g. `=cmd|' /C calc'!A0` can never execute as a formula when the file is
opened in Excel or Sheets — covered exhaustively in
`backend/test/csv.test.js`. Frontend: `reports.html` (both roles), plus the
same summary cards reused on the HR `dashboard.html`.

### Tests

`cd backend && npm test` covers every pure module Sprint 2 added: the interview
scheduling/availability matching math, the interviewer-visibility privacy
projection, evaluation validation and rounding, the hiring-decision state
machine, the candidate-pipeline row-shaping, the funnel/report metrics, and CSV
serialization/injection-safety — all offline, no network or database.


