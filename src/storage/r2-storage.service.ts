import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const PUT_EXPIRES_SEC = 15 * 60;
const GET_EXPIRES_SEC = 60 * 60;

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class R2StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('CLOUDFLARE_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>(
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    );
    const bucket = this.configService.get<string>('CLOUDFLARE_R2_BUCKET');

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'R2: defina CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ACCESS_KEY_ID e CLOUDFLARE_R2_SECRET_ACCESS_KEY.',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  extForImageMime(mimeType: string): string {
    const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    const ext = ALLOWED_IMAGE_TYPES[normalized];
    if (!ext) {
      throw new BadRequestException(
        'Tipo de imagem não suportado. Use JPEG, PNG ou WebP.',
      );
    }
    return ext;
  }

  buildFaceDraftKey(
    companyId: string,
    clientId: string,
    registrationId: string,
    ext: string,
  ): string {
    return `${companyId}/${clientId}/${registrationId}/face.${ext}`;
  }

  async createPresignedPutUrl(
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: PUT_EXPIRES_SEC });
  }

  /** Upload direto pelo servidor (evita CORS no navegador → R2). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async createPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: GET_EXPIRES_SEC });
  }

  async assertObjectExists(key: string): Promise<void> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      throw new BadRequestException(
        'Foto não encontrada no armazenamento. Envie a imagem novamente.',
      );
    }
  }

  /** Download binário direto para sync com leitor. */
  async getObjectBytes(key: string): Promise<{ buffer: Buffer; contentType?: string }> {
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = resp.Body;
    if (!body || typeof body === 'string') {
      throw new BadRequestException('Objeto vazio ou inválido no R2.');
    }
    const buf = Buffer.from(await body.transformToByteArray());
    const contentType =
      resp.ContentType?.split(';')[0]?.trim().toLowerCase() ?? undefined;
    return { buffer: buf, contentType };
  }
}
