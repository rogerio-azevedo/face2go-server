import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import {
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentType,
} from '../legal-documents/legal-documents.constants';

type LegalDocumentSeed = {
  type: LegalDocumentType;
  version: string;
  title: string;
  effectiveDate: string;
  fileName: string;
};

const LEGAL_DOCUMENT_SEEDS: LegalDocumentSeed[] = [
  {
    type: LEGAL_DOCUMENT_TYPES.PRIVACY_POLICY,
    version: '1.0',
    title: 'Política de Privacidade do Face2Go',
    effectiveDate: '2026-05-01',
    fileName: 'privacy-policy-v1.0.md',
  },
  {
    type: LEGAL_DOCUMENT_TYPES.TERMS_OF_USE,
    version: '1.0',
    title: 'Termos de Uso do Face2Go',
    effectiveDate: '2026-05-01',
    fileName: 'terms-of-use-v1.0.md',
  },
];

function readLegalDocumentContent(fileName: string): string {
  const filePath = join(__dirname, 'legal-documents', fileName);
  return readFileSync(filePath, 'utf8');
}

async function seedLegalDocumentIfNeeded(
  db: AppDb,
  seed: LegalDocumentSeed,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.legalDocuments.id })
    .from(schema.legalDocuments)
    .where(
      and(
        eq(schema.legalDocuments.type, seed.type),
        eq(schema.legalDocuments.version, seed.version),
      ),
    )
    .limit(1);

  if (existing) {
    console.info(`Documento legal já existe: ${seed.type} v${seed.version}`);
    return;
  }

  await db.insert(schema.legalDocuments).values({
    type: seed.type,
    version: seed.version,
    title: seed.title,
    content: readLegalDocumentContent(seed.fileName),
    effectiveDate: seed.effectiveDate,
    isActive: true,
  });

  console.info(`Documento legal criado: ${seed.type} v${seed.version}`);
}

export async function seedLegalDocumentsIfNeeded(db: AppDb) {
  for (const seed of LEGAL_DOCUMENT_SEEDS) {
    await seedLegalDocumentIfNeeded(db, seed);
  }
}
