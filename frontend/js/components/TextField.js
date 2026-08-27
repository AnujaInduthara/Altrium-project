// TextField — enhances a `.field` block (label + icon input + inline error).
//
// Usage:
//   const email = createTextField(document.querySelector('[data-field="email"]'));
//   email.value            -> current trimmed value
//   email.setError('...')  -> show inline error + red border
//   email.clearError()
//   email.focus()
//
// The error clears automatically as soon as the user edits the input.

export function createTextField(root) {
  if (!root) throw new Error('createTextField: root element is required');

  const input = root.querySelector('.field__input');
  const errorEl = root.querySelector('.field__error');

  if (!input) throw new Error('createTextField: no .field__input inside root');

  input.addEventListener('input', () => api.clearError());

  const api = {
    root,
    input,

    get value() {
      return input.value.trim();
    },

    get rawValue() {
      return input.value;
    },

    setError(message) {
      root.classList.add('is-invalid');
      if (errorEl) errorEl.textContent = message;
      input.setAttribute('aria-invalid', 'true');
    },

    clearError() {
      root.classList.remove('is-invalid');
      if (errorEl) errorEl.textContent = '';
      input.removeAttribute('aria-invalid');
    },

    focus() {
      input.focus();
    },

    reset() {
      input.value = '';
      api.clearError();
    },
  };

  return api;
}
