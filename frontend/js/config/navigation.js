// Primary sidebar navigation. One entry per section — add a page here and it
// appears in the sidebar of every page that mounts the app shell.
//
// `id`   - matches `data-active-nav` on the page container
// `icon` - key in js/components/icons.js

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard' },
  { id: 'vacancies', label: 'Vacancies', href: 'vacancies.html', icon: 'briefcase' },
  { id: 'applications', label: 'Applications', href: 'applications.html', icon: 'documents' },
  { id: 'ai-screening', label: 'AI Screening', href: 'ai-screening.html', icon: 'sparkles' },
  { id: 'interviews', label: 'Interviews', href: 'interviews.html', icon: 'calendar' },
  { id: 'candidates', label: 'Candidates', href: 'candidates.html', icon: 'users' },
  { id: 'reports', label: 'Reports', href: 'reports.html', icon: 'chart' },
  { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' },
];
