import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { legalDocuments } from '../database/schema';

@Injectable()
export class LegalDocumentsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getActiveByType(type: string) {
    const [doc] = await this.databaseService.db
      .select({
        id: legalDocuments.id,
        type: legalDocuments.type,
        version: legalDocuments.version,
        title: legalDocuments.title,
        content: legalDocuments.content,
        effectiveDate: legalDocuments.effectiveDate,
        isActive: legalDocuments.isActive,
        createdAt: legalDocuments.createdAt,
      })
      .from(legalDocuments)
      .where(
        and(eq(legalDocuments.type, type), eq(legalDocuments.isActive, true)),
      )
      .limit(1);

    if (!doc) {
      throw new NotFoundException('Documento legal não encontrado.');
    }

    return doc;
  }

  async listVersionsByType(type: string) {
    return this.databaseService.db
      .select({
        id: legalDocuments.id,
        type: legalDocuments.type,
        version: legalDocuments.version,
        title: legalDocuments.title,
        effectiveDate: legalDocuments.effectiveDate,
        isActive: legalDocuments.isActive,
        createdAt: legalDocuments.createdAt,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.type, type))
      .orderBy(desc(legalDocuments.effectiveDate), desc(legalDocuments.createdAt));
  }

  async getByTypeAndVersion(type: string, version: string) {
    const [doc] = await this.databaseService.db
      .select({
        id: legalDocuments.id,
        type: legalDocuments.type,
        version: legalDocuments.version,
        title: legalDocuments.title,
        content: legalDocuments.content,
        effectiveDate: legalDocuments.effectiveDate,
        isActive: legalDocuments.isActive,
        createdAt: legalDocuments.createdAt,
      })
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.type, type),
          eq(legalDocuments.version, version),
        ),
      )
      .limit(1);

    if (!doc) {
      throw new NotFoundException('Documento legal não encontrado.');
    }

    return doc;
  }
}
