import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { generateCompanyInviteByAdminSchema } from '../client-invites.schema';

const updateRoleSchema = z.object({
  role: z.enum(['company_admin', 'company_operator']),
});

const toggleActiveSchema = z.object({
  isActive: z.boolean(),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  jobTitle: z.string().trim().min(2).max(120).optional().nullable(),
  phone: z.string().trim().min(8).max(30).optional().nullable(),
});

const permissionsSchema = z.object({
  featureSlug: z.string(),
  actions: z.array(
    z.enum(['can_read', 'can_create', 'can_update', 'can_delete']),
  ),
});

export class GenerateCompanyUserInviteLinkDto extends createZodDto(
  generateCompanyInviteByAdminSchema,
) {}
export class PatchCompanyUserRoleDto extends createZodDto(updateRoleSchema) {}
export class PatchCompanyUserActiveDto extends createZodDto(
  toggleActiveSchema,
) {}
export class PatchCompanyUserProfileDto extends createZodDto(profileSchema) {}
export class PatchCompanyUserPermissionsDto extends createZodDto(
  permissionsSchema,
) {}
