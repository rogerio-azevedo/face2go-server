import type { JwtPayload } from './jwt-payload.interface';
import type { UserContext } from './user-context.interface';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name?: string | null;
  cpf?: string | null;
  role: string;
  contextType?: JwtPayload['contextType'];
  companyId?: string;
  clientId?: string;
  companyUserId?: string;
  clientUserId?: string;
  responsibleId?: string;
};

export type IdentityUser = {
  id: string;
  email: string;
  name?: string | null;
  cpf?: string | null;
};

export type LoginResult = {
  user: IdentityUser;
  contexts: UserContext[];
  identityToken: string;
};

export type SelectContextResult = {
  accessToken: string;
  context: UserContext;
  user: AuthenticatedUser;
};

export type JoinContextResult = LoginResult;
