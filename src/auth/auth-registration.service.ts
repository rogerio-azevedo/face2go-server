import { Injectable } from '@nestjs/common';

import type { JoinContextInput } from '../validation/join-context.schema';
import type { RegisterInput } from '../validation/register.schema';
import type { JoinContextResult } from './interfaces/auth-types.interface';
import { AuthService } from './auth.service';

/**
 * Facade de registro/convite — delega ao AuthService enquanto
 * register/joinContext são extraídos incrementalmente.
 */
@Injectable()
export class AuthRegistrationService {
  constructor(private readonly authService: AuthService) {}

  register(input: RegisterInput): Promise<{ success: true }> {
    return this.authService.register(input);
  }

  joinContext(input: JoinContextInput): Promise<JoinContextResult> {
    return this.authService.joinContext(input);
  }
}
