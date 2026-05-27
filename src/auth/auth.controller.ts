import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

import { Public } from '../common/decorators/public.decorator';
import { AllowIdentity } from '../common/decorators/allow-identity.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import type { UserContextType } from './interfaces/user-context.interface';
import { AuthService } from './auth.service';

export class LoginDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class SelectContextDto {
  @IsIn(['super_admin', 'company', 'client', 'responsible', 'face_user'])
  contextType!: UserContextType;

  @IsOptional()
  @IsString()
  contextId?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login com e-mail ou CPF e senha' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifier, dto.password);
  }

  @AllowIdentity()
  @Post('select-context')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Seleciona contexto de acesso e emite JWT de sessão' })
  async selectContext(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SelectContextDto,
  ) {
    return this.authService.selectContext(user.sub, {
      contextType: dto.contextType,
      contextId: dto.contextId,
    });
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Cadastro via código de convite' })
  async register(@Body() body: Record<string, unknown>) {
    return this.authService.register(body);
  }

  @Public()
  @Post('join-context')
  @ApiOperation({
    summary: 'Usuário existente aceita convite e vincula novo contexto',
  })
  async joinContext(@Body() body: Record<string, unknown>) {
    return this.authService.joinContext(body);
  }

  @AllowIdentity()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil do usuário autenticado (JWT)' })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.profileFromPayload(user);
  }
}
