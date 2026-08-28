import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';

import type { EnvVars } from '../config/env.validation';
import type { AppDb } from './database.types';
import { createPostgresClient, endPostgresPool } from './postgres-connection';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: AppDb;
  private readonly client: ReturnType<typeof createPostgresClient>;

  constructor(
    @Inject(ConfigService)
    private readonly configService: ConfigService<EnvVars, true>,
  ) {
    const databaseUrl = this.configService.get('DATABASE_URL', {
      infer: true,
    });
    this.client = createPostgresClient(databaseUrl);
    this.db = drizzle(this.client, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await endPostgresPool(this.client);
  }
}
