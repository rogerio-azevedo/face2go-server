import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

import type { UserContextType } from '../interfaces/user-context.interface';

export class LoginDto {
  /** Compatível com clientes antigos (ex.: app mobile) que ainda enviam `email`. */
  @ValidateIf((dto: LoginDto) => !dto.identifier?.trim())
  @IsEmail()
  email?: string;

  @ValidateIf((dto: LoginDto) => !dto.email?.trim())
  @IsString()
  @MinLength(1)
  identifier?: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class SelectContextDto {
  @IsIn([
    'super_admin',
    'company',
    'client',
    'responsible',
    'member',
    'face_user',
  ])
  contextType!: UserContextType;

  @IsOptional()
  @IsString()
  contextId?: string;
}
