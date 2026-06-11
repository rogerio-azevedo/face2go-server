import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  fetchIenhSchema,
  type FetchIenhInput,
} from '../validation/ienh.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { TotvsIenhClient } from './totvs-ienh.client';
import type { TotvsIenhRecordWithFilial } from './types/ienh-sync.types';
import type {
  TotvsIenhFetchParams,
  TotvsIenhRecord,
  TotvsIenhSnapshot,
} from './types/totvs-ienh.types';

const DEFAULT_FILIAIS = [1, 2, 3];
const DEFAULT_NIVEIS = [1, 2, 3];

export interface FetchAndSaveResult {
  count: number;
  file: string;
  snapshot: TotvsIenhRecord[];
}

@Injectable()
export class IenhService {
  private readonly logger = new Logger(IenhService.name);

  constructor(private readonly totvsClient: TotvsIenhClient) {}

  async fetchAllRecordsTagged(input: {
    perlet: string;
    filiais: number[];
    niveis?: number[];
  }): Promise<TotvsIenhRecordWithFilial[]> {
    const resolved = this.resolveInput({
      perlet: input.perlet,
      filiais: input.filiais,
      niveis: input.niveis,
    });
    const requests = this.buildRequests(resolved);
    const tagged: TotvsIenhRecordWithFilial[] = [];

    for (const req of requests) {
      const batch = await this.totvsClient.fetchRecords(req);
      this.logger.log(
        `TOTVS IENH: ${batch.length} registros (FILIAL=${req.filial}, NIVEL=${req.nivel})`,
      );
      for (const record of batch) {
        tagged.push({ filial: req.filial, record });
      }
    }
    return tagged;
  }

  /** Busca registros de uma filial (todos os níveis informados). */
  async fetchFilialRecordsTagged(input: {
    perlet: string;
    filial: number;
    niveis?: number[];
  }): Promise<TotvsIenhRecordWithFilial[]> {
    const resolved = this.resolveInput({
      perlet: input.perlet,
      filiais: [input.filial],
      niveis: input.niveis,
    });
    const requests = this.buildRequests(resolved);
    const tagged: TotvsIenhRecordWithFilial[] = [];

    for (const req of requests) {
      const batch = await this.totvsClient.fetchRecords(req);
      this.logger.log(
        `TOTVS IENH: ${batch.length} registros (FILIAL=${req.filial}, NIVEL=${req.nivel})`,
      );
      for (const record of batch) {
        tagged.push({ filial: req.filial, record });
      }
    }
    return tagged;
  }

  async fetchAndSave(body: unknown): Promise<FetchAndSaveResult> {
    const parsed = fetchIenhSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const input = this.resolveInput(parsed.data);
    const tagged = await this.fetchAllRecordsTagged({
      perlet: input.perlet,
      filiais: input.filiais,
      niveis: input.niveis,
    });
    const records = tagged.map((t) => t.record);
    const requests = this.buildRequests(input);

    const fetchedAt = new Date();
    const file = await this.persistSnapshot({
      fetchedAt,
      perlet: input.perlet,
      filiais: input.filiais,
      niveis: input.niveis,
      requests,
      records,
    });

    return {
      count: records.length,
      file,
      snapshot: records,
    };
  }

  /** Persiste snapshot com filial por registro (usado após fetch no sync). */
  async persistTaggedSnapshot(args: {
    tagged: TotvsIenhRecordWithFilial[];
    perlet: string;
    perlets?: string[];
    filiais: number[];
    niveis: number[];
    requests?: TotvsIenhFetchParams[];
  }): Promise<{ file: string; filename: string; recordCount: number }> {
    const fetchedAt = new Date();
    const records = args.tagged.map((t) => t.record);
    const file = await this.persistSnapshot({
      fetchedAt,
      perlet: args.perlet,
      perlets: args.perlets,
      filiais: args.filiais,
      niveis: args.niveis,
      requests: args.requests ?? [],
      records,
      taggedRecords: args.tagged,
    });
    return {
      file,
      filename: basename(file),
      recordCount: records.length,
    };
  }

  private resolveInput(data: FetchIenhInput): {
    perlet: string;
    filiais: number[];
    niveis: number[];
  } {
    return {
      perlet: data.perlet ?? String(new Date().getFullYear()),
      filiais: data.filiais ?? DEFAULT_FILIAIS,
      niveis: data.niveis ?? DEFAULT_NIVEIS,
    };
  }

  private buildRequests(input: {
    perlet: string;
    filiais: number[];
    niveis: number[];
  }): TotvsIenhFetchParams[] {
    const requests: TotvsIenhFetchParams[] = [];
    for (const filial of input.filiais) {
      for (const nivel of input.niveis) {
        requests.push({
          perlet: input.perlet,
          filial,
          nivel,
        });
      }
    }
    return requests;
  }

  private async persistSnapshot(args: {
    fetchedAt: Date;
    perlet: string;
    perlets?: string[];
    filiais: number[];
    niveis: number[];
    requests: TotvsIenhFetchParams[];
    records: TotvsIenhRecord[];
    taggedRecords?: TotvsIenhRecordWithFilial[];
  }): Promise<string> {
    const dir = join(process.cwd(), 'data');
    await mkdir(dir, { recursive: true });

    const stamp = this.formatTimestamp(args.fetchedAt);
    const filename = `ienh-snapshot-${stamp}.json`;
    const filePath = join(dir, filename);

    const snapshot: TotvsIenhSnapshot = {
      meta: {
        fetchedAt: args.fetchedAt.toISOString(),
        perlet: args.perlet,
        ...(args.perlets?.length ? { perlets: args.perlets } : {}),
        filiais: args.filiais,
        niveis: args.niveis,
        requests: args.requests,
        recordCount: args.records.length,
      },
      records: args.records,
      ...(args.taggedRecords?.length
        ? { taggedRecords: args.taggedRecords }
        : {}),
    };

    await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    this.logger.log(
      `Snapshot TOTVS IENH salvo em ${filePath} (${args.records.length} registros)`,
    );

    return filePath;
  }

  private formatTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`
    );
  }
}
