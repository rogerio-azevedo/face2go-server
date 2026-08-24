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
import { PublicPickupRegisterService } from './public-pickup-register.service';

const UPLOAD_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('public-pickup-register')
@Controller('pickup-register')
export class PublicPickupRegisterController {
  constructor(private readonly svc: PublicPickupRegisterService) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Preview da autorização de retirada para cadastro de face',
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
  @ApiOperation({
    summary: 'Enviar foto do convidado (multipart via servidor)',
  })
  uploadPhoto(
    @Param('code') code: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.uploadPhoto(code, file);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Confirmar envio da foto do convidado' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.submit(code, body);
  }
}
