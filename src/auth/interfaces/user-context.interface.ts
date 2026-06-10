export type UserContextType =
  | 'super_admin'
  | 'company'
  | 'client'
  | 'responsible'
  | 'face_user';

export type TenantBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
  privacyPolicyUrl: string | null;
};

export type UserContext =
  | {
      type: 'super_admin';
      contextId: 'super_admin';
      label: string;
    }
  | {
      type: 'company';
      contextId: string;
      companyUserId: string;
      companyId: string;
      companyName: string;
      logoUrl: string | null;
      role: 'company_admin' | 'company_operator';
      label: string;
    }
  | {
      type: 'client';
      contextId: string;
      clientUserId: string;
      clientId: string;
      clientName: string;
      companyId: string;
      role: 'client_admin' | 'client_operator';
      branding: TenantBranding;
      label: string;
    }
  | {
      type: 'responsible';
      contextId: string;
      responsibleId: string;
      clientId: string;
      clientName: string;
      branding: TenantBranding;
      label: string;
    }
  | {
      type: 'face_user';
      contextId: 'face_user';
      label: string;
    };

export type SelectContextInput = {
  contextType: UserContextType;
  contextId?: string;
};
