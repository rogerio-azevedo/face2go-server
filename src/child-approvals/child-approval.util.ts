import { createHash, timingSafeEqual } from 'node:crypto';
import {
  calculateAgeOnDate,
  toIsoDateString,
} from '../common/utils/birth-date';
import { calendarDateInOffset } from '../common/parse-access-list-datetime';
import { isValidCpf, normalizeCpf } from '../common/utils/document';
import type { ChildApprovalSnapshot } from '../database/schema/child-approvals';

export const CHILD_APPROVAL_TERM_VERSION = '2026-10-12-v1';
export const CHILD_APPROVAL_ACCEPTED = 'child-approval.accepted';
export const CHILD_APPROVAL_CHANGED = 'child-approval.changed';
export const CHILD_APPROVAL_PENDING_MESSAGE =
  'Aguardando autorização de adulto aprovado da mesma unidade.';

export function hashApprovalToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function matchesAdultCpf(input: string, document: string | null) {
  if (!document || !isValidCpf(input) || !isValidCpf(document)) return false;
  return timingSafeEqual(
    Buffer.from(hashApprovalToken(normalizeCpf(input))),
    Buffer.from(hashApprovalToken(normalizeCpf(document))),
  );
}

export function ageForApproval(
  birthDate: unknown,
  offset: number,
  now = new Date(),
): number | null {
  const iso = toIsoDateString(birthDate);
  if (!iso) return null;
  const age = calculateAgeOnDate(iso, calendarDateInOffset(offset, now));
  return Number.isFinite(age) && age >= 0 ? age : null;
}

export function needsChildApproval(
  client: { enableChildApprove?: boolean; timezoneOffsetMinutes: number },
  registration: { childApprovalRequired?: boolean; birthDate: unknown },
) {
  if (!client.enableChildApprove || !registration.childApprovalRequired)
    return false;
  const age = ageForApproval(
    registration.birthDate,
    client.timezoneOffsetMinutes,
  );
  // Dados ausentes em cadastro inscrito no fluxo não podem abrir uma exceção.
  return age == null || age < 18;
}

export function approvalSnapshot(row: {
  id: string;
  name: string | null;
  birthDate: unknown;
  additionalData: { block?: string; unit?: string } | null;
}): ChildApprovalSnapshot {
  return {
    registrationId: row.id,
    name: row.name ?? 'Cadastro',
    birthDate: toIsoDateString(row.birthDate),
    block: row.additionalData?.block ?? null,
    unit: row.additionalData?.unit ?? null,
  };
}

/** Copiado na solicitação e no aceite. Alterar esta versão não reescreve históricos. */
export function childApprovalTerm(
  clientName: string,
  child: ChildApprovalSnapshot,
) {
  return `Declaro ser maior de idade e estar cadastrado(a) no bloco ${child.block ?? '—'}, unidade ${child.unit ?? '—'}. Autorizo a habilitação do acesso facial de ${child.name} ao mercado ${clientName}, desde que cumpridas as demais regras de acesso. Assumo a responsabilidade pelos atos do menor durante o uso do mercado, conforme as regras aplicáveis. Comprometo-me a orientar o menor sobre as regras de utilização do mercado e a comunicar à administração qualquer uso indevido de que eu tenha conhecimento. Confirmo a veracidade das informações que prestei. Estou ciente de que minha identidade, a data e a hora do aceite e a versão deste termo serão registradas para auditoria. Posso revogar meu aceite pelo mesmo link de gestão desta autorização ou solicitar a revogação ao administrador do cliente.`;
}
