// Create Vacancy page controller: mounts the app shell, enforces the HR-only
// route, wires client validation, and submits the draft to the backend.

import { AuthService } from '../services/authService.js';
import { VacancyService } from '../services/vacancyService.js';
import { mountAppShell } from '../components/AppShell.js';
import { createFormField } from '../components/FormField.js';
import { createAlert } from '../components/Alert.js';
import {
  validateVacancyForm,
  parseRequirements,
  VACANCY_LIMITS,
} from '../utils/vacancyValidators.js';
import { withHashParam } from '../utils/urlParams.js';

const LOGIN_PAGE = 'login.html';

const FIELD_NAMES = [
  'job_title',
  'department',
  'location',
  'employment_type',
  'experience_level',
  'number_of_positions',
  'job_description',
  'job_requirements',
];

const shell = mountAppShell(document.getElementById('app'), {
  activeNav: 'vacancies',
  onSignOut: async () => {
    await AuthService.signOut();
    window.location.replace(LOGIN_PAGE);
  },
});

const page = document.getElementById('vacancy-page');
const formCard = document.getElementById('vacancy-form-card');
const successCard = document.getElementById('vacancy-success');
const form = document.getElementById('vacancy-form');
const alert = createAlert(document.getElementById('form-alert'));
const submitBtn = document.getElementById('save-draft-btn');
const submitLabel = submitBtn.querySelector('[data-label]');
const descCount = document.getElementById('job_description-count');

let fields = {};
let submitting = false;
let wired = false;

function setLoading(loading) {
  submitting = loading;
  submitBtn.disabled = loading;
  submitBtn.setAttribute('aria-busy', String(loading));
  submitLabel.textContent = loading ? 'Saving…' : 'Save Draft';
}

function clearAllErrors() {
  Object.values(fields).forEach((field) => field.clearError());
}

function showFieldErrors(errors) {
  clearAllErrors();
  let firstInvalid = null;
  FIELD_NAMES.forEach((name) => {
    if (errors[name]) {
      fields[name].setError(errors[name]);
      if (!firstInvalid) firstInvalid = fields[name];
    }
  });
  if (firstInvalid) firstInvalid.focus();
}

function readValues() {
  return {
    job_title: fields.job_title.value,
    department: fields.department.value,
    location: fields.location.value,
    employment_type: fields.employment_type.value,
    experience_level: fields.experience_level.value,
    number_of_positions: fields.number_of_positions.rawValue,
    job_description: fields.job_description.value,
    job_requirements: fields.job_requirements.rawValue,
  };
}

function buildPayload(values) {
  return {
    job_title: values.job_title,
    department: values.department,
    location: values.location,
    employment_type: values.employment_type,
    experience_level: values.experience_level,
    number_of_positions: Number(values.number_of_positions),
    job_description: values.job_description,
    job_requirements: parseRequirements(values.job_requirements),
  };
}

function showSuccess(vacancy) {
  const titleEl = document.getElementById('vacancy-success-title');
  titleEl.textContent = vacancy && vacancy.job_title ? vacancy.job_title : '';
  const openLink = document.getElementById('open-vacancy-link');
  if (vacancy && vacancy.id) {
    openLink.href = withHashParam('vacancy.html', 'id', vacancy.id);
    openLink.hidden = false;
  } else {
    openLink.hidden = true;
  }
  formCard.hidden = true;
  successCard.hidden = false;
  successCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForNewDraft() {
  form.reset();
  clearAllErrors();
  alert.hide();
  updateDescCount();
  successCard.hidden = true;
  formCard.hidden = false;
  setLoading(false);
  fields.job_title.focus();
}

function updateDescCount() {
  const len = fields.job_description.rawValue.length;
  descCount.textContent = `${len} / ${VACANCY_LIMITS.jobDescription}`;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting) return;

  alert.hide();
  const values = readValues();

  const clientErrors = validateVacancyForm(values);
  if (Object.keys(clientErrors).length > 0) {
    showFieldErrors(clientErrors);
    return;
  }
  clearAllErrors();

  setLoading(true);
  try {
    const { ok, status, body } = await VacancyService.create(buildPayload(values));

    if (ok) {
      showSuccess(body && body.data);
      return;
    }

    if (status === 401) {
      await AuthService.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (status === 403) {
      alert.error('You are not authorized to create vacancies.');
    } else if (status === 400 && body?.error?.fields) {
      showFieldErrors(body.error.fields);
      alert.error(body.error.message || 'Some vacancy details need attention.');
    } else {
      alert.error(
        body?.error?.message || 'Unable to save the vacancy. Please try again later.'
      );
    }
    setLoading(false);
  } catch (err) {
    alert.error(
      'Unable to save the vacancy. Please check your connection and try again.'
    );
    setLoading(false);
  }
}

async function initPage() {
  const result = await AuthService.requireHRSession(LOGIN_PAGE);
  if (!result) return; // already redirected

  shell.setUser({ email: result.profile.email });

  if (!wired) {
    fields = Object.fromEntries(
      FIELD_NAMES.map((name) => [
        name,
        createFormField(document.querySelector(`[data-field="${name}"]`)),
      ])
    );

    fields.job_description.control.addEventListener('input', updateDescCount);
    updateDescCount();

    form.addEventListener('submit', handleSubmit);
    document
      .getElementById('create-another-btn')
      .addEventListener('click', resetForNewDraft);

    wired = true;
  }

  page.hidden = false;
}

document.addEventListener('DOMContentLoaded', initPage);

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    page.hidden = true;
    initPage();
  }
});
