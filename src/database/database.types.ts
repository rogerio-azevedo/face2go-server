import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import type * as schema from './schema';

export type AppDb = NeonHttpDatabase<typeof schema>;
