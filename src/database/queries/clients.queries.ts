import { randomBytes, randomUUID } from 'node:crypto';

import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import { slugifyName } from '../../common/utils/slugify';
import type { AppDb } from '../database.types';
import { clients } from '../schema';

const SLUG_MAX = 100;

const DISPLAY_SHORT_CODE_CHARS =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomDisplayShortCode(length = 5): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    const idx = (bytes[i] ?? 0) % DISPLAY_SHORT_CODE_CHARS.length;
    out += DISPLAY_SHORT_CODE_CHARS.charAt(idx);
  }
  return out;
}

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

export type ClientListRow = {
  id: string;
  companyId: string;
  name: string;
  slug: string | null;
  type: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  timezoneOffsetMinutes: number;
  ienhFilialCode: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

async function isClientSlugTaken(
  db: AppDb,
  companyId: string,
  slug: string | null | undefined,
  excludeClientId?: string,
): Promise<boolean> {
  if (!slug) return false;

  if (!excludeClientId) {
    const rows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.slug, slug)))
      .limit(1);
    return rows.length > 0;
  }

  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.companyId, companyId),
        eq(clients.slug, slug),
        ne(clients.id, excludeClientId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function ensureUniqueClientSlug(
  db: AppDb,
  companyId: string,
  baseName: string,
  excludeClientId?: string,
): Promise<string> {
  let candidate = slugifyName(baseName, SLUG_MAX);
  if (!candidate || candidate === 'empresa') {
    candidate = 'cliente';
  }

  if (!(await isClientSlugTaken(db, companyId, candidate, excludeClientId))) {
    return candidate;
  }

  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const truncated = slugifyName(baseName, SLUG_MAX - suffix.length);
    candidate = `${truncated}${suffix}`;
    if (!(await isClientSlugTaken(db, companyId, candidate, excludeClientId))) {
      return candidate;
    }
  }

  throw new Error('Não foi possível gerar um slug único para o cliente.');
}

export async function listClients(
  db: AppDb,
  companyId: string,
): Promise<ClientListRow[]> {
  const rows = await db
    .select({
      id: clients.id,
      companyId: clients.companyId,
      name: clients.name,
      slug: clients.slug,
      type: clients.type,
      cnpj: clients.cnpj,
      phone: clients.phone,
      email: clients.email,
      logoUrl: clients.logoUrl,
      timezoneOffsetMinutes: clients.timezoneOffsetMinutes,
      ienhFilialCode: clients.ienhFilialCode,
      isActive: clients.isActive,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(eq(clients.companyId, companyId))
    .orderBy(asc(clients.name));

  return rows.map((r) => ({
    ...r,
    type: r.type ?? 'other',
  }));
}

export async function getClientById(
  db: AppDb,
  clientId: string,
  companyId: string,
) {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);
  return row;
}

/** Busca cliente apenas pelo ID (ex.: tenant cliente na área escola). */
export async function getClientByIdOnly(db: AppDb, clientId: string) {
  const [row] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  return row;
}

export type ClientCreateInput = {
  companyId: string;
  name: string;
  type: 'office' | 'clinic' | 'condominium' | 'school' | 'other';
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  timezoneOffsetMinutes?: number;
  isActive?: boolean;
};

export async function createClient(db: AppDb, input: ClientCreateInput) {
  const slug = await ensureUniqueClientSlug(db, input.companyId, input.name);
  const now = new Date();

  const [row] = await db
    .insert(clients)
    .values({
      companyId: input.companyId,
      name: input.name,
      slug,
      type: input.type,
      cnpj: input.cnpj ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      logoUrl: input.logoUrl ?? null,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? 0,
      isActive: input.isActive ?? true,
      updatedAt: now,
    })
    .returning();

  return row;
}

export type ClientUpdateInput = Partial<{
  name: string;
  type: 'office' | 'clinic' | 'condominium' | 'school' | 'other';
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  timezoneOffsetMinutes: number;
  ienhFilialCode: number | null;
  isActive: boolean;
}>;

export async function updateClient(
  db: AppDb,
  clientId: string,
  companyId: string,
  input: ClientUpdateInput,
) {
  const existing = await getClientById(db, clientId, companyId);
  if (!existing) {
    return undefined;
  }

  const setPayload: Partial<typeof clients.$inferInsert> = {};

  if (input.name !== undefined) {
    const newName = input.name.trim();
    setPayload.name = newName;
    if (newName !== (existing.name?.trim() ?? '')) {
      setPayload.slug = await ensureUniqueClientSlug(
        db,
        companyId,
        newName,
        clientId,
      );
    }
  }

  if (input.type !== undefined) setPayload.type = input.type;
  if (input.cnpj !== undefined) setPayload.cnpj = input.cnpj;
  if (input.phone !== undefined) setPayload.phone = input.phone;
  if (input.email !== undefined) setPayload.email = input.email;
  if (input.logoUrl !== undefined) setPayload.logoUrl = input.logoUrl;
  if (input.timezoneOffsetMinutes !== undefined) {
    setPayload.timezoneOffsetMinutes = input.timezoneOffsetMinutes;
  }
  if (input.isActive !== undefined) setPayload.isActive = input.isActive;
  if (input.ienhFilialCode !== undefined) {
    setPayload.ienhFilialCode = input.ienhFilialCode;
  }

  if (Object.keys(setPayload).length === 0) {
    return existing;
  }

  setPayload.updatedAt = new Date();

  const [row] = await db
    .update(clients)
    .set(setPayload)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning();

  return row;
}

export async function setClientActive(
  db: AppDb,
  clientId: string,
  companyId: string,
  isActive: boolean,
) {
  const now = new Date();
  const [row] = await db
    .update(clients)
    .set({ isActive, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning();
  return row;
}

export async function validateClientDisplayToken(
  db: AppDb,
  clientId: string,
  token: string,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    return false;
  }
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(eq(clients.id, clientId), eq(clients.displayToken, trimmed)),
    )
    .limit(1);
  return !!row;
}

export async function getDisplayTokenForCompanyClient(
  db: AppDb,
  clientId: string,
  companyId: string,
): Promise<string | null> {
  const row = await getClientById(db, clientId, companyId);
  return row?.displayToken ?? null;
}

/** Garante um token antes de usar o display pela primeira vez. */
export async function ensureDisplayTokenForCompanyClient(
  db: AppDb,
  clientId: string,
  companyId: string,
): Promise<{ token: string } | undefined> {
  const existing = await getClientById(db, clientId, companyId);
  if (!existing) {
    return undefined;
  }
  if (existing.displayToken) {
    return { token: existing.displayToken };
  }
  const token = randomUUID();
  const now = new Date();
  const [updated] = await db
    .update(clients)
    .set({ displayToken: token, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning({ displayToken: clients.displayToken });
  if (!updated?.displayToken) {
    return undefined;
  }
  return { token: updated.displayToken };
}

export async function regenerateDisplayTokenForCompanyClient(
  db: AppDb,
  clientId: string,
  companyId: string,
): Promise<{ token: string } | undefined> {
  const existing = await getClientById(db, clientId, companyId);
  if (!existing) {
    return undefined;
  }
  const token = randomUUID();
  const now = new Date();
  const [updated] = await db
    .update(clients)
    .set({ displayToken: token, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning({ displayToken: clients.displayToken });
  if (!updated?.displayToken) {
    return undefined;
  }
  return { token: updated.displayToken };
}

/** Garante código curto do display (idempotente). */
export async function ensureDisplayShortCodeForCompanyClient(
  db: AppDb,
  clientId: string,
  companyId: string,
): Promise<{ shortCode: string } | undefined> {
  const existing = await getClientById(db, clientId, companyId);
  if (!existing) {
    return undefined;
  }
  if (existing.displayShortCode) {
    return { shortCode: existing.displayShortCode };
  }

  for (let attempt = 0; attempt < 32; attempt++) {
    const code = randomDisplayShortCode(5);
    try {
      const now = new Date();
      const [updated] = await db
        .update(clients)
        .set({ displayShortCode: code, updatedAt: now })
        .where(
          and(
            eq(clients.id, clientId),
            eq(clients.companyId, companyId),
            isNull(clients.displayShortCode),
          ),
        )
        .returning({ displayShortCode: clients.displayShortCode });

      if (updated?.displayShortCode) {
        return { shortCode: updated.displayShortCode };
      }

      const again = await getClientById(db, clientId, companyId);
      if (again?.displayShortCode) {
        return { shortCode: again.displayShortCode };
      }
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) {
        throw err;
      }
    }
  }

  throw new Error('Não foi possível gerar um código curto único para o display.');
}

/** Resolve display público pelo código curto (lookup global). */
export async function getClientByDisplayShortCode(
  db: AppDb,
  shortCodeRaw: string,
): Promise<{ id: string; displayToken: string | null } | undefined> {
  const shortCode = shortCodeRaw.trim();
  if (!shortCode || shortCode.length > 8) {
    return undefined;
  }
  if (!/^[0-9a-zA-Z]+$/.test(shortCode)) {
    return undefined;
  }
  const [row] = await db
    .select({
      id: clients.id,
      displayToken: clients.displayToken,
    })
    .from(clients)
    .where(eq(clients.displayShortCode, shortCode))
    .limit(1);
  return row;
}

export async function listClientsWithIenhFilialByCompany(
  db: AppDb,
  companyId: string,
) {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      ienhFilialCode: clients.ienhFilialCode,
    })
    .from(clients)
    .where(eq(clients.companyId, companyId))
    .orderBy(asc(clients.name));
}

export async function findClientByIenhFilialCode(
  db: AppDb,
  companyId: string,
  filialCode: number,
) {
  const [row] = await db
    .select({
      id: clients.id,
      name: clients.name,
      ienhFilialCode: clients.ienhFilialCode,
    })
    .from(clients)
    .where(
      and(
        eq(clients.companyId, companyId),
        eq(clients.ienhFilialCode, filialCode),
      ),
    )
    .limit(1);
  return row;
}

/** Remove o código de filial de outros clientes da mesma empresa (exclusividade). */
export async function clearIenhFilialCodeFromOtherClients(
  db: AppDb,
  companyId: string,
  filialCode: number,
  exceptClientId: string,
) {
  await db
    .update(clients)
    .set({ ienhFilialCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(clients.companyId, companyId),
        eq(clients.ienhFilialCode, filialCode),
        ne(clients.id, exceptClientId),
      ),
    );
}

export async function updateClientIenhFilialCode(
  db: AppDb,
  clientId: string,
  companyId: string,
  filialCode: number | null,
) {
  const now = new Date();
  const [row] = await db
    .update(clients)
    .set({ ienhFilialCode: filialCode, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .returning({
      id: clients.id,
      name: clients.name,
      ienhFilialCode: clients.ienhFilialCode,
    });
  return row;
}
