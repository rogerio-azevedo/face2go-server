import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { AllowIdentity } from '../common/decorators/allow-identity.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  JoinContextDto,
  LoginDto,
  RegisterDto,
  RequestPasswordDto,
  ResetPasswordDto,
  SelectContextDto,
} from '../validation/dto/auth.dto';
import { AuthService } from './auth.service';
import type { LoginResult } from './interfaces/auth-types.interface';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login com e-mail ou CPF e senha.' })
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    const loginId = dto.identifier?.trim() || dto.email?.trim();
    if (!loginId) {
      throw new BadRequestException('Informe e-mail ou CPF.');
    }
    return await this.authService.login(loginId, dto.password);
  }

  @AllowIdentity()
  @Post('select-context')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Seleciona contexto de acesso e emite JWT de sessão',
  })
  async selectContext(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SelectContextDto,
  ) {
    return await this.authService.selectContext(user.sub, {
      contextType: dto.contextType,
      contextId: dto.contextId,
    });
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Cadastro via código de convite' })
  async register(@Body() dto: RegisterDto) {
    return await this.authService.register(dto);
  }

  @Public()
  @Post('join-context')
  @ApiOperation({
    summary: 'Usuário existente aceita convite e vincula novo contexto',
  })
  async joinContext(@Body() dto: JoinContextDto) {
    return await this.authService.joinContext(dto);
  }

  @Public()
  @Post('request-password')
  @ApiOperation({
    summary: 'Solicita e-mail para redefinir senha (e-mail ou CPF)',
  })
  async requestPassword(@Body() dto: RequestPasswordDto) {
    return await this.authService.requestPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Redefine senha com token recebido por e-mail' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.authService.resetPassword(dto);
  }

  @AllowIdentity()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil do usuário autenticado (JWT)' })
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.profileFromPayload(user);
  }
}
