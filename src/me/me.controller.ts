import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ALL_FEATURES, type FeatureSlug, type PermissionAction } from '../common/features.constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionsService } from '../permissions/permissions.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('navigation')
  @ApiOperation({
    summary: 'Paths permitidos na sidebar da área empresa',
  })
  navigation(@CurrentUser() user: JwtPayload) {
    return this.permissionsService.getSidebarNavAccess(user);
  }

  @Get('can-check')
  @ApiOperation({
    summary:
      'Checa permissão granular (empresa). Usado pelo middleware Next.js.',
  })
  async canCheck(
    @CurrentUser() user: JwtPayload,
    @Query('feature') feature: string,
    @Query('action') action: string,
  ) {
    const slugOk = ALL_FEATURES.some((f) => f.slug === feature);
    if (!slugOk) {
      throw new BadRequestException('Feature inválida.');
    }
    const actionsOk = [
      'can_read',
      'can_create',
      'can_update',
      'can_delete',
    ].includes(action);
    if (!actionsOk) {
      throw new BadRequestException('Ação inválida.');
    }

    const allowed = await this.permissionsService.evaluateCompanyFeatureAction(
      user.role,
      user.companyUserId,
      feature as FeatureSlug,
      action as PermissionAction,
    );

    return { allowed };
  }

  @Get('permissions/:featureSlug')
  @ApiOperation({
    summary:
      'Ações efetivas para uma feature (equivalente a getPermissions no Next.js)',
  })
  async permissionsForFeature(
    @CurrentUser() user: JwtPayload,
    @Param('featureSlug') featureSlug: string,
  ) {
    const slugOk = ALL_FEATURES.some((f) => f.slug === featureSlug);
    if (!slugOk) {
      throw new BadRequestException('Feature inválida.');
    }
    const actions =
      await this.permissionsService.getEffectivePermissionActions(
        user,
        featureSlug as FeatureSlug,
      );
    return { actions };
  }
}
