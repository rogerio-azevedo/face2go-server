/** Subconjunto do contexto do leitor usado ao persistir acessos (evita import circular). */
export type ReaderStreamContextLike = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  /** `ip:port` do leitor — usado para completar `SnapPath` relativo. */
  host?: string;
  direction?: 'in' | 'out' | null;
};
