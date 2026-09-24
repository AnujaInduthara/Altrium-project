const { supabaseAdmin } = require('../config/supabase');
const { ROLES } = require('../config/roles');
const { APP_URL } = require('../config/app');
const notificationService = require('./notification.service');
const { buildCandidateAccountInvite } = require('../utils/notificationTemplates');

const SET_PASSWORD_PATH = '/candidate-set-password.html';

const STAFF_EMAIL_CONFLICT_NOTE =
  "This applicant's email matches an existing staff account and could not be given portal access automatically.";

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// Any existing profile (any role) for this email — used to detect both the
// "already has a candidate account" and "collides with a staff account"
// cases before ever calling Supabase Auth.
async function findProfileByEmail(email) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, role, auth_user_id')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw wrapDbError('Failed to look up profile by email', error);
  return data || null;
}

// Mirrors scripts/seed.js's findAuthUserByEmail — only used on the rare retry
// path where a previous attempt created the auth user but crashed before the
// profiles row was written.
async function findAuthUserByEmail(email) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Failed to list auth users: ${error.message}`);
  return (data?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function insertCandidateProfile({ authUserId, email, fullName }) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .insert({
      auth_user_id: authUserId,
      email,
      role: ROLES.CANDIDATE,
      full_name: fullName,
      is_active: true,
    })
    .select('id, role')
    .single();

  if (error) {
    if (error.code === '23505') return null; // lost the unique-email race — caller re-selects
    throw wrapDbError('Failed to create candidate profile', error);
  }
  return data;
}

// Finds or creates the candidate profile for this email.
// Returns:
//   { profile, isNewAccount, setPasswordUrl } — profile is a candidate profile
//   { conflict: true }                        — email belongs to a staff profile
async function findOrCreateCandidateProfile(email, fullName) {
  const existing = await findProfileByEmail(email);
  if (existing) {
    if (existing.role !== ROLES.CANDIDATE) {
      return { conflict: true };
    }
    return { profile: existing, isNewAccount: false, setPasswordUrl: null };
  }

  const redirectTo = `${APP_URL}${SET_PASSWORD_PATH}`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });

  if (error) {
    // The auth user may already exist from a prior attempt that crashed
    // before the profiles row was written — recover instead of failing.
    const authUser = await findAuthUserByEmail(email);
    if (!authUser) throw wrapDbError('Failed to generate candidate invite link', error);
    const created = await insertCandidateProfile({ authUserId: authUser.id, email, fullName });
    const profile = created || (await findProfileByEmail(email));
    if (!profile || profile.role !== ROLES.CANDIDATE) return { conflict: true };
    return { profile, isNewAccount: Boolean(created), setPasswordUrl: null };
  }

  const created = await insertCandidateProfile({ authUserId: data.user.id, email, fullName });
  if (created) {
    return { profile: created, isNewAccount: true, setPasswordUrl: data.properties.action_link };
  }
  // Lost the unique-index race to a concurrent provisioning call.
  const profile = await findProfileByEmail(email);
  if (!profile || profile.role !== ROLES.CANDIDATE) return { conflict: true };
  return { profile, isNewAccount: false, setPasswordUrl: null };
}

// Called (via notificationService.dispatchInBackground) right after an
// application is selected. Idempotent: a repeat selection, or a second
// application from someone who already has an account, is a cheap no-op /
// link-only operation — never a second auth user or a second invite email.
async function provisionCandidateAccount(applicationId) {
  const { data: application, error } = await supabaseAdmin
    .from('applications')
    .select('id, full_name, email, vacancy_id, candidate_profile_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error || !application) {
    if (error) console.error('[candidateAccount] failed to load application:', applicationId, error.message);
    return;
  }
  if (application.candidate_profile_id) return; // already linked

  const result = await findOrCreateCandidateProfile(application.email, application.full_name);

  if (result.conflict) {
    await supabaseAdmin
      .from('applications')
      .update({ candidate_provisioning_note: STAFF_EMAIL_CONFLICT_NOTE })
      .eq('id', applicationId)
      .is('candidate_profile_id', null);
    return;
  }

  const { error: linkError } = await supabaseAdmin
    .from('applications')
    .update({ candidate_profile_id: result.profile.id })
    .eq('id', applicationId)
    .is('candidate_profile_id', null); // never clobber a concurrent link
  if (linkError) {
    console.error('[candidateAccount] failed to link application to profile:', applicationId, linkError.message);
    return;
  }

  if (!result.isNewAccount || !result.setPasswordUrl) return; // existing account — no re-invite

  const { data: vacancy } = await supabaseAdmin
    .from('job_vacancies')
    .select('job_title')
    .eq('id', application.vacancy_id)
    .maybeSingle();

  await notificationService.createMany([
    {
      recipient_email: application.email,
      ...buildCandidateAccountInvite({ vacancyTitle: vacancy?.job_title, setPasswordUrl: result.setPasswordUrl }),
    },
  ]);
}

module.exports = { provisionCandidateAccount };
