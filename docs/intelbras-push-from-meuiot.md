# POST Intelbras no Face2Go

Portado do MeuIOT. Hikvision e LPR (`snapManager` de câmera) ficam de fora.

## Contrato

- Identidade = UUID do `facial_readers` no path: `POST /device-events/facial/:readerId`
- `/notification` é legado (só serial)
- `DeviceMode=1` → Post 1.0 (multipart). `DeviceMode=3` → Online/Post 2.0 (JSON). **Não usar `2`**
- Auth 2.0 (`OnlineAuthServer`) fica **off**
- 2.0 só com FW ≥ `20250625` nos modelos SS da lista. Build exato `20250625` pode recusar `jsonv2` — cai para `ContentType=json` ou 1.0
- Target: `API_URL` (prod: `https://api.face2go.com.br`) + path do UUID

## Flags

- Default: stream facial Intelbras **ligada** (Pindorama não some antes do POST)
- Depois de validar POST no UUID: `FACIAL_INTELBRAS_SKIP_STREAM=1`
- Rollback: `FACIAL_INTELBRAS_USE_STREAM=1`

Online Intelbras com skip: último POST (10 min) ou probe `getSoftwareVersion`.

## Clientes

**Pindorama** (`9ccae3b8-d790-4c62-a940-3dd6ffda20a2`) — 9 Intelbras, `177.53.49.53:52002–52011`. ACL só aceita o server de **prod**. `setConfig`/probe do laptop falha. Model/FW não estavam no banco.

| Porta | UUID | Nome |
| --- | --- | --- |
| 52002 | `027dcfc6-da89-4af6-889a-7a9b09a63763` | A1 - Entrada - Esquerdo Frederico |
| 52003 | `c25c964b-9320-41e2-a03b-25dd5e9fe0b8` | A1 - Saída - Esquerdo Frederico |
| 52004 | `28d3aab6-b63f-4c7e-bf2b-b48e28def37b` | A1 - Entrada - Direito Frederico |
| 52005 | `d3638428-0e96-4a88-a52a-d19d971757c2` | A1 - Saída - Direito Frederico |
| 52006 | `382f38ec-3854-4d9f-b3b5-b2d93c94246f` | A1 - Saída - Frederico |
| 52008 | `5fc4a507-0251-4275-950b-dd7bbeebf54f` | A1 - Entrada - Esquerdo Mena |
| 52009 | `13259a15-7c41-4e69-8e0b-670534ceef30` | A1 - Saída - Esquerdo Mena |
| 52010 | `747be206-ae3f-440c-97ad-40db6253221e` | A1 - Entrada - Direito Mena |
| 52011 | `d592056c-819c-44bb-ba47-3cf75d21f241` | A1 - Saída - Direito Mena |

**Royal Mirage Residence** (`ad855d03-c41d-4e1c-a775-e11701635b55`) — 9 Hikvision. Fora do POST. Piscina (`084247fc-…:1545`) offline.

## Depois do deploy em prod

1. `API_URL=https://api.face2go.com.br`
2. Um leitor: **Enviar config** no cadastro Intelbras (ou `POST /api/readers/:id/provision-push`)
3. Validar POST em `/device-events/facial/:readerId`
4. Lote: `POST /api/readers/intelbras-push/provision-all?clientId=9ccae3b8-d790-4c62-a940-3dd6ffda20a2`
5. Só então `FACIAL_INTELBRAS_SKIP_STREAM=1` e restart
