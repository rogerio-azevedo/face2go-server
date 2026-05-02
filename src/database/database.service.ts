import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import type { EnvVars } from '../config/env.validation';
import type { AppDb } from './database.types';
import * as schema from './schema';

@Injectable()
export class DatabaseService {
  readonly db: AppDb;

  constructor(
    private readonly configService: ConfigService<EnvVars, true>,
  ) {
    const databaseUrl = this.configService.get('DATABASE_URL', {
      infer: true,
    });
    const sql = neon(databaseUrl);
    this.db = drizzle(sql, { schema });
  }
}
