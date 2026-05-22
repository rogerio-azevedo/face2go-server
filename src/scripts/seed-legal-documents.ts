import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database/database.types';
import * as schema from '../database/schema';
import { LEGAL_DOCUMENT_TYPES } from '../legal-documents/legal-documents.constants';

const privacyPolicySeed = {
  type: LEGAL_DOCUMENT_TYPES.PRIVACY_POLICY,
  version: '1.0',
  title: 'Política de Privacidade do Face2Go',
  effectiveDate: '2026-05-01',
} as const;

function readPrivacyPolicyContent(): string {
  const filePath = join(__dirname, 'legal-documents', 'privacy-policy-v1.0.md');
  return readFileSync(filePath, 'utf8');
}

export async function seedLegalDocumentsIfNeeded(db: AppDb) {
  const [existing] = await db
    .select({ id: schema.legalDocuments.id })
    .from(schema.legalDocuments)
    .where(
      and(
        eq(schema.legalDocuments.type, privacyPolicySeed.type),
        eq(schema.legalDocuments.version, privacyPolicySeed.version),
      ),
    )
    .limit(1);

  if (existing) {
    console.info(
      `Documento legal já existe: ${privacyPolicySeed.type} v${privacyPolicySeed.version}`,
    );
    return;
  }

  await db.insert(schema.legalDocuments).values({
    type: privacyPolicySeed.type,
    version: privacyPolicySeed.version,
    title: privacyPolicySeed.title,
    content: readPrivacyPolicyContent(),
    effectiveDate: privacyPolicySeed.effectiveDate,
    isActive: true,
  });

  console.info(
    `Documento legal criado: ${privacyPolicySeed.type} v${privacyPolicySeed.version}`,
  );
}
