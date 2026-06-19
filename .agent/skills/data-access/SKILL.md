---
name: data-access
description: >
  Padrões de acesso a dados do backend Face2GO. Drizzle/Postgres, Mongoose/Mongo,
  repositórios, migrations (incl. journal _journal.json) e coexistência OLTP vs event log.
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

- Geradas em `drizzle/` via `drizzle-kit` **ou** SQL manual quando o diff for pontual.
- Config: `drizzle.config.ts` na raiz.
- Scripts:
  - `pnpm db:migrate` — aplica migrations
  - `pnpm db:studio` — Drizzle Studio
  - `pnpm db:seed` — seed local

#### Obrigatório: registrar no journal

**Toda migration nova precisa de entrada em `drizzle/meta/_journal.json`.**  
Sem isso, `db:migrate` **não aplica** o `.sql` — o arquivo fica órfão.

Checklist ao criar `drizzle/00XX_nome.sql`:

1. Conferir o último `idx` em `_journal.json` (ex.: `53` → próximo é `54`).
2. Adicionar entrada com `tag` **igual ao nome do arquivo sem `.sql`**:

```json
{
  "idx": 54,
  "version": "7",
  "when": 1779230000000,
  "tag": "0054_pickup_plate_approval",
  "breakpoints": true
}
```

3. `when`: timestamp maior que o da migration anterior (pode ser sequencial, ex. `1779230000000`).
4. Validar: `grep 0054_pickup_plate_approval drizzle/meta/_journal.json` deve retornar a linha do `tag`.

**Preferir `drizzle-kit generate`** quando a alteração vier só do schema — o kit gera SQL + journal.  
Se escrever SQL manual, **sempre** completar o journal na mesma entrega (mesmo PR/commit).

**Anti-padrão:** criar só o `.sql` e esquecer o journal (migration nunca roda em dev/staging/prod).

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
- [ ] **Entrada adicionada em `drizzle/meta/_journal.json`** (tag = nome do `.sql` sem extensão)
- [ ] Queries ou repositório criado
- [ ] Filtro de tenant em todas as queries de listagem
- [ ] Service usa repositório (não query direta, em código novo)
- [ ] Schema Zod + DTO para endpoints HTTP
- [ ] Tipos expostos via OpenAPI (automático com nestjs-zod)
