import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../src/database/schema';
async function main() {
 const baseline = generateDrizzleJson(schema);
 delete baseline.tables['public.child_approval_requests'];
 delete baseline.tables['public.child_approval_consents'];
 delete baseline.tables['public.child_approval_faces'];
 delete baseline.tables['public.clients'].columns.enable_child_approve;
 const r = baseline.tables['public.registrations'];
 for (const key of Object.keys(r.columns)) if (key.startsWith('child_approval_')) delete r.columns[key];
 for (const key of Object.keys(r.foreignKeys)) if (key.includes('child_approval')) delete r.foreignKeys[key];
 baseline.enums['public.device_sync_job_kind'].values = baseline.enums['public.device_sync_job_kind'].values.filter(v => v !== 'face.remove');
 const sql = await generateMigration(generateDrizzleJson({}), baseline);
 console.log(JSON.stringify(sql));
}
main();
