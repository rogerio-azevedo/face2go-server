import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { LegalDocumentsService } from './legal-documents.service';

@ApiTags('legal-documents')
@Controller('legal-documents')
export class LegalDocumentsController {
  constructor(private readonly legalDocumentsService: LegalDocumentsService) {}

  @Public()
  @Get(':type/active')
  @ApiOperation({ summary: 'Documento legal ativo por tipo (público)' })
  getActive(@Param('type') type: string) {
    return this.legalDocumentsService.getActiveByType(type);
  }

  @Public()
  @Get(':type/versions')
  @ApiOperation({
    summary: 'Versões de um documento legal (público, sem conteúdo)',
  })
  listVersions(@Param('type') type: string) {
    return this.legalDocumentsService.listVersionsByType(type);
  }

  @Public()
  @Get(':type/:version')
  @ApiOperation({
    summary: 'Versão específica de um documento legal (público)',
  })
  getByVersion(@Param('type') type: string, @Param('version') version: string) {
    return this.legalDocumentsService.getByTypeAndVersion(type, version);
  }
}
