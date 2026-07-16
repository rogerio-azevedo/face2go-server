import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ToggleCompanyFeatureDto } from '../validation/dto/company-features.dto';
import { CompanyFeaturesService } from './company-features.service';

@ApiTags('companies')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('companies')
export class CompanyFeaturesController {
  constructor(
    private readonly companyFeaturesService: CompanyFeaturesService,
  ) {}

  @Get(':id/features')
  @ApiOperation({ summary: 'Listar recursos premium da empresa' })
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.companyFeaturesService.listForCompany(id);
  }

  @Patch(':id/features/:slug')
  @ApiOperation({ summary: 'Habilitar/desabilitar recurso premium da empresa' })
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slug') slug: string,
    @Body() body: ToggleCompanyFeatureDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companyFeaturesService.toggle(id, slug, body.enabled, user.sub);
  }
}
