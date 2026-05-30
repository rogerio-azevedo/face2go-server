import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponsiblesService } from './responsibles.service';

@ApiTags('responsibles')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/responsibles')
export class ResponsiblesController {
  constructor(private readonly responsiblesService: ResponsiblesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar responsáveis da escola paginados (?page, ?pageSize, ?search)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.responsiblesService.list(user, clientId, {
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
      search,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar responsável com login (usuário + senha)' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.responsiblesService.create(user, clientId, body);
  }

  @Get(':responsibleId/students')
  @ApiOperation({
    summary: 'Listar alunos vinculados ao responsável',
  })
  listStudents(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
  ) {
    return this.responsiblesService.listLinkedStudents(
      user,
      clientId,
      responsibleId,
    );
  }

  @Post(':responsibleId/students')
  @ApiOperation({ summary: 'Vincular aluno ao responsável' })
  linkStudent(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Body() body: unknown,
  ) {
    return this.responsiblesService.linkStudent(
      user,
      clientId,
      responsibleId,
      body,
    );
  }

  @Delete(':responsibleId/students/:studentId')
  @ApiOperation({ summary: 'Remover vínculo aluno–responsável' })
  unlinkStudent(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.responsiblesService.unlinkStudent(
      user,
      clientId,
      responsibleId,
      studentId,
    );
  }

  @Patch(':responsibleId/students/:studentId')
  @ApiOperation({
    summary: 'Atualizar vínculo (parentesco / autorização de retirada)',
  })
  updateLink(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: unknown,
  ) {
    return this.responsiblesService.updateLink(
      user,
      clientId,
      responsibleId,
      studentId,
      body,
    );
  }

  @Get(':responsibleId')
  @ApiOperation({ summary: 'Detalhe do responsável' })
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
  ) {
    return this.responsiblesService.getById(user, clientId, responsibleId);
  }

  @Patch(':responsibleId')
  @ApiOperation({ summary: 'Atualizar responsável (opcional: nova senha)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Body() body: unknown,
  ) {
    return this.responsiblesService.update(user, clientId, responsibleId, body);
  }
}
