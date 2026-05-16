import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from './auth/auth.module';
import { AccessesModule } from './accesses/accesses.module';
import { ClientsModule } from './clients/clients.module';
import { CompaniesModule } from './companies/companies.module';
import { CompanyUsersModule } from './company-users/company-users.module';
import { validateEnv, type EnvVars } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { DatabaseModule } from './database/database.module';
import { FaceEnrollmentModule } from './face-enrollment/face-enrollment.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
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
    AuthModule,
    CompaniesModule,
    ClientsModule,
    ReadersModule,
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
    MeModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
