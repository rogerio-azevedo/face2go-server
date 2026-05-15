export interface JwtPayload {
  sub: string;
  email: string;
  name?: string | null;
  role: string;
  companyId?: string | null;
  clientId?: string | null;
  companyUserId?: string | null;
  clientUserId?: string | null;
  /** Responsável (escola); presente quando `role === 'responsible'`. */
  responsibleId?: string | null;
}
