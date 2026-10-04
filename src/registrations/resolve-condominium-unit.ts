import { BadRequestException } from '@nestjs/common';

import type { ResolvedRegistrationFieldsConfig } from './registration-fields-config';

export const EMPTY_CATALOG_MESSAGE =
  'Cadastre blocos e unidades antes de receber cadastros.';
export const UNIT_REQUIRED_MESSAGE = 'Informe o bloco e a unidade.';
export const UNIT_INVALID_MESSAGE = 'Bloco ou unidade inválidos.';

type AdditionalData = { block?: string; unit?: string; room?: string } | null;

export async function resolveCondominiumUnit(input: {
  clientType: string;
  config: ResolvedRegistrationFieldsConfig;
  requestedUnitId: string | null | undefined;
  additionalData: AdditionalData;
  existingUnitId?: string | null;
  /** Na edição: com `requestedUnitId` omitido, mantém unidade e texto atuais. */
  existingAdditionalData?: AdditionalData;
  catalog: {
    loadActiveUnit: (
      unitId: string,
    ) => Promise<{ blockName: string; unitName: string } | null>;
    countActiveUnits: () => Promise<number>;
  };
}): Promise<{ unitId: string | null; additionalData: AdditionalData }> {
  if (input.clientType !== 'condominium') {
    return { unitId: null, additionalData: input.additionalData };
  }

  const blockVisible = input.config.block !== 'hidden';
  const unitVisible = input.config.unit !== 'hidden';
  if (!blockVisible && !unitVisible) {
    return {
      unitId: input.existingUnitId ?? null,
      additionalData: input.additionalData,
    };
  }

  const base: { block?: string; unit?: string; room?: string } = {
    ...(input.additionalData ?? {}),
  };
  delete base.block;
  delete base.unit;

  if (
    input.requestedUnitId === undefined &&
    input.existingAdditionalData !== undefined
  ) {
    const block = input.existingAdditionalData?.block;
    const unit = input.existingAdditionalData?.unit;
    if (block) base.block = block;
    if (unit) base.unit = unit;
    return {
      unitId: input.existingUnitId ?? null,
      additionalData: Object.keys(base).length > 0 ? base : null,
    };
  }

  const requested = input.requestedUnitId?.trim() || null;
  if (!requested) {
    const required =
      input.config.block === 'required' || input.config.unit === 'required';
    if (required) {
      const total = await input.catalog.countActiveUnits();
      throw new BadRequestException(
        total === 0 ? EMPTY_CATALOG_MESSAGE : UNIT_REQUIRED_MESSAGE,
      );
    }
    return {
      unitId: null,
      additionalData: Object.keys(base).length > 0 ? base : null,
    };
  }

  const located = await input.catalog.loadActiveUnit(requested);
  if (!located) throw new BadRequestException(UNIT_INVALID_MESSAGE);

  base.block = located.blockName;
  base.unit = located.unitName;
  return {
    unitId: requested,
    additionalData: base,
  };
}
