import type { VisitorApprovalSnapshot } from '../database/schema/visitor-approvals';
export const VISITOR_APPROVAL_TERM_VERSION = '2026-10-19-v1';
export const VISITOR_APPROVAL_ACCEPTED = 'visitor-approval.accepted';
export const VISITOR_APPROVAL_CHANGED = 'visitor-approval.changed';
export const VISITOR_APPROVAL_PENDING_MESSAGE =
  'Aguardando autorização de adulto aprovado da mesma unidade.';

export {
  hashApprovalToken,
  matchesAdultCpf,
  ageForApproval,
  approvalSnapshot,
} from '../child-approvals/child-approval.util';
export function needsVisitorApproval(
  client: { enableVisitorApprove?: boolean; timezoneOffsetMinutes: number },
  registration: { visitorApprovalRequired?: boolean; isVisitor?: boolean },
) {
  return Boolean(
    client.enableVisitorApprove &&
    registration.visitorApprovalRequired &&
    registration.isVisitor,
  );
}

/** Copiado na solicitação e no aceite. Alterar esta versão não reescreve históricos. */
export function visitorApprovalTerm(
  clientName: string,
  visitor: VisitorApprovalSnapshot,
) {
  return `Declaro ser maior de idade e estar cadastrado(a) no bloco ${visitor.block ?? '—'}, unidade ${visitor.unit ?? '—'}. Confirmo que reconheço ${visitor.name} e autorizo a habilitação de seu acesso facial como visitante vinculado a esta unidade em ${clientName}, observadas as demais regras de acesso. Estou ciente de que este aceite, minha identificação, a data e a versão do termo serão registrados para auditoria. Posso revogar minha autorização pelo mesmo link de gestão ou solicitar a revogação ao administrador do cliente.`;
}
