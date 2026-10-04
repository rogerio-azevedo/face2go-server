import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateClientBlockDto,
  CreateClientUnitDto,
  GenerateClientUnitsDto,
  GenerateStructureDto,
  UpdateClientBlockDto,
  UpdateClientUnitDto,
} from '../validation/dto/client-blocks.dto';
import { ClientBlocksRemovalService } from './client-blocks-removal.service';
import { ClientBlocksService } from './client-blocks.service';

@ApiTags('client-blocks')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin', 'client_operator')
@Controller('clients/:clientId')
export class ClientBlocksController {
  constructor(
    private readonly clientBlocksService: ClientBlocksService,
    private readonly removalService: ClientBlocksRemovalService,
  ) {}

  @Get('blocks')
  @ApiOperation({ summary: 'Listar blocos e unidades do condomínio' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientBlocksService.list(user, clientId);
  }

  @Post('blocks')
  @ApiOperation({ summary: 'Criar bloco' })
  createBlock(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateClientBlockDto,
  ) {
    return this.clientBlocksService.createBlock(user, clientId, dto);
  }

  @Post('blocks/generate-structure')
  @ApiOperation({
    summary: 'Gerar blocos e unidades por andar (cria só o que falta)',
  })
  generateStructure(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateStructureDto,
  ) {
    return this.clientBlocksService.generateStructure(user, clientId, dto);
  }

  @Patch('blocks/:blockId')
  @ApiOperation({ summary: 'Atualizar bloco' })
  updateBlock(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: UpdateClientBlockDto,
  ) {
    return this.clientBlocksService.updateBlock(user, clientId, blockId, dto);
  }

  @Delete('blocks/:blockId')
  @ApiOperation({
    summary: 'Excluir bloco inativo (e suas unidades) sem pessoas vinculadas',
  })
  deleteBlock(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.removalService.deleteBlock(user, clientId, blockId);
  }

  @Post('blocks/:blockId/units')
  @ApiOperation({ summary: 'Criar unidade' })
  createUnit(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: CreateClientUnitDto,
  ) {
    return this.clientBlocksService.createUnit(user, clientId, blockId, dto);
  }

  @Post('blocks/:blockId/units/generate')
  @ApiOperation({ summary: 'Gerar unidades por andar no bloco' })
  generateUnits(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
    @Body() dto: GenerateClientUnitsDto,
  ) {
    return this.clientBlocksService.generateUnits(user, clientId, blockId, dto);
  }

  @Patch('units/:unitId')
  @ApiOperation({ summary: 'Atualizar unidade' })
  updateUnit(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateClientUnitDto,
  ) {
    return this.clientBlocksService.updateUnit(user, clientId, unitId, dto);
  }

  @Get('units/:unitId/people')
  @ApiOperation({
    summary: 'Pessoas vinculadas à unidade (inclusive inativas)',
  })
  listUnitPeople(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.removalService.listUnitPeople(user, clientId, unitId);
  }

  @Delete('units/:unitId')
  @ApiOperation({ summary: 'Excluir unidade inativa sem pessoas vinculadas' })
  deleteUnit(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('unitId', ParseUUIDPipe) unitId: string,
  ) {
    return this.removalService.deleteUnit(user, clientId, unitId);
  }
}
