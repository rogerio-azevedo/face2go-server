import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  ACCESS_FACIAL_RECORDED,
  ACCESS_LPR_RECORDED,
  type AccessFacialRecordedPayload,
  type AccessLprRecordedPayload,
} from '../notifications/notifications.events';

import { ArrivalsService } from './arrivals.service';

@Injectable()
export class ArrivalsListener {
  constructor(private readonly arrivalsService: ArrivalsService) {}

  @OnEvent(ACCESS_FACIAL_RECORDED, { async: true })
  async onAccessFacialRecorded(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    await this.arrivalsService.broadcastFacialRecorded(payload);
  }

  @OnEvent(ACCESS_LPR_RECORDED, { async: true })
  async onAccessLprRecorded(payload: AccessLprRecordedPayload): Promise<void> {
    await this.arrivalsService.broadcastLprRecorded(payload);
  }
}
