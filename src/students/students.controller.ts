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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { GlobalFaceSyncService } from '../face-sync/global-face-sync.service';
import { StudentsService } from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly globalFaceSync: GlobalFaceSyncService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar alunos paginados (?page, ?pageSize, ?search, ?classId)',
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

  @Get('face/global-sync/progress')
  @ApiOperation({
    summary:
      'SSE — progresso da sincronização global de alunos (token na query)',
  })
  async globalSyncProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
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
      await this.globalFaceSync.globalSyncStudents(user, clientId, (evt) =>
        write(evt),
      );
    } catch (e: unknown) {
      write({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
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
    return this.studentsService.unlinkClass(user, clientId, studentId, classId);
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

  @Post(':studentId/face/sync')
  @ApiOperation({
    summary: 'Sincronizar face do aluno com os leitores Intelbras',
  })
  syncFace(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.studentsService.syncFaceByCompany(user, clientId, studentId);
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

  @Delete(':studentId')
  @Roles('company_admin')
  @ApiOperation({
    summary: 'Excluir aluno (remove face dos leitores e vínculos)',
  })
  deleteStudent(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.studentsService.delete(user, clientId, studentId);
  }
}
