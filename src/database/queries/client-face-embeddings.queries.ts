import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import {
  clientFaceEmbeddings,
  clientMembers,
  registrations,
  responsibles,
  students,
} from '../schema';

export type GalleryFace = {
  faceId: number;
  name: string;
  photoKey: string;
  blocked: boolean;
};

export type StoredFaceEmbedding = {
  faceId: number;
  photoKey: string;
  blocked: boolean;
  embedding: number[];
};

function asEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    out.push(item);
  }
  return out;
}

function addGalleryFace(
  into: Map<number, GalleryFace>,
  faceId: number | null,
  name: string | null | undefined,
  photoKey: string | null,
  blocked: boolean,
): void {
  if (faceId == null || !photoKey || into.has(faceId)) return;
  into.set(faceId, {
    faceId,
    name: name?.trim() ?? '',
    photoKey,
    blocked,
  });
}

/** Fotos do cliente que podem estar no leitor. Registration entra primeiro (mercado). */
export async function listClientGalleryFaces(
  db: AppDb,
  clientId: string,
): Promise<GalleryFace[]> {
  const into = new Map<number, GalleryFace>();
  const [registrationRows, memberRows, studentRows, responsibleRows] =
    await Promise.all([
      db
        .select({
          faceId: registrations.faceId,
          name: registrations.name,
          photoKey: registrations.faceImageKey,
          status: registrations.status,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.clientId, clientId),
            isNotNull(registrations.faceId),
            isNotNull(registrations.faceImageKey),
            inArray(registrations.status, ['approved', 'blocked']),
            or(
              eq(registrations.isActive, true),
              eq(registrations.status, 'blocked'),
            ),
          ),
        ),
      db
        .select({
          faceId: clientMembers.faceId,
          name: clientMembers.name,
          photoKey: clientMembers.photoKey,
          blockedAt: clientMembers.blockedAt,
        })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            isNotNull(clientMembers.faceId),
            isNotNull(clientMembers.photoKey),
            or(
              eq(clientMembers.isActive, true),
              isNotNull(clientMembers.blockedAt),
            ),
          ),
        ),
      db
        .select({
          faceId: students.faceId,
          name: students.name,
          photoKey: students.photoKey,
          blockedAt: students.blockedAt,
        })
        .from(students)
        .where(
          and(
            eq(students.clientId, clientId),
            isNotNull(students.faceId),
            isNotNull(students.photoKey),
            or(eq(students.isActive, true), isNotNull(students.blockedAt)),
          ),
        ),
      db
        .select({
          faceId: responsibles.faceId,
          name: responsibles.name,
          photoKey: responsibles.photoKey,
          blockedAt: responsibles.blockedAt,
        })
        .from(responsibles)
        .where(
          and(
            eq(responsibles.clientId, clientId),
            isNotNull(responsibles.faceId),
            isNotNull(responsibles.photoKey),
            or(
              eq(responsibles.isActive, true),
              isNotNull(responsibles.blockedAt),
            ),
          ),
        ),
    ]);

  for (const row of registrationRows) {
    addGalleryFace(
      into,
      row.faceId,
      row.name,
      row.photoKey,
      row.status === 'blocked',
    );
  }
  for (const row of memberRows) {
    addGalleryFace(
      into,
      row.faceId,
      row.name,
      row.photoKey,
      row.blockedAt != null,
    );
  }
  for (const row of studentRows) {
    addGalleryFace(
      into,
      row.faceId,
      row.name,
      row.photoKey,
      row.blockedAt != null,
    );
  }
  for (const row of responsibleRows) {
    addGalleryFace(
      into,
      row.faceId,
      row.name,
      row.photoKey,
      row.blockedAt != null,
    );
  }
  return [...into.values()];
}

export async function listEmbeddingsByClient(
  db: AppDb,
  clientId: string,
): Promise<StoredFaceEmbedding[]> {
  const rows = await db
    .select({
      faceId: clientFaceEmbeddings.faceId,
      photoKey: clientFaceEmbeddings.photoKey,
      blocked: clientFaceEmbeddings.blocked,
      embedding: clientFaceEmbeddings.embedding,
    })
    .from(clientFaceEmbeddings)
    .where(eq(clientFaceEmbeddings.clientId, clientId));
  const out: StoredFaceEmbedding[] = [];
  for (const row of rows) {
    const embedding = asEmbedding(row.embedding);
    if (!embedding) continue;
    out.push({
      faceId: row.faceId,
      photoKey: row.photoKey,
      blocked: row.blocked,
      embedding,
    });
  }
  return out;
}

export async function upsertFaceEmbedding(
  db: AppDb,
  input: {
    clientId: string;
    faceId: number;
    photoKey: string;
    blocked: boolean;
    embedding: number[];
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(clientFaceEmbeddings)
    .values({
      clientId: input.clientId,
      faceId: input.faceId,
      photoKey: input.photoKey,
      blocked: input.blocked,
      embedding: input.embedding,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [clientFaceEmbeddings.clientId, clientFaceEmbeddings.faceId],
      set: {
        photoKey: input.photoKey,
        blocked: input.blocked,
        embedding: input.embedding,
        updatedAt: now,
      },
    });
}

export async function updateFaceEmbeddingBlocked(
  db: AppDb,
  clientId: string,
  faceId: number,
  blocked: boolean,
): Promise<void> {
  await db
    .update(clientFaceEmbeddings)
    .set({ blocked, updatedAt: new Date() })
    .where(
      and(
        eq(clientFaceEmbeddings.clientId, clientId),
        eq(clientFaceEmbeddings.faceId, faceId),
      ),
    );
}
