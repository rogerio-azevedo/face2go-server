import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { RegistrationFaceRetakeService } from './registration-face-retake.service';

const UPLOAD_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('public-registration')
@Controller('register/retake')
export class PublicFaceRetakeController {
  constructor(private readonly faceRetake: RegistrationFaceRetakeService) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Dados públicos para refazer só a foto de um cadastro',
  })
  preview(@Param('code') code: string) {
    return this.faceRetake.getPreview(code);
  }

  @Public()
  @Post(':code/upload-photo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_PHOTO_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Substituir a foto de um cadastro (link de uso único)',
  })
  uploadPhoto(
    @Param('code') code: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.faceRetake.uploadPhoto(code, file);
  }
}
