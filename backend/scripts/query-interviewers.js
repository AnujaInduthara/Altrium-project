require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');

async function main() {
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role, department, job_position, seniority_level, is_active')
    .in('role', ['employee', 'hr', 'hiring_manager'])
    .order('full_name');

  if (profilesError) {
    console.error('Error fetching profiles:', profilesError.message);
    process.exit(1);
  }

  console.log('=== Interview-eligible employees ===');
  console.table(profiles.map((p) => ({
    name: p.full_name,
    email: p.email,
    role: p.role,
    department: p.department,
    position: p.job_position,
    seniority: p.seniority_level,
    active: p.is_active,
  })));

  const { data: assignments, error: assignmentsError } = await supabaseAdmin
    .from('interview_interviewers')
    .select(`
      interview_id,
      profile_id,
      profiles ( full_name, email ),
      interviews ( id, scheduled_date, start_time, end_time, status, candidate_stage_id )
    `);

  if (assignmentsError) {
    console.error('Error fetching interview assignments:', assignmentsError.message);
    process.exit(1);
  }

  console.log('\n=== Actual interview assignments ===');
  if (!assignments || assignments.length === 0) {
    console.log('(none found)');
  } else {
    console.table(assignments.map((a) => ({
      interviewer: a.profiles?.full_name,
      email: a.profiles?.email,
      date: a.interviews?.scheduled_date,
      start: a.interviews?.start_time,
      end: a.interviews?.end_time,
      status: a.interviews?.status,
    })));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
