import { Injectable, Logger } from '@nestjs/common';

import type { ReaderStreamContextLike } from '../accesses/reader-stream-context.type';
import { AccessesService } from '../accesses/accesses.service';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { FaceListenerService } from '../face-listener/face-listener.service';
import { isHikvisionAlertFaceAccess } from '../face-listener/hikvision-alert-pending.util';
import { hikvisionEventToVideoEvent } from '../integrations/hikvision';
import { parseHikvisionPushBody } from './hikvision-push.parser';

@Injectable()
export class HikvisionPushReceiverService {
  private readonly logger = new Logger(HikvisionPushReceiverService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly accessesService: AccessesService,
    private readonly faceListener: FaceListenerService,
  ) {}

  async handlePush(params: {
    contentType?: string;
    raw: Buffer;
    readerId: string;
  }): Promise<void> {
    const parsed = parseHikvisionPushBody(params.contentType, params.raw);
    const row = await readersQueries.getReaderForPushById(
      this.database.db,
      params.readerId,
    );
    if (!row || row.brand !== 'hikvision') {
      this.logger.warn(
        `[HikvisionPush] leitor ausente readerId=${params.readerId} bytes=${params.raw.length}`,
      );
      return;
    }

    this.faceListener.notePushActivity(row.id);
    const event = parsed.event;
    if (!event || !isHikvisionAlertFaceAccess(event) || !row.isActive) {
      return;
    }

    this.logger.log(
      `[HikvisionPush] ${row.name} UserID=${event.employeeNoString ?? '—'} foto=${parsed.jpeg ? 'inline' : 'nenhuma'}`,
    );
    const ctx: ReaderStreamContextLike = {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      clientName: row.clientName,
      companyId: row.companyId,
      host: `${row.ip.trim()}:${row.port}`,
      direction: row.direction,
    };
    await this.accessesService.recordSnapManagerAccess(
      hikvisionEventToVideoEvent(event),
      ctx,
      parsed.jpeg,
    );
  }
}
