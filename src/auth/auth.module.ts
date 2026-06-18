import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthPasswordService } from './auth-password.service';
import { AuthRegistrationService } from './auth-registration.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    DatabaseModule,
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '7d',
          },
        }) as import('@nestjs/jwt').JwtModuleOptions,
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthPasswordService,
    AuthRegistrationService,
    JwtStrategy,
  ],
  exports: [AuthService, AuthRegistrationService, JwtModule],
})
export class AuthModule {}
