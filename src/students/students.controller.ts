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
import { StudentsService } from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar alunos paginados (?page, ?pageSize, ?search, ?classId)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('classId') classId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.studentsService.list(user, clientId, {
      classId,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
      search,
    });
  }

  @Post(':studentId/classes')
  @ApiOperation({ summary: 'Vincular turma ao aluno' })
  linkClass(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: unknown,
  ) {
    return this.studentsService.linkClass(user, clientId, studentId, body);
  }

  @Delete(':studentId/classes/:classId')
  @ApiOperation({ summary: 'Remover vínculo aluno–turma' })
  unlinkClass(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    return this.studentsService.unlinkClass(
      user,
      clientId,
      studentId,
      classId,
    );
  }

  @Get(':studentId/responsibles')
  @ApiOperation({ summary: 'Listar responsáveis vinculados ao aluno' })
  listLinkedResponsibles(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.studentsService.listLinkedResponsibles(
      user,
      clientId,
      studentId,
    );
  }

  @Get(':studentId')
  @ApiOperation({ summary: 'Detalhe do aluno' })
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.studentsService.getById(user, clientId, studentId);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar aluno' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.studentsService.create(user, clientId, body);
  }

  @Patch(':studentId')
  @ApiOperation({ summary: 'Atualizar aluno' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: unknown,
  ) {
    return this.studentsService.update(user, clientId, studentId, body);
  }
}
