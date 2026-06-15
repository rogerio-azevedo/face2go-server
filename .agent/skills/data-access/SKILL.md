---
name: data-access
description: >
  Padrões de acesso a dados do backend Face2GO. Drizzle/Postgres, Mongoose/Mongo,
  repositórios, migrations e coexistência OLTP vs event log.
metadata:
  author: project-team
  version: "1.0.0"
---

# Data Access — Face2GO Backend

## Visão geral dos bancos

| Banco | Driver | Uso |
|-------|--------|-----|
| **PostgreSQL** | Drizzle + postgres.js | Domínio transacional (usuários, escolas, alunos, leitores, permissões) |
| **MongoDB** | Mongoose | Event log append-only (acessos faciais, acessos LPR) |

**Regra:** dados que precisam de transação, FK e consistência → Postgres. Histórico de alto volume, consultas por período → Mongo.

---

## 1. Drizzle — schema e migrations

### Schema

- Um arquivo por módulo em `src/database/schema/*.ts`.
- Export central em `src/database/schema/index.ts`.
- Nomes de tabelas em **snake_case** no banco, camelCase no TypeScript.

### Migrations

- Geradas em `drizzle/` via `drizzle-kit`.
- Config: `drizzle.config.ts` na raiz.
- Scripts:
  - `pnpm db:migrate` — aplica migrations
  - `pnpm db:studio` — Drizzle Studio
  - `pnpm db:seed` — seed local

### Conexão

- `DatabaseService` (`@Global`) expõe `db: AppDb`.
- URL via `DATABASE_URL` (pooled em runtime).
- Migrations usam URL unpooled (`DATABASE_URL_UNPOOLED`).

---

## 2. Queries (legado) vs Repositórios (alvo)

### Padrão legado — query modules

```typescript
// database/queries/clients.queries.ts
export async function findClientById(db: AppDb, id: string) {
  return db.select().from(clients).where(eq(clients.id, id)).limit(1);
}
```

Services importam funções diretamente. **Problema:** difícil mockar, arquivos monolíticos (>500 linhas).

### Padrão alvo — repositório fino

```typescript
// database/repositories/clients.repository.ts
@Injectable()
export class ClientsRepository {
  constructor(private readonly database: DatabaseService) {}

  findById(id: string) {
    return clientsQueries.findClientById(this.database.db, id);
  }

  listByCompany(companyId: string) {
    return clientsQueries.listClientsByCompany(this.database.db, companyId);
  }
}
```

**Regras:**
- Repositório **não** contém regra de negócio — só acesso a dados.
- Repositório é `@Injectable()` e registrado no módulo da feature.
- Services recebem repositório via DI, nunca importam queries diretamente (em código novo).
- Ao refatorar query files grandes, extrair repositório por subdomínio.

---

## 3. Multi-tenant nas queries

Toda listagem/busca de dados de negócio deve incluir filtro de tenant:

```typescript
// Correto — operador de empresa
.where(and(
  eq(students.clientId, user.clientId),
  eq(students.isActive, true),
))

// Correto — super admin com filtro explícito
.where(eq(students.clientId, requestedClientId))

// ERRADO — sem filtro de tenant
.where(eq(students.isActive, true))
```

Helpers comuns:
- `user.companyId` — escopo de empresa
- `user.clientId` — escopo de cliente/escola
- Validar que `contextId` pertence ao tenant antes de operar

---

## 4. MongoDB — event log

### Schemas Mongoose

- `src/accesses/access.schema.ts` — acessos faciais
- `src/lpr-accesses/lpr-access.schema.ts` — acessos LPR

### Padrão de gravação

Services de domínio (Postgres) **emitem eventos** para services de acesso Mongo:

```typescript
await this.accessesService.recordAccess({
  companyId,
  clientId,
  personId,
  // ...
});
```

### Consultas

- Filtros por `companyId`, `clientId`, período (`createdAt`).
- Índices definidos nos schemas Mongoose.
- Paginação por cursor ou skip/limit conforme volume.

---

## 5. Transações

Use transações Drizzle para operações que alteram múltiplas tabelas:

```typescript
await this.database.db.transaction(async (tx) => {
  await studentsQueries.create(tx, data);
  await faceSyncQueries.enqueueSync(tx, studentId);
});
```

**Quando usar:**
- Criar entidade + vínculos + side effects atômicos
- Operações de convite/cadastro com múltiplas tabelas
- Nunca deixar Postgres inconsistente por falha parcial

---

## 6. Checklist de nova entidade

- [ ] Tabela Drizzle em `database/schema/<entidade>.ts`
- [ ] Migration gerada e testada
- [ ] Queries ou repositório criado
- [ ] Filtro de tenant em todas as queries de listagem
- [ ] Service usa repositório (não query direta, em código novo)
- [ ] Schema Zod + DTO para endpoints HTTP
- [ ] Tipos expostos via OpenAPI (automático com nestjs-zod)
