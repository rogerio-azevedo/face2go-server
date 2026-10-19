/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- Drizzle-kit snapshot utility is a runtime API outside the application TS project. */
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../src/database/schema';
async function main() {
  const baseline = generateDrizzleJson(schema);
  delete baseline.tables['public.child_approval_requests'];
  delete baseline.tables['public.child_approval_consents'];
  delete baseline.tables['public.child_approval_faces'];
  delete baseline.tables['public.clients'].columns.enable_child_approve;
  for (const key of Object.keys(baseline.tables))
    if (key.includes('visitor_approval_')) delete baseline.tables[key];
  delete baseline.tables['public.clients'].columns.enable_visitor_approve;
  const r = baseline.tables['public.registrations'];
  for (const key of Object.keys(r.columns))
    if (
      key.startsWith('child_approval_') ||
      key.startsWith('visitor_approval_') ||
      key === 'is_visitor'
    )
      delete r.columns[key];
  for (const key of Object.keys(r.foreignKeys))
    if (key.includes('child_approval') || key.includes('visitor_approval'))
      delete r.foreignKeys[key];
  baseline.enums['public.device_sync_job_kind'].values = baseline.enums[
    'public.device_sync_job_kind'
  ].values.filter((v) => v !== 'face.remove');
  const sql = await generateMigration(generateDrizzleJson({}), baseline);
  console.log(JSON.stringify(sql));
}
void main();
