/**
 * Gera openapi.json a partir do AppModule (sem precisar do servidor HTTP rodando).
 *
 * Uso: pnpm openapi:generate
 */
import 'reflect-metadata';

import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyOpenApiEnvDefaults } from '../src/scripts/openapi-env.defaults';

config();
applyOpenApiEnvDefaults();

async function main(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const { cleanupOpenApiDoc } = await import('nestjs-zod');
  const { AppModule } = await import('../dist/app.module');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Face2go API')
    .setDescription('Backend NestJS da plataforma Face2go')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const outPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  console.log(`OpenAPI gerado em ${outPath}`);

  await app.close();
}

main().catch((err: unknown) => {
  console.error('Falha ao gerar OpenAPI:', err);
  process.exit(1);
});
