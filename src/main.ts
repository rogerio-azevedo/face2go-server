import 'reflect-metadata';

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppLogger } from './common/logging/app-logger.service';
import sharp from 'sharp';

sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 50 });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new AppLogger(),
    bodyParser: false,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useBodyParser('json', { limit: '8mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '8mb' });

  app.setGlobalPrefix('api', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ZodValidationPipe());

  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL');

  const relaxCors =
    process.env.NODE_ENV !== 'production' ||
    process.env.FACE2GO_RELAX_CORS === '1';
  const corsOrigin = relaxCors ? true : frontendUrl;
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
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
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  const port = configService.get<number>('PORT') ?? 6200;
  await app.listen(port);
}

bootstrap().catch((err: unknown) => {
  const logger = new AppLogger();
  logger.error(
    'Falha ao iniciar aplicação',
    err instanceof Error ? err.stack : String(err),
    'Bootstrap',
  );
  process.exit(1);
});
