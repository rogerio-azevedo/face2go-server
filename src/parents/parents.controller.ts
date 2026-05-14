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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParentsService } from './parents.service';

@ApiTags('parents')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/parents')
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar responsáveis da escola' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.parentsService.list(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar responsável com login (usuário + senha)' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.parentsService.create(user, clientId, body);
  }

  @Get(':parentId/students')
  @ApiOperation({
    summary: 'Listar alunos vinculados ao responsável',
  })
  listStudents(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
  ) {
    return this.parentsService.listLinkedStudents(user, clientId, parentId);
  }

  @Post(':parentId/students')
  @ApiOperation({ summary: 'Vincular aluno ao responsável' })
  linkStudent(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() body: unknown,
  ) {
    return this.parentsService.linkStudent(user, clientId, parentId, body);
  }

  @Delete(':parentId/students/:studentId')
  @ApiOperation({ summary: 'Remover vínculo aluno–responsável' })
  unlinkStudent(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.parentsService.unlinkStudent(
      user,
      clientId,
      parentId,
      studentId,
    );
  }

  @Get(':parentId')
  @ApiOperation({ summary: 'Detalhe do responsável' })
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
  ) {
    return this.parentsService.getById(user, clientId, parentId);
  }

  @Patch(':parentId')
  @ApiOperation({ summary: 'Atualizar responsável (opcional: nova senha)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() body: unknown,
  ) {
    return this.parentsService.update(user, clientId, parentId, body);
  }
}
