import { SetMetadata } from '@nestjs/common';

export const ALLOW_IDENTITY_KEY = 'allowIdentity';

/** Permite JWT de identidade (pós-login, pré-seleção de contexto). */
export const AllowIdentity = () => SetMetadata(ALLOW_IDENTITY_KEY, true);
