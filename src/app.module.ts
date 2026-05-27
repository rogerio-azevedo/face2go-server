import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';

import { ArrivalsModule } from './arrivals/arrivals.module';
import { AuthModule } from './auth/auth.module';
import { AccessesModule } from './accesses/accesses.module';
import { CamerasModule } from './cameras/cameras.module';
import { ClientsModule } from './clients/clients.module';
import { ClientInviteLinksModule } from './client-invite-links/client-invite-links.module';
import { CompaniesModule } from './companies/companies.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CompanyUsersModule } from './company-users/company-users.module';
import { validateEnv, type EnvVars } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ContextRequiredGuard } from './common/guards/context-required.guard';
import { DatabaseModule } from './database/database.module';
import { LprPlateSyncModule } from './lpr-plate-sync/lpr-plate-sync.module';
import { FaceEnrollmentModule } from './face-enrollment/face-enrollment.module';
import { HealthModule } from './health/health.module';
import { IenhModule } from './ienh/ienh.module';
import { LegalDocumentsModule } from './legal-documents/legal-documents.module';
import { LprAccessesModule } from './lpr-accesses/lpr-accesses.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SimulateModule } from './simulate/simulate.module';
import { ResponsibleDashboardModule } from './responsible-dashboard/responsible-dashboard.module';
import { ResponsiblesModule } from './responsibles/responsibles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PickupAuthorizationsModule } from './pickup-authorizations/pickup-authorizations.module';
import { ReadersModule } from './readers/readers.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { SchoolClassesModule } from './school-classes/school-classes.module';
import { ShiftsModule } from './shifts/shifts.module';
import { StorageModule } from './storage/storage.module';
import { StudentsModule } from './students/students.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    EventEmitterModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<EnvVars, true>) => ({
        uri: configService.get('MONGODB_URI', { infer: true }),
        dbName: configService.get('MONGODB_DB_NAME', { infer: true }),
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    StorageModule,
    PermissionsModule,
    LprPlateSyncModule,
    AuthModule,
    CompaniesModule,
    ClientsModule,
    ClientInviteLinksModule,
    ReadersModule,
    CamerasModule,
    RegistrationsModule,
    CompanyUsersModule,
    SchoolClassesModule,
    ShiftsModule,
    StudentsModule,
    ResponsiblesModule,
    PickupAuthorizationsModule,
    VehiclesModule,
    ResponsibleDashboardModule,
    FaceEnrollmentModule,
    AccessesModule,
    LprAccessesModule,
    MeModule,
    DashboardModule,
    NotificationsModule,
    HealthModule,
    LegalDocumentsModule,
    ArrivalsModule,
    SimulateModule,
    IenhModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ContextRequiredGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
