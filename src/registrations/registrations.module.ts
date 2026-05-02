import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import { ClientRegistrationLinksController } from './client-registration-links.controller';
import { ClientRegistrationsController } from './client-registrations.controller';
import { CompanyRegistrationLinksController } from './company-registration-links.controller';
import { CompanyRegistrationsController } from './company-registrations.controller';
import { PublicRegisterController } from './public-register.controller';
import { PublicRegistrationService } from './public-registration.service';
import { RegistrationLinksService } from './registration-links.service';
import { RegistrationsAdminService } from './registrations-admin.service';

@Module({
  imports: [DatabaseModule, PermissionsModule, StorageModule],
  controllers: [
    ClientRegistrationLinksController,
    CompanyRegistrationLinksController,
    PublicRegisterController,
    ClientRegistrationsController,
    CompanyRegistrationsController,
  ],
  providers: [
    RegistrationLinksService,
    PublicRegistrationService,
    RegistrationsAdminService,
  ],
  exports: [RegistrationLinksService, RegistrationsAdminService],
})
export class RegistrationsModule {}
