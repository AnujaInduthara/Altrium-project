// Public application page controller (PB-03). Resolves a published vacancy by
// its public token, shows it, and lets an external applicant submit a CV
// application — no account, no sign-in. Composes the shared field/alert
// components; all network + validation rules live in services/utils.

import { APP_CONFIG } from '../config.js';
import { fetchPublicVacancy, submitApplication } from '../services/publicVacancyService.js';
import { readParam } from '../utils/urlParams.js';
import { createFormField } from '../components/FormField.js';
import { createAlert } from '../components/Alert.js';
import {
  validateApplicantForm,
  validateCvFile,
  formatBytes,
  CV_ACCEPT,
} from '../utils/applicantValidators.js';

const $ = (id) => document.getElementById(id);

const MAX_CV_BYTES = Math.max(1, Number(APP_CONFIG.MAX_CV_MB) || 5) * 1024 * 1024;
const TEXT_FIELDS = ['full_name', 'email', 'phone', 'location'];

const els = {
  loading: $('apply-loading'),
  unavailable: $('apply-unavailable'),
  error: $('apply-error'),
  retry: $('apply-retry'),
  vacancy: $('apply-vacancy'),
  formCard: $('apply-form-card'),
  form: $('apply-form'),
  submit: $('apply-submit'),
  submitLabel: $('apply-submit').querySelector('[data-label]'),
  success: $('apply-success'),
  cvInput: $('cv'),
  cvStatus: $('cv-status'),
  cvRemove: $('cv-remove'),
  cvError: $('cv-error'),
  cvMax: $('cv-max'),
};

const alert = createAlert($('apply-alert'));
const token = readParam('token');

let fields = {};
let selectedFile = null;
let submitting = false;

// --- view state ---------------------------------------------------------

function showOnly(...visible) {
  const all = [els.loading, els.unavailable, els.error, els.vacancy, els.formCard, els.success];
  for (const el of all) el.hidden = !visible.includes(el);
}

function showUnavailable() {
  showOnly(els.unavailable);
}

function showLoadError() {
  showOnly(els.error);
}

// --- rendering ---------------------------------------------------------

function renderVacancy(vacancy) {
  document.title = `${vacancy.job_title} — Apply — Altrium`;
  $('apply-title').textContent = vacancy.job_title;

  const positions = Number(vacancy.number_of_positions);
  const meta = [
    vacancy.department,
    vacancy.location,
    vacancy.employment_type,
    vacancy.experience_level,
    Number.isFinite(positions) && positions > 0
      ? `${positions} position${positions === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);

  $('apply-meta').replaceChildren(
    ...meta.map((item) => {
      const span = document.createElement('span');
      span.textContent = item;
      return span;
    })
  );

  $('apply-description').textContent = vacancy.job_description || '';

  const reqs = Array.isArray(vacancy.job_requirements) ? vacancy.job_requirements : [];
  $('apply-requirements').replaceChildren(
    ...reqs.map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    })
  );

  showOnly(els.vacancy, els.formCard);
}

function renderSuccess({ job_title, reference }) {
  $('apply-success-role').textContent = job_title || 'this position';
  $('apply-success-reference').textContent = reference || '';
  document.title = 'Application submitted — Altrium';
  showOnly(els.success);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- CV file handling -------------------------------------------------

function clearCvError() {
  els.cvError.textContent = '';
  els.cvInput.removeAttribute('aria-invalid');
}

function setCvError(message) {
  els.cvError.textContent = message;
  els.cvInput.setAttribute('aria-invalid', 'true');
}

function renderCvSelection() {
  if (selectedFile) {
    els.cvStatus.textContent = `${selectedFile.name} (${formatBytes(selectedFile.size)})`;
    els.cvStatus.classList.add('is-selected');
    els.cvRemove.hidden = false;
  } else {
    els.cvStatus.textContent = 'No file selected';
    els.cvStatus.classList.remove('is-selected');
    els.cvRemove.hidden = true;
  }
}

function handleCvChange() {
  clearCvError();
  const file = els.cvInput.files && els.cvInput.files[0];
  if (!file) {
    selectedFile = null;
    renderCvSelection();
    return;
  }

  const problem = validateCvFile(file, MAX_CV_BYTES);
  if (problem) {
    selectedFile = null;
    els.cvInput.value = '';
    renderCvSelection();
    setCvError(problem);
    return;
  }

  selectedFile = file;
  renderCvSelection();
}

function removeCv() {
  selectedFile = null;
  els.cvInput.value = '';
  clearCvError();
  renderCvSelection();
  els.cvInput.focus();
}

// --- submission ------------------------------------------------------

function setSubmitting(on) {
  submitting = on;
  els.submit.disabled = on;
  els.submit.setAttribute('aria-busy', String(on));
  els.submitLabel.textContent = on ? 'Submitting application…' : 'Submit application';
}

function clearFieldErrors() {
  Object.values(fields).forEach((f) => f.clearError());
  clearCvError();
}

function showFieldErrors(errors) {
  let firstInvalid = null;
  TEXT_FIELDS.forEach((name) => {
    if (errors[name]) {
      fields[name].setError(errors[name]);
      if (!firstInvalid) firstInvalid = fields[name];
    }
  });
  if (errors.cv) {
    setCvError(errors.cv);
    if (!firstInvalid) firstInvalid = { focus: () => els.cvInput.focus() };
  }
  if (firstInvalid) firstInvalid.focus();
}

function readValues() {
  return {
    full_name: fields.full_name.value,
    email: fields.email.value,
    phone: fields.phone.value,
    location: fields.location.value,
  };
}

function mapErrorMessage(status, body) {
  const apiMessage = body && body.error && body.error.message;
  switch (status) {
    case 400:
      return apiMessage || 'Please check the highlighted fields and try again.';
    case 404:
      return apiMessage || 'This vacancy is no longer accepting applications.';
    case 409:
      return apiMessage || 'We already have an application from you for this position.';
    case 413:
      return apiMessage || 'Your CV exceeds the maximum allowed file size.';
    case 415:
      return apiMessage || 'Please upload your CV as a PDF or DOCX file.';
    case 429:
      return apiMessage || 'Too many attempts. Please wait a little while and try again.';
    default:
      return apiMessage || "We couldn't submit your application right now. Please try again later.";
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting) return;

  alert.hide();
  clearFieldErrors();

  const values = readValues();
  const errors = validateApplicantForm(values);

  const cvProblem = validateCvFile(selectedFile, MAX_CV_BYTES);
  if (cvProblem) errors.cv = cvProblem;

  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    return;
  }

  const formData = new FormData();
  formData.append('full_name', values.full_name);
  formData.append('email', values.email);
  formData.append('phone', values.phone);
  formData.append('location', values.location);
  formData.append('cv', selectedFile, selectedFile.name);

  setSubmitting(true);
  try {
    const { ok, status, body } = await submitApplication(token, formData);

    if (ok && body && body.data) {
      renderSuccess(body.data);
      return;
    }

    if (status === 400 && body && body.error && body.error.fields) {
      showFieldErrors(body.error.fields);
    }
    if (status === 404) {
      // The vacancy closed between load and submit — send the applicant to the
      // unavailable state rather than leaving a dead form.
      showUnavailable();
      return;
    }

    alert.error(mapErrorMessage(status, body));
    setSubmitting(false);
  } catch (err) {
    alert.error(
      'Something went wrong while submitting your application. Please check your connection and try again.'
    );
    setSubmitting(false);
  }
}

// --- init -----------------------------------------------------------

async function loadVacancy() {
  showOnly(els.loading);
  alert.hide();

  if (!token) {
    showUnavailable();
    return;
  }

  try {
    const { ok, status, body } = await fetchPublicVacancy(token);
    if (ok && body && body.data) {
      renderVacancy(body.data);
      return;
    }
    if (status === 404) {
      showUnavailable();
      return;
    }
    showLoadError();
  } catch (err) {
    showLoadError();
  }
}

function wire() {
  els.cvInput.setAttribute('accept', CV_ACCEPT);
  els.cvMax.textContent = `${APP_CONFIG.MAX_CV_MB} MB`;

  fields = Object.fromEntries(
    TEXT_FIELDS.map((name) => [
      name,
      createFormField(document.querySelector(`[data-field="${name}"]`)),
    ])
  );

  els.cvInput.addEventListener('change', handleCvChange);
  els.cvRemove.addEventListener('click', removeCv);
  els.form.addEventListener('submit', handleSubmit);
  els.retry.addEventListener('click', loadVacancy);

  renderCvSelection();
}

document.addEventListener('DOMContentLoaded', () => {
  wire();
  loadVacancy();
});
