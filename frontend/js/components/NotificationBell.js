// NotificationBell — unread-count badge + dropdown, mounted into the app
// header by AppShell.js. Same open/close/keyboard/outside-click conventions
// as AppShell's own user menu.
//
//   const bell = mountNotificationBell(root); // root = the app shell's outer element
//   bell.load();  // fetch + render; call once auth is confirmed (AppShell
//                  // does this automatically from setUser()).
//
// Markup contract (see AppShell.js's shellMarkup):
//   <div data-notification-menu>
//     <button data-notification-trigger>
//       ...
//       <span data-notification-dot hidden></span>
//     </button>
//     <div data-notification-dropdown hidden>
//       <ul data-notification-list></ul>
//       <p data-notification-empty hidden></p>
//     </div>
//   </div>

import { NotificationService } from '../services/notificationService.js';

function formatRelativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function mountNotificationBell(root) {
  const menu = root.querySelector('[data-notification-menu]');
  const trigger = root.querySelector('[data-notification-trigger]');
  const dot = root.querySelector('[data-notification-dot]');
  const dropdown = root.querySelector('[data-notification-dropdown]');
  const list = root.querySelector('[data-notification-list]');
  const emptyEl = root.querySelector('[data-notification-empty]');

  if (!menu || !trigger || !dropdown || !list) {
    // Defensive: shouldn't happen given AppShell's own markup, but never
    // throw over a non-critical UI piece.
    return { load: async () => {} };
  }

  function setOpen(open) {
    dropdown.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  }

  function updateDot(unreadCount) {
    if (dot) dot.hidden = !(unreadCount > 0);
  }

  function buildItem(notification) {
    const li = document.createElement('li');
    li.className = 'notification-menu__item';
    li.classList.toggle('is-unread', !notification.read_at);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notification-menu__item-btn';
    btn.setAttribute('role', 'menuitem');

    const title = document.createElement('span');
    title.className = 'notification-menu__item-title';
    title.textContent = notification.title;

    const body = document.createElement('span');
    body.className = 'notification-menu__item-body';
    body.textContent = notification.body;

    const time = document.createElement('span');
    time.className = 'notification-menu__item-time';
    time.textContent = formatRelativeTime(notification.created_at);

    btn.append(title, body, time);
    btn.addEventListener('click', () => markRead(notification.id, li));

    li.appendChild(btn);
    return li;
  }

  // Optimistic: the item flips to "read" immediately — a failed request just
  // means the server might still show it unread on next load, which is
  // harmless and self-corrects.
  async function markRead(id, itemEl) {
    if (!itemEl.classList.contains('is-unread')) return;
    itemEl.classList.remove('is-unread');
    updateDot(list.querySelectorAll('.is-unread').length);
    try {
      await NotificationService.markRead(id);
    } catch (err) {
      /* best-effort — see comment above */
    }
  }

  let loaded = false;
  async function load() {
    try {
      const { ok, body } = await NotificationService.list({});
      if (!ok) return;

      const notifications = body?.data?.notifications || [];
      const unreadCount = body?.data?.unread_count ?? 0;
      updateDot(unreadCount);

      if (notifications.length === 0) {
        list.replaceChildren();
        if (emptyEl) emptyEl.hidden = false;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      list.replaceChildren(...notifications.map(buildItem));
    } catch (err) {
      // Silent — the bell just keeps its last known state.
    } finally {
      loaded = true;
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    setOpen(willOpen);
    if (willOpen && !loaded) load();
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.hidden) setOpen(false);
  });

  return { load };
}
