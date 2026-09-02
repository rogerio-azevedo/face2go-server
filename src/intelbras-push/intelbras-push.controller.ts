import {
  Controller,
  Header,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { IntelbrasPushReceiverService } from './intelbras-push.receiver.service';

function clientIpFromRequest(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip;
}

function requestBodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (body && typeof body === 'object') {
    return Buffer.from(JSON.stringify(body));
  }
  return Buffer.alloc(0);
}

@ApiExcludeController()
@Public()
@Controller()
export class IntelbrasPushController {
  private readonly logger = new Logger(IntelbrasPushController.name);

  constructor(private readonly receiver: IntelbrasPushReceiverService) {}

  @Post('notification')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  receiveLegacy(@Req() req: Request): string {
    const raw = requestBodyToBuffer(req.body);
    void this.receiver
      .handlePush({
        contentType: req.headers['content-type'],
        raw,
        clientIp: clientIpFromRequest(req),
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[IntelbrasPush] /notification: ${message}`);
      });
    return 'OK';
  }

  @Post('device-events/facial/:readerId')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  receiveByReader(
    @Param('readerId') readerId: string,
    @Req() req: Request,
  ): string {
    const raw = requestBodyToBuffer(req.body);
    void this.receiver
      .handlePush({
        contentType: req.headers['content-type'],
        raw,
        readerId,
        clientIp: clientIpFromRequest(req),
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[IntelbrasPush] /device-events: ${message}`);
      });
    return 'OK';
  }
}
