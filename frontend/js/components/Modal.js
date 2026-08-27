// Modal — a small accessible confirmation dialog.
//
// Markup contract:
//   <div class="modal" id="…" hidden>
//     <div class="modal__backdrop" data-close></div>
//     <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="…">
//       …content…  (buttons; give the primary one [data-autofocus])
//     </div>
//   </div>
//
//   const modal = createModal(document.getElementById('publish-modal'));
//   modal.open();  modal.close();
//
// Esc and backdrop / [data-close] click dismiss it; focus is moved into the
// dialog on open and restored to the trigger on close; Tab is kept inside.

export function createModal(root) {
  if (!root) throw new Error('createModal: root element is required');

  const dialog = root.querySelector('.modal__dialog');
  let lastFocused = null;

  function focusables() {
    return Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function open() {
    lastFocused = document.activeElement;
    root.hidden = false;
    document.addEventListener('keydown', onKeydown, true);
    const target = dialog.querySelector('[data-autofocus]') || focusables()[0];
    if (target) target.focus();
  }

  function close() {
    root.hidden = true;
    document.removeEventListener('keydown', onKeydown, true);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });

  return { root, dialog, open, close, get isOpen() { return !root.hidden; } };
}
