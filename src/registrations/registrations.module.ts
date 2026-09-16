import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { MembersModule } from '../members/members.module';
import { PeopleModule } from '../people/people.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import { ClientRegistrationLinksController } from './client-registration-links.controller';
import { ClientRegistrationsController } from './client-registrations.controller';
import { ClientRegistrationConfigController } from './client-registration-config.controller';
import { CompanyRegistrationLinksController } from './company-registration-links.controller';
import { CompanyRegistrationsController } from './company-registrations.controller';
import { CompanyRegistrationConfigController } from './company-registration-config.controller';
import { PublicRegisterController } from './public-register.controller';
import { PublicRegistrationService } from './public-registration.service';
import { RegistrationConfigService } from './registration-config.service';
import { RegistrationLinksService } from './registration-links.service';
import { RegistrationsAdminService } from './registrations-admin.service';

@Module({
  imports: [
    DatabaseModule,
    PermissionsModule,
    StorageModule,
    FaceSyncModule,
    MembersModule,
    PeopleModule,
  ],
  controllers: [
    ClientRegistrationLinksController,
    CompanyRegistrationLinksController,
    ClientRegistrationConfigController,
    CompanyRegistrationConfigController,
    PublicRegisterController,
    ClientRegistrationsController,
    CompanyRegistrationsController,
  ],
  providers: [
    RegistrationLinksService,
    RegistrationConfigService,
    PublicRegistrationService,
    RegistrationsAdminService,
  ],
  exports: [
    RegistrationLinksService,
    RegistrationConfigService,
    RegistrationsAdminService,
  ],
})
export class RegistrationsModule {}
