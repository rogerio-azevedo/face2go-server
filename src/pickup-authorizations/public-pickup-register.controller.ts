import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicPickupRegisterService } from './public-pickup-register.service';

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
  @ApiOperation({ summary: 'Enviar foto do convidado (base64 via servidor)' })
  uploadPhoto(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.uploadPhoto(code, body);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Confirmar envio da foto do convidado' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.submit(code, body);
  }
}
