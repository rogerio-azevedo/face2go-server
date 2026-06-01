import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { IenhFilialMappingService } from './ienh-filial-mapping.service';
import { IenhSyncService } from './ienh-sync.service';
import { IenhService } from './ienh.service';

@ApiTags('ienh')
@ApiBearerAuth()
@Roles('company_admin', 'super_admin')
@Controller('ienh')
export class IenhController {
  constructor(
    private readonly ienhService: IenhService,
    private readonly ienhSyncService: IenhSyncService,
    private readonly filialMappingService: IenhFilialMappingService,
  ) {}

  @Get('filial-mappings')
  @ApiOperation({ summary: 'Listar mapeamento FILIAL IENH ↔ clientes Face2Go' })
  listFilialMappings(@CurrentUser() user: JwtPayload) {
    return this.filialMappingService.listMappings(user);
  }

  @Put('filial-mappings')
  @ApiOperation({ summary: 'Associar filial IENH a um cliente' })
  setFilialMapping(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.filialMappingService.setMapping(user, body);
  }

  @Post('fetch')
  @ApiOperation({
    summary:
      'Buscar dados na API TOTVS IENH e salvar snapshot JSON em disco',
  })
  fetch(@Body() body: unknown) {
    return this.ienhService.fetchAndSave(body);
  }

  @Post('sync')
  @ApiOperation({
    summary:
      'Sincronizar cadastros IENH (turmas, alunos, responsáveis) no Face2Go',
  })
  sync(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não identificada no token.');
    }
    return this.ienhSyncService.runSyncForCompany(companyId, body);
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'Listar snapshots IENH salvos em disco' })
  listSnapshots() {
    return this.ienhSyncService.listSnapshots();
  }

  @Get('sync/progress')
  @ApiOperation({
    summary:
      'SSE — progresso da sincronização IENH (token na query aceito)',
  })
  async syncProgress(
    @CurrentUser() user: JwtPayload,
    @Query('perlet') perletRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não identificada no token.');
    }

    const perlet = typeof perletRaw === 'string' ? perletRaw.trim() : '';
    const body = perlet ? { perlet } : {};

    await this.runIenhSyncSse(res, (write) =>
      this.ienhSyncService.runSyncForCompany(companyId, body, write),
    );
  }

  @Get('sync/progress/from-snapshot')
  @ApiOperation({
    summary:
      'SSE — re-sincronizar a partir de snapshot JSON (sem chamar TOTVS)',
  })
  async syncProgressFromSnapshot(
    @CurrentUser() user: JwtPayload,
    @Query('file') fileRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não identificada no token.');
    }

    const file = typeof fileRaw === 'string' ? fileRaw.trim() : '';
    if (!file) {
      throw new BadRequestException('Parâmetro file é obrigatório.');
    }

    await this.runIenhSyncSse(res, (write) =>
      this.ienhSyncService.runSyncFromSnapshot(companyId, file, write),
    );
  }

  private static readonly SSE_HEARTBEAT_MS = 15_000;

  private async runIenhSyncSse(
    res: Response,
    run: (write: (data: Record<string, unknown>) => void) => Promise<unknown>,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const write = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      write({ type: 'heartbeat' });
    }, IenhController.SSE_HEARTBEAT_MS);

    try {
      await run(write);
    } catch (err: unknown) {
      let message = 'Erro na sincronização.';
      if (err instanceof HttpException) {
        const response = err.getResponse();
        if (typeof response === 'string') {
          message = response;
        } else if (response && typeof response === 'object' && 'message' in response) {
          const m = (response as { message?: string | string[] }).message;
          message = Array.isArray(m) ? m.join(', ') : String(m ?? message);
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      write({ type: 'error', message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
