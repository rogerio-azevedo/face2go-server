---
name: project-conventions
description: >
  Convenções obrigatórias do backend Face2GO (NestJS). Consultar antes de criar
  módulos, controllers, services, DTOs ou queries. Define arquitetura modular,
  validação Zod, multi-tenant, auth e error handling.
metadata:
  author: project-team
  version: "2.0.0"
---

# Project Conventions — Face2GO Backend (NestJS)

## Contexto do Domínio

**Face2GO** é um SaaS **multi-tenant** para controle de acesso facial e LPR em escolas, empresas e condomínios.

Hierarquia:

- **Super Admin**: operação global da plataforma.
- **Empresa (`companies`)**: tenant raiz — agrupa clientes e usuários internos.
- **Cliente (`clients`)**: unidade operacional (escola, clínica, condomínio, etc.).
- **Leitor facial / Câmera LPR**: dispositivos vinculados a um cliente.
- **Face / Veículo**: registros biométricos e placas sincronizados com dispositivos.

### Isolamento multi-tenant

- Toda query de dados de negócio DEVE filtrar por **`companyId`** e/ou **`clientId`**, conforme o papel do usuário.
- **Super admin** pode cruzar empresas; demais papéis apenas dentro do escopo da sessão JWT.
- Nunca retornar linhas de outro tenant por esquecimento de `WHERE`.
- Permissões granulares (`PermissionsService`) são checadas **dentro dos services**, não só na UI.

---

## 1. Arquitetura em camadas

| Camada | Pasta | Responsabilidade |
|--------|-------|------------------|
| HTTP | `*.controller.ts` | Rotas finas: recebe DTO, chama service, retorna resposta |
| Use-case / Orquestração | `*.service.ts` | Regras de negócio, orquestra repositórios e integrações |
| Repositório | `*.repository.ts` | Encapsula queries Drizzle/Mongoose; testável via injeção |
| Queries | `database/queries/*.queries.ts` | Funções puras de acesso a dados (legado — migrar para repositório) |
| Validação | `validation/*.schema.ts` + `validation/dto/*.dto.ts` | Schemas Zod + DTOs HTTP via `createZodDto` |
| Integrações | `integrations/*` | Clients HTTP, parsers, listeners de terceiros (Intelbras, etc.) |

**Fluxo:** `Controller (DTO Zod)` → `Service` → `Repository` → `Query/ORM`

### Limites de tamanho

- **Controllers:** ≤ 150 linhas (ideal ≤ 80).
- **Services:** ≤ 300 linhas — se crescer, extrair sub-services ou use-cases.
- **Query files / Repositories:** ≤ 400 linhas — dividir por subdomínio.
- **Arquivos > 300 linhas** exigem justificativa e plano de split.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Framework | **NestJS 11** |
| Linguagem | **TypeScript 5** (strict onde possível) |
| ORM transacional | **Drizzle ORM** + **PostgreSQL** |
| Event log | **Mongoose** + **MongoDB** (acessos faciais/LPR) |
| Validação HTTP | **Zod 4** + **nestjs-zod** (`createZodDto`, `ZodValidationPipe`) |
| Auth | **Passport JWT** + guards globais |
| Docs API | **Swagger** + OpenAPI JSON em `/api/docs-json` |
| Pacotes | **pnpm** |

### Validação — regra única

1. Schema Zod em `src/validation/<domínio>.schema.ts`.
2. DTO HTTP em `src/validation/dto/<domínio>.dto.ts` com `createZodDto(schema)`.
3. **Nunca** usar `@Body() body: unknown` ou `Record<string, unknown>` em controllers.
4. **Não** usar `class-validator` — migrado para Zod.
5. Validação de env continua em `src/config/env.validation.ts`.

```typescript
// validation/dto/students.dto.ts
import { createZodDto } from 'nestjs-zod';
import { createStudentSchema } from '../students.schema';

export class CreateStudentDto extends createZodDto(createStudentSchema) {}
```

```typescript
// students.controller.ts
@Post()
create(@Body() dto: CreateStudentDto) {
  return this.studentsService.create(dto);
}
```

---

## 3. Autenticação e autorização

### Guards globais (ordem)

1. `JwtAuthGuard` — JWT obrigatório; bypass com `@Public()`.
2. `ContextRequiredGuard` — bloqueia `contextType === 'identity'` salvo `@AllowIdentity()`.
3. `RolesGuard` — checa `@Roles(...)` contra `user.role`.

### Decorators

- `@Public()` — rotas sem auth (login, cadastro público).
- `@AllowIdentity()` — permite JWT de identidade (pré seleção de contexto).
- `@Roles('company_admin', ...)` — RBAC por papel efetivo.
- `@CurrentUser()` — injeta `JwtPayload`.

### Fluxo JWT multi-contexto

1. `POST /auth/login` → JWT **identity** (curto).
2. `POST /auth/select-context` → JWT de sessão com `role`, `companyId`, `clientId`.
3. Demais endpoints exigem contexto selecionado.

---

## 4. Estrutura de pastas

```
src/
├── main.ts                    # Bootstrap, Swagger, ZodValidationPipe global
├── app.module.ts
├── config/                    # env.validation.ts
├── common/
│   ├── decorators/
│   ├── filters/               # HttpExceptionFilter global
│   ├── guards/
│   └── interceptors/
├── database/
│   ├── schema/                # Drizzle tables
│   ├── queries/               # Funções puras (legado)
│   ├── repositories/          # Classes injetáveis (alvo)
│   └── database.service.ts
├── validation/
│   ├── *.schema.ts            # Schemas Zod de domínio
│   └── dto/                   # DTOs HTTP (createZodDto)
├── integrations/
│   └── intelbras/             # Clients, parsers, listeners
└── [feature]/                 # Um módulo Nest por bounded context
    ├── *.module.ts
    ├── *.controller.ts
    ├── *.service.ts
    └── *.repository.ts        # quando aplicável
```

---

## 5. Error handling e logging

- **HttpExceptionFilter** global formata todas as respostas de erro de forma consistente.
- Use exceções Nest (`BadRequestException`, `ForbiddenException`, etc.) nos services.
- **Logger** estruturado via `AppLogger` — não usar `console.log/error` em produção.
- Mensagens de erro para o cliente devem ser em **português** e seguras (sem stack trace).

---

## 6. Testes

- **Unitários:** services e use-cases com mocks de repositório.
- **Prioridade de cobertura:** auth, permissions, pickup-authorizations, face-sync.
- **E2E:** health + fluxos críticos com env de teste completo.
- Rodar `pnpm test` e `pnpm test:e2e` antes de PR.

---

## 7. OpenAPI e contrato com clientes

- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api/docs-json`
- Script: `pnpm openapi:export` gera `openapi.json` na raiz.
- Web e mobile geram tipos via `openapi-typescript` a partir desse JSON.
- **Não duplicar tipos manualmente** nos clientes — regenerar após mudanças na API.

---

## 8. Checklist antes de commitar

- [ ] Queries com filtro de tenant quando não for super admin?
- [ ] Entrada validada com DTO Zod no controller?
- [ ] Service ≤ 300 linhas ou split justificado?
- [ ] Novo schema tem DTO correspondente em `validation/dto/`?
- [ ] Testes para regras de negócio novas?
- [ ] `pnpm lint` e `pnpm build` passam?
- [ ] OpenAPI exportado se endpoints/DTOs mudaram?
