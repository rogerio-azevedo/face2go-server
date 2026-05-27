import type { FeatureSlug } from './features.constants';

/** Rotas da área empresa → feature necessária para `can_read`. */
export const ROUTE_PERMISSIONS: Partial<Record<string, FeatureSlug>> = {
  '/company/usuarios': 'users',
  '/company/clientes': 'clients',
  '/company/leitores': 'clients',
  '/company/cameras': 'clients',
  '/company/acessos': 'clients',
  '/company/display': 'clients',
  '/company/integracao': 'clients',
};
