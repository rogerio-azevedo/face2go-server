import {
  Body,
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
import { PublicInviteRegisterService } from './public-invite-register.service';

const UPLOAD_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('public-invite-register')
@Controller('invite-register')
export class PublicInviteRegisterController {
  constructor(private readonly svc: PublicInviteRegisterService) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Preview do convite de visitante para cadastro de face',
  })
  preview(@Param('code') code: string) {
    return this.svc.getPreview(code);
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
  @ApiOperation({ summary: 'Enviar foto do visitante (multipart via servidor)' })
  uploadPhoto(
    @Param('code') code: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.uploadPhoto(code, file);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Confirmar envio da foto do visitante' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.submit(code, body);
  }
}
