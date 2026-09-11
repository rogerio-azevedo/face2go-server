import { BadRequestException } from '@nestjs/common';

function coerceTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

export function normalizeAdditionalDataForClientType(
  clientType: string,
  raw: Record<string, unknown> | undefined,
): { block?: string; unit?: string; room?: string } | null {
  if (clientType === 'condominium') {
    const block = coerceTrimmedString(raw?.block);
    const unit = coerceTrimmedString(raw?.unit);
    if (!block || !unit) {
      throw new BadRequestException('Informe bloco e unidade.');
    }
    return { block, unit };
  }
  if (clientType === 'office' || clientType === 'clinic') {
    const room = coerceTrimmedString(raw?.room);
    if (!room) {
      throw new BadRequestException('Informe a sala.');
    }
    return { room };
  }
  return null;
}
