import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { MonitoringGateway } from '../realtime/monitoring.gateway';
import {
  PANIC_CREATED,
  PANIC_UPDATED,
  type PanicCreatedEvent,
  type PanicUpdatedEvent,
} from './panic-events.events';

@Injectable()
export class PanicEventsListener {
  constructor(private readonly monitoringGateway: MonitoringGateway) {}

  @OnEvent(PANIC_CREATED, { async: true })
  async onPanicCreated(payload: PanicCreatedEvent): Promise<void> {
    this.monitoringGateway.emitPanicNew(payload);
  }

  @OnEvent(PANIC_UPDATED, { async: true })
  async onPanicUpdated(payload: PanicUpdatedEvent): Promise<void> {
    this.monitoringGateway.emitPanicUpdated(payload);
  }
}
