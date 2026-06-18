import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { companies } from './companies';

export const companyFeatures = pgTable(
  'company_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    featureSlug: varchar('feature_slug', { length: 100 }).notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    enabledAt: timestamp('enabled_at'),
    enabledBy: text('enabled_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueCompanyFeature: unique('unique_company_feature').on(
      t.companyId,
      t.featureSlug,
    ),
  }),
);
