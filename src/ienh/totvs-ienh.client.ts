import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvVars } from '../config/env.validation';
import type {
  TotvsIenhFetchParams,
  TotvsIenhRecord,
} from './types/totvs-ienh.types';

const REQUEST_TIMEOUT_MS = 60_000;

@Injectable()
export class TotvsIenhClient {
  private readonly logger = new Logger(TotvsIenhClient.name);

  constructor(private readonly configService: ConfigService<EnvVars, true>) {}

  async fetchRecords(params: TotvsIenhFetchParams): Promise<TotvsIenhRecord[]> {
    const baseUrl = this.configService.get('IENH_API_URL', { infer: true });
    const user = this.configService.get('IENH_API_USER', { infer: true });
    const password = this.configService.get('IENH_API_PASSWORD', {
      infer: true,
    });

    if (!baseUrl || !user || !password) {
      throw new ServiceUnavailableException(
        'Integração IENH não configurada (variáveis de ambiente ausentes).',
      );
    }

    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

    const parameters = `NIVEL=${params.nivel};PERLET=${params.perlet};FILIAL=${params.filial}`;
    const url = `${normalizedBaseUrl}/1/S?parameters=${parameters}`;

    const auth = Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    this.logger.log(
      `TOTVS IENH: fetch FILIAL=${params.filial} NIVEL=${params.nivel} PERLET=${params.perlet}`,
    );

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${auth}`,
        },
        signal: controller.signal,
      });

      if (res.status === 401) {
        throw new UnauthorizedException(
          'Credenciais TOTVS IENH inválidas (401 Unauthorized).',
        );
      }

      if (!res.ok) {
        const text = await res.text();
        throw new BadGatewayException(
          `TOTVS IENH retornou HTTP ${res.status}: ${text.slice(0, 500)}`,
        );
      }

      const body: unknown = await res.json();
      return this.parseRecords(body);
    } catch (err: unknown) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof BadGatewayException
      ) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BadGatewayException(
          `TOTVS IENH: timeout após ${REQUEST_TIMEOUT_MS}ms.`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `TOTVS IENH: falha na requisição — ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRecords(body: unknown): TotvsIenhRecord[] {
    if (Array.isArray(body)) {
      return body as TotvsIenhRecord[];
    }
    if (
      body &&
      typeof body === 'object' &&
      'data' in body &&
      Array.isArray(body.data)
    ) {
      return (body as { data: TotvsIenhRecord[] }).data;
    }
    throw new BadGatewayException(
      'TOTVS IENH: resposta JSON em formato inesperado (esperado: array).',
    );
  }
}
