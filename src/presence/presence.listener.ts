import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  ACCESS_FACIAL_RECORDED,
  ACCESS_LPR_RECORDED,
  type AccessFacialRecordedPayload,
  type AccessLprRecordedPayload,
} from '../notifications/notifications.events';
import { DatabaseService } from '../database/database.service';
import * as presenceQueries from '../database/queries/presence.queries';

@Injectable()
export class PresenceListener implements OnModuleInit {
  private readonly logger = new Logger(PresenceListener.name);

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.scheduleDailyReset();
  }

  private scheduleDailyReset(): void {
    const runReset = () => {
      void presenceQueries
        .resetSchoolPresenceToOut(this.database.db)
        .then(() => {
          this.logger.log('Reset diário de presença concluído.');
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Reset diário de presença falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    };

    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(3, 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      const delay = next.getTime() - now.getTime();
      setTimeout(() => {
        runReset();
        setInterval(runReset, 24 * 60 * 60 * 1000);
      }, delay);
    };

    scheduleNext();
  }

  @OnEvent(ACCESS_FACIAL_RECORDED)
  async handleFacialAccess(payload: AccessFacialRecordedPayload): Promise<void> {
    if (!payload.personId || !payload.personType) return;
    if (payload.personType === 'guest') return;

    const direction = payload.readerDirection;
    if (direction !== 'in' && direction !== 'out') return;

    try {
      await presenceQueries.upsertPresenceState(this.database.db, {
        companyId: payload.companyId,
        clientId: payload.clientId,
        personType: payload.personType,
        personId: payload.personId,
        personName: payload.personName ?? 'Desconhecido',
        status: direction,
        lastDirection: direction,
        lastEventAt: payload.eventDate ?? new Date(),
        lastSource: 'facial',
        lastDeviceId: payload.readerId,
        lastDeviceName: payload.readerName,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Presence upsert facial falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(ACCESS_LPR_RECORDED)
  async handleLprAccess(payload: AccessLprRecordedPayload): Promise<void> {
    if (!payload.personId || !payload.personType) return;

    const direction = payload.cameraDirection;
    if (direction !== 'in' && direction !== 'out') return;

    try {
      await presenceQueries.upsertPresenceState(this.database.db, {
        companyId: payload.companyId,
        clientId: payload.clientId,
        personType: payload.personType,
        personId: payload.personId,
        personName: payload.personName ?? 'Desconhecido',
        status: direction,
        lastDirection: direction,
        lastEventAt: payload.snapTime ?? new Date(),
        lastSource: 'lpr',
        lastDeviceId: payload.cameraId,
        lastDeviceName: payload.cameraName,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Presence upsert LPR falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
