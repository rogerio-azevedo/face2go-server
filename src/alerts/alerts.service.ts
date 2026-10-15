import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  FacialAccess,
  type FacialAccessDocument,
} from '../accesses/access.schema';
import { R2StorageService } from '../storage/r2-storage.service';
import type { ClientAlertsList } from '../validation/alerts.schema';

type BlockedAttemptDoc = FacialAccessDocument & {
  _id: { toString(): string };
  createdAt?: Date;
};

@Injectable()
export class AlertsService {
  private static readonly PAGE_SIZE = 20;
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly r2: R2StorageService,
  ) {}

  async listBlockedAttempts(
    companyId: string,
    clientId: string,
    page = 1,
  ): Promise<ClientAlertsList> {
    const pageSize = AlertsService.PAGE_SIZE;
    const safePage = Math.max(1, page);
    const filter = { companyId, clientId, blockedAttempt: true };

    const total = await this.accessModel.countDocuments(filter).exec();
    const docs = await this.accessModel
      .find(filter)
      .sort({ eventDate: -1, createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .lean()
      .exec();

    const items = await Promise.all(
      (docs as BlockedAttemptDoc[]).map((doc) => this.toItem(doc)),
    );

    return { items, page: safePage, pageSize, total };
  }

  private async toItem(
    doc: BlockedAttemptDoc,
  ): Promise<ClientAlertsList['items'][number]> {
    const key = typeof doc.snapR2Key === 'string' ? doc.snapR2Key.trim() : '';
    let snapUrl: string | null = null;
    if (key) {
      try {
        snapUrl = await this.r2.createPresignedGetUrl(key);
      } catch (err: unknown) {
        this.logger.debug(
          `Presign alerta falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      id: doc._id.toString(),
      personName: doc.personName ?? null,
      blockReason: doc.blockReason ?? null,
      readerName: doc.readerName,
      readerDirection: doc.readerDirection ?? null,
      eventDate: doc.eventDate ? doc.eventDate.toISOString() : null,
      createdAt: doc.createdAt
        ? doc.createdAt.toISOString()
        : new Date().toISOString(),
      clientName: doc.clientName,
      snapUrl,
    };
  }
}
