import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadFaceDto } from './dto/upload-face.dto';
import { FaceEnrollmentService } from './face-enrollment.service';

@ApiTags('responsible-face-enrollment')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class FaceEnrollmentController {
  constructor(private readonly faceEnrollmentService: FaceEnrollmentService) {}

  @Get('me/face')
  @ApiOperation({
    summary:
      'Status da face do responsável (foto cadastrada e sync com leitores)',
  })
  async getMyFace(@CurrentUser() user: JwtPayload) {
    return this.faceEnrollmentService.getMyFaceStatus(user);
  }

  @Post('me/face')
  @ApiOperation({
    summary:
      'Enviar/atualizar foto do responsável e sincronizar com os leitores',
  })
  async uploadMyFace(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadFaceDto,
  ) {
    return this.faceEnrollmentService.uploadAndSyncMyFace(
      user,
      dto.imageBase64,
    );
  }

  @Post('me/face/sync')
  @ApiOperation({
    summary:
      'Reenviar foto já armazenada para os leitores faciais (sem nova imagem)',
  })
  async resyncMyFace(@CurrentUser() user: JwtPayload) {
    return this.faceEnrollmentService.resyncMyFaceFromR2(user);
  }

  @Get('children/:studentId/face')
  @ApiOperation({
    summary: 'Status da face de um aluno vinculado ao responsável',
  })
  async getChildFace(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.faceEnrollmentService.getChildFaceStatus(user, studentId);
  }

  @Post('children/:studentId/face')
  @ApiOperation({
    summary:
      'Enviar/atualizar foto de um aluno vinculado e sincronizar com os leitores',
  })
  async uploadChildFace(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UploadFaceDto,
  ) {
    return this.faceEnrollmentService.uploadAndSyncChildFace(
      user,
      studentId,
      dto.imageBase64,
    );
  }

  @Post('children/:studentId/face/sync')
  @ApiOperation({
    summary:
      'Reenviar foto do aluno já armazenada para os leitores (sem nova imagem)',
  })
  async resyncChildFace(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.faceEnrollmentService.resyncChildFaceFromR2(user, studentId);
  }

  @Get('household/:responsibleId/face')
  @ApiOperation({
    summary:
      'Status da face de um co-responsável do mesmo núcleo (compartilham alunos)',
  })
  async getHouseholdMemberFace(
    @CurrentUser() user: JwtPayload,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
  ) {
    return this.faceEnrollmentService.getHouseholdMemberFaceStatus(
      user,
      responsibleId,
    );
  }

  @Post('household/:responsibleId/face')
  @ApiOperation({
    summary:
      'Enviar/atualizar foto de um co-responsável do núcleo e sincronizar com os leitores',
  })
  async uploadHouseholdMemberFace(
    @CurrentUser() user: JwtPayload,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Body() dto: UploadFaceDto,
  ) {
    return this.faceEnrollmentService.uploadAndSyncHouseholdMemberFace(
      user,
      responsibleId,
      dto.imageBase64,
    );
  }

  @Post('household/:responsibleId/face/sync')
  @ApiOperation({
    summary:
      'Reenviar foto do co-responsável já armazenada para os leitores (sem nova imagem)',
  })
  async resyncHouseholdMemberFace(
    @CurrentUser() user: JwtPayload,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
  ) {
    return this.faceEnrollmentService.resyncHouseholdMemberFaceFromR2(
      user,
      responsibleId,
    );
  }
}
