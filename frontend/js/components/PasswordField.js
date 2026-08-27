// PasswordField — a TextField plus a show/hide reveal toggle.
//
// Expects a `.field__addon` button inside the `.field__control`, with the
// two eye icons marked `data-icon="show"` / `data-icon="hide"` (CSS swaps
// them based on the button's aria-pressed state).

import { createTextField } from './TextField.js';

export function createPasswordField(root) {
  const field = createTextField(root);
  const toggle = root.querySelector('.field__addon');

  if (toggle) {
    toggle.addEventListener('click', () => {
      const reveal = field.input.type === 'password';
      field.input.type = reveal ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(reveal));
      toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      field.input.focus();
    });
  }

  return field;
}
