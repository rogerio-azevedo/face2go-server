import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import type { AppDb } from '../database/database.types';
import * as clientsQueries from '../database/queries/clients.queries';
import * as readersQueries from '../database/queries/readers.queries';
import {
  toPlainReaderCredential,
  type PlainReaderCredential,
} from '../face-sync/intelbras-device.client';
import { PermissionsService } from '../permissions/permissions.service';

export type LoadedDeviceReader = {
  id: string;
  clientId: string;
  clientType: string;
  brand: string;
  plain: PlainReaderCredential;
};

export function assertNotSchoolClient(clientType: string) {
  if (clientType === 'school') {
    throw new BadRequestException(
      'Esta ação não está disponível para clientes do tipo escola.',
    );
  }
}

export function ensureCompanyId(user: JwtPayload): string {
  const companyId = user.companyId ?? undefined;
  if (!companyId) {
    throw new ForbiddenException('Sem permissão.');
  }
  return companyId;
}

export async function assertCompanyOperatorAction(
  permissionsService: PermissionsService,
  user: JwtPayload,
  action: 'can_read' | 'can_delete',
) {
  if (user.role !== 'company_admin' && user.role !== 'company_operator') {
    throw new ForbiddenException('Sem permissão.');
  }
  if (user.role !== 'company_operator') return;
  const ok = await permissionsService.evaluateCompanyFeatureAction(
    user.role,
    user.companyUserId,
    'clients',
    action,
  );
  if (!ok) throw new ForbiddenException('Sem permissão.');
}

export async function loadActiveDeviceReader(
  db: AppDb,
  configService: ConfigService<EnvVars, true>,
  companyId: string,
  readerId: string,
): Promise<LoadedDeviceReader> {
  const reader = await readersQueries.getReaderWithCredentialsById(
    db,
    readerId,
    companyId,
  );
  if (!reader) throw new NotFoundException('Leitor não encontrado.');
  if (!reader.isActive) {
    throw new BadRequestException('O leitor está inativo.');
  }
  if (!reader.username || !reader.passwordEncrypted) {
    throw new BadRequestException('O leitor não possui credenciais salvas.');
  }

  const client = await clientsQueries.getClientById(
    db,
    reader.clientId,
    companyId,
  );
  const cipher = createReaderCredentialsCipher(
    configService.get('READER_ENCRYPTION_KEY', { infer: true }),
  );
  return {
    id: reader.id,
    clientId: reader.clientId,
    clientType: client?.type ?? 'other',
    brand: reader.brand ?? 'intelbras',
    plain: toPlainReaderCredential(
      {
        id: reader.id,
        name: reader.name,
        brand: reader.brand ?? 'intelbras',
        ip: reader.ip,
        port: reader.port,
        username: reader.username,
        passwordEncrypted: reader.passwordEncrypted,
      },
      cipher.decrypt(reader.passwordEncrypted),
    ),
  };
}
