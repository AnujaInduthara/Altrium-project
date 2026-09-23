# Altrium — Frontend

Static HTML + vanilla ES-module JS + a token-based CSS system. No build step:
serve the folder with any static file server.

```
npx serve . -l 5500
# then open http://127.0.0.1:5500/login.html
```

> ES modules require HTTP(S) — opening the files with `file://` will not work.

## Structure

```
frontend/
├── index.html               Session-aware entry point (redirects to login / role's dashboard)
├── login.html                Split-screen login page
├── dashboard.html            HR dashboard — quick actions + recruitment summary cards (PB-23)
├── employee-dashboard.html   Employee dashboard — "My Interviews" (PB-18) + availability shortcut
├── vacancies.html            Job Vacancies list (PB-01) — cards link to the details page
├── create-vacancy.html       Create Job Vacancy form (PB-01) — saves a DRAFT
├── vacancy.html               Vacancy details — publish (PB-02) / close (PB-08) actions
├── portal.html                Public Applicant Portal — browse published vacancies, no auth
├── apply.html                 Public application page (PB-03) — view vacancy + submit a CV, no auth
├── applications.html          HR application review (PB-04) — pick a vacancy, see applicants, view CVs
├── ai-screening.html          AI Screening (PB-05/06) — applicants ranked by AI CV-match score
├── applicant-review.html      Applicant Review (PB-06/07) — AI result + selection decision panel
├── candidates.html            Bulk "select candidates to proceed" review (PB-07)
├── interview-setup.html       Per-candidate interview process: level, stages, assign + schedule (PB-09…16)
├── interviews.html            HR's scheduled interviews list — cancel action (PB-15/16)
├── my-availability.html       An employee's own availability calendar (PB-13)
├── interview-detail.html      An interviewer's assigned-interview detail + evaluation form (PB-18/19)
├── hiring-dashboard.html      Hiring Manager's candidate pipeline (PB-20)
├── hiring-candidate.html      Hiring Manager's per-candidate detail + hire/reject decision (PB-20/21)
├── reports.html                Recruitment pipeline funnel + CSV report (PB-23/24), for HR and management
│
├── assets/
│   └── icons/
│       └── altrium-logo.png
│
├── css/
│   ├── main.css          The ONLY stylesheet pages link. Imports everything below.
│   ├── base/
│   │   ├── tokens.css    Design tokens — colours, spacing, type, radius, shadow.
│   │   ├── reset.css     Minimal reset + element defaults.
│   │   └── typography.css
│   ├── components/       One file per reusable UI piece (BEM-ish class names)
│   │   ├── brand.css            .brand / .brand__logo
│   │   ├── button.css           .button + --primary / --ghost / --block
│   │   ├── icon-button.css      .icon-button (square borderless 24px-icon button)
│   │   ├── field.css            .field (label + icon input + inline error)
│   │   ├── card.css             .card + __header / __title / __subtitle
│   │   ├── alert.css            .alert + --error / --success
│   │   ├── badge.css            .badge + --draft / --published / --closed
│   │   ├── modal.css            .modal (centred confirmation dialog)
│   │   ├── divider.css          .divider (rule with optional centred label)
│   │   ├── app-header.css       .app-header (top bar: brand + actions)
│   │   ├── sidebar.css          .sidebar / .sidebar__item (+ .is-active)
│   │   ├── user-menu.css        .user-badge + .user-menu__dropdown
│   │   ├── notification-menu.css  .notification-menu — bell + unread dot + dropdown (PB-17)
│   │   └── page-header.css      .page-header (title block for a shell page)
│   ├── layout/
│   │   ├── auth.css         Split-screen auth layout (login: hero + form panel).
│   │   └── app-shell.css    Signed-in layout: sticky header + sidebar + main.
│   └── pages/               One file per page, imported by main.css in page order above
│       ├── login.css
│       ├── dashboard.css
│       ├── vacancies.css
│       ├── create-vacancy.css
│       ├── vacancy.css
│       ├── portal.css
│       ├── apply.css
│       ├── applications.css
│       ├── ai-screening.css
│       ├── applicant-review.css
│       ├── candidates.css
│       ├── interview-setup.css
│       ├── interviews.css
│       ├── my-availability.css
│       ├── interview-detail.css
│       ├── hiring-dashboard.css
│       ├── hiring-candidate.css
│       └── reports.css
│
└── js/
    ├── config.js               Public browser-safe config (Supabase URL + anon key, API base resolution).
    ├── config/
    │   └── navigation.js       Sidebar nav items (id / label / href / icon / roles) — filtered per signed-in role.
    ├── lib/
    │   └── supabaseClient.js    Single shared Supabase client.
    ├── services/                Network logic only, no DOM. Every call returns { ok, status, body }.
    │   ├── authService.js            Auth + role-authorization API (requireSession / requireHRSession).
    │   ├── vacancyService.js         Vacancy API (create / list / get / publish / close).
    │   ├── publicVacancyService.js   Unauthenticated portal listing + application submission.
    │   ├── applicationService.js     HR review API — applications, CV links, screening, status, candidate selection.
    │   ├── interviewProcessService.js  Per-candidate interview process — level, stage list (PB-09…12).
    │   ├── availabilityService.js    An employee's own availability calendar (PB-13).
    │   ├── interviewService.js       Scheduling, cancelling, the interviewer's own interviews + evaluations (PB-15…19).
    │   ├── hiringService.js          Hiring Manager's candidate pipeline + CV access + decision (PB-20/21).
    │   ├── notificationService.js    The signed-in user's own notifications (PB-17/22).
    │   └── reportingService.js       Recruitment pipeline funnel + CSV report (PB-23/24).
    ├── utils/
    │   ├── validators.js          Pure form-validation helpers.
    │   ├── vacancyValidators.js   Vacancy form rules + dropdown option lists.
    │   ├── applicantValidators.js Applicant form + CV file rules (PB-03); mirrors the server.
    │   └── urlParams.js           Read id/token from query OR hash (survives clean-URL redirects).
    ├── components/              Reusable DOM behaviours (factory functions)
    │   ├── icons.js             Shared inline-SVG icon set.
    │   ├── AppShell.js          Mounts the common header + sidebar (+ notification bell) around a page.
    │   ├── NotificationBell.js  Unread-count badge + dropdown, mounted into the app header (PB-17/22).
    │   ├── TextField.js         Enhances a .field: value / setError / clearError.
    │   ├── PasswordField.js     TextField + show/hide reveal toggle.
    │   ├── FormField.js         Like TextField but for input / select / textarea.
    │   ├── Modal.js             Accessible confirmation dialog (open / close, focus trap).
    │   └── Alert.js             Show/hide a .alert banner (error / success).
    └── pages/                   One controller per page; composes the above.
        ├── entryPage.js
        ├── loginPage.js
        ├── dashboardPage.js            HR dashboard + recruitment summary cards (PB-23).
        ├── employeeDashboardPage.js    Employee's "My Interviews" (PB-18).
        ├── vacanciesPage.js
        ├── createVacancyPage.js
        ├── vacancyPage.js              Details, publish (PB-02), close (PB-08).
        ├── portalPage.js               Public Applicant Portal listing.
        ├── applyPage.js                Public application page (PB-03).
        ├── applicationsPage.js         HR review — pick a vacancy, see applicants, view CVs.
        ├── aiScreeningPage.js          Ranked AI-screening list (PB-05/06).
        ├── applicantReviewPage.js      AI result + selection decision panel (PB-06/07).
        ├── candidatesPage.js           Bulk candidate selection (PB-07).
        ├── interviewSetupPage.js       Interview level, stage list, find/assign/schedule (PB-09…16).
        ├── interviewsPage.js           HR's scheduled interviews + cancel (PB-15/16).
        ├── myAvailabilityPage.js       An employee's own calendar (PB-13).
        ├── interviewDetailPage.js      Interviewer's assigned interview + evaluation form (PB-18/19).
        ├── hiringDashboardPage.js      Hiring Manager's candidate pipeline (PB-20).
        ├── hiringCandidatePage.js      Per-candidate detail + hire/reject decision (PB-20/21).
        └── reportsPage.js              Pipeline funnel + CSV report (PB-23/24).
```

## The app shell (common header + sidebar)

Every signed-in page shares one chrome — the top bar and the left navigation —
built by [`js/components/AppShell.js`](js/components/AppShell.js) and styled by
`css/layout/app-shell.css` + the `app-header` / `sidebar` / `user-menu`
components. A page only writes its own content:

```html
<body>
  <div id="app" data-active-nav="dashboard">
    <section class="page">
      <header class="page-header">
        <h1 class="page-header__title">Dashboard</h1>
      </header>
      <!-- page content -->
    </section>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script type="module" src="js/pages/dashboardPage.js"></script>
</body>
```

```js
import { mountAppShell } from '../components/AppShell.js';

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'dashboard',                    // or rely on data-active-nav
  onSignOut: () => AuthService.signOut(),
});
shell.setUser({ name: 'HR Manager', email: 'hr@company.com' });
```

`mountAppShell` moves the container's existing children untouched into the
shell's `<main>`, renders the header + sidebar around them, and wires the mobile
drawer toggle and the user dropdown. Add or reorder nav items in
[`js/config/navigation.js`](js/config/navigation.js) — every page picks it up.

## Conventions

- **Styling changes start in `css/base/tokens.css`.** Change `--color-primary`
  once and every button, link, focus ring and icon follows.
- **CSS components are self-contained** and named `block__element--modifier`.
  A component file never reaches outside its own block.
- **JS components are factory functions** `createX(rootElement) -> api` (or
  `mountX` for ones that build their own markup). They own DOM behaviour only;
  no network calls, no routing.
- **Services** (`authService.js`) hold all network / auth logic and never touch
  the DOM. **Page controllers** (`js/pages/*`) are the only place the two meet.
