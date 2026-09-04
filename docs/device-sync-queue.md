# Fila de sync de dispositivos (faces + LPR)

Documento de referência para `face2go-server` e `meuiot-server`.

Status: desenho aprovado. Face2Go implementa primeiro; MeuIOT porta o mesmo contrato.

---

## 1. Problema

Com **3 clientes** o `face2go-server` (2 vCPU / 2 GB) já satura quando um usuário dispara sync em lote: CPU a 90–100%, p95 de transação ~12 s, FaceListener com timeout/401. O sync **roda na request HTTP** (POST ou SSE). Dez cliques = dez downloads R2 + compressão + conexão aberta no mesmo event loop dos listeners.

O gate de concorrência (`GLOBAL_FACE_SYNC_LIMIT = 4`) só serializa writes no equipamento. Não protege a API.

O `device_sync_status` / `lpr_sync_status` é **global por entidade**. Um leitor novo (ou queimado e trocado) fica “já synced” no sistema e vazio no hardware.

No MeuIOT o write de face também é síncrono (`syncFaceToDevice` / `syncBatchFacesToDevice` em `facial-face-sync.ts`).

---

## 2. Decisão

| Escolha | Agora | Depois (100+ clientes / várias instâncias) |
| --- | --- | --- |
| Fila | Tabela no **mesmo Postgres** | Redis/Bull só se houver disputa entre instâncias ou milhares de jobs/min |
| Worker | Mesmo repo, teto **2** jobs, **1 write por dispositivo** | Segundo processo `node dist/worker` no Beanstalk |
| Microsserviço | Não | Só se API e ingestão precisarem escalar separado |

Fila numa tabela resolve o que mata a API: HTTP devolve **202 + jobId** e o trabalho acontece com backpressure. `FOR UPDATE SKIP LOCKED` + `dedupe_key` (único enquanto `queued`/`running`) fazem 10 cliques virarem **1 job**.

O que a tabela **não** resolve sozinha: worker no mesmo processo com teto alto ainda compete com o FaceListener. Por isso o teto fica em 2.

---

## 3. Modelo

### 3.1 Progresso por dispositivo (fonte de verdade)

- Faces: `person_reader_sync` (`client_id`, `face_id`, `reader_id`, `status`, `error`, `synced_at`).
- LPR: `vehicle_camera_sync` (`client_id`, `vehicle_id`, `camera_id`, `status`, `error`, `synced_at`).

`device_sync_status` / `lpr_sync_status` na entidade é **agregado**: synced só se todos os dispositivos ativos estiverem synced.

### 3.2 Fila

`device_sync_jobs`:

| Campo | Uso |
| --- | --- |
| `kind` | `face.person` \| `face.reader` \| `lpr.vehicle` \| `lpr.camera` |
| `client_id` | Tenant |
| `target_id` | Pessoa/veículo ou leitor/câmera |
| `force` | Incremental (`false`) vs reenviar todos (`true`) |
| `status` | `queued` \| `running` \| `done` \| `failed` |
| `dedupe_key` | Único entre jobs ativos |
| `payload` | JSON (faceId, photoKey, entityKind, readerIds, …) — **sem** buffer de imagem |
| `processed` / `total` | Progresso para UI |
| `created_by` | Quem disparou |

Claim:

```sql
UPDATE device_sync_jobs
SET status = 'running', started_at = now()
WHERE id = (
  SELECT id FROM device_sync_jobs
  WHERE status = 'queued'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`dedupe_key` sugerido:

- `face.person:{clientId}:{entityKind}:{entityId}`
- `face.reader:{clientId}:{readerId}:incremental` ou `:force`
- `lpr.vehicle:{clientId}:{vehicleId}`
- `lpr.camera:{clientId}:{cameraId}:incremental` ou `:force`

Foto vem do R2 via `photoKey` no worker — não persistir `imageBuffer` no Postgres.

### 3.3 Force vs incremental

- **Sincronizar neste leitor/câmera:** enqueue `force=false` — só pendentes/falhos.
- **Forçar neste leitor/câmera:** apaga linhas `synced` daquele dispositivo + enqueue `force=true`. Não apaga o hardware (wipe continua separado).
- Caso clássico: leitor queimou, equipamento novo no mesmo cadastro — o incremental não reenvia; o force sim.

---

## 4. Contrato HTTP

- `POST .../sync` → **202** `{ jobId, status: "queued" }` (ou o job ativo já existente).
- `GET .../jobs/:jobId` → status + `processed`/`total`.
- SSE de progresso **só observa** a tabela (ping + eventos). Não executa sync na conexão.

Teto do worker: 2 jobs globais; 1 write por leitor/câmera (estender o gate atual ao LPR).

---

## 5. Portar para `meuiot-server`

Repo: `/Users/rogerio/Projetos/MeuIOT/meuiot-server`.

Este documento **completa** o P2.1 de [face-sync-performance.md](./face-sync-performance.md) (tirar o sync do caminho da request). EventEmitter in-process **não** é suficiente — usar a mesma fila Postgres.

Pontos de write hoje (síncronos):

- [`src/http/rest/faceRecognition/facial-face-sync.ts`](../../../MeuIOT/meuiot-server/src/http/rest/faceRecognition/facial-face-sync.ts) — `syncFaceToDevice`, `syncBatchFacesToDevice`
- Clients: `integrations/intelbras/intelbras-facial.client.ts`, `integrations/hikvision/hikvision-facial.client.ts`

O que reaproveitar: Prisma no lugar do Drizzle; mesmas tabelas (`person_reader_sync`, `device_sync_jobs`, `vehicle_camera_sync` se houver LPR).

O que **não** misturar: [PLANO-MULTI-VENDOR-FACIAL-E-ESCALA.md](../../../MeuIOT/meuiot-server/docs/PLANO-MULTI-VENDOR-FACIAL-E-ESCALA.md) trata **ingestão** de eventos (streams). Este doc trata **write** de faces/placas nos dispositivos.

Ordem no MeuIOT: (1) tabela de jobs + HTTP 202, (2) progresso por dispositivo, (3) force por leitor, (4) LPR se aplicável.

---

## 6. Fora de escopo agora

- Redis, BullMQ, microsserviço de sync.
- Separar FaceListener/VideoListener (outro projeto; ajuda em 1000 streams).
- Reescrever clients Intelbras/Hikvision.
