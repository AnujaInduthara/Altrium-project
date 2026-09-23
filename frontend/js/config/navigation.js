// Primary sidebar navigation. One entry per section — add a page here and it
// appears in the sidebar of every page that mounts the app shell.
//
// `id`    - matches `data-active-nav` on the page container
// `icon`  - key in js/components/icons.js
// `roles` - which profile roles see this item. Omit to show it to everyone
//           (today, only AppShell.setUser({ role }) callers get filtered at
//           all — see AppShell.js — so every existing HR page is unaffected
//           unless it starts passing `role`).

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard', roles: ['hr'] },
  { id: 'vacancies', label: 'Vacancies', href: 'vacancies.html', icon: 'briefcase', roles: ['hr'] },
  { id: 'applications', label: 'Applications', href: 'applications.html', icon: 'documents', roles: ['hr'] },
  { id: 'ai-screening', label: 'AI Screening', href: 'ai-screening.html', icon: 'sparkles', roles: ['hr'] },
  { id: 'interviews', label: 'Interviews', href: 'interviews.html', icon: 'calendar', roles: ['hr'] },
  { id: 'candidates', label: 'Candidates', href: 'candidates.html', icon: 'users', roles: ['hr'] },
  { id: 'reports', label: 'Reports', href: 'reports.html', icon: 'chart', roles: ['hr', 'management'] },
  { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings', roles: ['hr'] },
  {
    id: 'my-interviews',
    label: 'My Interviews',
    href: 'employee-dashboard.html',
    icon: 'calendar',
    roles: ['employee'],
  },
  {
    id: 'my-availability',
    label: 'My Availability',
    href: 'my-availability.html',
    icon: 'calendar',
    roles: ['employee', 'hr', 'hiring_manager'],
  },
  {
    id: 'hiring-dashboard',
    label: 'Hiring Dashboard',
    href: 'hiring-dashboard.html',
    icon: 'chart',
    roles: ['hiring_manager', 'management'],
  },
];
