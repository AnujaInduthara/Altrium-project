# Altrium — Development Plan (remaining features)

A step-by-step build order for everything that is **not yet implemented**: the
Sprint 1 remainder (Applicant Portal, PB-07, PB-08) and all of Sprint 2
(PB-09 → PB-24), finishing with a hardening pass.

Every step is sized to be **one branch → one PR**, and every step ends with a
**copy-paste prompt** you can hand to Claude Code (Sonnet, high thinking mode).

> Companion docs: [`README.md`](README.md) is the record of what already
> exists and how it works. This file is the record of what's left and how to
> build it. Keep both current — the last step of the plan updates the README.

---

## 1. How to use this document

1. **Work top to bottom.** The steps are dependency-ordered. Skipping ahead
   (e.g. scheduling before the employee directory exists) will fail.
2. **One step = one session = one PR.** Start a fresh Claude Code session per
   step so context stays clean, and open a PR per step so review stays small.
3. **Paste the step's prompt verbatim.** Each prompt is self-contained: it
   tells the model what to read, what to build, what the rules are, and how to
   know it's done. Add your own notes at the end if you want a variation.
4. **Apply the migration before testing.** Any step with a `backend/sql/0NN_*`
   file needs that SQL run in the Supabase SQL editor before the feature works.
   The model cannot do this for you.
5. **Run the tests** (`cd backend && npm test`) and click through the UI before
   marking a step done. Backend tests are pure/offline by design.

**Recommended model settings:** Sonnet, high thinking. These prompts ask for
real design decisions (state machines, conflict detection, privacy
projections), not boilerplate.

### Per-step checklist

```
[ ] Branch created:            git checkout -b <step-branch>
[ ] Prompt pasted, code written
[ ] Migration applied in Supabase (if the step has one)
[ ] cd backend && npm test      → all green
[ ] Manual click-through of the new UI
[ ] Definition of Done items all ticked
[ ] PR opened and merged
```

---

## 2. Where the project stands today

Verified against the code, not assumed:

| Area | State |
|---|---|
| Auth | Supabase Auth + `profiles.role` checked server-side. `requireHR` in [`auth.middleware.js`](backend/src/middleware/auth.middleware.js) **hardcodes** `role !== 'hr'` — it must be generalized before any non-HR role exists. |
| Vacancies | Create (draft), publish (`DRAFT → PUBLISHED`, atomic), HR list/detail. `closed` is already an allowed status in migration `002` — **PB-08 needs no migration**. |
| Public access | Only `GET /api/public/vacancies/:token` (one vacancy, by token). **There is no listing endpoint and no portal page.** |
| Applications | Submit + store + CV in private bucket + HR review list + CV signed URLs. |
| Application status | Stuck at `submitted`. The check constraint in `004` already allows `under_review`, `shortlisted`, `rejected`, `selected` — **PB-07 needs no new status values**. It does **not** allow `hired`; that constraint must be altered in Phase 5. |
| AI screening | Full pipeline (extract → prompt → validate → re-score → persist), advisory only. |
| HR review | Ranked AI Screening list + read-only Applicant Review. |
| Sidebar | [`navigation.js`](frontend/js/config/navigation.js) already links `interviews.html`, `candidates.html`, `reports.html`, `settings.html` — **all four are dead links today.** This plan fills three of them; Settings stays out of scope. |
| Migrations | `001` … `005` applied. **Next number is `006`.** |
| Tests | `node --test` over `backend/test/*.test.js`. Pure unit tests, no network, no DB. |

---

## 3. House rules

Every prompt in this document inherits these. When a prompt says *"follow the
house rules in DEVELOPMENT_PLAN.md §3"*, this is what it means.

### Architecture

- **Backend layering:** `routes/*.routes.js` → `controllers/*.controller.js` →
  `services/*.service.js`. Routes wire middleware only. Controllers translate
  HTTP ↔ service calls and never talk to Supabase. Services own all data
  access and never touch `req`/`res`.
- **Typed service errors.** Follow `VacancyError` in
  [`vacancy.service.js`](backend/src/services/vacancy.service.js): a class with
  `isXError = true`, a `code`, and an HTTP `status`, thrown by the service and
  translated by the controller. Never leak DB errors.
- **Responses** always go through `successResponse` / `errorResponse` in
  [`utils/response.js`](backend/src/utils/response.js). Validation failures use
  the `{ code: 'VALIDATION_ERROR', message, fields: {...} }` shape.
- **Explicit column lists.** Never `select('*')`. Define a `RETURNING` constant
  and a separate public-safe projection, as `vacancy.service.js` does.
- **Frontend:** one page = `X.html` + `css/pages/x.css` + `js/pages/xPage.js`.
  Network logic lives in `js/services/*.js` and returns `{ ok, status, body }`.
  DOM behaviour lives in `js/components/*` factories. Page controllers are the
  only place those meet.
- **Build DOM with `document.createElement` + `textContent`.** Never
  `innerHTML` with server or user data. This is the app's XSS defence.
- **Styling starts in `css/base/tokens.css`.** No hard-coded colours or
  spacing in page CSS; use the existing tokens and component classes
  (`card`, `button`, `badge`, `field`, `alert`, `modal`, `page-header`).

### Database

- Migrations are **append-only**: `backend/sql/0NN_description.sql`, next
  number in sequence, never edit an applied file.
- **RLS enabled, no policies** on every new table — access is backend-only via
  the service-role key, matching `applications` and `application_screenings`.
- Reuse the shared `public.set_updated_at()` trigger function.
- Constraints belong in the database (checks, uniques, foreign keys), not only
  in JS. State machines get **conditional updates** (`.eq('status', <from>)`)
  so transitions are atomic under concurrency, like `publishVacancy`.
- Index for the queries you actually run, and say which query each index serves.

### Security

- Every HR/employee/manager route: `authenticateUser` → role check → **explicit
  ownership/assignment check** before returning anyone's data.
- Reading someone else's record returns **`404`, not `403`**, where `403` would
  confirm the record exists (this is the existing convention for applications).
- Candidate/applicant-facing payloads must never carry AI scores, rankings,
  interviewer comments, internal notes, other candidates' data, `cv_path`, or
  internal ids. Use a deliberate projection, not a delete-list.
- No secrets in the browser. CVs stay in the private bucket behind short-lived
  signed URLs.
- Never log PII, CV text, prompts, or tokens.

### Testing

- Add unit tests to `backend/test/*.test.js` (`node --test`).
- Tests must be **pure and offline**: extract the logic worth testing into a
  helper in `utils/` or `config/` and test that. No network, no Supabase, no
  filesystem beyond fixtures.
- Every step below names the specific helper it expects to be tested.

### Scope discipline

- Build **only** the step. No speculative abstractions, no "while I'm here"
  refactors, no feature flags, no backwards-compatibility shims.
- Don't add comments that restate the code. Comment only non-obvious *why*.
- Don't create new markdown files unless the step asks for one.

---

## 4. Build order and dependencies

```
PHASE 1 — Finish Sprint 1
  1.1 Public vacancy list API ──┐
  1.2 Applicant Portal page  ───┘
  1.3 PB-07 candidate selection ──────────────┐
  1.4 PB-08 close vacancy                     │
                                              │
PHASE 2 — Sprint 2 foundations                │
  2.1 Roles + employee directory ─────────┐   │
  2.2 Interview process schema ───────────┼───┤
  2.3 Interview process API  ─────────────┤   │
  2.4 Interview process UI   ─────────────┘   │
                                              │
PHASE 3 — Availability & scheduling           │
  3.1 PB-13 availability  ────────┐           │
  3.2 PB-14 matching + free slots ┤           │
  3.3 PB-15/16 assign + schedule ─┤───────────┘
  3.4 PB-17 notifications ────────┘
                                   │
PHASE 4 — Interviewer              │
  4.1 PB-18 interviewer dashboard ─┤
  4.2 PB-19 evaluation ────────────┤
                                   │
PHASE 5 — Hiring Manager           │
  5.1 PB-20 review ────────────────┤
  5.2 PB-21 decision ──────────────┤
  5.3 PB-22 decision notifications ┘
                                   │
PHASE 6 — Management               │
  6.1 PB-23 pipeline dashboard ────┤
  6.2 PB-24 reports + export ──────┘
                                   │
PHASE 7 — Hardening                │
  7.1 Seed data  7.2 Security audit  7.3 Docs + E2E
```

**Hard dependencies:** 2.1 blocks everything in Phases 3–6 (no roles = no
interviewers, no hiring managers). 2.2 blocks 2.3/2.4 and all of Phase 3. 3.3
blocks Phase 4. 4.2 blocks 5.1.

### Parallelising across four developers

After **2.1 and 2.2 are merged** (do those two sequentially, together, first —
they are the shared foundation), the work splits cleanly:

| Dev | Owns | Steps |
|---|---|---|
| 1 — HR/Applicant | Portal, selection, interview setup | 1.1, 1.2, 1.3, 1.4, 2.3, 2.4, 3.2, 3.3 |
| 2 — Employee/Interviewer | Availability, interviewer experience | 3.1, 3.4, 4.1, 4.2 |
| 3 — Hiring Manager | Review and decision | 5.1, 5.2, 5.3 |
| 4 — Dashboard/Reporting | Pipeline and reports, integration | 6.1, 6.2, 7.1 |

Dev 3 and Dev 4 are blocked on Phase 4 landing, so give them 7.1 (seed data)
and schema review early so they aren't idle.

---

# PHASE 1 — Finish Sprint 1

## Step 1.1 — Public vacancy listing API `[PB-02 update]`

**Goal.** Let anyone (no auth) fetch the list of currently published vacancies,
so the Applicant Portal has something to render. This is the backend half of
replacing manual link-sharing.

**Depends on:** nothing.

**Deliverables**

- Modify [`backend/src/services/vacancy.service.js`](backend/src/services/vacancy.service.js) — add `listPublishedVacancies(query)`.
- New `backend/src/utils/vacancyListQuery.js` — pure query parser/sanitiser.
- Modify [`backend/src/controllers/public.controller.js`](backend/src/controllers/public.controller.js) — add `listPublishedVacancies`.
- Modify [`backend/src/routes/public.routes.js`](backend/src/routes/public.routes.js) — add the route under `lookupLimiter`.
- New `backend/test/vacancyListQuery.test.js`.

**API contract**

| Endpoint | `GET /api/public/vacancies` |
|---|---|
| Auth | none (public) |
| Query | `q` (title/department contains, ≤ 100 chars), `department` (must be a known department), `limit` (1–50, default 20), `offset` (≥ 0, default 0) |
| Returns | `{ success: true, data: { vacancies: [...], total, limit, offset } }` |
| Per item | the existing `PUBLIC_FIELDS` **plus `public_token`** (the portal needs it to link to `apply.html#token=…`) — never `id`, `created_by`, `created_at`, `updated_at` |
| Errors | `400 VALIDATION_ERROR` on a bad query, `429` rate limited, `500` generic |

**Design note to respect.** `public_token` stops being a secret the moment
vacancies are publicly listed — that is intentional and fine: it only ever
grants "view this *published* vacancy and apply to it", which is exactly what
the portal is for. Do **not** change the token scheme; `apply.html` already
works this way and closed/draft vacancies still 404.

**Definition of Done**

- [ ] `curl http://localhost:5000/api/public/vacancies` returns only published vacancies.
- [ ] A draft or closed vacancy never appears in the list.
- [ ] No response field exposes `id`, `created_by` or audit timestamps.
- [ ] Bad query values return `400`, not a 500 or a silent full-table scan.
- [ ] `npm test` passes, including the new query-parser tests.

**Prompt**

```text
You are working in the Altrium recruitment platform repo (Node/Express +
Supabase backend, static vanilla-JS frontend).

READ FIRST
- DEVELOPMENT_PLAN.md sections 2 and 3 (house rules) — follow them exactly.
- backend/src/services/vacancy.service.js (note RETURNING, PUBLIC_FIELDS,
  getPublishedVacancyByToken, and the VacancyError pattern)
- backend/src/controllers/public.controller.js
- backend/src/routes/public.routes.js
- backend/src/config/vacancyOptions.js
- backend/src/utils/vacancyValidation.js (for the validation style)

TASK — implement DEVELOPMENT_PLAN.md Step 1.1: a public, unauthenticated
endpoint that lists currently published vacancies, so an Applicant Portal page
can show open roles instead of HR sharing links by hand.

BUILD
1. backend/src/utils/vacancyListQuery.js — a pure exported function
   parseVacancyListQuery(rawQuery) that returns { valid, errors, value } with
   value = { q, department, limit, offset }. Rules: q is optional, trimmed,
   max 100 chars, and must be treated as a literal substring (escape % and _
   so a user cannot inject a LIKE wildcard); department is optional and must be
   one of the departments in config/vacancyOptions.js; limit is an integer
   1..50 defaulting to 20; offset is an integer >= 0 defaulting to 0. Anything
   else is a validation error. No imports from Supabase or Express.
2. vacancy.service.js — add listPublishedVacancies({ q, department, limit,
   offset }). Select PUBLIC_FIELDS plus public_token, filter
   status = 'published', apply the department equality filter and the q
   substring filter across job_title and department (case-insensitive), order
   by published_at desc, apply range(offset, offset+limit-1), and request an
   exact count so the caller can return a total. Return
   { vacancies, total }. Map DB errors through the existing wrapDbError.
3. public.controller.js — add listPublishedVacancies: parse the query, 400 with
   the standard VALIDATION_ERROR shape on failure, otherwise
   successResponse(res, { vacancies, total, limit, offset }). Log failures with
   console.error and return the generic 500 message, like the existing handlers.
4. public.routes.js — register GET /vacancies BEFORE GET /vacancies/:token
   (otherwise the token route can shadow it) and put it behind lookupLimiter.
5. backend/test/vacancyListQuery.test.js — node:test + node:assert. Cover:
   defaults when the query is empty; limit clamping and rejection of 0, 51,
   "abc" and negatives; offset rejection of negatives; unknown department
   rejected; q over 100 chars rejected; and that % and _ inside q are escaped
   rather than passed through.

RULES
- Never return id, created_by, created_at or updated_at on this endpoint.
- Draft and closed vacancies must be impossible to see here.
- Do not modify the existing token endpoint, the apply flow, or any HR route.
- Do not add pagination UI, a frontend page, or caching — API only.

DONE WHEN
- npm test passes from backend/.
- GET /api/public/vacancies returns only published vacancies with the fields
  above, and GET /api/public/vacancies?limit=999 returns 400.
```

---

## Step 1.2 — Applicant Portal page `[PB-02 / PB-03 update]`

**Goal.** The public entry point. An applicant lands on the portal, browses
open roles, opens one, and applies — no account, no link from HR.

**Depends on:** 1.1.

**Deliverables**

- New `frontend/portal.html`, `frontend/css/pages/portal.css`, `frontend/js/pages/portalPage.js`.
- Modify `frontend/css/main.css` (import the new page stylesheet).
- Modify `frontend/js/services/publicVacancyService.js` — add `fetchPublicVacancies(params)`.
- Modify `frontend/login.html` — add a "Looking for a job? View open positions" link to the portal.
- Modify `frontend/vacancy.html` + `frontend/js/pages/vacancyPage.js` — the published panel gains a "View on portal" link alongside the existing copy-link control.

**Definition of Done**

- [ ] `portal.html` loads with **no** sign-in and **no** app shell (like `apply.html`).
- [ ] Cards show title, department, location, employment type, experience level, positions, posted date; each links to `apply.html#token=…`.
- [ ] Search box + department filter work against the API (debounced, server-side).
- [ ] Loading, empty ("No open positions right now"), and error states all render.
- [ ] All text is inserted with `textContent` — verified by creating a vacancy whose title contains `<img src=x onerror=alert(1)>` and seeing it rendered as literal text.
- [ ] Works at phone width with no horizontal scroll.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2 and 3 (house rules) — follow them exactly.
- frontend/apply.html and frontend/js/pages/applyPage.js (the existing PUBLIC,
  no-app-shell page pattern — match its structure and states)
- frontend/js/services/publicVacancyService.js
- frontend/js/pages/vacanciesPage.js (card rendering with createElement +
  textContent, loading/empty/error state handling)
- frontend/css/main.css, frontend/css/base/tokens.css, frontend/css/pages/apply.css
- frontend/js/utils/urlParams.js

CONTEXT — Step 1.1 added GET /api/public/vacancies returning
{ success: true, data: { vacancies: [...], total, limit, offset } } where each
vacancy has job_title, department, location, employment_type, experience_level,
number_of_positions, job_description, job_requirements, published_at and
public_token. It is unauthenticated.

TASK — implement DEVELOPMENT_PLAN.md Step 1.2: a public "Altrium Careers"
Applicant Portal that lists open positions, so applicants find vacancies by
browsing instead of receiving a link from HR.

BUILD
1. frontend/js/services/publicVacancyService.js — add
   fetchPublicVacancies({ q, department, limit, offset }) that builds the query
   string with URLSearchParams (omitting empty values) and returns the same
   { ok, status, body } shape as the existing functions.
2. frontend/portal.html — a public page with no app shell and no Supabase
   dependency: the Altrium brand header, an "Open Positions" heading, a search
   input and a department <select>, plus loading / empty / error / list
   regions. Load the page controller as a module, mirroring apply.html.
3. frontend/js/pages/portalPage.js — fetch on load, render cards, wire the
   search (debounce ~300ms) and the department filter, handle every state, and
   link each card to apply.html#token=<public_token> using withHashParam from
   utils/urlParams.js. Build all DOM with createElement/textContent — never
   innerHTML. Populate the department <select> from the departments the API
   actually returned so it can never filter to an empty set.
4. frontend/css/pages/portal.css + an @import in frontend/css/main.css. Reuse
   the existing card/button/badge/field components and tokens; add only what
   the grid and filter bar genuinely need. Must work at 360px wide.
5. frontend/login.html — add an unobtrusive link to portal.html for applicants.
6. frontend/vacancy.html and frontend/js/pages/vacancyPage.js — in the
   already-published panel, add a "View on portal" link to portal.html next to
   the existing public-link controls. Do not change the publish flow.

RULES
- No authentication anywhere on this page. Do not import supabaseClient,
  AuthService, or mountAppShell.
- No innerHTML with API data.
- Do not change apply.html's submission flow or any backend file.
- Keep the existing public token link scheme exactly as it is.

DONE WHEN
- Serving frontend/ and opening portal.html with no session lists published
  vacancies, and clicking one lands on the working apply form.
- A vacancy titled: <img src=x onerror=alert(1)>
  renders as literal text with no dialog.
- Search and department filtering both hit the API and update the list.
- The page has no horizontal scroll at 360px.
```

---

## Step 1.3 — PB-07: HR selects candidates for interviews

**Goal.** The bridge from Sprint 1 to Sprint 2. HR moves a reviewed applicant
to `shortlisted` / `selected` / `rejected`, with an audit trail. The AI never
writes these — a human does.

**Depends on:** nothing (can run parallel to 1.1/1.2).

**Deliverables**

- New `backend/sql/006_add_application_status_audit.sql`.
- New `backend/src/utils/applicationStatus.js` — the state machine, pure.
- Modify `backend/src/services/application.service.js` — `updateApplicationStatus`.
- Modify `backend/src/controllers/application.controller.js` + `backend/src/routes/application.routes.js`.
- Modify `frontend/js/services/applicationService.js`, `frontend/js/pages/applicantReviewPage.js`, `frontend/applicant-review.html`, `frontend/js/pages/aiScreeningPage.js`.
- New `backend/test/applicationStatus.test.js`.

**Data model (migration `006`).** The status *values* already exist in the
check constraint from `004`; this migration only adds the audit columns:

| column | type | notes |
|---|---|---|
| `status_updated_at` | timestamptz | null until the first HR decision |
| `status_updated_by` | uuid | FK → `auth.users(id)`, the deciding HR user |
| `hr_note` | text | optional internal note, never shown to the candidate |

**State machine**

```
submitted ──► under_review ──► shortlisted ──► selected
     │             │                │
     └─────────────┴────────────────┴──────► rejected
rejected ──► under_review        (re-open a rejection)
selected  ──► (terminal for Sprint 1; Sprint 2 takes over)
```

**Definition of Done**

- [ ] `PATCH /api/applications/:id/status` is HR-only and owner-checked (someone else's application → `404`).
- [ ] An illegal transition returns `409 INVALID_STATUS_TRANSITION` and changes nothing.
- [ ] The update is atomic — conditional on the current status, like `publishVacancy`.
- [ ] Applicant Review shows the current status and offers only legal next actions.
- [ ] The AI Screening list shows each applicant's status badge.
- [ ] Nothing in the screening pipeline writes `status`.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2 and 3 (house rules) — follow them exactly.
- backend/sql/004_create_applications.sql — note the applications_status_allowed
  check constraint ALREADY permits submitted, under_review, shortlisted,
  rejected, selected. Do not redefine it.
- backend/sql/003_add_vacancy_publishing.sql (migration style)
- backend/src/services/vacancy.service.js — publishVacancy, for the atomic
  conditional-update pattern and the typed-error pattern
- backend/src/services/application.service.js
- backend/src/controllers/application.controller.js
- backend/src/routes/application.routes.js
- frontend/js/pages/applicantReviewPage.js and frontend/applicant-review.html
- frontend/js/pages/aiScreeningPage.js
- frontend/js/components/Modal.js and frontend/js/components/Alert.js

TASK — implement DEVELOPMENT_PLAN.md Step 1.3 (PB-07): let an HR user record a
selection decision on an application. This is the handoff into Sprint 2's
interview process. The AI is advisory only and must never write a status.

BUILD
1. backend/sql/006_add_application_status_audit.sql — add status_updated_at
   (timestamptz null), status_updated_by (uuid null, references auth.users(id))
   and hr_note (text null) to public.applications. Use "add column if not
   exists". Add an index on (vacancy_id, status) for the per-vacancy filtered
   lists. Add column comments. Do not touch RLS and do not alter the existing
   status check constraint.
2. backend/src/utils/applicationStatus.js — pure module exporting
   APPLICATION_STATUS, the ALLOWED_TRANSITIONS map, and
   canTransition(from, to) plus validateStatusChange({ current, next, hr_note })
   returning { valid, errors, value }. Legal transitions:
     submitted    -> under_review | shortlisted | rejected
     under_review -> shortlisted | rejected
     shortlisted  -> selected | rejected
     rejected     -> under_review
     selected     -> (none)
   Any same-state transition is invalid. hr_note is optional, trimmed, max 1000
   chars. No Supabase or Express imports.
3. application.service.js — add updateApplicationStatus({ applicationId,
   nextStatus, hrNote, authUserId }). Load the application, resolve its parent
   vacancy and confirm the caller owns it via the existing owner check; if not
   owned or not found, throw the typed not-found error so the controller
   answers 404 (never 403 — do not confirm the row exists). Validate the
   transition, then do a conditional update guarded by .eq('status', current)
   setting status, status_updated_at, status_updated_by and hr_note. If the
   guarded update matches no row, re-read and throw a typed
   INVALID_STATUS_TRANSITION (409). Return the updated public-safe projection.
4. Controller + route — PATCH /api/applications/:id/status, HR-only, body
   { status, hr_note? }. Unknown status value -> 400 VALIDATION_ERROR.
5. Frontend: add updateStatus(id, payload) to js/services/applicationService.js.
   On applicant-review.html show the current status as a badge and add a
   decision panel whose buttons are derived from ALLOWED_TRANSITIONS mirrored in
   the frontend (Shortlist / Select for interview / Reject / Re-open) with an
   optional internal note field. Confirm destructive-sounding actions (Reject)
   with the existing Modal component, show success/error through the Alert
   component, and re-render the panel from the server response. On
   ai-screening.html add a status badge to each row.
6. backend/test/applicationStatus.test.js — cover every legal transition, a
   representative set of illegal ones, same-state rejection, unknown status
   values, and hr_note trimming/length validation.

RULES
- The screening pipeline must not be modified and must never write status.
- Someone else's application returns 404 from this route.
- The candidate-facing side of the app must not gain any new field here;
  hr_note is internal only.
- No new status values, no schema change to the status check constraint.

DONE WHEN
- npm test passes.
- Applying 006 in Supabase then shortlisting/selecting/rejecting from the
  Applicant Review page works, persists, and survives a reload.
- Attempting submitted -> selected returns 409 and leaves the row unchanged.
```

---

## Step 1.4 — PB-08: HR closes a job vacancy

**Goal.** A `PUBLISHED → CLOSED` transition that stops new applications and
removes the role from the portal, while HR keeps full visibility.

**Depends on:** 1.1 (so the portal list already filters by status).

**Deliverables**

- Modify `backend/src/services/vacancy.service.js` — `closeVacancy(id, authUserId)`.
- Modify `backend/src/controllers/vacancy.controller.js` + `backend/src/routes/vacancy.routes.js`.
- Modify `frontend/js/services/vacancyService.js`, `frontend/vacancy.html`, `frontend/js/pages/vacancyPage.js`.
- No migration — `closed` is already an allowed status from migration `002`.

**Definition of Done**

- [ ] `POST /api/vacancies/:id/close` closes a published vacancy the caller owns.
- [ ] Draft → close returns `409 VACANCY_NOT_PUBLISHED`; closing twice returns `409 VACANCY_ALREADY_CLOSED`.
- [ ] A closed vacancy disappears from `GET /api/public/vacancies`.
- [ ] Its `apply.html#token=…` link returns the existing "no longer accepting applications" 404 (already true — verify, don't rebuild).
- [ ] HR still sees the vacancy, its applications and its screenings.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2 and 3 (house rules) — follow them exactly.
- backend/src/services/vacancy.service.js — publishVacancy is the template for
  this transition (ownership check, status guards, atomic conditional update,
  typed VacancyError)
- backend/src/controllers/vacancy.controller.js
- backend/src/routes/vacancy.routes.js
- backend/src/config/vacancyOptions.js (VACANCY_STATUS)
- frontend/js/pages/vacancyPage.js, frontend/vacancy.html
- frontend/js/components/Modal.js

TASK — implement DEVELOPMENT_PLAN.md Step 1.4 (PB-08): HR closes a job vacancy.

BUILD
1. vacancy.service.js — add closeVacancy(id, authUserId) modelled directly on
   publishVacancy: load it, 404 if missing, 403 if another HR user owns it,
   409 VACANCY_ALREADY_CLOSED if already closed, 409 VACANCY_NOT_PUBLISHED for
   anything that is not currently published, then a single conditional update
   guarded by .eq('status', 'published') setting status = 'closed'. If the
   guarded update matches no row, re-read and throw the accurate typed conflict.
   Export it.
2. Controller + route — POST /api/vacancies/:id/close, HR-only, no request body
   (ignore anything sent). Translate the typed error codes to their statuses.
3. Frontend — add close(id) to js/services/vacancyService.js. On vacancy.html,
   when the vacancy is published, show a "Close Vacancy" action that confirms
   through the existing Modal ("Applicants will no longer be able to apply and
   the role will be removed from the public portal. This cannot be undone.")
   and on success re-renders the page in its closed state: closed badge, the
   public link and portal link removed, the close action gone, and the existing
   "View applications" / "View AI screening" links still present and working.

RULES
- No migration. 'closed' is already permitted by migration 002.
- Do not add a re-open transition; closing is one-way for this sprint.
- Do not change the public token endpoints — they already reject non-published
  vacancies. Verify this rather than reimplementing it.
- Do not change how applications or screenings are read.

DONE WHEN
- Publishing then closing a vacancy works, and the button disappears afterwards.
- The closed vacancy is gone from GET /api/public/vacancies and from the portal.
- Opening its old apply link shows the "no longer accepting applications" state.
- HR can still open its applications and AI screening pages.
```

---

# PHASE 2 — Sprint 2 foundations

Phases 3–6 all depend on two things that don't exist yet: **people who aren't
HR** (employees, hiring managers) and **a per-candidate interview process**.
Build these two first, carefully — everything else sits on top.

## Step 2.1 — Roles and the employee directory

**Goal.** Turn `profiles` into a real employee directory with roles,
department, job position and seniority, and generalise the authorization
middleware so non-HR roles can exist.

**Depends on:** nothing, but **blocks Phases 3–6**. Do this first.

**Deliverables**

- New `backend/sql/007_extend_profiles_employees.sql`.
- New `backend/src/config/roles.js` and `backend/src/config/seniority.js`.
- Modify `backend/src/middleware/auth.middleware.js` — add `requireRole(...roles)`.
- Modify `backend/src/services/auth.service.js` — return the new profile columns.
- New `backend/src/services/employee.service.js`, `backend/src/controllers/employee.controller.js`, `backend/src/routes/employee.routes.js`; mount in `backend/src/server.js`.
- Modify `backend/src/controllers/hr.controller.js` — `/api/hr/me` returns the richer profile.
- Modify `frontend/js/services/authService.js` — add a role-aware `requireSession(roles)`.
- Modify `frontend/js/pages/entryPage.js` + `frontend/js/pages/loginPage.js` — route by role after login.
- New `backend/test/seniority.test.js`.

**Data model (migration `007`)** — extends `public.profiles`:

| column | type | notes |
|---|---|---|
| `full_name` | text | display name for interviewer lists |
| `department` | text | must match the `vacancyOptions` department list |
| `job_position` | text | e.g. "Senior Software Engineer" |
| `seniority_level` | text | one of `intern`/`junior`/`mid`/`senior`/`lead` |
| `is_active` | boolean | default `true`; inactive employees are never offered as interviewers |

Plus a **role check constraint**: `hr`, `employee`, `hiring_manager`,
`management`, `admin` — defaulting to `employee` for new rows so a mistake
grants the least privilege, while existing rows keep `hr`.

**Seniority is ordered.** `intern < junior < mid < senior < lead`. "Minimum
seniority: senior" means senior **or above**. That comparison is a pure
function and is the thing the test covers.

**Definition of Done**

- [ ] `requireHR` still works everywhere it's used today (implement it as `requireRole('hr')`).
- [ ] `GET /api/employees?department=&min_seniority=&q=` returns active, matching employees — HR-only.
- [ ] A user with `role = 'employee'` can sign in and is **not** let into HR pages.
- [ ] After login, users land on the right home page for their role.
- [ ] `npm test` covers the seniority comparison including unknown values.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2 and 3 (house rules) — follow them exactly.
- backend/sql/001_create_profiles.sql (the table being extended)
- backend/src/middleware/auth.middleware.js (requireHR hardcodes role === 'hr')
- backend/src/services/auth.service.js (getProfileByAuthUserId selects a fixed
  column list)
- backend/src/controllers/hr.controller.js and backend/src/routes/hr.routes.js
- backend/src/config/vacancyOptions.js (the canonical department list)
- backend/src/server.js (route mounting)
- frontend/js/services/authService.js (requireHRSession)
- frontend/js/pages/entryPage.js, frontend/js/pages/loginPage.js

TASK — implement DEVELOPMENT_PLAN.md Step 2.1. Sprint 2 introduces employees
(who act as interviewers), hiring managers and management. Today the only role
is 'hr' and the middleware hardcodes it. Turn profiles into an employee
directory and generalise authorization. This step blocks all later Sprint 2
work, so it must be exactly right.

BUILD
1. backend/sql/007_extend_profiles_employees.sql — add full_name, department,
   job_position, seniority_level and is_active (boolean not null default true)
   to public.profiles using "add column if not exists". Add a check constraint
   restricting role to hr | employee | hiring_manager | management | admin, and
   a check restricting seniority_level to null or
   intern | junior | mid | senior | lead. Change the column default for role to
   'employee' (least privilege for new rows) without rewriting existing rows.
   Add an index on (role, department, seniority_level) filtered to is_active,
   serving the "find candidate interviewers" query. Add column comments
   explaining that interviewers are ordinary employees, not a separate role.
   Include commented-out example INSERT/UPDATE statements for provisioning a
   few employees and one hiring manager. Do not add RLS policies.
2. backend/src/config/roles.js — export ROLES and helper isRole-style
   constants. backend/src/config/seniority.js — export SENIORITY_LEVELS in
   rank order, seniorityRank(level) returning a number or null for unknown
   values, and meetsMinimumSeniority(actual, minimum) that returns false when
   either value is unknown (fail closed, never fail open).
3. auth.middleware.js — add requireRole(...allowedRoles) which loads the
   profile, 403s if the role is not allowed, and attaches req.profile. Keep the
   existing exported requireHR working by defining it as requireRole('hr') so
   no existing route file has to change. Also reject an inactive profile
   (is_active === false) with 403.
4. auth.service.js — extend getProfileByAuthUserId's select list with
   full_name, department, job_position, seniority_level and is_active.
   hr.controller.js — return those fields from /api/hr/me too.
5. employee.service.js / employee.controller.js / employee.routes.js — a
   GET /api/employees endpoint, HR-only, supporting optional department (must
   be a known department), min_seniority (must be a known level) and q (name or
   job position contains, escaped literal). Return only active employees whose
   role can conduct interviews (employee, hr, hiring_manager) and only the
   fields an interviewer picker needs: profile id, full_name, email, department,
   job_position, seniority_level. Never return auth_user_id. Filter the
   minimum-seniority requirement using meetsMinimumSeniority. Mount at
   /api/employees in server.js.
6. Frontend — add requireSession(loginPage, allowedRoles) to authService.js
   that fetches the profile and redirects unless the role is allowed; keep
   requireHRSession as a thin wrapper over it so existing pages are untouched.
   After login, route by role: hr -> dashboard.html, employee ->
   employee-dashboard.html, hiring_manager -> hiring-dashboard.html,
   management -> reports.html, with dashboard.html as the fallback. Those target
   pages are built in later steps — link to them anyway; do not create stubs.
7. backend/test/seniority.test.js — cover rank ordering, meetsMinimumSeniority
   at, above and below the bar, and unknown/null/uppercase inputs failing
   closed.

RULES
- Do not change any existing route's authorization behaviour. HR routes stay
  HR-only.
- Never trust a client-supplied role; roles come only from the profiles table.
- Do not build any new page in this step.
- Do not rename existing profile columns or break /api/hr/me's current shape —
  only add to it.

DONE WHEN
- npm test passes.
- After applying 007, existing HR login and every existing HR page still work
  unchanged.
- A profile row with role='employee' can sign in but is rejected from HR APIs
  with 403.
- GET /api/employees?department=Engineering&min_seniority=senior returns only
  active Engineering employees at senior or lead.
```

---

## Step 2.2 — Interview process schema `[PB-09 … PB-12 data model]`

**Goal.** The tables that make "different vacancies → different interview
stages" possible without hard-coding, plus the per-candidate copy HR actually
customises.

**Depends on:** 2.1.

**The key design decision — templates vs instances.** Two layers:

- **Template layer** (shared, reusable): a catalogue of stage types and a
  defaults table keyed by *(vacancy, level)* with a *(level)*-only fallback.
  This is what PB-10 reads to propose a starting process.
- **Instance layer** (per candidate): when HR picks a level for a candidate
  (PB-09), the defaults are **copied** into a per-candidate stage list. PB-11
  add/remove/reorder and PB-12 requirements then edit the *copy*.

Copying is what makes the rest safe: editing a template later can never mutate
an interview process that's already underway, and two candidates for the same
vacancy can legitimately have different processes.

**Deliverables**

- New `backend/sql/008_create_interview_process.sql` (tables + seed).
- No application code — schema and seed only, so the migration can be reviewed on its own.

**Tables**

| table | purpose |
|---|---|
| `interview_stages` | Catalogue: `id`, `stage_key` (unique), `stage_name`, `description`, `is_active`. Seeded with HR/Behavioural, Basic Technical, Technical, Technical 1, Technical 2, System Design, Leadership, Accounting Knowledge, Hiring Manager, Final. |
| `interview_stage_defaults` | `id`, `vacancy_id` (**nullable** — null = global default), `interview_level`, `stage_id`, `stage_order`, `duration_minutes`, `department`, `minimum_seniority`, `required_interviewers`. Unique on `(vacancy_id, interview_level, stage_order)`. |
| `candidate_interview_processes` | `id`, `application_id` (**unique**), `vacancy_id`, `interview_level`, `status` (`draft`/`active`/`completed`/`cancelled`), `created_by`, timestamps. |
| `candidate_interview_stages` | `id`, `process_id`, `stage_id` (nullable for a custom stage), `stage_name` (always stored so a renamed template can't rewrite history), `stage_order`, `duration_minutes`, `department`, `minimum_seniority`, `required_interviewers`, `status` (`pending`/`scheduled`/`completed`/`skipped`). Unique on `(process_id, stage_order)`. |

**Seed the global defaults** from the backlog, as `vacancy_id = null` rows:

```
intern : HR/Behavioural → Basic Technical → Final
junior : HR/Behavioural → Technical → Hiring Manager
mid    : HR/Behavioural → Technical 1 → Technical 2 → Hiring Manager
senior : HR/Behavioural → Technical → System Design → Leadership → Final
```

**Definition of Done**

- [ ] Migration applies cleanly on a database that already has `001`–`007`.
- [ ] Selecting global defaults for each level returns the four processes above, in order.
- [ ] A per-vacancy override row wins over the global row for the same level.
- [ ] Deleting a process cascades to its stages; deleting a catalogue stage does **not** destroy per-candidate history.
- [ ] RLS enabled, no policies, on all four tables.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 2.2 — follow them exactly.
- backend/sql/004_create_applications.sql and
  backend/sql/005_create_application_screenings.sql (migration house style:
  header comment explaining the backlog item, checks, indexes with a comment
  naming the query they serve, shared set_updated_at trigger, RLS enabled with
  no policies, table/column comments)
- backend/sql/007_extend_profiles_employees.sql (seniority + department values)
- backend/src/config/vacancyOptions.js

TASK — implement DEVELOPMENT_PLAN.md Step 2.2: the schema behind PB-09..PB-12.
SQL ONLY — no JavaScript in this step.

Design contract you must follow: there is a TEMPLATE layer (a stage catalogue
plus defaults keyed by vacancy+level, with a level-only global fallback) and an
INSTANCE layer (a per-candidate process whose stages are COPIED from the
template when the process is created). HR edits the copy. Editing a template
later must never mutate an in-flight candidate process.

BUILD backend/sql/008_create_interview_process.sql containing:
1. public.interview_stages — id uuid pk, stage_key text unique not null,
   stage_name text not null, description text, is_active boolean not null
   default true, timestamps + updated_at trigger. Seed (on conflict do nothing)
   the stage keys: hr_behavioural, basic_technical, technical, technical_1,
   technical_2, system_design, leadership, accounting_knowledge, hiring_manager,
   final — with readable display names.
2. public.interview_stage_defaults — id uuid pk, vacancy_id uuid null
   references job_vacancies(id) on delete cascade (null means "global default
   for this level"), interview_level text not null checked against
   intern|junior|mid|senior, stage_id uuid not null references
   interview_stages(id), stage_order integer not null check (stage_order >= 1),
   duration_minutes integer not null default 60 check (between 15 and 480),
   department text null, minimum_seniority text null checked against the
   seniority levels, required_interviewers integer not null default 1 check
   (between 1 and 5). Unique on (vacancy_id, interview_level, stage_order) —
   note that Postgres treats NULL vacancy_id as distinct, so also add a partial
   unique index on (interview_level, stage_order) where vacancy_id is null to
   keep the global defaults unique. Seed the four global processes listed in
   Step 2.2 of the plan.
3. public.candidate_interview_processes — id uuid pk, application_id uuid not
   null UNIQUE references applications(id) on delete cascade, vacancy_id uuid
   not null references job_vacancies(id), interview_level text not null with the
   same check, status text not null default 'draft' checked against
   draft|active|completed|cancelled, created_by uuid not null references
   auth.users(id), timestamps + trigger. The UNIQUE on application_id is the
   idempotency guard: one process per candidate.
4. public.candidate_interview_stages — id uuid pk, process_id uuid not null
   references candidate_interview_processes(id) on delete cascade, stage_id uuid
   null references interview_stages(id) on delete set null (null = custom
   stage), stage_name text not null and non-blank (always stored, so renaming or
   deactivating a catalogue stage cannot rewrite an existing process),
   stage_order integer not null check (>= 1), duration_minutes, department,
   minimum_seniority, required_interviewers with the same checks as the defaults
   table, status text not null default 'pending' checked against
   pending|scheduled|completed|skipped, timestamps + trigger. Unique on
   (process_id, stage_order).
5. Indexes: interview_stage_defaults on (vacancy_id, interview_level,
   stage_order); candidate_interview_processes on (vacancy_id) and (status);
   candidate_interview_stages on (process_id, stage_order) and (status). Comment
   each one with the query it serves.
6. RLS: enable on all four tables with NO policies, and a comment saying access
   is backend-only via the service role, like applications.
7. Table and column comments explaining the template-vs-instance split.

RULES
- SQL only. Do not create or modify any .js file in this step.
- Idempotent where practical (create table if not exists, on conflict do
  nothing for seeds) so the migration can be re-run safely during development.
- Do not modify migrations 001-007.
- Do not create an interviews, availability, evaluation or notification table —
  those are later steps.

DONE WHEN
- The file applies cleanly in the Supabase SQL editor on a DB that already has
  001-007, and applies twice without error.
- select stage_name, stage_order from interview_stage_defaults d join
  interview_stages s on s.id = d.stage_id where d.vacancy_id is null and
  d.interview_level = 'junior' order by stage_order
  returns HR/Behavioural, Technical, Hiring Manager.
```

---

## Step 2.3 — Interview process API `[PB-09, PB-10, PB-11, PB-12]`

**Goal.** Create a candidate's interview process from defaults, then let HR
add, remove, reorder and configure stages.

**Depends on:** 2.1, 2.2, 1.3 (a candidate must be `selected` first).

**Deliverables**

- New `backend/src/services/interviewProcess.service.js`, `backend/src/controllers/interviewProcess.controller.js`, `backend/src/routes/interviewProcess.routes.js`; mount in `server.js`.
- New `backend/src/utils/interviewStageValidation.js` — pure.
- New `backend/test/interviewStageValidation.test.js`.

**API contract**

| Endpoint | Purpose |
|---|---|
| `POST /api/applications/:id/interview-process` | PB-09/PB-10. Body `{ interview_level }`. Creates the process and **copies** defaults (vacancy-specific, else global) into per-candidate stages. Idempotent: if one exists, `409 PROCESS_EXISTS`. Requires the application to be `selected`. |
| `GET /api/applications/:id/interview-process` | The process + ordered stages. `{ process: null }` if not started. |
| `PUT /api/applications/:id/interview-process/stages` | PB-11/PB-12. **Full replacement** of the ordered stage list in one atomic call — the simplest correct way to express add + remove + reorder + reconfigure together. |
| `DELETE /api/applications/:id/interview-process` | Cancel a process that has no scheduled interviews. |

**Why full replacement.** Per-item add/remove/reorder endpoints make order
collisions and partial failures easy to hit. Sending the whole desired list and
validating it as a unit means `stage_order` is always a contiguous `1..n` and
the UI's state is the source of truth.

**Definition of Done**

- [ ] Creating a process for a `junior` candidate yields the three seeded stages in order.
- [ ] A vacancy-specific default overrides the global one.
- [ ] `PUT` rejects duplicate/non-contiguous order, empty lists, >10 stages, blank names, and out-of-range durations/interviewer counts.
- [ ] A stage that already has a scheduled interview cannot be removed or reordered (`409 STAGE_LOCKED`).
- [ ] Every route is HR-only and owner-checked through the parent vacancy.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 2.3 — follow them exactly.
- backend/sql/008_create_interview_process.sql (the schema you are serving)
- backend/src/services/vacancy.service.js (service structure, typed errors,
  ownership checks, atomic conditional updates)
- backend/src/services/application.service.js (how an application is resolved
  to its parent vacancy and owner-checked)
- backend/src/utils/applicationStatus.js (from Step 1.3)
- backend/src/config/seniority.js, backend/src/config/vacancyOptions.js
- backend/src/routes/application.routes.js and backend/src/server.js

TASK — implement DEVELOPMENT_PLAN.md Step 2.3: the API for PB-09 (choose the
interview level), PB-10 (load default stages), PB-11 (add/remove/reorder) and
PB-12 (configure each stage's interviewer requirements).

BUILD
1. backend/src/utils/interviewStageValidation.js — pure. Export
   validateStageList(stages) returning { valid, errors, value }. Rules: 1..10
   stages; each has a non-blank stage_name <= 120 chars; optional stage_id must
   be a uuid string; duration_minutes integer 15..480; required_interviewers
   integer 1..5; department, when present, must be a known department;
   minimum_seniority, when present, must be a known seniority level. Normalise
   stage_order by position so the caller cannot send duplicates or gaps — the
   returned value always has contiguous 1..n ordering in array order. Also
   export validateInterviewLevel(level).
2. interviewProcess.service.js:
   - createProcess({ applicationId, interviewLevel, authUserId }) — resolve the
     application, owner-check via its vacancy (404 if not owned, never 403),
     require application.status === 'selected' else 409
     CANDIDATE_NOT_SELECTED, then insert the process row. Rely on the UNIQUE
     application_id constraint for idempotency: translate a 23505 into 409
     PROCESS_EXISTS rather than checking-then-inserting. Then copy defaults:
     prefer rows for this vacancy_id and level; fall back to the global
     (vacancy_id is null) rows for the level; if neither exists, create the
     process with an empty stage list rather than failing. Copy stage_name from
     the catalogue at copy time. Return the process with its ordered stages.
   - getProcess({ applicationId, authUserId }) — same ownership rules; returns
     { process: null } when absent.
   - replaceStages({ applicationId, stages, authUserId }) — validate the list,
     load the existing stages, and refuse with 409 STAGE_LOCKED if any existing
     stage whose status is 'scheduled' or 'completed' would be removed or moved
     to a different order position. Then replace the set: delete the stages that
     are gone and upsert the rest with their new contiguous order. Because
     (process_id, stage_order) is unique, write the new ordering in a way that
     cannot transiently collide — e.g. offset existing orders out of range
     first, or delete-then-insert the whole non-locked set inside one sequence
     of statements. Explain the approach you chose in one short comment.
   - cancelProcess({ applicationId, authUserId }) — 409 if any stage is
     scheduled or completed, otherwise set status='cancelled'.
3. Controller + routes — add the four endpoints in the table in Step 2.3 of the
   plan, HR-only via requireHR. Mount the router so the paths are
   /api/applications/:id/interview-process[...]. Keep the existing application
   routes working.
4. backend/test/interviewStageValidation.test.js — cover empty list, 11 stages,
   blank and over-length names, bad durations, bad interviewer counts, unknown
   department/seniority, unknown interview level, and that stage_order is always
   renormalised to 1..n regardless of what the caller sent.

RULES
- An application under another HR user's vacancy returns 404 everywhere here.
- Do not schedule anything, do not touch employees or availability — later steps.
- Do not add per-stage add/remove/reorder endpoints; the PUT replaces the list.
- Do not mutate interview_stages or interview_stage_defaults from these routes;
  the catalogue is not user-editable in this step.

DONE WHEN
- npm test passes.
- POST with interview_level='junior' on a selected candidate returns the three
  seeded junior stages in order; a second POST returns 409 PROCESS_EXISTS.
- PUT with a reordered/edited list persists and renormalises stage_order.
- PUT that would move a scheduled stage returns 409 STAGE_LOCKED.
```

---

## Step 2.4 — Interview process UI `[PB-09 … PB-12 frontend]`

**Goal.** The HR screen where a selected candidate gets a level, sees the
proposed stages, edits them, and configures who may interview each stage.

**Depends on:** 2.3.

**Deliverables**

- New `frontend/interview-setup.html`, `frontend/css/pages/interview-setup.css`, `frontend/js/pages/interviewSetupPage.js`, `frontend/js/services/interviewProcessService.js`.
- Modify `frontend/css/main.css`, `frontend/js/pages/applicantReviewPage.js` (entry point when status is `selected`).

**Definition of Done**

- [ ] Picking a level loads and displays the default stages.
- [ ] Add stage, remove stage, move up, move down all work client-side and save in one request.
- [ ] Each stage has department, minimum seniority, interviewer count and duration inputs.
- [ ] Stages that are already scheduled render locked (no remove/reorder) and explain why.
- [ ] Unsaved-changes state is obvious; save reports success/failure through the Alert component.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 2.4 — follow them exactly.
- frontend/js/pages/createVacancyPage.js (form composition, FormField usage,
  validation display, submit handling)
- frontend/js/pages/applicantReviewPage.js and frontend/applicant-review.html
- frontend/js/components/FormField.js, Modal.js, Alert.js, AppShell.js
- frontend/js/services/applicationService.js (service shape)
- frontend/css/pages/create-vacancy.css and frontend/css/base/tokens.css
- DEVELOPMENT_PLAN.md Step 2.3 for the exact API contract

TASK — implement DEVELOPMENT_PLAN.md Step 2.4: the HR interview-setup screen
covering PB-09 (choose level), PB-10 (see defaults), PB-11 (add/remove/reorder)
and PB-12 (configure each stage's interviewer requirements).

BUILD
1. frontend/js/services/interviewProcessService.js — get(applicationId),
   create(applicationId, { interview_level }), replaceStages(applicationId,
   { stages }), cancel(applicationId). Same { ok, status, body } shape and
   bearer-token handling as the existing authenticated services.
2. frontend/interview-setup.html — an app-shell page (data-active-nav
   "interviews") reached as interview-setup.html#id=<applicationId>. Sections:
   a candidate/vacancy header, an interview-level radio group
   (Internship/Entry, Junior, Mid-Level, Senior), the stage list, and a save
   bar.
3. frontend/js/pages/interviewSetupPage.js — require an HR session; read the id
   with readParam from utils/urlParams.js; GET the process. If none exists show
   the level chooser and create on confirm; if one exists render its level and
   stages. Keep the working stage list in a local array and render from it:
   "Add stage" appends a row, each row has remove / move up / move down and
   inputs for stage name, department, minimum seniority, number of interviewers
   and duration. Disable remove/reorder on rows whose status is 'scheduled' or
   'completed' and show a short reason. Save sends the whole list to
   replaceStages in one request, then re-renders from the server response.
   Handle 409 STAGE_LOCKED and 409 CANDIDATE_NOT_SELECTED with clear messages.
   Build every node with createElement/textContent.
4. frontend/css/pages/interview-setup.css + @import in main.css. Reuse card,
   button, field, badge and page-header; add only the stage-row layout.
5. applicantReviewPage.js — when the application status is 'selected', show a
   primary "Set up interviews" link to interview-setup.html#id=<id>.

RULES
- Department and seniority dropdown options must mirror the backend's allowed
  values; do not invent new ones.
- No innerHTML with server data.
- Do not implement scheduling, interviewer assignment or availability here —
  those are Phase 3. The per-stage configuration only records REQUIREMENTS.
- Do not add a new sidebar entry; 'interviews' already exists in
  js/config/navigation.js.

DONE WHEN
- For a selected candidate, choosing "Junior" renders HR/Behavioural →
  Technical → Hiring Manager.
- Adding, removing and reordering stages then saving persists across a reload.
- Editing a stage's department/seniority/count/duration persists.
- The page works at 360px wide with no horizontal scroll.
```

---

# PHASE 3 — Availability and scheduling

The heart of Sprint 2, and the part most likely to be built wrong. Two rules
drive every step here:

1. **An employee's marked availability is not the same as being free.** Free =
   marked availability **minus** interviews already booked.
2. **The database, not the application, is the final guard against double
   booking.** Two HR users scheduling at the same instant must not both win.

## Step 3.1 — PB-13: interviewer manages availability

**Goal.** Any employee opens their own calendar and publishes when they can
interview, without messaging HR.

**Depends on:** 2.1.

**Deliverables**

- New `backend/sql/009_create_interview_availability.sql`.
- New `backend/src/utils/timeSlots.js` — pure time/interval helpers.
- New `backend/src/services/availability.service.js`, `backend/src/controllers/availability.controller.js`, `backend/src/routes/availability.routes.js`; mount in `server.js`.
- New `frontend/my-availability.html`, `frontend/css/pages/my-availability.css`, `frontend/js/pages/myAvailabilityPage.js`, `frontend/js/services/availabilityService.js`.
- New `frontend/employee-dashboard.html` + `frontend/js/pages/employeeDashboardPage.js` (minimal home for non-HR roles; Step 4.1 fills it out).
- New `backend/test/timeSlots.test.js`.

**Data model (migration `009`)** — `public.interview_availability`:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `profile_id` | uuid | FK → `profiles(id)`, the employee |
| `slot_date` | date | not null |
| `start_time` / `end_time` | time | `end_time > start_time` |
| `created_at` / `updated_at` | timestamptz | trigger-maintained |

Plus a **no-overlap guarantee per employee per day**. Use an exclusion
constraint (`btree_gist`) rather than trusting application code:

```sql
create extension if not exists btree_gist;
alter table public.interview_availability
  add constraint interview_availability_no_overlap
  exclude using gist (
    profile_id with =,
    slot_date with =,
    tsrange(('2000-01-01'::date + start_time), ('2000-01-01'::date + end_time)) with &&
  );
```

**Definition of Done**

- [ ] `GET/POST/DELETE /api/availability` operate **only on the caller's own** slots.
- [ ] Overlapping slots are rejected with `409 SLOT_OVERLAP` — and are rejected by the database even if the check is bypassed.
- [ ] Past dates, zero/negative durations, slots under 15 minutes and slots over 8 hours are rejected.
- [ ] An employee (role `employee`) can use the page; it does not require HR.
- [ ] `npm test` covers overlap detection and slot validation.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 3.1 — follow them exactly.
- backend/sql/005_create_application_screenings.sql (migration house style)
- backend/src/middleware/auth.middleware.js (requireRole from Step 2.1)
- backend/src/services/vacancy.service.js (service + typed error structure)
- frontend/js/pages/vacanciesPage.js (list page structure, states)
- frontend/js/components/AppShell.js, Modal.js, Alert.js, FormField.js
- frontend/js/services/authService.js (requireSession from Step 2.1)

TASK — implement DEVELOPMENT_PLAN.md Step 3.1 (PB-13): employees publish their
own interview availability. Interviewers are ordinary employees using their
existing account — do not create a separate interviewer role or account type.

BUILD
1. backend/sql/009_create_interview_availability.sql — create
   public.interview_availability per the table in Step 3.1 of the plan, with:
   create extension if not exists btree_gist; a check that end_time >
   start_time; the exclusion constraint shown in the plan preventing
   overlapping slots for the same profile on the same date; an index on
   (profile_id, slot_date) and one on (slot_date) for the HR-side lookup in Step
   3.2; the shared updated_at trigger; RLS enabled with NO policies; table and
   column comments. Explain the exclusion constraint in a comment — it is the
   real guarantee, the service check is only for a friendly error message.
2. backend/src/utils/timeSlots.js — pure, no imports. Export:
   - toMinutes('HH:MM') / toTimeString(minutes)
   - validateSlotInput({ slot_date, start_time, end_time, todayIso }) returning
     { valid, errors, value }: date must be ISO yyyy-mm-dd and not in the past;
     times must be HH:MM on a 5-minute boundary; duration >= 15 minutes and
     <= 8 hours.
   - overlaps(a, b) for two { start, end } minute ranges (touching endpoints do
     NOT overlap: 10:00-11:00 and 11:00-12:00 are fine).
   - subtractIntervals(slot, busyList) returning the remaining free sub-ranges
     of one slot after removing every busy range — sorted, merged, and dropping
     any remainder shorter than a given minimum. Step 3.2 depends on this.
3. availability.service.js — listMine(profileId, { from, to }), create(
   profileId, input) and remove(profileId, id). Every query is filtered by the
   caller's own profile_id; removal must be scoped by profile_id in the WHERE
   clause so one employee can never delete another's slot (404 if no row
   matched). Translate Postgres exclusion-violation errors (code 23P01) into a
   typed 409 SLOT_OVERLAP. Refuse to delete a slot that already has an
   interview booked inside it — for now, since the interviews table does not
   exist until Step 3.3, add a clearly-marked hook function
   hasBookedInterviews() that returns false and a TODO comment naming Step 3.3.
4. Controller + routes — GET /api/availability (optional from/to date range,
   defaulting to today..+60 days), POST /api/availability, DELETE
   /api/availability/:id. Guard with authenticateUser + requireRole('employee',
   'hr', 'hiring_manager') — anyone who can be an interviewer manages their own
   calendar.
5. Frontend:
   - js/services/availabilityService.js (list/create/remove, bearer token).
   - my-availability.html + js/pages/myAvailabilityPage.js + css page file
     (+ @import in main.css): app-shell page, requireSession allowing the three
     roles, grouped by date with each slot showing its time range and a remove
     action (confirm via Modal), an add form (date, start time, end time) with
     inline validation mirroring the backend rules, and loading/empty/error
     states. Show a short helper line explaining HR sees these slots when
     scheduling interviews.
   - employee-dashboard.html + js/pages/employeeDashboardPage.js: a minimal
     app-shell landing page for non-HR roles with a greeting and a link to
     My Availability. Step 4.1 adds assigned interviews here — leave room but
     do not stub future sections.
   - Add a nav entry for My Availability in js/config/navigation.js. The sidebar
     currently assumes HR; make NAV_ITEMS role-aware (each item may declare the
     roles that see it) and have AppShell filter by the signed-in profile's
     role, keeping today's HR sidebar identical.
6. backend/test/timeSlots.test.js — cover toMinutes/toTimeString round trips,
   every validateSlotInput failure mode, overlaps() including the
   touching-endpoints case, and subtractIntervals with: no busy ranges, a busy
   range in the middle (two remainders), busy ranges covering the whole slot
   (no remainder), overlapping busy ranges, and remainders below the minimum
   being dropped.

RULES
- An employee may only ever read, create or delete their OWN slots. There is no
  endpoint here that takes someone else's profile id.
- Do not build the HR-facing view of availability — that is Step 3.2.
- Do not weaken the sidebar for HR users while making it role-aware.

DONE WHEN
- npm test passes, with subtractIntervals well covered.
- After applying 009, an employee-role user can add, list and delete their own
  slots, and adding an overlapping slot returns 409.
- Inserting an overlapping row directly in SQL is rejected by the database.
```

---

## Step 3.2 — PB-14: HR views matching interviewers and their real free time

**Goal.** For one configured stage, show which employees qualify and exactly
when they are genuinely free — availability minus interviews already booked.

**Depends on:** 3.1, 2.3. (Booked-interview subtraction has nothing to subtract
until 3.3 exists; build the code path now and it lights up immediately.)

**Deliverables**

- Modify `backend/src/services/availability.service.js` — `findAvailableInterviewers`.
- New `backend/src/controllers/schedulingController` endpoints (or extend the interview-process controller) + routes.
- Modify `frontend/js/pages/interviewSetupPage.js` + its CSS — a per-stage "Find interviewers" panel.
- New `backend/test/interviewerMatching.test.js`.

**API contract**

| Endpoint | `GET /api/interview-stages/:stageId/available-interviewers` |
|---|---|
| Auth | HR only, owner-checked through the stage → process → application → vacancy chain |
| Query | `from` (date, default today), `to` (date, default `from` + 14 days) |
| Returns | `{ requirements: { department, minimum_seniority, required_interviewers, duration_minutes }, interviewers: [ { profile_id, full_name, job_position, department, seniority_level, free_slots: [ { slot_date, start_time, end_time } ] } ] }` |
| Rule | `free_slots` = marked availability − booked interviews, then only windows ≥ the stage's `duration_minutes` |

**Definition of Done**

- [ ] Only active employees meeting department **and** minimum seniority (at-or-above) are returned.
- [ ] A window already booked for that employee does not appear as free.
- [ ] A 30-minute remaining gap is **not** offered for a 60-minute stage.
- [ ] Employees with no usable window are returned with an empty `free_slots` array (so HR can see they qualify but aren't free), not silently dropped.
- [ ] The matching + subtraction logic is unit-tested without a database.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 3.2 — follow them exactly.
- backend/src/utils/timeSlots.js (subtractIntervals, from Step 3.1)
- backend/src/config/seniority.js (meetsMinimumSeniority, from Step 2.1)
- backend/src/services/employee.service.js (from Step 2.1)
- backend/src/services/availability.service.js (from Step 3.1)
- backend/src/services/interviewProcess.service.js (from Step 2.3 — ownership
  chain from a stage back to the vacancy)
- backend/sql/008_create_interview_process.sql, 009_create_interview_availability.sql
- frontend/js/pages/interviewSetupPage.js (Step 2.4)

TASK — implement DEVELOPMENT_PLAN.md Step 3.2 (PB-14): for one configured
interview stage, show HR which employees qualify and when they are genuinely
free. The brief is explicit that marked availability alone is not enough:
already-scheduled interviews must be subtracted so HR cannot double-book.

BUILD
1. backend/src/utils/interviewerMatching.js — pure, no DB access. Export
   buildFreeSlots({ availability, bookings, durationMinutes }) that, for one
   employee, groups availability rows by date, subtracts that date's bookings
   using subtractIntervals from timeSlots.js, keeps only remaining windows at
   least durationMinutes long, and returns them sorted by date then start time.
   Also export filterQualifiedEmployees(employees, { department,
   minimumSeniority }) using meetsMinimumSeniority — an employee with an
   unknown or missing seniority must be excluded (fail closed), and a stage
   with no department requirement matches any department.
2. availability.service.js — add findAvailableInterviewers({ stageId,
   authUserId, from, to }). Resolve the stage, walk stage -> process ->
   application -> vacancy and confirm the caller owns that vacancy, else throw
   the typed not-found error (404, never 403). Load candidate employees via the
   employee directory, load their availability rows in the date range in ONE
   query (a single .in('profile_id', ids) query, not a query per employee), load
   their already-booked interviews in the same range in one query, then compose
   with the pure helpers. If the interviews table does not exist yet in your
   working copy, read it defensively and treat "no rows" as no bookings, with a
   comment naming Step 3.3 — do not invent a different bookings source.
   Return the shape in Step 3.2 of the plan, including employees whose
   free_slots array is empty.
3. Controller + route — GET /api/interview-stages/:stageId/available-interviewers,
   HR-only. Validate from/to: ISO dates, to >= from, range <= 60 days, defaults
   today..+14 days. 400 VALIDATION_ERROR otherwise.
4. Frontend — in interviewSetupPage.js, add a "Find interviewers" action to each
   configured stage that opens a panel listing qualifying employees with their
   position, department, seniority and their free windows grouped by date, plus
   an empty state ("No employees match these requirements" vs "Matching
   employees have no free time in this range — ask them to add availability").
   Add a date-range control defaulting to the next 14 days. This panel is
   read-only in this step; the Assign/Schedule action arrives in Step 3.3.
5. backend/test/interviewerMatching.test.js — cover: qualification by department
   and by seniority at/above/below the bar; unknown seniority excluded; no
   department requirement matching everyone; buildFreeSlots with no bookings, a
   booking splitting a slot in two, a booking covering a whole slot, several
   bookings on one date, bookings on a different date not affecting the slot,
   and remainders shorter than durationMinutes being dropped.

RULES
- No N+1 queries: at most one availability query and one bookings query per
  request, regardless of how many employees match.
- All filtering logic that can be pure must live in the pure module and be
  tested there.
- Do not create, modify or cancel any booking in this step.
- A stage under another HR user's vacancy returns 404.

DONE WHEN
- npm test passes with the matching/subtraction cases above.
- For a stage requiring IT + senior + 60 minutes, the endpoint returns only
  qualifying active employees, each with windows of at least 60 minutes.
- An employee with availability 10:00-12:00 and an existing 10:00-11:00
  interview is offered 11:00-12:00 only.
```

---

## Step 3.3 — PB-15 / PB-16: assign interviewers and schedule the interview

**Goal.** Turn a chosen employee + time into a booked interview, with the
database itself preventing double booking.

**Depends on:** 3.2.

**Deliverables**

- New `backend/sql/010_create_interviews.sql`.
- New `backend/src/services/interview.service.js`, controller, routes.
- Modify `backend/src/services/availability.service.js` — implement the real `hasBookedInterviews` hook from 3.1.
- Modify `frontend/js/pages/interviewSetupPage.js` + `frontend/js/services/interviewService.js`.
- New `frontend/interviews.html` + `frontend/js/pages/interviewsPage.js` (HR's scheduled-interview list — fills the existing dead sidebar link).
- New `backend/test/interviewScheduling.test.js`.

**Data model (migration `010`)**

`public.interviews`: `id`, `candidate_stage_id` (FK → `candidate_interview_stages`, **unique** — one interview per stage), `application_id`, `vacancy_id`, `scheduled_date`, `start_time`, `end_time`, `status` (`scheduled`/`completed`/`cancelled`/`no_show`), `scheduled_by`, timestamps.

`public.interview_interviewers`: `id`, `interview_id`, `profile_id`, unique on
`(interview_id, profile_id)`. **A join table from day one** — the brief says
ship single-interviewer first but design so multiple interviewers need no schema
change later.

**The double-booking guard.** Application checks are for friendly errors; this
is the guarantee:

```sql
alter table public.interview_interviewers
  add column scheduled_date date not null,
  add column start_time time not null,
  add column end_time time not null,
  add constraint interview_interviewers_no_overlap
  exclude using gist (
    profile_id with =,
    scheduled_date with =,
    tsrange(('2000-01-01'::date + start_time), ('2000-01-01'::date + end_time)) with &&
  ) where (cancelled_at is null);
```

Denormalising the time onto the join row is deliberate: an exclusion constraint
cannot reach into another table, and this is the only way Postgres can enforce
"one interviewer, one place at a time" atomically.

**Definition of Done**

- [ ] Scheduling validates: the interviewer qualifies, the window is inside their availability, and it doesn't collide with an existing booking.
- [ ] Two concurrent requests for the same interviewer/time → exactly one succeeds, the other gets `409 INTERVIEWER_UNAVAILABLE`.
- [ ] The stage flips to `scheduled`; cancelling returns it to `pending`.
- [ ] `required_interviewers` is enforced (exactly that many assigned).
- [ ] HR's Interviews page lists upcoming interviews with candidate, vacancy, stage, interviewer and time.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 3.3 — follow them exactly,
  including the exclusion-constraint SQL shown there.
- backend/sql/009_create_interview_availability.sql (btree_gist exclusion
  constraint style)
- backend/sql/008_create_interview_process.sql
- backend/src/services/availability.service.js and
  backend/src/utils/interviewerMatching.js (Step 3.2)
- backend/src/services/vacancy.service.js (atomic conditional updates, typed
  errors)
- frontend/js/pages/interviewSetupPage.js, frontend/js/config/navigation.js

TASK — implement DEVELOPMENT_PLAN.md Step 3.3 (PB-15 assign interviewer,
PB-16 schedule interview). The database must be the final guard against double
booking; application checks exist only to produce friendly errors.

BUILD
1. backend/sql/010_create_interviews.sql — create public.interviews and
   public.interview_interviewers exactly as described in Step 3.3 of the plan,
   including: unique candidate_stage_id on interviews (one interview per
   stage); the denormalised scheduled_date/start_time/end_time on
   interview_interviewers plus a cancelled_at timestamptz null; the partial
   gist exclusion constraint preventing overlapping non-cancelled bookings per
   profile; a check that end_time > start_time; indexes on
   (profile_id, scheduled_date) for the interviewer dashboard and
   (vacancy_id, scheduled_date) for HR's list; updated_at triggers; RLS enabled
   with no policies; and comments explaining why the times are denormalised onto
   the join table.
2. backend/src/utils/interviewScheduling.js — pure. Export
   validateScheduleInput({ scheduled_date, start_time, durationMinutes,
   interviewer_ids, required_interviewers, todayIso }) returning
   { valid, errors, value } with end_time derived from start_time +
   durationMinutes: date not in the past, time on a 5-minute boundary,
   interviewer_ids a non-empty array of unique uuid strings whose length equals
   required_interviewers. Export fitsWithinAvailability(window, freeSlots) that
   checks the requested window is fully inside one free slot.
3. interview.service.js:
   - schedule({ stageId, input, authUserId }) — owner-check via stage ->
     process -> application -> vacancy (404 otherwise); load the stage's
     requirements; validate the input; confirm every chosen interviewer still
     qualifies and that the window fits their CURRENT free slots (recompute via
     the Step 3.2 helpers — never trust what the browser saw); insert the
     interview row, then the interviewer join rows. Translate a 23P01 exclusion
     violation into 409 INTERVIEWER_UNAVAILABLE and a 23505 on
     candidate_stage_id into 409 STAGE_ALREADY_SCHEDULED. If the join insert
     fails after the interview row was created, delete the interview row so no
     half-booked interview is left behind (best-effort compensation, logged),
     mirroring how the CV upload compensates in application.service.js. Finally
     set the stage status to 'scheduled' with a conditional update guarded on
     status = 'pending'.
   - cancel({ interviewId, authUserId }) — set interviews.status='cancelled'
     and stamp cancelled_at on the join rows so the exclusion constraint frees
     the slot, then return the stage to 'pending'.
   - listForVacancy / listUpcomingForHr for the HR list page.
4. availability.service.js — replace the Step 3.1 hasBookedInterviews stub with
   a real check so an employee cannot delete a slot that contains a
   non-cancelled interview (409 SLOT_HAS_INTERVIEWS).
5. Controller + routes — POST /api/interview-stages/:stageId/schedule,
   POST /api/interviews/:id/cancel, GET /api/interviews (HR list, optional
   vacancy_id and date range). HR-only.
6. Frontend — js/services/interviewService.js; in interviewSetupPage.js turn
   each free-slot window into a "Schedule" action that opens a Modal confirming
   candidate, stage, interviewer(s), date, time and duration, then calls the
   API and re-renders the stage as scheduled with a cancel action. Create
   interviews.html + js/pages/interviewsPage.js + css page file (+ main.css
   import) listing HR's upcoming interviews grouped by date — this page already
   has a sidebar entry pointing at it.
7. backend/test/interviewScheduling.test.js — cover validateScheduleInput
   (past date, bad boundary, duplicate ids, wrong number of interviewers) and
   fitsWithinAvailability (exact fit, inside a larger slot, overhanging either
   end, and spanning two adjacent slots which must NOT be accepted).

RULES
- Recompute qualification and availability server-side at schedule time. The
  request body supplies choices, never facts.
- Never remove or edit an availability row when booking; free time is always
  derived (availability minus bookings).
- Single-interviewer scheduling is enough for now, but nothing in the schema or
  service may assume exactly one — required_interviewers drives it.
- Do not send notifications here; that is Step 3.4.

DONE WHEN
- npm test passes.
- After applying 010, scheduling from the interview-setup page books the
  interview, marks the stage scheduled and shows it on interviews.html.
- Re-running the same schedule request returns 409 STAGE_ALREADY_SCHEDULED.
- Booking a second interview overlapping the same interviewer returns
  409 INTERVIEWER_UNAVAILABLE, and the equivalent raw SQL insert is rejected by
  the database.
- The just-booked window no longer appears in that interviewer's free slots.
```

---

## Step 3.4 — PB-17: interview notifications

**Goal.** Tell the candidate and the interviewer that an interview exists,
without leaking anything internal.

**Depends on:** 3.3.

**Deliverables**

- New `backend/sql/011_create_notifications.sql`.
- New `backend/src/services/notification.service.js` + `backend/src/utils/notificationTemplates.js`.
- Modify `backend/src/services/interview.service.js` — fire-and-forget dispatch after scheduling/cancelling.
- New notification routes + `frontend/js/components/NotificationBell.js`, mounted by `AppShell`.
- New `backend/test/notificationTemplates.test.js`.

**Data model (migration `011`)** — `public.notifications`: `id`,
`recipient_profile_id` (nullable — candidates have no account),
`recipient_email` (nullable), `type`, `title`, `body`, `payload` (jsonb),
`read_at`, `created_at`.

**Scope call — delivery.** In-app notifications are stored and shown for
employees/HR. Candidate notifications are **recorded** with their email and
rendered wherever the candidate-facing surfaces show them; actually sending
mail is left behind a single `notification.transport.js` seam so an email
provider can be added later without touching call sites. Don't build an SMTP
integration in this step.

**Definition of Done**

- [ ] Scheduling an interview creates one interviewer notification and one candidate notification.
- [ ] Notification dispatch failures never fail the scheduling request.
- [ ] The candidate-facing payload contains no AI score, no ranking, no interviewer comments, no other candidates, no internal ids — **asserted by a test**.
- [ ] The bell shows unread count and marks items read.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 3.4 — follow them exactly.
- backend/src/services/screening/ (the existing fire-and-forget,
  never-break-the-request pattern used after an application is stored)
- backend/src/services/interview.service.js (Step 3.3)
- backend/sql/005_create_application_screenings.sql (migration style)
- frontend/js/components/AppShell.js and frontend/css/components/app-header.css
- README.md section PB-22 privacy rules (what a candidate may never see)

TASK — implement DEVELOPMENT_PLAN.md Step 3.4 (PB-17): notify the candidate and
the assigned interviewer when an interview is scheduled or cancelled.

BUILD
1. backend/sql/011_create_notifications.sql — public.notifications per Step 3.4
   of the plan. recipient_profile_id uuid null references profiles(id) on delete
   cascade; recipient_email text null; a check that at least one recipient
   column is present; type text not null; title and body text not null; payload
   jsonb not null default '{}'; read_at timestamptz null; created_at. Indexes on
   (recipient_profile_id, read_at) for the unread badge and (created_at desc).
   RLS enabled with no policies. Comments noting candidates are addressed by
   email because they have no account.
2. backend/src/utils/notificationTemplates.js — pure. Export
   buildInterviewScheduledForCandidate(ctx) and
   ...ForInterviewer(ctx), plus the cancellation equivalents. Each returns
   { type, title, body, payload }. The CANDIDATE payload may contain only:
   job title, stage name, date, start time and duration. It must never contain
   ai score, rank, recommendation, matched/missing skills, screening summary,
   interviewer names or comments, hr notes, other candidates, or any internal
   id. Build the payload by explicitly constructing the allowed object — never
   by copying an input object and deleting fields.
3. backend/src/services/notification.transport.js — a single seam:
   deliver(notification) that currently persists the row and, for
   email-addressed recipients, logs an intent line WITHOUT the body or any PII
   (type and a recipient hash/id only). One short comment saying an email
   provider plugs in here.
4. backend/src/services/notification.service.js — createMany(list),
   listForProfile(profileId, { unreadOnly, limit }), markRead(profileId, id)
   scoped by recipient_profile_id in the WHERE clause, and
   notifyInterviewScheduled(interviewContext) / notifyInterviewCancelled(...)
   which build from the templates and deliver. Export a
   dispatchInBackground(fn) helper that runs after the response and swallows +
   logs errors, matching how screening is triggered today.
5. interview.service.js — after a successful schedule or cancel, dispatch in
   the background. A notification failure must never turn a successful booking
   into an error response.
6. Routes — GET /api/notifications (own, optional unread_only) and
   POST /api/notifications/:id/read, for any authenticated role.
7. Frontend — js/services/notificationService.js and
   js/components/NotificationBell.js (a factory following the existing
   component conventions) mounted by AppShell into the app header: unread count
   badge, dropdown list with relative times, click marks read. Keyboard
   accessible and closes on Escape and outside click, like the existing user
   menu. Build all DOM with createElement/textContent.
8. backend/test/notificationTemplates.test.js — assert the candidate payload
   contains exactly the allowed keys and, given a context object polluted with
   ai_score, rank, interviewer_comments, hr_note, other_candidates and
   application_id, that NONE of those keys or values appear anywhere in the
   produced title, body or payload (serialise and assert absence).

RULES
- The candidate template is a privacy boundary. Construct allowed fields
  explicitly; never delete-from-a-copy.
- Notification work must never block or fail the scheduling request.
- Do not add an SMTP/email dependency.
- Do not show internal notifications to candidates in any existing public page.

DONE WHEN
- npm test passes, including the candidate-payload leak assertions.
- Scheduling an interview produces two notification rows; the interviewer sees
  the bell count increment and can mark it read.
- Cancelling produces cancellation notifications.
- Breaking the notification service on purpose still lets scheduling succeed.
```

---

# PHASE 4 — The interviewer experience

Two steps, both on the employee's existing account. **No new account type** —
this is the single most important idea in the brief.

## Step 4.1 — PB-18: interviewer views assigned interviews

**Goal.** An employee signs in and sees the interviews they must conduct, with
enough context to prepare — and nothing more.

**Depends on:** 3.3.

**Deliverables**

- Modify `backend/src/services/interview.service.js` — `listForInterviewer`, `getForInterviewer`.
- New routes: `GET /api/interviews/mine`, `GET /api/interviews/:id` (assignment-checked).
- Modify `backend/src/controllers/application.controller.js` — allow an assigned interviewer to fetch that candidate's CV signed URL.
- Modify `frontend/employee-dashboard.html` / `employeeDashboardPage.js`; new `frontend/interview-detail.html` + page controller + CSS.
- New `backend/test/interviewVisibility.test.js`.

**The privacy rule for this step.** An interviewer may see: candidate name,
the vacancy, the stage, the schedule, and the **CV**. An interviewer may **not**
see: the AI screening score, recommendation, matched/missing skills or summary;
other candidates; other interviewers' evaluations or comments; HR notes;
application status history. Keep them independent — that's the point of
collecting a fresh evaluation.

**Definition of Done**

- [ ] `GET /api/interviews/mine?scope=upcoming|past` returns only interviews where the caller is an assigned interviewer.
- [ ] Fetching an interview you're not assigned to returns `404`.
- [ ] The interviewer can open the candidate's CV via a short-lived signed URL.
- [ ] No screening field appears in any interviewer-facing response — asserted by a test.
- [ ] The employee dashboard shows upcoming interviews.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 4.1 — follow them exactly.
- backend/src/services/interview.service.js (Step 3.3)
- backend/src/controllers/application.controller.js and
  backend/src/services/application.service.js (the existing HR CV signed-URL
  flow — 120s, private bucket, owner-checked)
- backend/src/services/screening (so you can see exactly which fields must NOT
  reach an interviewer)
- frontend/js/pages/employeeDashboardPage.js (Step 3.1)
- frontend/js/pages/applicantReviewPage.js (detail-page structure to mirror,
  MINUS every AI section)

TASK — implement DEVELOPMENT_PLAN.md Step 4.1 (PB-18): the interviewer's view
of their assigned interviews. Interviewers are ordinary employees on their
existing account — do not add a role or an account type.

BUILD
1. interview.service.js:
   - listForInterviewer({ profileId, scope }) — join through
     interview_interviewers where profile_id = the caller and cancelled_at is
     null; scope 'upcoming' means scheduled_date >= today and status =
     'scheduled', 'past' means everything else; order upcoming ascending and
     past descending. Return a deliberate INTERVIEWER projection: interview id,
     scheduled_date, start_time, end_time, status, stage_name, job_title,
     department, candidate full_name, and whether an evaluation has been
     submitted (false for now; Step 4.2 wires it).
   - getForInterviewer({ interviewId, profileId }) — same projection plus the
     candidate's email/phone and the vacancy's job_description and
     job_requirements so the interviewer can prepare. If the caller is not an
     assigned, non-cancelled interviewer on that interview, throw the typed
     not-found error so the route answers 404 — never 403.
   Both must select explicit column lists and must NOT join
   application_screenings at all.
2. Routes — GET /api/interviews/mine?scope=upcoming|past and
   GET /api/interviews/:id, guarded by authenticateUser + requireRole(
   'employee','hr','hiring_manager'). Keep the HR-only list from Step 3.3
   separate and unchanged.
3. CV access — extend the existing application CV endpoint (or add a sibling
   route) so an assigned interviewer can mint the same short-lived signed URL
   for the candidate of an interview they are assigned to. Authorisation must be
   "HR who owns the parent vacancy OR an assigned interviewer on a non-cancelled
   interview for this application". Anything else stays 404. Do not change the
   signed-URL lifetime or make the bucket public.
4. Frontend:
   - Extend employee-dashboard.html / employeeDashboardPage.js with an
     "Upcoming interviews" section: date, time, candidate, position, stage, and
     a "View interview" link; empty state when there are none.
   - New interview-detail.html + js/pages/interviewDetailPage.js + css page
     file (+ main.css import), reached as interview-detail.html#id=<interviewId>:
     schedule, candidate, vacancy summary, what the role needs, and View /
     Download CV using the existing signed-URL pattern. Include a short line
     stating the evaluation form appears after the interview time (Step 4.2).
   - Add "My Interviews" to the role-aware NAV_ITEMS for the employee role.
5. backend/test/interviewVisibility.test.js — extract the projection into a
   pure helper (e.g. toInterviewerView(row)) and assert that, given a row
   polluted with ai_score, recommendation, matched_skills, missing_skills,
   screening_summary, hr_note and cv_path, none of those keys or values appear
   in the output. Also cover the upcoming/past scope split with a fixed
   "today" argument.

RULES
- An interviewer must never receive any AI screening field, any other
  candidate, any other interviewer's evaluation, or any HR note.
- Not-assigned means 404, not 403.
- Do not modify the HR-facing screening or review endpoints.
- Do not build the evaluation form here — that is Step 4.2.

DONE WHEN
- npm test passes, including the leak assertions.
- An employee with one assigned interview sees it on their dashboard and can
  open the detail page and the candidate's CV.
- Changing the id in the URL to an interview they are not assigned to returns
  404 and renders a clean "not found" state.
- No network response on these pages contains a screening field.
```

---

## Step 4.2 — PB-19: interviewer records ratings and feedback

**Goal.** Structured evaluation instead of a good/bad flag, computed and stored
so the Hiring Manager can compare candidates fairly.

**Depends on:** 4.1.

**Deliverables**

- New `backend/sql/012_create_interview_evaluations.sql`.
- New `backend/src/utils/evaluationValidation.js` — pure, including the overall-rating computation.
- New `backend/src/services/evaluation.service.js`, controller, routes.
- Modify `frontend/js/pages/interviewDetailPage.js` — the evaluation form.
- New `backend/test/evaluationValidation.test.js`.

**Data model (migration `012`)** — `public.interview_evaluations`: `id`,
`interview_id` (FK), `interviewer_profile_id` (FK), **unique
`(interview_id, interviewer_profile_id)`** (one evaluation per interviewer per
interview), `technical_rating`, `problem_solving_rating`,
`communication_rating`, `role_knowledge_rating` (each `1..5`),
`overall_rating` (`numeric(3,2)`), `comments` (text), `submitted_at`.

**Server computes the overall.** `overall_rating` is the mean of the submitted
dimensions, rounded to 2dp, calculated server-side. A client-supplied
`overall_rating` is ignored — same principle as PB-05 recomputing the AI score.

**Definition of Done**

- [ ] Only an assigned interviewer can submit, and only once (`409 EVALUATION_EXISTS`).
- [ ] Ratings outside `1..5` or non-integers are rejected with field-level errors.
- [ ] `overall_rating` is computed server-side and matches the mean to 2dp.
- [ ] Submitting the last outstanding evaluation flips the interview to `completed` and the stage to `completed`.
- [ ] Submitting before the interview's start time is rejected (`409 INTERVIEW_NOT_STARTED`).

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 4.2 — follow them exactly.
- backend/sql/010_create_interviews.sql (Step 3.3)
- backend/src/services/interview.service.js — getForInterviewer's assignment
  check is the authorisation you must reuse
- backend/src/services/screening/scoring.js — the precedent for recomputing a
  score server-side instead of trusting supplied values
- backend/src/utils/applicationValidation.js (validation module style)
- frontend/js/pages/interviewDetailPage.js (Step 4.1)
- frontend/js/components/FormField.js, Alert.js, Modal.js

TASK — implement DEVELOPMENT_PLAN.md Step 4.2 (PB-19): the interviewer submits
a structured evaluation after conducting the interview.

BUILD
1. backend/sql/012_create_interview_evaluations.sql — public.interview_evaluations
   per Step 4.2 of the plan: four integer rating columns each with a check
   between 1 and 5, overall_rating numeric(3,2) not null with a check between 1
   and 5, comments text with a length check <= 4000, submitted_at timestamptz
   not null default now(), unique (interview_id, interviewer_profile_id),
   foreign keys with sensible on-delete behaviour, an index on (interview_id),
   updated_at trigger, RLS enabled with no policies, and comments explaining
   that overall_rating is computed by the backend and never accepted from a
   client.
2. backend/src/utils/evaluationValidation.js — pure. Export RATING_FIELDS and
   validateEvaluationInput(body) returning { valid, errors, value } where every
   rating must be an integer 1..5 (reject "4", 4.5, 0, 6, null), comments are
   optional, trimmed, max 4000 chars, and any client-supplied overall_rating is
   ignored. Export computeOverallRating(ratings) returning the mean rounded to
   two decimals (assert 4,5,4,4 -> 4.25).
3. evaluation.service.js — submit({ interviewId, profileId, input }): confirm
   the caller is an assigned, non-cancelled interviewer on that interview (404
   otherwise, reusing the Step 4.1 check); refuse with 409
   INTERVIEW_NOT_STARTED if the interview's scheduled date+start time is still
   in the future; refuse with 409 INTERVIEW_CANCELLED for a cancelled
   interview; validate; compute the overall; insert, translating a 23505 into
   409 EVALUATION_EXISTS. Then, if the number of submitted evaluations equals
   the number of assigned non-cancelled interviewers, set interviews.status to
   'completed' with a conditional update guarded on status='scheduled', and set
   the parent candidate_interview_stage status to 'completed' guarded on
   status='scheduled'. Also export getForInterview({ interviewId, profileId })
   returning the caller's OWN evaluation only.
4. Controller + routes — POST /api/interviews/:id/evaluation and
   GET /api/interviews/:id/evaluation, for the interviewer roles.
5. Frontend — extend interviewDetailPage.js: once the interview start time has
   passed and no evaluation exists, render the evaluation form (four 1-5 rating
   controls with visible labels, a comments textarea with a live character
   count, and a submit that confirms through Modal). After submission, replace
   the form with a read-only summary including the computed overall. Before the
   start time, show a short note instead of the form. Show field errors from the
   API inline via the existing FormField error mechanism.
6. backend/test/evaluationValidation.test.js — cover every rating failure mode,
   comments trimming/length, a client-supplied overall_rating being ignored, and
   computeOverallRating rounding (including a case that needs real rounding such
   as 4,4,5,4 -> 4.25 and 5,4,4,4 -> 4.25, plus 3,3,3,4 -> 3.25).

RULES
- overall_rating is always computed server-side.
- One evaluation per interviewer per interview; enforced by a unique
  constraint, not only by a pre-check.
- An interviewer must not see any other interviewer's evaluation here.
- Do not surface anything to the Hiring Manager in this step; that is Phase 5.

DONE WHEN
- npm test passes.
- After applying 012, an assigned interviewer can submit once; a second submit
  returns 409.
- Submitting before the interview time returns 409 INTERVIEW_NOT_STARTED.
- When the last assigned interviewer submits, the interview and its stage both
  become 'completed'.
```

---

# PHASE 5 — Hiring Manager

## Step 5.1 — PB-20: Hiring Manager reviews results and candidate progress

**Goal.** One screen where a Hiring Manager compares candidates across the AI
score and every completed interview stage, then drills into the detail.

**Depends on:** 4.2.

**Deliverables**

- New `backend/src/services/hiring.service.js`, controller, routes (`requireRole('hiring_manager','management')`).
- New `frontend/hiring-dashboard.html`, `frontend/hiring-candidate.html`, their page controllers, service and CSS.
- New `backend/test/candidatePipelineView.test.js`.

**API contract**

| Endpoint | Purpose |
|---|---|
| `GET /api/hiring/candidates?vacancy_id=&status=` | Candidates with an active/completed interview process: candidate, vacancy, AI score, per-stage ratings, overall progress, decision (if any). |
| `GET /api/hiring/candidates/:applicationId` | Full detail: every stage with interviewer, ratings, comments and status, plus the AI screening summary and CV access. |

**Scope of visibility.** Unlike the interviewer, the Hiring Manager **is**
allowed to see the AI screening summary and all interviewer feedback — that's
the decision they're making. They are still not allowed to see other
organisations' data, and the candidate-facing surfaces remain untouched.

**Definition of Done**

- [ ] Only `hiring_manager` / `management` roles can call these routes; HR gets `403`.
- [ ] A candidate with 3 stages shows 3 ratings and a clear "2 of 3 completed" progress.
- [ ] Candidates without an interview process never appear.
- [ ] The aggregation runs without N+1 queries.
- [ ] The row-shaping logic is unit-tested with no DB.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 5.1 — follow them exactly.
- backend/src/middleware/auth.middleware.js (requireRole, Step 2.1)
- backend/src/services/interviewProcess.service.js (Step 2.3)
- backend/src/services/evaluation.service.js (Step 4.2)
- backend/src/services/application.service.js (screening projection + CV
  signed URL pattern)
- frontend/js/pages/aiScreeningPage.js (ranked list page structure)
- frontend/js/pages/applicantReviewPage.js (detail page structure)

TASK — implement DEVELOPMENT_PLAN.md Step 5.1 (PB-20): the Hiring Manager
dashboard and candidate detail view.

BUILD
1. backend/src/utils/candidatePipelineView.js — pure. Export
   buildCandidateRow({ application, vacancy, screening, stages, evaluations,
   decision }) returning the list row: candidate name, job title, department,
   ai_score (or null), an array of { stage_name, stage_order, status,
   overall_rating|null }, stages_completed, stages_total, average_interview_rating
   (mean of completed stage overalls, 2dp, null when none) and decision status.
   Also export sortCandidates(rows) ordering by decision-pending first, then by
   average_interview_rating desc, then ai_score desc, with nulls last.
2. hiring.service.js:
   - listCandidates({ vacancyId, status }) — load applications that HAVE a
     candidate_interview_process, plus their vacancies, screenings, stages and
     evaluations, in a SMALL FIXED NUMBER of queries (batch with .in(...);
     absolutely no per-candidate query loop), then compose with the pure helper.
   - getCandidate({ applicationId }) — the same data for one candidate plus
     per-stage interviewer names, comments and each rating dimension, plus the
     AI screening summary. Explicit column lists only; never cv_path.
3. Controller + routes — GET /api/hiring/candidates and
   GET /api/hiring/candidates/:applicationId, guarded by authenticateUser +
   requireRole('hiring_manager','management'). Validate vacancy_id as a uuid
   and status against a known set; 400 otherwise. Also allow the Hiring Manager
   to mint a CV signed URL for a candidate in their pipeline, reusing the
   existing signed-URL service rather than a new mechanism.
4. Frontend:
   - js/services/hiringService.js.
   - hiring-dashboard.html + js/pages/hiringDashboardPage.js + css: an
     app-shell page (requireSession allowing hiring_manager and management)
     listing candidates with vacancy filter, AI score, a compact per-stage
     rating strip, progress ("2 of 3 stages"), and a decision badge. Loading,
     empty and error states.
   - hiring-candidate.html + js/pages/hiringCandidatePage.js + css: full detail
     — candidate info, AI screening summary, then each stage as a card with
     interviewer, date, the four rating dimensions, overall and comments, plus
     View/Download CV. Leave a clearly marked region for the decision panel that
     Step 5.2 fills; do not build the decision UI yet.
   - Add role-aware nav entries for the hiring_manager role.
5. backend/test/candidatePipelineView.test.js — cover buildCandidateRow with
   zero, partial and all stages completed; average rating rounding; null AI
   score; and sortCandidates ordering including nulls-last behaviour.

RULES
- HR must NOT be able to call these routes (403) — this is the Hiring Manager's
  view, and role separation is part of the assignment.
- No N+1 queries. Batch every lookup.
- Read-only. Do not write a decision, a status or a notification in this step.
- Never expose cv_path or internal screening diagnostics.

DONE WHEN
- npm test passes.
- A hiring_manager user sees candidates with their AI score and per-stage
  ratings, and can open a candidate to read every interviewer's feedback.
- An HR user calling /api/hiring/candidates gets 403.
- A candidate with no interview process never appears in the list.
```

---

## Step 5.2 — PB-21: final hiring decision

**Goal.** Record Hire or Reject, once, with an audit trail, and move the
application to its terminal status.

**Depends on:** 5.1.

**Deliverables**

- New `backend/sql/013_create_hiring_decisions.sql` — **includes altering the `applications` status check to add `hired`.**
- Modify `backend/src/utils/applicationStatus.js` — add the `selected → hired` / `selected → rejected` transitions.
- New `backend/src/services/hiringDecision.service.js`, controller, routes.
- Modify `frontend/js/pages/hiringCandidatePage.js` — the decision panel.
- Modify `backend/test/applicationStatus.test.js`.

> **Migration gotcha.** Migration `004`'s check constraint allows
> `submitted, under_review, shortlisted, rejected, selected` — **`hired` is not
> in it.** `013` must drop and recreate that constraint. This is the single
> easiest thing to get wrong in Phase 5.

**Data model** — `public.hiring_decisions`: `id`, `application_id` (**unique**),
`vacancy_id`, `hiring_manager_profile_id`, `decision` (`hired`/`rejected`),
`reason` (text), `decided_at`.

**Definition of Done**

- [ ] `POST /api/hiring/candidates/:applicationId/decision` records the decision and sets the application to `hired` / `rejected` atomically.
- [ ] A second decision returns `409 DECISION_EXISTS`.
- [ ] Deciding while stages are still incomplete requires an explicit `acknowledge_incomplete: true` plus a reason; otherwise `409 STAGES_INCOMPLETE`.
- [ ] Only `hiring_manager` can decide.
- [ ] The application status check constraint now permits `hired`.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 5.2 — follow them exactly,
  including the migration gotcha about the applications status check.
- backend/sql/004_create_applications.sql — read applications_status_allowed
  carefully: it does NOT include 'hired'.
- backend/src/utils/applicationStatus.js (Step 1.3 state machine)
- backend/src/services/vacancy.service.js (atomic conditional update pattern)
- backend/src/services/hiring.service.js (Step 5.1)
- frontend/js/pages/hiringCandidatePage.js (Step 5.1 left a region for this)

TASK — implement DEVELOPMENT_PLAN.md Step 5.2 (PB-21): the Hiring Manager
records the final Hire/Reject decision.

BUILD
1. backend/sql/013_create_hiring_decisions.sql —
   a) ALTER public.applications: drop constraint applications_status_allowed if
      exists and recreate it allowing submitted, under_review, shortlisted,
      rejected, selected AND hired. Comment why.
   b) create public.hiring_decisions per Step 5.2 of the plan: application_id
      uuid not null UNIQUE references applications(id), vacancy_id uuid not
      null references job_vacancies(id), hiring_manager_profile_id uuid not null
      references profiles(id), decision text not null check in ('hired',
      'rejected'), reason text with a length check <= 2000, decided_at
      timestamptz not null default now(), timestamps + trigger, index on
      (vacancy_id, decided_at desc), RLS enabled with no policies, comments.
2. applicationStatus.js — extend ALLOWED_TRANSITIONS so selected -> hired and
   selected -> rejected are legal. Keep every existing transition unchanged.
   Add 'hired' to APPLICATION_STATUS as a terminal state with no outgoing
   transitions.
3. hiringDecision.service.js — decide({ applicationId, profileId, decision,
   reason, acknowledgeIncomplete }). Load the candidate's process and stages;
   if any stage is not 'completed' or 'skipped', require acknowledgeIncomplete
   === true AND a non-blank reason, else throw 409 STAGES_INCOMPLETE. Require
   the application status to be 'selected'. Insert the decision row, relying on
   the UNIQUE application_id for idempotency (23505 -> 409 DECISION_EXISTS).
   Then update the application status to 'hired' or 'rejected' with a
   conditional update guarded on status='selected', also stamping
   status_updated_at/status_updated_by. If the guarded status update matches no
   row, delete the just-inserted decision row so the two never disagree, and
   throw the accurate conflict. Set the interview process status to 'completed'.
4. Controller + route — POST /api/hiring/candidates/:applicationId/decision,
   guarded by requireRole('hiring_manager'). Body { decision, reason?,
   acknowledge_incomplete? }. Validate decision against the two allowed values.
5. Frontend — fill the decision region on hiring-candidate.html: Hire / Reject
   radio choice, a reason textarea (required when stages are incomplete), and a
   submit that confirms through Modal with explicit wording that the decision is
   final and notifies HR and the candidate. On success re-render the page in its
   decided state (decision badge, who decided, when, reason) with the form gone.
   Handle 409 STAGES_INCOMPLETE by revealing the acknowledgement checkbox and
   explaining which stages are outstanding.
6. backend/test/applicationStatus.test.js — extend: selected -> hired and
   selected -> rejected are legal; hired is terminal (hired -> anything is
   illegal); every previously-legal transition still passes.

RULES
- One decision per application, enforced by a unique constraint.
- Decision and application status must never disagree — compensate if the
  guarded status update fails.
- Only hiring_manager may decide. Management is read-only.
- Do not send notifications here; that is Step 5.3.

DONE WHEN
- npm test passes with the extended state machine.
- After applying 013, deciding on a selected candidate with all stages complete
  sets the application to hired or rejected and records the decision.
- A second decision returns 409 DECISION_EXISTS.
- Deciding with an incomplete stage requires the acknowledgement plus a reason.
```

---

## Step 5.3 — PB-22: send the final decision to HR and the candidate

**Goal.** Notify both sides — and make the candidate-facing message provably
free of internal information.

**Depends on:** 5.2, 3.4.

**Deliverables**

- Modify `backend/src/utils/notificationTemplates.js` — decision templates.
- Modify `backend/src/services/hiringDecision.service.js` — background dispatch.
- Modify `backend/test/notificationTemplates.test.js`.

**Definition of Done**

- [ ] A decision notifies the vacancy's HR owner and the candidate.
- [ ] The candidate message never contains the AI score, rank, other candidates, interviewer comments, ratings, HR notes, the reason text, or any internal id — **asserted by a test**.
- [ ] Notification failure never fails the decision request.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 5.3 — follow them exactly.
- backend/src/utils/notificationTemplates.js and
  backend/src/services/notification.service.js (Step 3.4)
- backend/src/services/hiringDecision.service.js (Step 5.2)
- README.md PB-22 — the explicit list of what a candidate may never receive
- backend/test/notificationTemplates.test.js (extend it)

TASK — implement DEVELOPMENT_PLAN.md Step 5.3 (PB-22): notify HR and the
candidate of the final hiring decision.

BUILD
1. notificationTemplates.js — add buildDecisionForHr(ctx) and
   buildDecisionForCandidate(ctx).
   - HR message: "<Candidate name> has been selected for <job title>." or
     "<Candidate name> was not selected for <job title>." HR may also receive
     who decided and when.
   - CANDIDATE message: hired -> a short congratulations naming ONLY the job
     title; rejected -> a short, respectful thank-you naming ONLY the job title.
     The candidate payload may contain job_title and decision and nothing else.
     It must never contain: ai score, rank, recommendation, skills, screening
     summary, interview ratings, interviewer names or comments, the decision
     reason, hr notes, other candidates, or any internal id. Construct the
     allowed object explicitly — never copy-and-delete.
2. hiringDecision.service.js — after a successful decision, dispatch both
   notifications in the background using the existing dispatchInBackground
   helper. Resolve the HR recipient from the vacancy's created_by. A
   notification failure must never turn a successful decision into an error.
3. backend/test/notificationTemplates.test.js — extend with decision cases:
   assert the exact allowed key set on the candidate payload for both hired and
   rejected; and given a context polluted with ai_score, rank,
   interviewer_comments, ratings, reason, hr_note, other_candidates and
   application_id, assert that none of those keys OR their values appear
   anywhere in the candidate title, body or payload (serialise the whole object
   and assert absence of each value string).

RULES
- The candidate template is a hard privacy boundary; the decision REASON is
  internal and must never reach the candidate.
- Do not change the decision logic or the application status transitions.
- Do not add an email provider dependency; reuse the existing transport seam.

DONE WHEN
- npm test passes, including the candidate-payload leak assertions for both
  outcomes.
- Recording a decision creates exactly two notifications: one for the vacancy's
  HR owner and one addressed to the candidate's email.
- Breaking the notification service on purpose still lets the decision succeed.
```

---

# PHASE 6 — Management dashboard and reporting

## Step 6.1 — PB-23: recruitment dashboard and candidate pipeline

**Goal.** The funnel — how many people are at each stage of recruitment — plus
summary cards, for management.

**Depends on:** 5.2 (the funnel's last two numbers don't exist before decisions do).

**Deliverables**

- New `backend/src/services/reporting.service.js`, `backend/src/utils/pipelineMetrics.js`, controller, routes.
- New `frontend/reports.html`, `frontend/js/pages/reportsPage.js`, `frontend/css/pages/reports.css`, `frontend/js/services/reportingService.js`.
- Modify `frontend/js/pages/dashboardPage.js` — HR summary cards reusing the same endpoint.
- New `backend/test/pipelineMetrics.test.js`.

**Funnel definition — agree this once, use it everywhere:**

| Stage | Counted as |
|---|---|
| Applications | all `applications` rows for in-range vacancies |
| AI Screening | applications with a `completed` screening |
| HR Selected | status in `shortlisted`, `selected`, `hired`, `rejected-after-selection` |
| Interviews | candidates with ≥ 1 interview scheduled |
| Final Review | candidates with all stages complete and no decision yet |
| Hired / Rejected | from `hiring_decisions` |

**No chart library.** Bars are CSS-width divs driven by percentages, every
figure is also present as text, and the whole funnel has an accessible table
equivalent. Adding a charting dependency for six numbers isn't worth it.

**Definition of Done**

- [ ] `GET /api/reports/pipeline?from=&to=&vacancy_id=` returns all funnel counts plus summary cards.
- [ ] Counts are computed in a bounded number of queries, not per-vacancy loops.
- [ ] The page renders correctly with zero data.
- [ ] Every number is readable as text, not only as a bar.
- [ ] Accessible to `management` **and** `hr` (HR needs its own numbers too).

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 6.1 — follow them exactly,
  including the funnel definition table.
- backend/src/services/hiring.service.js (Step 5.1 batching approach)
- backend/src/middleware/auth.middleware.js (requireRole)
- frontend/js/pages/dashboardPage.js and frontend/css/pages/dashboard.css
- frontend/css/base/tokens.css (use tokens for every colour and space)
- frontend/js/config/navigation.js ('reports' already exists and is a dead link)

TASK — implement DEVELOPMENT_PLAN.md Step 6.1 (PB-23): the recruitment
dashboard and candidate pipeline funnel.

BUILD
1. backend/src/utils/pipelineMetrics.js — pure. Export
   buildPipeline({ applications, screenings, interviews, decisions, vacancies })
   returning { funnel: [ { key, label, count } ], cards: { open_vacancies,
   applications, shortlisted, interviews, hired, rejected } } using exactly the
   funnel definition in Step 6.1 of the plan. Also export
   toFunnelPercentages(funnel) giving each row a percentage of the first
   (largest) stage, guarding against division by zero. No DB or Express imports.
2. backend/src/utils/dateRange.js — pure. parseReportRange({ from, to,
   todayIso }) returning { valid, errors, value }: ISO dates only, to >= from,
   span <= 730 days, defaulting to the last 90 days.
3. reporting.service.js — getPipeline({ from, to, vacancyId, requesterProfile }).
   Scope: a 'management' requester sees all vacancies; an 'hr' requester sees
   only vacancies they created. Load the raw rows in a small fixed number of
   batched queries and compose with the pure helper. Select only the columns the
   metrics need — never applicant PII, never CV fields, never screening text.
4. Controller + routes — GET /api/reports/pipeline, guarded by
   requireRole('management','hr'). 400 VALIDATION_ERROR for a bad range or a
   non-uuid vacancy_id.
5. Frontend:
   - js/services/reportingService.js.
   - reports.html + js/pages/reportsPage.js + css/pages/reports.css (+ main.css
     import): an app-shell page (requireSession allowing management and hr) with
     a date-range control, an optional vacancy filter, the six summary cards,
     and the funnel. Render the funnel as horizontal bars whose widths come from
     toFunnelPercentages, each row showing its label and count as text, and
     include a visually-hidden <table> with the same numbers for screen readers.
     Do NOT add a charting library. Handle loading, zero-data and error states —
     zero data must render an honest empty funnel, not a broken layout.
   - dashboardPage.js — reuse the same endpoint to show the summary cards on the
     HR dashboard, replacing the placeholder content.
6. backend/test/pipelineMetrics.test.js — cover an empty dataset (all zeros, no
   NaN), a dataset exercising every funnel stage, candidates counted once even
   with multiple interviews, decisions splitting hired/rejected correctly, and
   toFunnelPercentages when the first stage is zero.

RULES
- No charting dependency; CSS bars + tokens only.
- No PII in any reporting response — counts and labels only.
- HR sees only their own vacancies' numbers; management sees everything.
- Do not modify how any existing record is written.

DONE WHEN
- npm test passes, including the zero-data case.
- reports.html shows the funnel and cards for a management user and for an HR
  user (scoped to their vacancies).
- Every funnel figure is present as text, and the page is usable at 360px.
- The 'Reports' sidebar link is no longer dead.
```

---

## Step 6.2 — PB-24: recruitment reports and export

**Goal.** A period report management can take away — on screen and as a
download.

**Depends on:** 6.1.

**Deliverables**

- Modify `backend/src/services/reporting.service.js` — `getRecruitmentReport`.
- New `backend/src/utils/csv.js` — CSV serialisation **with formula-injection protection**.
- Modify reporting controller/routes — `GET /api/reports/recruitment[?format=csv]`.
- Modify `frontend/js/pages/reportsPage.js` — report table + Download CSV.
- New `backend/test/csv.test.js`.

**CSV injection matters.** A field beginning `=`, `+`, `-`, `@`, tab or CR is
executable when the file is opened in Excel or Sheets. Prefix those values with
a single quote and quote/escape properly. This is a real vulnerability class,
not a nicety — and it's easy to unit-test.

**Definition of Done**

- [ ] The report returns vacancies created, applications, AI shortlisted, HR selected, interviews completed, hired, rejected for the period.
- [ ] `?format=csv` downloads a correctly-named, correctly-escaped file.
- [ ] A vacancy titled `=cmd|' /C calc'!A0` is neutralised in the CSV.
- [ ] Per-vacancy breakdown rows are included, not just totals.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 6.2 — follow them exactly,
  including the CSV-injection requirement.
- backend/src/services/reporting.service.js and
  backend/src/utils/pipelineMetrics.js (Step 6.1)
- backend/src/utils/dateRange.js (Step 6.1)
- frontend/js/pages/reportsPage.js (Step 6.1)

TASK — implement DEVELOPMENT_PLAN.md Step 6.2 (PB-24): recruitment reports with
CSV export.

BUILD
1. backend/src/utils/csv.js — pure. Export toCsv({ columns, rows }) producing
   RFC4180-style CSV: CRLF line endings, values containing a comma, quote,
   CR or LF wrapped in double quotes with internal quotes doubled, null and
   undefined rendered as empty. CRITICALLY: any value whose first character is
   =, +, -, @, tab or carriage return must be prefixed with a single
   apostrophe to neutralise spreadsheet formula injection, and that sanitisation
   must happen BEFORE quoting. Also export a safe filename builder
   (reportFilename(prefix, from, to)) that strips anything outside
   [A-Za-z0-9._-].
2. reporting.service.js — add getRecruitmentReport({ from, to, vacancyId,
   requesterProfile }) returning { period: { from, to }, totals: {
   vacancies_created, applications, ai_shortlisted, hr_selected,
   interviews_completed, hired, rejected }, by_vacancy: [ { job_title,
   department, applications, ai_shortlisted, hr_selected,
   interviews_completed, hired, rejected } ] }. Same role scoping as Step 6.1
   (HR sees only their own vacancies). Batch the queries; no per-vacancy loops.
3. Controller + route — GET /api/reports/recruitment, requireRole(
   'management','hr'). With format=csv, respond with text/csv, a
   Content-Disposition attachment filename from reportFilename, and the
   by_vacancy rows plus a totals row; otherwise respond with the normal JSON
   envelope. Validate format against an allowlist of 'json' and 'csv'.
4. Frontend — on reports.html add a report table below the funnel showing the
   totals and the per-vacancy breakdown, and a "Download CSV" button that
   requests the csv format with the bearer token, turns the response into a
   Blob, and triggers a download via a temporary object URL that is revoked
   afterwards. Show a clear error if the download fails.
5. backend/test/csv.test.js — cover: plain values; values with commas, quotes
   and newlines; null/undefined; and formula injection for each dangerous
   leading character including =cmd|' /C calc'!A0, +1+1, -1+1, @SUM(A1),
   a leading tab and a leading CR — asserting each is prefixed and correctly
   quoted. Also cover reportFilename stripping path separators and unusual
   characters.

RULES
- Sanitise before quoting, never after.
- No new dependency for CSV generation.
- No PII in the report; counts, job titles and departments only.
- Do not change the pipeline endpoint's response shape.

DONE WHEN
- npm test passes, with every injection case covered.
- The report table renders and the CSV downloads with a sensible filename.
- A vacancy titled =cmd|' /C calc'!A0 appears in the CSV as '=cmd|' /C calc'!A0
  (leading apostrophe, properly quoted) and does not execute when opened in a
  spreadsheet.
```

---

# PHASE 7 — Hardening and release

## Step 7.1 — Seed and demo data

**Goal.** One script that fills an empty database with a realistic end-to-end
scenario, so every later step (and your demo) has something to show.

**Depends on:** 2.2 minimum; most useful after Phase 4. Give this to whoever is
blocked waiting on other phases.

**Deliverables**

- New `backend/scripts/seed.js` + an `npm run seed` script in `backend/package.json`.
- New `backend/sql/seed/README-seed.md` **only if** SQL-side seeding is needed.

**Definition of Done**

- [ ] `npm run seed` creates HR, 4+ employees across departments/seniorities, a hiring manager, 3 vacancies (draft/published/closed), applications with CVs, availability slots and at least one full interview process.
- [ ] Re-running it is safe (idempotent or clearly refuses).
- [ ] It refuses to run against a database that looks like production (a `--force` flag and an env guard).
- [ ] No secrets are printed.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- DEVELOPMENT_PLAN.md sections 2, 3 and Step 7.1 — follow them exactly.
- backend/src/config/supabase.js (the service-role client)
- every file in backend/sql/ (the current schema you must seed against)
- backend/package.json (script conventions)

TASK — implement DEVELOPMENT_PLAN.md Step 7.1: a development seed script that
creates a realistic end-to-end recruitment scenario.

BUILD
1. backend/scripts/seed.js — a plain Node script (no new dependencies) using
   the existing service-role Supabase client and dotenv config. It must create:
   - Auth users + profiles: 1 hr, 1 hiring_manager, 1 management, and 4+
     employees spanning Engineering/Finance/Human Resources at junior, mid,
     senior and lead seniority, each with full_name, job_position and
     department.
   - 3 vacancies owned by the HR user: one draft, one published, one closed.
   - 6+ applications against the published vacancy with plausible names, emails
     and phone numbers (clearly fictional), each with a small generated PDF CV
     uploaded to the private candidate-cvs bucket via the same storage path
     convention the application service uses.
   - Availability slots for each employee across the next 14 days.
   - For one selected candidate: a junior interview process with its three
     default stages, one scheduled interview, and one submitted evaluation.
   Print a short human-readable summary at the end (counts and the HR login
   email) and nothing sensitive — never print keys, passwords or tokens beyond
   a seeded demo password that the script itself generated and is documented as
   development-only.
2. Safety: refuse to run unless NODE_ENV !== 'production' AND the operator
   passes --force, or SEED_ALLOW=true is set. Print a clear refusal explaining
   why. Make re-runs safe: look up by a stable marker (e.g. a
   seed-<something> email domain) and skip or clean up what already exists,
   rather than duplicating rows.
3. Add "seed": "node scripts/seed.js" to backend/package.json scripts.
4. Document usage in a short section in README.md under Setup — how to run it,
   what it creates, the demo credentials, and a warning that it is
   development-only.

RULES
- No new npm dependencies.
- Never print or commit real credentials; demo passwords are generated at run
  time and shown once.
- Do not modify application code or migrations to make seeding easier — if
  something cannot be seeded through the existing schema, say so in the summary
  instead of changing the schema.
- Do not seed anything into a table that does not exist yet; detect and skip
  with a clear message so the script works at any point in the build order.

DONE WHEN
- npm run seed -- --force against a fresh dev database produces a complete
  scenario and prints the summary.
- Running it twice does not duplicate data.
- Running it without --force and without SEED_ALLOW refuses.
- Logging in as the seeded HR user shows the seeded vacancies and applications.
```

---

## Step 7.2 — Security and RLS audit

**Goal.** Verify, file by file, that the guarantees claimed in the README are
actually true after twelve new steps of code.

**Depends on:** Phases 1–6.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- README.md "Security notes" (the claims that must hold)
- DEVELOPMENT_PLAN.md section 3 Security
- every file in backend/sql/
- every file in backend/src/routes/ and backend/src/middleware/
- backend/src/services/*.service.js

TASK — audit the whole application against its own stated security model and
fix what is broken. This is a review-and-repair step, not a feature step.

AUDIT AND REPORT on each of these, naming file:line for every finding:
1. Every route: is it behind authenticateUser, the right requireRole, AND an
   explicit ownership/assignment check? List any route missing one. Pay special
   attention to routes added in Phases 3-6.
2. Ownership leaks: does any handler return 403 where 404 is required (i.e.
   where a 403 confirms a record exists that the caller may not see)?
3. Every table in backend/sql: is RLS enabled? Does any table have an
   unintended anon or authenticated policy?
4. Every response projection: does any endpoint return cv_path, auth_user_id,
   public_token where it should not, internal ids to a candidate, screening
   diagnostics, or another user's PII?
5. Candidate-facing notification templates: re-verify no internal data can
   reach a candidate, including via the payload object.
6. Input validation: is every route's body and query validated before use? Are
   any user-supplied values interpolated into a query, a LIKE pattern, a file
   path, a redirect, or a CSV cell without escaping?
7. Frontend: any innerHTML with server data? Any secret in frontend/js/config.js
   beyond the anon key? Any authorisation decided client-side that isn't also
   enforced server-side?
8. Logging: does anything log CV text, prompts, tokens, passwords, emails or
   other PII?
9. Rate limiting: are all public, unauthenticated routes limited?

THEN
- Fix every HIGH and MEDIUM finding directly, smallest change that closes the
  hole, following the house rules.
- For anything you judge LOW or out of scope, list it at the end with a one-line
  rationale rather than fixing it.
- Add regression tests for any logic-level fix that can be tested purely.
- Update the README "Security notes" section so it describes the system as it
  now is, including the Sprint 2 tables and roles.

RULES
- Do not add new features or refactor beyond what a fix requires.
- Do not weaken any existing check to make something pass.
- If a fix would break a working flow, say so and propose the alternative
  instead of shipping the break.

DONE WHEN
- A findings list exists with file:line and severity for every item.
- Every HIGH and MEDIUM finding is fixed or explicitly justified.
- npm test passes.
- README security notes match reality.
```

---

## Step 7.3 — End-to-end verification and documentation

**Goal.** Prove the whole pipeline works in one sitting, and leave the docs
true.

**Prompt**

```text
You are working in the Altrium recruitment platform repo.

READ FIRST
- README.md (all of it)
- DEVELOPMENT_PLAN.md (all of it)
- frontend/README.md

TASK — final verification and documentation pass for the Altrium project.

BUILD
1. Write backend/test/README-testing.md? NO — instead add a single
   "End-to-end verification" section to README.md: a numbered manual script a
   marker or teammate can follow start to finish, covering exactly this path:
   HR logs in -> creates a vacancy -> publishes it -> the vacancy appears on the
   public Applicant Portal -> an applicant browses the portal and applies with a
   CV -> AI screening produces a score -> HR reviews the ranked list -> HR
   selects the candidate -> HR sets the interview level and customises stages ->
   an employee publishes availability -> HR finds a qualified available
   interviewer and schedules -> both parties are notified -> the interviewer
   sees and conducts the interview and submits an evaluation -> the Hiring
   Manager reviews and decides -> HR and the candidate are notified -> the
   management dashboard and report reflect the outcome. For each step give the
   page, the action, and the expected result.
2. Update README.md so it is accurate as a whole: move every completed item in
   the backlog status table to Done, replace the "Sprint 2 (not started)"
   framing with real documentation of what was built (flows, API tables,
   database tables, security notes) in the same style as the existing PB-01..
   PB-06 sections, refresh the migration list under Setup with 006-013, and add
   any new environment variables.
3. Update frontend/README.md's structure tree with every page, service,
   component and stylesheet added in Phases 1-6.
4. Update DEVELOPMENT_PLAN.md: mark completed steps, and record anything that
   was deliberately left out (for example email delivery, multi-interviewer
   scheduling if not shipped, PDF/Excel export) in a short "Deferred" section,
   each with one line on why and what it would take.
5. Run cd backend && npm test and make sure the full suite passes. Fix any test
   that has drifted from the implementation — by correcting whichever side is
   actually wrong, and saying which you chose and why.

RULES
- Documentation must describe what the code actually does. Verify each claim
  against the code before writing it; delete or correct anything stale.
- Do not add features in this step.
- Keep the existing README voice and structure; extend, don't rewrite.

DONE WHEN
- The end-to-end script in README.md can be followed successfully on a fresh
  seeded database with no undocumented steps.
- README.md, frontend/README.md and DEVELOPMENT_PLAN.md agree with the code.
- npm test passes.
```

---

# Appendix A — Migration ledger

Apply in order in the Supabase SQL editor. Never edit an applied file.

| # | File | Step | Adds |
|---|---|---|---|
| 001 | `001_create_profiles.sql` | done | `profiles` |
| 002 | `002_create_job_vacancies.sql` | done | `job_vacancies` |
| 003 | `003_add_vacancy_publishing.sql` | done | `public_token`, `published_at` |
| 004 | `004_create_applications.sql` | done | `applications` + `candidate-cvs` bucket |
| 005 | `005_create_application_screenings.sql` | done | `application_screenings` |
| 006 | `006_add_application_status_audit.sql` | 1.3 | status audit columns |
| 007 | `007_extend_profiles_employees.sql` | 2.1 | employee fields + role check |
| 008 | `008_create_interview_process.sql` | 2.2 | stage catalogue, defaults, per-candidate process + stages |
| 009 | `009_create_interview_availability.sql` | 3.1 | availability + no-overlap exclusion constraint |
| 010 | `010_create_interviews.sql` | 3.3 | interviews + interviewers join + double-booking constraint |
| 011 | `011_create_notifications.sql` | 3.4 | notifications |
| 012 | `012_create_interview_evaluations.sql` | 4.2 | evaluations |
| 013 | `013_create_hiring_decisions.sql` | 5.2 | decisions **+ alters the applications status check to allow `hired`** |

**Steps with no migration:** 1.1, 1.2, 1.4 (`closed` already allowed), 2.3,
2.4, 3.2, 4.1, 5.1, 5.3, 6.1, 6.2, 7.x.

---

# Appendix B — Pitfalls worth pinning up

1. **`hired` is not an allowed application status** until migration `013`
   rewrites the check constraint from `004`. Everything else PB-07 needs is
   already there.
2. **`requireHR` hardcodes `'hr'`.** Until Step 2.1 generalises it, no other
   role can pass any guard.
3. **Availability ≠ free.** Always subtract booked interviews. This is called
   out explicitly in the brief and is the most likely silent bug in the project.
4. **Exclusion constraints, not app checks,** are what actually stop double
   booking. Application checks exist for the friendly message.
5. **Template vs instance.** Copy default stages into a per-candidate list at
   creation time; never have a live interview process read through to a
   template that HR may later edit.
6. **Candidates are not users.** They have no account, so notifications are
   addressed by email, and every candidate-facing payload is an explicit
   allow-list — never a copy with fields deleted.
7. **The AI never decides.** Screening writes only to `application_screenings`.
   Only a human writes an application status or a hiring decision.
8. **Interviewers stay independent.** Never show an interviewer the AI score or
   another interviewer's feedback before they submit theirs.
9. **404 not 403** whenever a 403 would confirm the existence of a record the
   caller may not see.
10. **One interview per stage, one evaluation per interviewer, one process per
    application, one decision per application** — all enforced by unique
    constraints, not by check-then-insert.
11. **No N+1 queries** in the dashboards. Batch with `.in(...)`.
12. **Nav items already exist** for `interviews`, `candidates`, `reports` and
    `settings`. Three get pages in this plan; `settings.html` stays unbuilt —
    either build it or remove the item before you demo.

---

# Appendix C — Final acceptance checklist

Sprint 1
- [ ] Published vacancies are discoverable on a public Applicant Portal — no manual link sharing (1.1, 1.2)
- [ ] HR can select, shortlist and reject candidates with an audit trail (1.3)
- [ ] HR can close a vacancy and it leaves the portal (1.4)

Sprint 2
- [ ] Employees, hiring managers and management have roles and directory data (2.1)
- [ ] Interview stage defaults exist per vacancy + level, with a global fallback (2.2)
- [ ] HR picks a level and gets default stages (PB-09, PB-10) (2.3, 2.4)
- [ ] HR can add, remove, reorder and configure stages (PB-11, PB-12) (2.3, 2.4)
- [ ] Employees publish their own availability (PB-13) (3.1)
- [ ] HR sees qualified interviewers and their genuinely free time (PB-14) (3.2)
- [ ] HR assigns an interviewer and schedules, with double booking impossible (PB-15, PB-16) (3.3)
- [ ] Candidate and interviewer are notified (PB-17) (3.4)
- [ ] Interviewers see their assigned interviews on their existing account (PB-18) (4.1)
- [ ] Interviewers submit structured ratings and comments (PB-19) (4.2)
- [ ] The Hiring Manager reviews AI score plus every interview result (PB-20) (5.1)
- [ ] The Hiring Manager records a final Hire/Reject (PB-21) (5.2)
- [ ] HR and the candidate are notified, with nothing internal leaked (PB-22) (5.3)
- [ ] Management sees the pipeline dashboard (PB-23) (6.1)
- [ ] Management generates and exports recruitment reports (PB-24) (6.2)

Quality gates
- [ ] `cd backend && npm test` passes
- [ ] Security audit complete, HIGH/MEDIUM findings closed (7.2)
- [ ] Seed script produces a demo-ready database (7.1)
- [ ] End-to-end script in README.md verified on a fresh database (7.3)
- [ ] Every page works at 360px with no horizontal scroll
- [ ] README.md, frontend/README.md and this plan match the code (7.3)
