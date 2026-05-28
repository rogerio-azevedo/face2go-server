import type { JwtPayload } from './jwt-payload.interface';
import type {
  AuthenticatedUser,
  JoinContextResult,
  LoginResult,
  SelectContextResult,
} from './auth-types.interface';
import type { SelectContextInput } from './user-context.interface';

export interface AuthServiceContract {
  login(identifier: string, password: string): Promise<LoginResult>;
  selectContext(
    userId: string,
    input: SelectContextInput,
  ): Promise<SelectContextResult>;
  joinContext(input: unknown): Promise<JoinContextResult>;
  register(input: unknown): Promise<{ success: true }>;
  profileFromPayload(user: JwtPayload): AuthenticatedUser;
}
