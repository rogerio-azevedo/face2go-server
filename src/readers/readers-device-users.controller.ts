import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  BatchDeleteDeviceUsersDto,
  RemoveDeviceUserOrphansDto,
} from '../validation/dto/readers.dto';
import { ReadersDeviceUsersService } from './readers-device-users.service';
import { ReadersDeviceWipeSyncService } from './readers-device-wipe-sync.service';

@ApiTags('readers')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('readers')
export class ReadersDeviceUsersController {
  constructor(
    private readonly deviceUsers: ReadersDeviceUsersService,
    private readonly wipeSync: ReadersDeviceWipeSyncService,
  ) {}

  @Get(':readerId/device-users')
  @ApiOperation({
    summary: 'Listar usuários cadastrados no dispositivo (direto da memória)',
  })
  getDeviceUsers(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    const off = offset ? parseInt(offset, 10) : 0;
    return this.deviceUsers.getDeviceUsers(
      user,
      readerId,
      lim,
      off,
      search?.trim() || undefined,
    );
  }

  @Post(':readerId/device-users/batch-delete')
  @ApiOperation({
    summary: 'Remover vários usuários da memória do dispositivo',
  })
  batchDeleteDeviceUsers(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() dto: BatchDeleteDeviceUsersDto,
  ) {
    return this.deviceUsers.batchDeleteDeviceUsers(user, readerId, dto.userIds);
  }

  @Post(':readerId/device-users/remove-orphans')
  @ApiOperation({
    summary:
      'Remover do leitor os usuários que não existem no Face2Go (órfãos)',
  })
  removeOrphans(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() dto: RemoveDeviceUserOrphansDto,
  ) {
    return this.deviceUsers.removeOrphans(user, readerId, dto.dryRun ?? false);
  }

  @Post(':readerId/device-users/wipe-all')
  @ApiOperation({
    summary:
      'Apagar todos os usuários da memória deste leitor (clientes não-escola)',
  })
  wipeAll(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
  ) {
    return this.wipeSync.wipeAll(user, readerId);
  }

  @Get(':readerId/device-users/sync-all/progress')
  @ApiOperation({
    summary:
      'SSE — sincronizar membros, cadastros e convites neste leitor (token na query aceito)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.wipeSync.syncAllOnReader(user, readerId, (evt) => write(evt));
    } catch (e: unknown) {
      write({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
  }

  @Delete(':readerId/device-users/:userId')
  @ApiOperation({
    summary: 'Remover um usuário da memória do dispositivo',
  })
  removeDeviceUser(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Param('userId') userId: string,
  ) {
    return this.deviceUsers.removeDeviceUser(user, readerId, userId);
  }

  @Get(':readerId/device-users/:userId/face')
  @ApiOperation({
    summary: 'Obter a foto do rosto do usuário (direto do leitor)',
  })
  getDeviceUserFace(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Param('userId') userId: string,
  ) {
    return this.deviceUsers.getDeviceUserFace(user, readerId, userId);
  }
}
