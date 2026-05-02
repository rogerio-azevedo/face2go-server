import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { Roles } from '../common/decorators/roles.decorator';
import { CompaniesService } from './companies.service';

class GenerateInviteBodyDto {
  @IsEnum(['company_admin', 'company_operator'])
  role!: 'company_admin' | 'company_operator';
}

@ApiTags('companies')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar empresas' })
  async list(@Query('includeInactive') includeInactive?: string) {
    const all = includeInactive === '1' || includeInactive === 'true';
    return this.companiesService.list(all);
  }

  @Post()
  @ApiOperation({ summary: 'Criar empresa' })
  async create(@Body() body: unknown) {
    return this.companiesService.create(body);
  }

  @Get(':id/users')
  @ApiOperation({ summary: 'Listar vínculos da empresa (usuários)' })
  async companyUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.listCompanyUsersForSuperAdmin(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da empresa' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar empresa' })
  async patch(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.companiesService.update(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Inativar empresa (soft delete)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.softDelete(id);
  }

  @Post(':id/invite-links')
  @ApiOperation({ summary: 'Gerar link de convite' })
  async invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GenerateInviteBodyDto,
  ) {
    return this.companiesService.generateInvite(id, body.role);
  }
}
