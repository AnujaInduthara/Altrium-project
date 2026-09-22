#!/usr/bin/env node
// PB-7.1 — development seed script. Fills an empty (or partially built)
// Supabase project with a realistic end-to-end recruitment scenario, so
// every later phase — and a live demo — has something real to show.
//
// Deliberately a plain Node script with NO new dependencies: it reuses the
// same service-role Supabase client and the exact same service-layer
// functions (backend/src/services/*.service.js) the HTTP API itself calls,
// so every row this script writes is guaranteed to satisfy the same
// validation, audit columns and constraints a real request would produce —
// there is no separate, drifting "seed-only" path.
//
// Usage:
//   npm run seed -- --force
//   SEED_ALLOW=true npm run seed
//
// Safe to re-run: everything is looked up by a stable @altrium-seed.test
// email/title marker first, and only created if missing.

require('dotenv').config();

const { supabaseAdmin } = require('../src/config/supabase');

const vacancyService = require('../src/services/vacancy.service');
const applicationService = require('../src/services/application.service');
const availabilityService = require('../src/services/availability.service');
const interviewProcessService = require('../src/services/interviewProcess.service');
const interviewService = require('../src/services/interview.service');
const evaluationService = require('../src/services/evaluation.service');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Every seeded person/application uses this email domain — the one stable
// marker every idempotency check in this script looks up by.
const SEED_EMAIL_DOMAIN = 'altrium-seed.test';

// A fixed, obviously-fake, development-only password for every seeded
// account. It is intentionally NOT randomly generated per run: README.md
// documents this exact value so anyone can log in as a seeded user, and a
// value that changed on every run could never be written down there. It is
// printed at the end of this script (the one deliberate exception to "never
// print secrets" — this is not a secret, it protects nothing real).
const SEED_PASSWORD = 'Altrium-Seed-2026!';

const VACANCY_TITLES = {
  draft: '[Seed] Backend Engineer (Draft)',
  published: '[Seed] Product Designer (Published)',
  closed: '[Seed] Data Analyst (Closed)',
};

const VACANCY_BASE = {
  location: 'Remote',
  employment_type: 'Full-time',
  experience_level: '2+ Years',
  number_of_positions: 1,
  job_description:
    'We are looking for a talented professional to join our growing team. You will collaborate ' +
    'closely with cross-functional stakeholders, own projects end-to-end, and help us raise the ' +
    'bar for quality across the organisation. (This is fictional seed data.)',
  job_requirements: ['Strong communication skills', 'Relevant hands-on experience', 'A collaborative mindset'],
};

const CANDIDATE_DEFS = [
  {
    full_name: 'Alex Rivera',
    email_local: 'alex.rivera',
    phone: '+1 555 010 1001',
    location: 'Austin, TX',
    headline: 'Product designer with 4 years of experience in B2B SaaS.',
  },
  {
    full_name: 'Jamie Chen',
    email_local: 'jamie.chen',
    phone: '+1 555 010 1002',
    location: 'Seattle, WA',
    headline: 'UX/UI designer focused on accessible, data-informed design.',
  },
  {
    full_name: 'Priya Patel',
    email_local: 'priya.patel',
    phone: '+1 555 010 1003',
    location: 'Chicago, IL',
    headline: 'Product designer and former front-end engineer.',
  },
  {
    full_name: "Sam O'Connor",
    email_local: 'sam.oconnor',
    phone: '+1 555 010 1004',
    location: 'Denver, CO',
    headline: 'Design systems specialist with a research background.',
  },
  {
    full_name: 'Nina Kowalski',
    email_local: 'nina.kowalski',
    phone: '+1 555 010 1005',
    location: 'Boston, MA',
    headline: 'Cross-platform product designer, mobile-first.',
  },
  {
    full_name: 'Marcus Webb',
    email_local: 'marcus.webb',
    phone: '+1 555 010 1006',
    location: 'Atlanta, GA',
    headline: 'Senior product designer with fintech experience.',
  },
];

const EMPLOYEE_DEFS = [
  {
    emailLocal: 'employee-1',
    full_name: 'Jordan Kim',
    department: 'Engineering',
    job_position: 'Software Engineer',
    seniority_level: 'junior',
  },
  {
    emailLocal: 'employee-2',
    full_name: 'Casey Nguyen',
    department: 'Engineering',
    job_position: 'Senior Software Engineer',
    seniority_level: 'senior',
  },
  {
    emailLocal: 'employee-3',
    full_name: 'Riley Thompson',
    department: 'Finance',
    job_position: 'Financial Analyst',
    seniority_level: 'mid',
  },
  {
    emailLocal: 'employee-4',
    full_name: 'Avery Martinez',
    department: 'Human Resources',
    job_position: 'HR Business Partner',
    seniority_level: 'lead',
  },
];

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

function assertSafeToRun() {
  const isProduction = process.env.NODE_ENV === 'production';
  const forced = process.argv.includes('--force');
  const allowed = process.env.SEED_ALLOW === 'true';

  // Absolute block — no flag can override this one.
  if (isProduction) {
    console.error(
      'Refusing to seed: NODE_ENV is "production". This script writes fake demo data and must never run against a production database.'
    );
    process.exit(1);
  }

  if (!forced && !allowed) {
    console.error(
      'Refusing to seed without explicit confirmation.\n' +
        'This creates demo auth users, vacancies, applications and CVs in the Supabase project configured\n' +
        'in backend/.env. Re-run with --force, or set SEED_ALLOW=true, once you have confirmed that\n' +
        'project is a development database.'
    );
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Refusing to seed: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured (see backend/.env).');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Detects a table that doesn't exist yet (this migration hasn't been applied
// to this database) so the script can skip that phase with a clear message
// instead of crashing — Postgres and PostgREST phrase this differently
// depending on how the query reaches the database, so both are checked.
async function tableExists(table) {
  const { error } = await supabaseAdmin.from(table).select('id').limit(1);
  if (!error) return true;
  if (error.code === '42P01' || error.code === 'PGRST205') return false;
  if (/does not exist|schema cache|could not find the table/i.test(error.message || '')) return false;
  // Some other, unrelated error (e.g. a real connectivity problem) — surface it.
  throw new Error(`Failed to check for table "${table}": ${error.message}`);
}

function isoDateAddDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// A start time on TODAY that is guaranteed to already be in the past by wall
// clock time, so the freshly-scheduled demo interview can have its evaluation
// submitted immediately (evaluation.service.js refuses one for an interview
// that "hasn't started yet"). 01:00 covers the overwhelming majority of when
// this script is actually run; the 00:00 fallback only matters in the rare
// case it's run in the first hour of the day.
function pastStartTimeForToday() {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = nowMinutes >= 60 ? 60 : 0;
  return `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`;
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildContentStream(lines) {
  const ops = ['BT', '/F1 11 Tf', '72 740 Td', '14 TL', `(${escapePdfText(lines[0] || '')}) Tj`];
  for (let i = 1; i < lines.length; i += 1) {
    ops.push('T*', `(${escapePdfText(lines[i])}) Tj`);
  }
  ops.push('ET');
  return ops.join('\n');
}

// A hand-built, dependency-free single-page PDF (no external library — the
// plan forbids adding one). Byte offsets in the xref table are computed as
// the buffer is assembled, so this is a genuinely well-formed PDF that a real
// parser can open, not just something that passes the "%PDF-" magic-byte
// check applicationValidation.js's upload check looks for.
function buildMinimalPdf(lines) {
  const streamBuffer = Buffer.from(buildContentStream(lines), 'latin1');

  const objectBodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let header = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objectBodies.length; i += 1) {
    offsets.push(Buffer.byteLength(header, 'latin1'));
    header += `${i + 1} 0 obj\n${objectBodies[i]}\nendobj\n`;
  }

  offsets.push(Buffer.byteLength(header, 'latin1'));
  header += `5 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(header, 'latin1'),
    streamBuffer,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);

  const xrefStart = bodyBuffer.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.concat([bodyBuffer, Buffer.from(xref + trailer, 'latin1')]);
}

// ---------------------------------------------------------------------------
// People (auth users + profiles)
// ---------------------------------------------------------------------------

async function findAuthUserByEmail(email) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Failed to list auth users: ${error.message}`);
  return (data?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function ensureAuthUser(email) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create auth user ${email}: ${error.message}`);
  return data.user;
}

async function ensureProfile({ authUserId, email, role, full_name, department, job_position, seniority_level }) {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (findError) throw new Error(`Failed to look up profile for ${email}: ${findError.message}`);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .insert({ auth_user_id: authUserId, email, role, full_name, department, job_position, seniority_level })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create profile for ${email}: ${error.message}`);
  return data;
}

async function ensurePerson({ emailLocal, role, full_name, department, job_position, seniority_level }) {
  const email = `${emailLocal}@${SEED_EMAIL_DOMAIN}`;
  const authUser = await ensureAuthUser(email);
  const profile = await ensureProfile({ authUserId: authUser.id, email, role, full_name, department, job_position, seniority_level });
  return { authUser, profile };
}

async function seedPeople() {
  const hr = await ensurePerson({
    emailLocal: 'hr',
    role: 'hr',
    full_name: 'Harper Reyes',
    department: 'Human Resources',
    job_position: 'HR Manager',
    seniority_level: 'senior',
  });

  const hiringManager = await ensurePerson({
    emailLocal: 'hiring-manager',
    role: 'hiring_manager',
    full_name: 'Morgan Ellis',
    department: 'Design',
    job_position: 'Design Director',
    seniority_level: 'lead',
  });

  const management = await ensurePerson({
    emailLocal: 'management',
    role: 'management',
    full_name: 'Taylor Brooks',
    department: 'Operations',
    job_position: 'VP of Operations',
    seniority_level: 'lead',
  });

  const employees = [];
  for (const def of EMPLOYEE_DEFS) {
    employees.push(await ensurePerson({ ...def, role: 'employee' }));
  }

  return { hr, hiringManager, management, employees };
}

// ---------------------------------------------------------------------------
// Vacancies
// ---------------------------------------------------------------------------

async function findVacancyByTitle(authUserId, jobTitle) {
  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select('*')
    .eq('created_by', authUserId)
    .eq('job_title', jobTitle)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up vacancy "${jobTitle}": ${error.message}`);
  return data;
}

async function seedVacancies(hr) {
  let draft = await findVacancyByTitle(hr.authUser.id, VACANCY_TITLES.draft);
  if (!draft) {
    draft = await vacancyService.createVacancy(
      { ...VACANCY_BASE, job_title: VACANCY_TITLES.draft, department: 'Engineering' },
      hr.authUser.id
    );
  }

  let published = await findVacancyByTitle(hr.authUser.id, VACANCY_TITLES.published);
  if (!published) {
    published = await vacancyService.createVacancy(
      { ...VACANCY_BASE, job_title: VACANCY_TITLES.published, department: 'Design' },
      hr.authUser.id
    );
  }
  if (published.status === 'draft') {
    published = await vacancyService.publishVacancy(published.id, hr.authUser.id);
  }

  let closed = await findVacancyByTitle(hr.authUser.id, VACANCY_TITLES.closed);
  if (!closed) {
    closed = await vacancyService.createVacancy(
      { ...VACANCY_BASE, job_title: VACANCY_TITLES.closed, department: 'Finance' },
      hr.authUser.id
    );
  }
  if (closed.status === 'draft') {
    closed = await vacancyService.publishVacancy(closed.id, hr.authUser.id);
  }
  if (closed.status === 'published') {
    closed = await vacancyService.closeVacancy(closed.id, hr.authUser.id);
  }

  return { draft, published, closed };
}

// ---------------------------------------------------------------------------
// Applications (+ generated CVs)
// ---------------------------------------------------------------------------

async function findApplicationByEmail(vacancyId, email) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('vacancy_id', vacancyId)
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up application for ${email}: ${error.message}`);
  return data;
}

// A few hundred characters of plausible CV body text per candidate — enough
// to comfortably clear screeningOptions.js's CV_TEXT_MIN_CHARS (200 readable
// characters), which a shorter placeholder CV would fail, surfacing as
// CV_EXTRACTION_ERROR the moment AI screening is configured.
function buildCvLines(def, email) {
  return [
    def.full_name,
    `${email} | ${def.phone} | ${def.location}`,
    def.headline,
    '',
    'Summary',
    `Fictional seed-data candidate. ${def.headline}`,
    '',
    'Experience',
    '- Product Designer, Fictional Seed Company (2021-Present): led end-to-end design for',
    '  several core product surfaces, partnering closely with engineering and research.',
    '- Associate Product Designer, Example Seed Studio (2019-2021): shipped onboarding and',
    '  growth experiments; ran usability studies and translated findings into design changes.',
    '',
    'Education',
    '- B.A. in Design (fictional seed institution), graduated 2019.',
    '',
    'Skills',
    '- User research, interaction design, prototyping, design systems, accessibility.',
  ];
}

async function seedApplications(publishedVacancy) {
  const applications = [];

  for (const def of CANDIDATE_DEFS) {
    const email = `${def.email_local}@${SEED_EMAIL_DOMAIN}`;
    let application = await findApplicationByEmail(publishedVacancy.id, email);

    if (!application) {
      const pdf = buildMinimalPdf(buildCvLines(def, email));

      await applicationService.createApplication({
        vacancy: { id: publishedVacancy.id, job_title: publishedVacancy.job_title },
        input: { full_name: def.full_name, email, phone: def.phone, location: def.location },
        cv: {
          buffer: pdf,
          size: pdf.length,
          originalName: `${def.full_name.replace(/\s+/g, '_')}_CV.pdf`,
          ext: 'pdf',
          contentType: 'application/pdf',
        },
      });

      application = await findApplicationByEmail(publishedVacancy.id, email);
    }

    applications.push(application);
  }

  return applications;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

async function findAvailabilitySlot(profileId, slotDate) {
  const { data, error } = await supabaseAdmin
    .from('interview_availability')
    .select('*')
    .eq('profile_id', profileId)
    .eq('slot_date', slotDate)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up availability for ${profileId} on ${slotDate}: ${error.message}`);
  return data;
}

// Every employee gets ordinary business-hours availability across the next
// 14 days. The one designated demo interviewer additionally gets a wide
// early-morning window TODAY (00:00-02:00) instead of the usual 09:00-17:00,
// so seedInterviewDemo() can book an already-started interview against it —
// see pastStartTimeForToday().
async function seedAvailability(employees, demoInterviewerProfileId) {
  let created = 0;

  for (const { profile } of employees) {
    for (let i = 0; i < 14; i += 1) {
      const slotDate = isoDateAddDays(i);
      const existing = await findAvailabilitySlot(profile.id, slotDate);
      if (existing) continue;

      if (i === 0 && profile.id === demoInterviewerProfileId) {
        await availabilityService.create(profile.id, { slot_date: slotDate, start_time: '00:00', end_time: '02:00' });
      } else {
        await availabilityService.create(profile.id, { slot_date: slotDate, start_time: '09:00', end_time: '17:00' });
      }
      created += 1;
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Full interview-process demo: select -> process -> schedule -> evaluate
// ---------------------------------------------------------------------------

async function seedInterviewDemo({ hr, employees, publishedVacancy, applications }) {
  const candidateApplication = applications[0];
  const interviewer = employees[0];

  await applicationService.selectCandidates({
    vacancyId: publishedVacancy.id,
    applicationIds: [candidateApplication.id],
    hrUserId: hr.authUser.id,
  });

  let process;
  let stages;
  try {
    const result = await interviewProcessService.createProcess({
      applicationId: candidateApplication.id,
      interviewLevel: 'junior',
      authUserId: hr.authUser.id,
    });
    process = result.process;
    stages = result.stages;
  } catch (err) {
    if (err && err.isInterviewProcessError && err.code === 'PROCESS_EXISTS') {
      const result = await interviewProcessService.getProcess({
        applicationId: candidateApplication.id,
        authUserId: hr.authUser.id,
      });
      process = result.process;
      stages = result.stages;
    } else {
      throw err;
    }
  }

  const firstStage = stages[0];
  const today = isoDateAddDays(0);
  const startTime = pastStartTimeForToday();

  let interview = null;
  try {
    interview = await interviewService.schedule({
      stageId: firstStage.id,
      input: { scheduled_date: today, start_time: startTime, interviewer_ids: [interviewer.profile.id] },
      authUserId: hr.authUser.id,
    });
  } catch (err) {
    if (err && err.isInterviewError && err.code === 'STAGE_ALREADY_SCHEDULED') {
      const { data, error } = await supabaseAdmin
        .from('interviews')
        .select('*')
        .eq('candidate_stage_id', firstStage.id)
        .maybeSingle();
      if (error) throw new Error(`Failed to look up the existing demo interview: ${error.message}`);
      interview = data;
    } else {
      throw err;
    }
  }

  let evaluationSubmitted = false;
  if (interview) {
    try {
      await evaluationService.submit({
        interviewId: interview.id,
        profileId: interviewer.profile.id,
        input: {
          technical_rating: 4,
          problem_solving_rating: 4,
          communication_rating: 5,
          role_knowledge_rating: 4,
          comments: 'Strong communicator with solid fundamentals. (Seed demo evaluation.)',
        },
      });
      evaluationSubmitted = true;
    } catch (err) {
      if (err && err.isEvaluationError && err.code === 'EVALUATION_EXISTS') {
        evaluationSubmitted = true; // already submitted by a previous run
      } else {
        throw err;
      }
    }
  }

  return { candidateApplication, stage: firstStage, interview, evaluationSubmitted };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function printSummary(summary) {
  console.log('\n=== Altrium seed summary ===\n');

  if (summary.people) {
    const { hr, hiringManager, management, employees } = summary.people;
    console.log(`People: 1 HR, 1 hiring manager, 1 management, ${employees.length} employees`);
    console.log(`  HR login:             ${hr.profile.email}`);
    console.log(`  Hiring manager login: ${hiringManager.profile.email}`);
    console.log(`  Management login:     ${management.profile.email}`);
    for (const { profile } of employees) {
      console.log(`  Employee login:       ${profile.email} (${profile.department}, ${profile.seniority_level})`);
    }
    console.log(`  Demo password (development only, every account): ${SEED_PASSWORD}`);
  } else {
    console.log('People: skipped (see messages above).');
  }

  if (summary.vacancies) {
    const { draft, published, closed } = summary.vacancies;
    console.log(`\nVacancies: "${draft.job_title}" (draft), "${published.job_title}" (published), "${closed.job_title}" (closed)`);
  } else {
    console.log('\nVacancies: skipped (see messages above).');
  }

  console.log(`\nApplications on the published vacancy: ${summary.applications.length}`);
  console.log(`Availability slots created this run: ${summary.availabilityCount}`);

  if (summary.interviewDemo) {
    const { candidateApplication, stage, interview, evaluationSubmitted } = summary.interviewDemo;
    console.log(
      `\nInterview process demo: candidate "${candidateApplication.full_name}", stage "${stage.stage_name}", ` +
        `interview ${interview ? `scheduled (id ${interview.id})` : 'NOT scheduled'}, ` +
        `evaluation ${evaluationSubmitted ? 'submitted' : 'NOT submitted'}.`
    );
  } else {
    console.log('\nInterview process demo: skipped (see messages above).');
  }

  console.log('\n============================\n');
}

async function main() {
  assertSafeToRun();

  const summary = { people: null, vacancies: null, applications: [], availabilityCount: 0, interviewDemo: null };

  if (!(await tableExists('profiles'))) {
    console.log('Skipping people: "profiles" table does not exist yet (run sql/001_create_profiles.sql first).');
    printSummary(summary);
    return;
  }
  summary.people = await seedPeople();

  if (!(await tableExists('job_vacancies'))) {
    console.log('Skipping vacancies: "job_vacancies" table does not exist yet (run sql/002_create_job_vacancies.sql first).');
    printSummary(summary);
    return;
  }
  summary.vacancies = await seedVacancies(summary.people.hr);

  if (!(await tableExists('applications'))) {
    console.log('Skipping applications: "applications" table does not exist yet (run sql/004_create_applications.sql first).');
  } else {
    summary.applications = await seedApplications(summary.vacancies.published);
  }

  if (!(await tableExists('interview_availability'))) {
    console.log(
      'Skipping availability: "interview_availability" table does not exist yet (run sql/011_create_interview_availability.sql first).'
    );
  } else {
    summary.availabilityCount = await seedAvailability(summary.people.employees, summary.people.employees[0]?.profile.id);
  }

  const readyForDemo =
    summary.applications.length > 0 &&
    (await tableExists('candidate_interview_processes')) &&
    (await tableExists('interviews')) &&
    (await tableExists('interview_evaluations'));

  if (!readyForDemo) {
    console.log('Skipping the full interview-process demo: applications, or one of the interview-related tables, are not ready yet.');
  } else {
    summary.interviewDemo = await seedInterviewDemo({
      hr: summary.people.hr,
      employees: summary.people.employees,
      publishedVacancy: summary.vacancies.published,
      applications: summary.applications,
    });
  }

  printSummary(summary);
}

main().catch((err) => {
  console.error('\nSeed script failed:', err.message);
  process.exitCode = 1;
});
