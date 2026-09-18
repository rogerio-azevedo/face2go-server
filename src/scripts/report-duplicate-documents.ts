/**
 * Relatório read-only de CPF/CNPJ duplicados em membros e cadastros pendentes.
 *
 * Uso:
 *   pnpm db:report-duplicate-documents
 */
import 'dotenv/config';

import {
  createPostgresClient,
  endPostgresPool,
} from '../database/postgres-connection';

function maskDocument(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  }
  return `${digits.slice(0, 3)}…`;
}

async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!url) {
    console.error('Defina DATABASE_URL (ou variante unpooled) no .env.');
    process.exit(1);
  }

  const sql = createPostgresClient(url);

  try {
    const members = await sql.query<{
      client_name: string;
      client_type: string;
      doc: string;
      qty: number;
      active_qty: number;
      names: string[];
    }>(`
      SELECT
        c.name AS client_name,
        c.type AS client_type,
        regexp_replace(cm.document, '\\D', '', 'g') AS doc,
        COUNT(*)::int AS qty,
        COUNT(*) FILTER (WHERE cm.is_active)::int AS active_qty,
        array_agg(cm.name ORDER BY cm.created_at) AS names
      FROM client_members cm
      JOIN clients c ON c.id = cm.client_id
      WHERE cm.document IS NOT NULL
        AND regexp_replace(cm.document, '\\D', '', 'g') <> ''
      GROUP BY c.id, c.name, c.type, regexp_replace(cm.document, '\\D', '', 'g')
      HAVING COUNT(*) > 1
      ORDER BY qty DESC, c.name
    `);

    const pending = await sql.query<{
      client_name: string;
      client_type: string;
      doc: string;
      qty: number;
      names: string[];
    }>(`
      SELECT
        c.name AS client_name,
        c.type AS client_type,
        regexp_replace(r.document, '\\D', '', 'g') AS doc,
        COUNT(*)::int AS qty,
        array_agg(COALESCE(r.name, '(sem nome)') ORDER BY r.submitted_at) AS names
      FROM registrations r
      JOIN clients c ON c.id = r.client_id
      WHERE r.submitted_at IS NOT NULL
        AND r.status = 'draft'
        AND r.document IS NOT NULL
        AND regexp_replace(r.document, '\\D', '', 'g') <> ''
      GROUP BY c.id, c.name, c.type, regexp_replace(r.document, '\\D', '', 'g')
      HAVING COUNT(*) > 1
      ORDER BY qty DESC, c.name
    `);

    const pendingVsMember = await sql.query<{
      client_name: string;
      client_type: string;
      doc: string;
      pending_qty: number;
      member_qty: number;
    }>(`
      SELECT
        c.name AS client_name,
        c.type AS client_type,
        regexp_replace(r.document, '\\D', '', 'g') AS doc,
        COUNT(DISTINCT r.id)::int AS pending_qty,
        COUNT(DISTINCT cm.id)::int AS member_qty
      FROM registrations r
      JOIN clients c ON c.id = r.client_id
      JOIN client_members cm
        ON cm.client_id = r.client_id
       AND regexp_replace(cm.document, '\\D', '', 'g')
         = regexp_replace(r.document, '\\D', '', 'g')
      WHERE r.submitted_at IS NOT NULL
        AND r.status = 'draft'
        AND r.document IS NOT NULL
        AND regexp_replace(r.document, '\\D', '', 'g') <> ''
      GROUP BY c.id, c.name, c.type, regexp_replace(r.document, '\\D', '', 'g')
      ORDER BY pending_qty DESC, c.name
    `);

    const crossClient = await sql.query<{
      doc: string;
      client_qty: number;
      row_qty: number;
      clients: string[];
    }>(`
      SELECT
        regexp_replace(cm.document, '\\D', '', 'g') AS doc,
        COUNT(DISTINCT cm.client_id)::int AS client_qty,
        COUNT(*)::int AS row_qty,
        array_agg(DISTINCT c.name ORDER BY c.name) AS clients
      FROM client_members cm
      JOIN clients c ON c.id = cm.client_id
      WHERE cm.document IS NOT NULL
        AND length(regexp_replace(cm.document, '\\D', '', 'g')) IN (11, 14)
      GROUP BY regexp_replace(cm.document, '\\D', '', 'g')
      HAVING COUNT(DISTINCT cm.client_id) > 1
      ORDER BY client_qty DESC, row_qty DESC
    `);

    console.log('Membros com o mesmo documento no mesmo cliente:');
    if (members.rows.length === 0) {
      console.log('  (nenhum)');
    } else {
      for (const row of members.rows) {
        console.log(
          `  ${row.client_name} [${row.client_type}] ${maskDocument(row.doc)} ×${row.qty} (ativos: ${row.active_qty}) — ${row.names.join(' | ')}`,
        );
      }
    }

    console.log('\nCadastros pendentes duplicados no mesmo cliente:');
    if (pending.rows.length === 0) {
      console.log('  (nenhum)');
    } else {
      for (const row of pending.rows) {
        console.log(
          `  ${row.client_name} [${row.client_type}] ${maskDocument(row.doc)} ×${row.qty} — ${row.names.join(' | ')}`,
        );
      }
    }

    console.log('\nPendentes cujo documento já existe em membro do mesmo cliente:');
    if (pendingVsMember.rows.length === 0) {
      console.log('  (nenhum)');
    } else {
      for (const row of pendingVsMember.rows) {
        console.log(
          `  ${row.client_name} [${row.client_type}] ${maskDocument(row.doc)} pendentes=${row.pending_qty} membros=${row.member_qty}`,
        );
      }
    }

    console.log('\nMesmo documento em mais de um cliente (informativo):');
    if (crossClient.rows.length === 0) {
      console.log('  (nenhum)');
    } else {
      for (const row of crossClient.rows) {
        console.log(
          `  ${maskDocument(row.doc)} — ${row.client_qty} clientes, ${row.row_qty} fichas (${row.clients.join(', ')})`,
        );
      }
    }

    console.log(
      `\nResumo: ${members.rows.length} grupos de membros, ${pending.rows.length} grupos pendentes, ${pendingVsMember.rows.length} pendente×membro, ${crossClient.rows.length} cross-cliente.`,
    );
  } finally {
    await endPostgresPool(sql);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
