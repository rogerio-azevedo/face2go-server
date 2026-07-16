import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ClosePanicEventDto,
  CreatePanicEventDto,
  UpdateClientPanicConfigDto,
} from '../validation/dto/panic-events.dto';
import { listPanicEventsQuerySchema } from '../validation/panic-events.schema';
import { PanicEventsService } from './panic-events.service';

@ApiTags('panic-events')
@ApiBearerAuth()
@Controller()
export class PanicEventsController {
  constructor(private readonly panicEventsService: PanicEventsService) {}

  @Get('clients/:clientId/panic-config')
  @Roles(
    'member',
    'responsible',
    'client_admin',
    'company_admin',
    'company_operator',
  )
  @ApiOperation({ summary: 'Configuração de pedido de socorro do cliente' })
  getPanicConfig(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.panicEventsService.getPanicConfigForClient(user, clientId);
  }

  @Patch('clients/:clientId/panic-config')
  @Roles('client_admin', 'company_admin')
  @ApiOperation({ summary: 'Atualizar configuração de pedido de socorro' })
  updatePanicConfig(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateClientPanicConfigDto,
  ) {
    return this.panicEventsService.updatePanicConfig(user, clientId, dto);
  }

  @Post('panic-events')
  @Roles(
    'member',
    'responsible',
    'client_admin',
    'client_operator',
    'face_user',
  )
  @ApiOperation({ summary: 'Criar pedido de socorro (app)' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePanicEventDto) {
    return this.panicEventsService.create(user, dto);
  }

  @Get('panic-events')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({ summary: 'Listar eventos de socorro (monitoramento)' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = listPanicEventsQuerySchema.parse(query);
    return this.panicEventsService.list(user, parsed);
  }

  @Get('panic-events/:eventId')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({ summary: 'Detalhe de evento de socorro' })
  getById(@CurrentUser() user: JwtPayload, @Param('eventId') eventId: string) {
    return this.panicEventsService.getById(user, eventId);
  }

  @Post('panic-events/:eventId/claim')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({ summary: 'Pegar evento para tratativa' })
  claim(@CurrentUser() user: JwtPayload, @Param('eventId') eventId: string) {
    return this.panicEventsService.claim(user, eventId);
  }

  @Post('panic-events/:eventId/release')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({ summary: 'Soltar evento em tratativa' })
  release(@CurrentUser() user: JwtPayload, @Param('eventId') eventId: string) {
    return this.panicEventsService.release(user, eventId);
  }

  @Post('panic-events/:eventId/close')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({ summary: 'Fechar evento de socorro' })
  close(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: ClosePanicEventDto,
  ) {
    return this.panicEventsService.close(user, eventId, dto);
  }
}
