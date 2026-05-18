import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  ACCESS_FACIAL_RECORDED,
  type AccessFacialRecordedPayload,
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
}
