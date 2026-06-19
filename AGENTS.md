# face2go-server (NestJS 11)

## Stack

NestJS 11 · TypeScript 5 · Drizzle (Postgres) · Mongoose (Mongo) · Zod 4 (`nestjs-zod`) · Passport JWT · Swagger · pnpm.

## Comandos

- `pnpm start:dev` – API em watch
- `pnpm test` / `pnpm test:e2e`
- `pnpm lint` · `pnpm build`
- `pnpm openapi:export` – regenera `openapi.json`

## Antes de editar (Skills)

- Antes de criar módulo / controller / service / repository / DTO → leia **`.agent/skills/project-conventions/SKILL.md`**.
- Antes de escrever query, repository ou alterar schema Drizzle → leia **`.agent/skills/data-access/SKILL.md`**.

## Não faça

- `class-validator` (foi migrado para Zod).
- Queries sem filtro de tenant (`companyId` / `clientId`) fora de super-admin.
- Tipos manuais duplicados nos clientes web/mobile — usam OpenAPI gerado.
