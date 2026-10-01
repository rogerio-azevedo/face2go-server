import { Injectable, Logger } from '@nestjs/common';

import { mapWithConcurrency } from '../common/concurrency/map-with-concurrency';
import { DatabaseService } from '../database/database.service';
import {
  listClientGalleryFaces,
  listEmbeddingsByClient,
  updateFaceEmbeddingBlocked,
  upsertFaceEmbedding,
  type GalleryFace,
  type StoredFaceEmbedding,
} from '../database/queries/client-face-embeddings.queries';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  FACE_COMPARE_FAILED_NOTE,
  appendFaceMatchNote,
  bestGalleryMatch,
  isSimilarFaceReaderMessage,
  similarGalleryNote,
} from './face-match.util';

const GALLERY_CONCURRENCY = 4;

@Injectable()
export class FaceMatchService {
  private readonly log = new Logger(FaceMatchService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
  ) {}

  /** Grava o vetor da foto que acabou de entrar no sync. Falha não derruba o sync. */
  async rememberPhoto(input: {
    clientId: string;
    faceId: number;
    photoKey?: string;
    imageBuffer: Buffer;
    blocked: boolean;
  }): Promise<void> {
    if (!input.photoKey) return;
    try {
      const { embedJpeg } = await import('./face-embedder');
      const embedding = await embedJpeg(input.imageBuffer);
      if (!embedding) {
        this.log.warn(
          `Sem rosto para gravar embedding client=${input.clientId} faceId=${input.faceId}`,
        );
        return;
      }
      await upsertFaceEmbedding(this.database.db, {
        clientId: input.clientId,
        faceId: input.faceId,
        photoKey: input.photoKey,
        blocked: input.blocked,
        embedding,
      });
    } catch (error) {
      this.log.warn(
        `Falha ao gravar embedding client=${input.clientId} faceId=${input.faceId}: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Quando o leitor recusa por duplicata e não diz quem, compara a foto
   * com a galeria do cliente e anexa o nome. Não libera o cadastro.
   */
  async annotateUnnamedDuplicates(input: {
    clientId: string;
    faceId: number;
    imageBuffer: Buffer;
    messages: Array<string | null>;
    collidingFaceIds: Array<number | null>;
  }): Promise<Array<string | null>> {
    const unnamed = input.messages.some(
      (message, index) =>
        message != null &&
        input.collidingFaceIds[index] == null &&
        isSimilarFaceReaderMessage(message),
    );
    if (!unnamed) return input.messages;

    let note = FACE_COMPARE_FAILED_NOTE;
    try {
      note = await this.compareNote(
        input.clientId,
        input.faceId,
        input.imageBuffer,
      );
    } catch (error) {
      this.log.warn(
        `Falha ao comparar face client=${input.clientId} faceId=${input.faceId}: ${errorMessage(error)}`,
      );
    }

    return input.messages.map((message, index) => {
      if (
        message == null ||
        input.collidingFaceIds[index] != null ||
        !isSimilarFaceReaderMessage(message)
      ) {
        return message;
      }
      return appendFaceMatchNote(message, note);
    });
  }

  /** Completa a galeria do cliente (usado no sync e no backfill). */
  async ensureClientGallery(clientId: string): Promise<number> {
    const gallery = await this.loadGallery(clientId);
    return gallery.length;
  }

  private async compareNote(
    clientId: string,
    faceId: number,
    imageBuffer: Buffer,
  ): Promise<string> {
    const gallery = await this.loadGallery(clientId);
    const { embedJpeg } = await import('./face-embedder');
    const probe = await embedJpeg(imageBuffer);
    if (!probe) return FACE_COMPARE_FAILED_NOTE;
    return similarGalleryNote(bestGalleryMatch(probe, gallery, faceId));
  }

  private async loadGallery(clientId: string): Promise<
    Array<{
      faceId: number;
      name: string;
      blocked: boolean;
      embedding: number[];
    }>
  > {
    const db = this.database.db;
    const [faces, stored] = await Promise.all([
      listClientGalleryFaces(db, clientId),
      listEmbeddingsByClient(db, clientId),
    ]);
    const byFace = new Map<number, StoredFaceEmbedding>(
      stored.map((row) => [row.faceId, row]),
    );

    const staleBlocked = faces.filter((face) => {
      const current = byFace.get(face.faceId);
      return (
        current != null &&
        current.photoKey === face.photoKey &&
        current.blocked !== face.blocked
      );
    });
    await Promise.all(
      staleBlocked.map((face) =>
        updateFaceEmbeddingBlocked(db, clientId, face.faceId, face.blocked),
      ),
    );

    const missing = faces.filter(
      (face) => byFace.get(face.faceId)?.photoKey !== face.photoKey,
    );
    await mapWithConcurrency(missing, GALLERY_CONCURRENCY, async (face) => {
      const embedding = await this.embedStoredPhoto(clientId, face);
      if (!embedding) return;
      byFace.set(face.faceId, {
        faceId: face.faceId,
        photoKey: face.photoKey,
        blocked: face.blocked,
        embedding,
      });
    });

    return faces.flatMap((face) => {
      const current = byFace.get(face.faceId);
      if (!current || current.photoKey !== face.photoKey) return [];
      return [
        {
          faceId: face.faceId,
          name: face.name,
          blocked: face.blocked,
          embedding: current.embedding,
        },
      ];
    });
  }

  private async embedStoredPhoto(
    clientId: string,
    face: GalleryFace,
  ): Promise<number[] | null> {
    try {
      const object = await this.r2.getObjectBytes(face.photoKey);
      const { embedJpeg } = await import('./face-embedder');
      const embedding = await embedJpeg(object.buffer);
      if (!embedding) {
        this.log.warn(
          `Sem rosto na galeria client=${clientId} faceId=${face.faceId}`,
        );
        return null;
      }
      await upsertFaceEmbedding(this.database.db, {
        clientId,
        faceId: face.faceId,
        photoKey: face.photoKey,
        blocked: face.blocked,
        embedding,
      });
      return embedding;
    } catch (error) {
      this.log.warn(
        `Foto da galeria ignorada client=${clientId} faceId=${face.faceId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
