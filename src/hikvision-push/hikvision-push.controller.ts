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
import { HikvisionPushReceiverService } from './hikvision-push.receiver.service';

function requestBodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body && typeof body === 'object') return Buffer.from(JSON.stringify(body));
  return Buffer.alloc(0);
}

@ApiExcludeController()
@Public()
@Controller()
export class HikvisionPushController {
  private readonly logger = new Logger(HikvisionPushController.name);

  constructor(private readonly receiver: HikvisionPushReceiverService) {}

  @Post('device-events/hikvision/:readerId')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  receive(
    @Param('readerId') readerId: string,
    @Req() req: Request,
  ): string {
    const raw = requestBodyToBuffer(req.body);
    void this.receiver
      .handlePush({
        contentType: req.headers['content-type'],
        raw,
        readerId,
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[HikvisionPush] /device-events: ${message}`);
      });
    return 'OK';
  }
}
