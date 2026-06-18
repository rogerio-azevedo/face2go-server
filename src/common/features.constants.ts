export type FeatureSlug =
  | 'visitors'
  | 'reports'
  | 'devices'
  | 'access_control'
  | 'users'
  | 'clients'
  | 'monitoring';

/** Recursos premium contratados por empresa (gerenciados pelo super admin). */
export type PremiumFeatureSlug = 'monitoring';

export const PREMIUM_FEATURE_SLUGS: PremiumFeatureSlug[] = ['monitoring'];

export type PermissionAction =
  | 'can_read'
  | 'can_create'
  | 'can_update'
  | 'can_delete';

export interface FeatureDefinition {
  slug: FeatureSlug;
  name: string;
  description: string;
  category: string;
  isPremium?: boolean;
}

export const ALL_FEATURES: FeatureDefinition[] = [
  {
    slug: 'visitors',
    name: 'Visitantes',
    description: 'Gestão de visitantes e acessos',
    category: 'Operações',
  },
  {
    slug: 'reports',
    name: 'Relatórios',
    description: 'Relatórios e exportações',
    category: 'Operações',
  },
  {
    slug: 'devices',
    name: 'Dispositivos',
    description: 'Leitores faciais e equipamentos',
    category: 'Administração',
  },
  {
    slug: 'access_control',
    name: 'Controle de acesso',
    description: 'Regras e permissões de acesso',
    category: 'Administração',
  },
  {
    slug: 'users',
    name: 'Usuários da empresa',
    description: 'Equipe e permissões por módulo',
    category: 'Administração',
  },
  {
    slug: 'clients',
    name: 'Clientes',
    description: 'Unidades atendidas pela empresa',
    category: 'Administração',
  },
  {
    slug: 'monitoring',
    name: 'Pedido de Socorro & Monitoramento',
    description:
      'Botão "Me Ajuda" no app + central de monitoramento (premium)',
    category: 'Premium',
    isPremium: true,
  },
];

export function isPremiumFeatureSlug(
  slug: string,
): slug is PremiumFeatureSlug {
  return (PREMIUM_FEATURE_SLUGS as string[]).includes(slug);
}
