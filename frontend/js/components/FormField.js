// FormField — like TextField, but works for any `.field__input` control:
// <input>, <select> or <textarea>. Same error API as TextField so page
// controllers treat every field the same way.
//
//   const dept = createFormField(document.querySelector('[data-field="department"]'));
//   dept.value            -> current trimmed value
//   dept.setError('...')  -> inline error + red border
//   dept.clearError()
//
// The error clears as soon as the user edits or changes the control.

export function createFormField(root) {
  if (!root) throw new Error('createFormField: root element is required');

  const control = root.querySelector('.field__input');
  const errorEl = root.querySelector('.field__error');

  if (!control) throw new Error('createFormField: no .field__input inside root');

  const clear = () => api.clearError();
  control.addEventListener('input', clear);
  control.addEventListener('change', clear);

  const api = {
    root,
    control,

    get value() {
      return control.value.trim();
    },

    get rawValue() {
      return control.value;
    },

    setError(message) {
      root.classList.add('is-invalid');
      if (errorEl) errorEl.textContent = message;
      control.setAttribute('aria-invalid', 'true');
    },

    clearError() {
      root.classList.remove('is-invalid');
      if (errorEl) errorEl.textContent = '';
      control.removeAttribute('aria-invalid');
    },

    focus() {
      control.focus();
    },
  };

  return api;
}
