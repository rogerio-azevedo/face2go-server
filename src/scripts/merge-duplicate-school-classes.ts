import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';
import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import * as schoolClassQueries from '../database/queries/school-classes.queries';

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

async function main() {
  if (!databaseUrl) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(databaseUrl);
  const db = drizzle(sql, { schema }) as AppDb;

  const clientIdArg = process.argv[2];
  let clientIds: string[];

  if (clientIdArg) {
    clientIds = [clientIdArg];
  } else {
    const rows = await db
      .selectDistinct({ clientId: schema.schoolClasses.clientId })
      .from(schema.schoolClasses);
    clientIds = rows.map((r) => r.clientId);
  }

  let totalRemoved = 0;
  for (const clientId of clientIds) {
    const merged =
      await schoolClassQueries.mergeDuplicateSchoolClassesForClient(
        db,
        clientId,
      );
    if (merged.classesRemoved > 0) {
      console.log(
        `Cliente ${clientId}: ${merged.groupsMerged} grupo(s), ` +
          `${merged.classesRemoved} turma(s) removida(s), ` +
          `${merged.studentLinksRelocated} vínculo(s) realocado(s), ` +
          `${merged.studentLinksRemoved} vínculo(s) removido(s).`,
      );
    }
    totalRemoved += merged.classesRemoved;
  }

  console.log(
    totalRemoved > 0
      ? `\nConcluído. ${totalRemoved} turma(s) duplicada(s) removida(s). Rode yarn db:migrate para aplicar o índice único.`
      : '\nNenhuma turma duplicada encontrada.',
  );

  await endPostgresPool(sql);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
