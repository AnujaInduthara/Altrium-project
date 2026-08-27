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
├── index.html            Session-aware entry point (redirects to login / dashboard)
├── login.html            Split-screen login page
├── dashboard.html        Protected HR dashboard placeholder
├── vacancies.html        Job Vacancies list (PB-01) — cards link to the details page
├── create-vacancy.html   Create New Vacancy form (PB-01) — saves a DRAFT
├── vacancy.html          Vacancy details + Publish action (PB-02)
├── applications.html     HR application review (PB-04) — pick a vacancy, see applicants, view CVs
├── apply.html            Public application page (PB-03) — view vacancy + submit a CV application, no auth
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
│   │   ├── brand.css        .brand / .brand__logo
│   │   ├── button.css       .button + --primary / --ghost / --block
│   │   ├── icon-button.css  .icon-button (square borderless 24px-icon button)
│   │   ├── field.css        .field (label + icon input + inline error)
│   │   ├── card.css         .card + __header / __title / __subtitle
│   │   ├── alert.css        .alert + --error / --success
│   │   ├── badge.css        .badge + --draft / --published / --closed
│   │   ├── modal.css        .modal (centred confirmation dialog)
│   │   ├── divider.css      .divider (rule with optional centred label)
│   │   ├── app-header.css   .app-header (top bar: brand + actions)
│   │   ├── sidebar.css      .sidebar / .sidebar__item (+ .is-active)
│   │   ├── user-menu.css    .user-badge + .user-menu__dropdown
│   │   └── page-header.css  .page-header (title block for a shell page)
│   ├── layout/
│   │   ├── auth.css         Split-screen auth layout (login: hero + form panel).
│   │   └── app-shell.css    Signed-in layout: sticky header + sidebar + main.
│   └── pages/
│       ├── login.css    Login-only composition.
│       ├── dashboard.css
│       ├── vacancies.css
│       ├── create-vacancy.css
│       ├── vacancy.css        Vacancy details / publish (PB-02).
│       └── apply.css          Public application page (PB-02).
│
└── js/
    ├── config.js               Public browser-safe config (Supabase URL + anon key).
    ├── config/
    │   └── navigation.js       Sidebar nav items (id / label / href / icon).
    ├── lib/
    │   └── supabaseClient.js    Single shared Supabase client.
    ├── services/
    │   ├── authService.js       Auth + HR-authorization API (no DOM).
    │   ├── vacancyService.js    Vacancy API (create / list / get / publish), bearer token.
    │   ├── applicationService.js  HR review API — list a vacancy's applications, get a CV link.
    │   └── publicVacancyService.js  Unauthenticated published-vacancy lookup + application submission.
    ├── utils/
    │   ├── validators.js        Pure form-validation helpers.
    │   ├── vacancyValidators.js Vacancy form rules + dropdown option lists.
    │   ├── applicantValidators.js Applicant form + CV file rules (PB-03); mirrors the server.
    │   └── urlParams.js         Read id/token from query OR hash (survives clean-URL redirects).
    ├── components/              Reusable DOM behaviours (factory functions)
    │   ├── icons.js             Shared inline-SVG icon set.
    │   ├── AppShell.js          Mounts the common header + sidebar around a page.
    │   ├── TextField.js         Enhances a .field: value / setError / clearError.
    │   ├── PasswordField.js     TextField + show/hide reveal toggle.
    │   ├── FormField.js         Like TextField but for input / select / textarea.
    │   ├── Modal.js             Accessible confirmation dialog (open / close, focus trap).
    │   └── Alert.js             Show/hide a .alert banner (error / success).
    └── pages/                   One controller per page; composes the above.
        ├── entryPage.js
        ├── loginPage.js
        ├── dashboardPage.js
        ├── vacanciesPage.js
        ├── createVacancyPage.js
        ├── vacancyPage.js       Details + publish flow (PB-02).
        ├── applicationsPage.js  HR review — pick a vacancy, see applicants, view CVs.
        └── applyPage.js         Public application page (PB-03).
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
