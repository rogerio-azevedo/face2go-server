import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { ensureCompanyId } from './readers-device-access';

export type RevealedReaderCredentials = {
  readerId: string;
  username: string | null;
  password: string;
};

@Injectable()
export class ReadersCredentialsService {
  private readonly log = new Logger(ReadersCredentialsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  async revealPassword(
    user: JwtPayload,
    readerId: string,
  ): Promise<RevealedReaderCredentials> {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const companyId = ensureCompanyId(user);
    const reader = await readersQueries.getReaderWithCredentialsById(
      this.database.db,
      readerId,
      companyId,
    );
    if (!reader) {
      throw new NotFoundException('Leitor não encontrado.');
    }
    if (!reader.username?.trim() || !reader.passwordEncrypted?.trim()) {
      throw new BadRequestException('O leitor não possui senha salva.');
    }

    const cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
    );
    const password = cipher.decrypt(reader.passwordEncrypted);

    this.log.warn(
      `Senha do leitor revelada readerId=${reader.id} name="${reader.name}" userId=${user.sub} email=${user.email}`,
    );

    return {
      readerId: reader.id,
      username: reader.username,
      password,
    };
  }
}
