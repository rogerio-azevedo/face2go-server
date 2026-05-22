export const LEGAL_DOCUMENT_TYPES = {
  PRIVACY_POLICY: 'privacy_policy',
  TERMS_OF_USE: 'terms_of_use',
} as const;

export type LegalDocumentType =
  (typeof LEGAL_DOCUMENT_TYPES)[keyof typeof LEGAL_DOCUMENT_TYPES];

export const LEGAL_DOCUMENT_TYPE_LABELS: Record<LegalDocumentType, string> = {
  privacy_policy: 'Política de Privacidade',
  terms_of_use: 'Termos de Uso',
};
