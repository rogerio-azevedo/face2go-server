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
import { PublicRegistrationService } from './public-registration.service';

const UPLOAD_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('public-registration')
@Controller('register')
export class PublicRegisterController {
  constructor(
    private readonly publicRegistrationService: PublicRegistrationService,
  ) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Dados públicos do cliente para o formulário de cadastro',
  })
  preview(@Param('code') code: string) {
    return this.publicRegistrationService.getPreview(code);
  }

  @Public()
  @Post(':code/presign-photo')
  @ApiOperation({ summary: 'URL assinada para upload da foto (R2)' })
  presign(@Param('code') code: string, @Body() body: unknown) {
    return this.publicRegistrationService.presignPhoto(code, body);
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
      required: ['file', 'registrationId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        registrationId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    summary: 'Enviar foto (multipart) pelo servidor para o R2',
  })
  uploadPhoto(
    @Param('code') code: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: unknown,
  ) {
    return this.publicRegistrationService.uploadPhoto(code, file, body);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Enviar cadastro (aguarda aprovação)' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.publicRegistrationService.submit(code, body);
  }
}
