import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';

import { ArrivalsService } from './arrivals.service';
import type {
  ArrivalSseConnectedPayload,
  ArrivalSseEnvelope,
  ArrivalSseHeartbeatPayload,
  ArrivalSsePayload,
} from './arrivals.types';

@Public()
@Controller('clients/:clientId/arrivals')
export class ArrivalsController {
  constructor(
    private readonly arrivalsService: ArrivalsService,
    private readonly database: DatabaseService,
  ) {}

  @Get('stream')
  async arrivalsStream(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('token') tokenRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
    if (!token) {
      throw new UnauthorizedException('Token ausente.');
    }

    const ok = await clientsQueries.validateClientDisplayToken(
      this.database.db,
      clientId,
      token,
    );
    if (!ok) {
      throw new UnauthorizedException('Token inválido.');
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEnvelope = (data: ArrivalSseEnvelope) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeEnvelope({
      type: 'connected',
      clientId,
    } satisfies ArrivalSseConnectedPayload);

    const sink = (payload: ArrivalSsePayload) => {
      writeEnvelope(payload);
    };

    const unsubscribe = this.arrivalsService.subscribe(clientId, sink);

    const ping = setInterval(() => {
      try {
        writeEnvelope({
          type: 'ping',
          at: new Date().toISOString(),
        } satisfies ArrivalSseHeartbeatPayload);
      } catch {
        clearInterval(ping);
      }
    }, 25_000);

    let finalized = false;
    const teardown = () => {
      if (finalized) {
        return;
      }
      finalized = true;
      clearInterval(ping);
      unsubscribe();
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    res.once('close', teardown);
  }
}
