import {
  Body,
  Controller,
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
import { SchoolClassesService } from './school-classes.service';

@ApiTags('school-classes')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/school-classes')
export class SchoolClassesController {
  constructor(private readonly schoolClassesService: SchoolClassesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar turmas da escola (cliente tipo school)' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.schoolClassesService.list(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar turma' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.schoolClassesService.create(user, clientId, body);
  }

  @Patch(':classId')
  @ApiOperation({ summary: 'Atualizar turma' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() body: unknown,
  ) {
    return this.schoolClassesService.update(user, clientId, classId, body);
  }
}
