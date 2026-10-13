import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../src/database/schema';
async function main() {
  const baseline = generateDrizzleJson(schema) as {
    tables: Record<string, unknown>;
  };
  delete baseline.tables['public.location_person_moves'];
  const statements = await generateMigration(generateDrizzleJson({}), baseline);
  console.log(JSON.stringify(statements));
}
void main();
