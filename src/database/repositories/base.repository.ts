import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database.service';
import type { AppDb } from '../database.types';

@Injectable()
export abstract class BaseRepository {
  constructor(protected readonly database: DatabaseService) {}

  protected get db(): AppDb {
    return this.database.db;
  }
}
