// AppShell — the common chrome (header + sidebar) shared by every signed-in
// page. The page HTML only holds its own content inside a container:
//
//   <div id="app" data-active-nav="dashboard">
//     <section class="page"> …page content… </section>
//   </div>
//
// then a page controller calls:
//
//   const shell = mountAppShell(document.getElementById('app'), {
//     onSignOut: () => AuthService.signOut(),
//   });
//   shell.setUser({ name: 'HR Manager', email: 'hr@company.com' });
//
// The existing children are moved untouched into the shell's <main>.

import { NAV_ITEMS } from '../config/navigation.js';
import { svgIcon } from './icons.js';
import { mountNotificationBell } from './NotificationBell.js';

const LOGO_SRC = 'assets/icons/altrium-logo.png';

// `role` filters NAV_ITEMS to those with no `roles` list, or whose `roles`
// list includes it. `role` is undefined at mount time (auth hasn't resolved
// yet) — showing everything until setUser({ role }) re-filters keeps every
// existing page's sidebar exactly as it always rendered.
function navMarkup(activeId, role) {
  const items = role ? NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role)) : NAV_ITEMS;
  return items.map((item) => {
    const isActive = item.id === activeId;
    return `
      <a class="sidebar__item${isActive ? ' is-active' : ''}" href="${item.href}"${
      isActive ? ' aria-current="page"' : ''
    }>
        ${svgIcon(item.icon, 'sidebar__icon')}
        <span class="sidebar__label">${item.label}</span>
      </a>`;
  }).join('');
}

function shellMarkup(activeId) {
  return `
    <header class="app-header">
      <button class="icon-button app-header__menu" type="button" aria-label="Open navigation" aria-expanded="false">
        ${svgIcon('menu')}
      </button>

      <a class="brand app-header__brand" href="index.html">
        <img class="brand__logo" src="${LOGO_SRC}" alt="Altrium" />
      </a>

      <div class="app-header__actions">
        <div class="notification-menu" data-notification-menu>
          <button
            class="icon-button"
            type="button"
            aria-haspopup="true"
            aria-expanded="false"
            aria-label="Notifications"
            data-notification-trigger
          >
            ${svgIcon('bell')}
            <span class="icon-button__dot" aria-hidden="true" data-notification-dot hidden></span>
          </button>
          <div class="notification-menu__dropdown" role="menu" aria-label="Notifications" hidden data-notification-dropdown>
            <div class="notification-menu__header">Notifications</div>
            <ul class="notification-menu__list" data-notification-list></ul>
            <p class="notification-menu__empty" data-notification-empty hidden>No notifications yet.</p>
          </div>
        </div>

        <div class="user-menu" data-user-menu>
          <button class="user-badge" type="button" aria-haspopup="true" aria-expanded="false">
            <span class="user-badge__avatar">${svgIcon('user')}</span>
            <span class="user-badge__info">
              <span class="user-badge__name" data-user-name>HR Manager</span>
              <span class="user-badge__email" data-user-email>—</span>
            </span>
            ${svgIcon('chevronDown', 'user-badge__chevron')}
          </button>
          <div class="user-menu__dropdown" role="menu" hidden>
            <button class="user-menu__item" type="button" role="menuitem" data-action="sign-out">
              ${svgIcon('logout', 'user-menu__icon')}
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="app-shell__backdrop" data-backdrop hidden></div>

    <aside class="sidebar" data-sidebar>
      <nav class="sidebar__nav" aria-label="Main">
        ${navMarkup(activeId)}
      </nav>
    </aside>

    <main class="app-shell__main">
      <div class="app-shell__content" data-shell-content></div>
    </main>`;
}

export function mountAppShell(root, options = {}) {
  if (!root) throw new Error('mountAppShell: root element is required');

  const activeId = options.activeNav || root.dataset.activeNav || '';

  // Detach the page's own content before we rebuild the container.
  const saved = document.createDocumentFragment();
  while (root.firstChild) saved.appendChild(root.firstChild);

  root.classList.add('app-shell');
  root.innerHTML = shellMarkup(activeId);
  root.querySelector('[data-shell-content]').appendChild(saved);

  const sidebar = root.querySelector('[data-sidebar]');
  const backdrop = root.querySelector('[data-backdrop]');
  const menuToggle = root.querySelector('.app-header__menu');
  const userMenu = root.querySelector('[data-user-menu]');
  const userTrigger = userMenu.querySelector('.user-badge');
  const dropdown = userMenu.querySelector('.user-menu__dropdown');
  const notificationBell = mountNotificationBell(root);

  /* --- mobile sidebar ---------------------------------------------------- */
  function setSidebar(open) {
    sidebar.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
  }
  menuToggle.addEventListener('click', () =>
    setSidebar(!sidebar.classList.contains('is-open'))
  );
  backdrop.addEventListener('click', () => setSidebar(false));
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar__item')) setSidebar(false);
  });

  /* --- user dropdown --------------------------------------------------------- */
  function setMenu(open) {
    dropdown.hidden = !open;
    userTrigger.setAttribute('aria-expanded', String(open));
  }
  userTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(dropdown.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!userMenu.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setMenu(false);
      setSidebar(false);
    }
  });

  dropdown
    .querySelector('[data-action="sign-out"]')
    .addEventListener('click', () => options.onSignOut && options.onSignOut());

  /* --- public API --------------------------------------------------------- */
  return {
    root,
    main: root.querySelector('.app-shell__main'),
    content: root.querySelector('[data-shell-content]'),

    // `role` is optional — pass the signed-in profile's role once auth
    // resolves to filter the sidebar to what that role can see (see
    // navigation.js). Omit it and the sidebar stays exactly as first
    // rendered (today's behaviour, unchanged, for every page that doesn't
    // pass it).
    setUser({ name, email, role } = {}) {
      if (name) root.querySelector('[data-user-name]').textContent = name;
      if (email) {
        root.querySelector('[data-user-email]').textContent = email;
        // setUser() is every page's "auth just resolved" signal — this is
        // the first safe point to fetch notifications (before this, we
        // don't yet know there's a valid session).
        notificationBell.load();
      }
      if (role) {
        root.querySelector('.sidebar__nav').innerHTML = navMarkup(activeId, role);
      }
    },
  };
}
