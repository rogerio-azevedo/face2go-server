/** Subconjunto do contexto do leitor usado ao persistir acessos (evita import circular). */
export type ReaderStreamContextLike = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
};
