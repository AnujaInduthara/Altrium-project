// Alert — form-level feedback banner. Toggles the `.alert` element between
// hidden / error / success states.
//
//   const alert = createAlert(document.getElementById('form-alert'));
//   alert.error('Invalid email or password.');
//   alert.success('Signed in.');
//   alert.hide();

const VARIANTS = ['alert--error', 'alert--success'];

export function createAlert(el) {
  if (!el) throw new Error('createAlert: element is required');

  function render(message, variant) {
    el.classList.remove(...VARIANTS);
    el.classList.add(variant);
    el.textContent = message;
    el.hidden = false;
  }

  return {
    element: el,
    error: (message) => render(message, 'alert--error'),
    success: (message) => render(message, 'alert--success'),
    hide() {
      el.hidden = true;
      el.textContent = '';
      el.classList.remove(...VARIANTS);
    },
  };
}
