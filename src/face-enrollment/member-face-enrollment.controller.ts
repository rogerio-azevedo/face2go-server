import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadFaceDto } from '../validation/dto/common.dto';
import { FaceEnrollmentService } from './face-enrollment.service';

@ApiTags('member-face-enrollment')
@ApiBearerAuth()
@Roles('member')
@Controller('member')
export class MemberFaceEnrollmentController {
  constructor(private readonly faceEnrollmentService: FaceEnrollmentService) {}

  @Get('me/face')
  @ApiOperation({
    summary: 'Status da face do membro (foto cadastrada e sync com leitores)',
  })
  getMyFace(@CurrentUser() user: JwtPayload) {
    return this.faceEnrollmentService.getMemberMyFaceStatus(user);
  }

  @Post('me/face')
  @ApiOperation({
    summary: 'Enviar/atualizar foto do membro e sincronizar com os leitores',
  })
  uploadMyFace(@CurrentUser() user: JwtPayload, @Body() dto: UploadFaceDto) {
    return this.faceEnrollmentService.uploadAndSyncMemberMyFace(
      user,
      dto.imageBase64,
    );
  }

  @Post('me/face/sync')
  @ApiOperation({
    summary:
      'Reenviar foto já armazenada para os leitores faciais (sem nova imagem)',
  })
  resyncMyFace(@CurrentUser() user: JwtPayload) {
    return this.faceEnrollmentService.resyncMemberMyFaceFromR2(user);
  }

  @Get('students')
  @ApiOperation({
    summary: 'Buscar alunos para cadastro facial (funcionário autorizado)',
  })
  listStudents(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.faceEnrollmentService.listStudentsForMemberEnrollment(user, {
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('students/:studentId/face')
  @ApiOperation({
    summary: 'Enviar/atualizar foto de aluno e sincronizar com os leitores',
  })
  uploadStudentFace(
    @CurrentUser() user: JwtPayload,
    @Param('studentId') studentId: string,
    @Body() dto: UploadFaceDto,
  ) {
    return this.faceEnrollmentService.uploadAndSyncStudentFaceByMember(
      user,
      studentId,
      dto.imageBase64,
    );
  }
}
