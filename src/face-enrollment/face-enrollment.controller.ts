import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

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
    summary: 'Status da face do responsável (foto cadastrada e sync com leitores)',
  })
  async getMyFace(@CurrentUser() user: JwtPayload) {
    return this.faceEnrollmentService.getMyFaceStatus(user);
  }

  @Post('me/face')
  @ApiOperation({
    summary: 'Enviar/atualizar foto do responsável e sincronizar com os leitores',
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
}
