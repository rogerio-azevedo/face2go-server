# Sincronismo de face: diagnóstico medido e plano de correção

Documento de referência para `face2go-server`, `face2go-mobile` e `meuiot-server`.

Status: diagnóstico validado em leitor Intelbras de produção. Plano pronto para execução.

---

## 1. Contexto

Sintoma relatado: ao sincronizar a foto de **uma** pessoa em 9 leitores (cliente Escola, todos Intelbras), o servidor fica travado por um período e o aplicativo fica extremamente lento, voltando ao normal depois.

Hipótese inicial (parcialmente errada, ver seção 4): o custo teria vindo de mover o redimensionamento e a conversão para Base64 do aplicativo para o servidor durante a implementação do Hikvision.

---

## 2. Metodologia

Todos os números abaixo vêm de medição real, não de estimativa.

- **Leitor de teste:** Intelbras de produção (condomínio Escovato), acessado por hostname DDNS, com 49 pessoas cadastradas.
- **Testes de escrita:** executados com autorização explícita, na foto de `UserID=1`, com backup prévio obtido via `AccessFace.cgi?action=list` e **restauração verificada byte a byte** (22852 B antes e depois, idênticos).
- **Benchmarks de CPU:** `sharp` local. Como a máquina local é muito mais rápida que o servidor (2 vCPU / 2 GB), o que importa nesses números é a **proporção entre as variantes**, não o valor absoluto.

Observação de reprodutibilidade: ao testar com `curl`, use `-g` (`--globoff`). Os colchetes em `UserIDList[0]` são interpretados como range pelo curl e a requisição falha silenciosamente.

---

## 3. Achados validados

### 3.1 A troca de foto não precisa do cartão (achado mais importante)

Foi enviado um `POST /cgi-bin/AccessFace.cgi?action=updateMulti` isolado, com corpo `{"FaceList":[{"UserID":"1","PhotoData":["<base64>"]}]}`, **sem nenhuma chamada prévia de cartão**. Resposta: `HTTP 200 OK`, foto atualizada.

Complementarmente, `FaceInfoManager.cgi?action=startFind&Condition.UserID=<id>` é **realmente filtrado no dispositivo**:

- `UserID=1` retorna `{"Token":7,"Total":1}`
- `UserID=999999` retorna `{"Token":4,"Total":0}`

Resposta de ~35 bytes, custo O(1).

**Consequência:** um re-sync de foto precisa de **2 requisições**, não das ~14 atuais. Toda a busca paginada de cartão existe apenas para obter o `recNo` exigido pelo `recordUpdater`, que é necessário só quando permissões mudam.

### 3.2 O tamanho do payload tem custo linear e alto

Mesma foto, mesmo endpoint, apenas variando a resolução enviada:

| Corpo enviado | Tamanho | Tempo total |
| --- | --- | --- |
| Foto nativa do leitor (400x534) | 30 KB | **0,29 s** |
| Simulando o app hoje (1280 de largura) | 154 KB | **0,92 s** |

Enviar imagem grande custa cerca de **0,6 s a mais por leitor**. Com 9 leitores, são aproximadamente **5,4 s desperdiçados** apenas por resolução excessiva.

### 3.3 O leitor armazena 400x534

A foto recuperada do leitor tem **400x534 pixels (proporção 3:4) e 22,3 KB**. Esse é o destino final da imagem. Tudo que o aplicativo envia acima disso é descartado pelo caminho.

### 3.4 Custo por requisição e Digest

- Latência por requisição: **0,09 a 0,21 s**.
- **14 requisições sequenciais levaram 2,98 s** — o custo aproximado do sync atual por leitor.
- O Digest gasta **2 conexões TCP por requisição** (`num_connects=2`), por causa do ciclo 401 e repetição.

### 3.5 O `recordFinder` respeita `count`

`count=5` devolveu 2593 B contra 27444 B de `count=500`. Útil para o caso em que o cartão é realmente necessário.

---

## 4. Achados refutados

Registrados para não perpetuar diagnóstico errado.

- **Busca filtrada de cartão não existe neste firmware.** As quatro variantes testadas (`action=find` e `doSeekFind`, com `UserID` e com `Condition.UserID`) devolveram os **49 registros completos, 27443 B idênticos**. O `recordFinder` ignora o filtro para `AccessControlCard`. Isso explica por que o cliente de LPR tenta várias variantes e ainda assim filtra o texto no lado do servidor.
- **O total inflado não se manifestou.** `getQuerySize` de `AccessUserInfo` e de `AccessControlCard` retornaram ambos **49**. Continua sendo inconsistência de código, mas não é a causa do problema.
- **Varredura massiva não se sustenta nesta escala.** Com 49 registros são 27 KB em uma única página, não os dezenas de MB estimados para um cenário hipotético de milhares de registros.
- **Starvation de DNS não se confirmou.** Ainda que os leitores sejam acessados por hostname DDNS (e não por IP), 252 lookups em paralelo levaram 106 ms e a latência do threadpool permaneceu em 1 ms.
- **A modelagem facial no dispositivo não é o gargalo.** Está embutida nos 0,29 s do upload de 30 KB.

### Consequência honesta

Somando o que foi medido, um sync de uma pessoa em 9 leitores custa aproximadamente **3,5 s por leitor** e dezenas de milissegundos de CPU. Isso explica bem a **lentidão do aplicativo**, mas **não explica o servidor travar**. A causa do travamento permanece não confirmada e depende de dados do cliente Escola (ver seção 9).

As correções abaixo têm ganho comprovado por si e devem ser feitas, mas não devem ser vendidas como cura de uma causa raiz já identificada.

---

## 5. Correções no `face2go-server`

### P0.1 — Separar sync de permissões do sync de foto

Arquivo: [src/integrations/intelbras/intelbras-device.client.ts](../src/integrations/intelbras/intelbras-device.client.ts)

Hoje `intelbrasUpsertFaceOnReader` sempre executa o bloco de cartão (que exige a varredura para obter o `recNo`, linhas ~545-643) antes do bloco de face (linhas 645-714). O bloco de face é autossuficiente e foi validado isoladamente.

Ação: adicionar um caminho `photoOnly` que executa apenas as linhas 645-714, pulando toda a parte de cartão. O chamador usa esse caminho quando apenas a foto mudou, e o caminho completo quando permissões ou validade mudam.

Ganho medido: de ~14 requisições (~3 s) para 2 requisições (~0,65 s) por leitor, cerca de **5x**.

### P0.2 — Reduzir o payload enviado ao leitor

Ver seção 6 (aplicativo). No servidor, garantir que o alvo de compressão do Intelbras continue em 400 de largura, que é o que o dispositivo efetivamente armazena.

### P1.1 — Habilitar keepAlive e reusar a instância Digest

Arquivos: [src/integrations/intelbras/intelbras-device.client.ts](../src/integrations/intelbras/intelbras-device.client.ts) e [src/integrations/hikvision/hikvision-digest-auth.ts](../src/integrations/hikvision/hikvision-digest-auth.ts)

Hoje cada operação cria `new AxiosDigestAuth(...)` e não há `http.Agent` com `keepAlive`. Com 2 conexões por requisição medidas, um sync completo abre cerca de 28 conexões TCP por leitor.

Ação: criar um agente compartilhado com `keepAlive: true` e cachear a instância por leitor.

### P1.2 — Remover o `getQuerySize` por página

Arquivo: [src/integrations/intelbras/intelbras-device.client.ts](../src/integrations/intelbras/intelbras-device.client.ts), em `intelbrasGetDeviceUsers` (~linha 903)

O total não muda entre páginas, mas é consultado a cada iteração, dobrando as requisições da paginação.

### P1.3 — Trocar `mozjpeg` por `libjpeg-turbo`

Arquivos: [src/face-sync/hikvision-face-image.util.ts](../src/face-sync/hikvision-face-image.util.ts) e [src/face-sync/face-image-for-reader.ts](../src/face-sync/face-image-for-reader.ts)

Medido: normalização com `mozjpeg` a partir de entrada 1280 levou **204 ms**; com `libjpeg-turbo` a partir de entrada 720, **11,3 ms**. Somando a validação de luminância, o ganho total por foto foi de **8,5x (237 ms para 28 ms)**.

### P1.4 — Corrigir o re-decode por iteração

Arquivo: [src/face-sync/face-image-for-reader.ts](../src/face-sync/face-image-for-reader.ts)

O loop de qualidade recria o pipeline `sharp` a cada tentativa, redecodificando o JPEG. Criar o pipeline uma vez e usar `.clone()` dentro do loop.

### P1.5 — Normalizar uma única vez, fora do laço de leitores

Arquivos: [src/face-sync/face-sync.service.ts](../src/face-sync/face-sync.service.ts) e [src/face-sync/global-face-sync.service.ts](../src/face-sync/global-face-sync.service.ts)

A compressão acontece por leitor e por pessoa. Deve acontecer uma vez por pessoa, antes do `Promise.all`, com o buffer já pronto passado aos clientes.

### P2.1 — Tirar o sync do caminho da requisição

Usar o `EventEmitter2` já presente no projeto: gravar `pending_sync`, emitir o evento e responder imediatamente. Um listener executa o sync e atualiza o status. Exige polling no aplicativo enquanto o status for `pending_sync`.

Esta é a correção que de fato protege a experiência do usuário, já que o tempo de rede com os leitores nunca será zero.

### P2.2 — Guarda defensiva na paginação

Arquivo: [src/integrations/intelbras/intelbras-device.client.ts](../src/integrations/intelbras/intelbras-device.client.ts), em `resolveDeviceUsersTotalCount` (~linha 789)

O total vem de `AccessUserInfo` enquanto a paginação percorre `AccessControlCard`. No leitor testado os valores coincidem, então é risco teórico. Manter apenas limite máximo de páginas e detecção de página repetida.

---

## 6. Correções no `face2go-mobile`

Arquivo: [lib/compose-face-upload.ts](../../face2go-mobile/lib/compose-face-upload.ts)

Situação atual: `FACE_UPLOAD_MAX_WIDTH = 1280` e `FACE_UPLOAD_JPEG_QUALITY = 0.85`.

Ação: reduzir para **720x960** (proporção 3:4), que é o máximo útil do Hikvision e deixa margem confortável sobre os 400x534 que o Intelbras armazena.

Ganho medido: redução de **68%** no payload, e cerca de **0,6 s a menos por leitor** no upload ao dispositivo.

Nota sobre a decisão arquitetural: manter o redimensionamento no cliente está correto e o princípio original estava certo. O aplicativo nunca deixou de redimensionar; o que mudou foi o alvo, que subiu de 1024 para 1280 e passou a exigir reprocessamento no servidor. A correção não é mover trabalho de volta, é **parar de enviar resolução que ninguém consome**.

Verificar também [components/enrollment/FaceCameraScreen.tsx](../../face2go-mobile/components/enrollment/FaceCameraScreen.tsx), que captura com `quality: 0.92`.

---

## 7. Correções no `meuiot-server`

O código foi replicado entre os projetos. Os mesmos problemas existem, com caminhos diferentes.

- [src/http/rest/faceRecognition/face-image.util.ts](../../../MeuIOT/meuiot-server/src/http/rest/faceRecognition/face-image.util.ts): usa `mozjpeg: true` nas linhas 74 e 92. Aplicar P1.3.
- [src/http/rest/faceRecognition/integrations/hikvision/hikvision-facial.client.ts](../../../MeuIOT/meuiot-server/src/http/rest/faceRecognition/integrations/hikvision/hikvision-facial.client.ts): chama `normalizeHikvisionFaceJpeg` dentro do cliente, nas linhas 579 e 870, ou seja, uma vez por leitor. Aplicar P1.5.
- [src/http/rest/faceRecognition/integrations/intelbras/intelbras-facial.client.ts](../../../MeuIOT/meuiot-server/src/http/rest/faceRecognition/integrations/intelbras/intelbras-facial.client.ts): mesmo padrão para Intelbras. Aplicar P0.1 e P1.5.
- Não há `keepAlive` em nenhum ponto do caminho facial (existe apenas em `nfse` e `boleto`). Aplicar P1.1.
- O aplicativo `meuiot-mobile` deve receber o mesmo ajuste de resolução da seção 6.

Ponto positivo: o `meuiot-server` já é mais organizado que o `face2go-server` nesse ponto, pois tem `normalizeIntelbrasFaceJpeg` reaproveitando o utilitário compartilhado, enquanto o `face2go-server` mantém o `face-image-for-reader.ts` com o problema de re-decode descrito em P1.4.

---

## 8. Ordem de execução e critérios de aceite

1. P0.1 e seção 6 — maior ganho, menor risco.
2. P1.1 a P1.5 — otimizações locais e isoladas.
3. P2.1 — mudança estrutural, altera contrato da API e exige ajuste no aplicativo.
4. P2.2 — apenas guarda defensiva.

Critérios de aceite:

- Re-sync de foto usa 2 requisições por leitor, verificável nos logs `[FaceSync]`.
- Tempo total do sync de uma pessoa em 9 leitores abaixo de 1,5 s, contra os cerca de 3,5 s por leitor atuais.
- Payload enviado ao leitor abaixo de 60 KB.
- A requisição HTTP do aplicativo retorna sem esperar os leitores (após P2.1).

---

## 9. O que ainda falta investigar

A causa do travamento do servidor não está confirmada. Os itens abaixo fecham o diagnóstico:

1. **Volume nos leitores da Escola.** Rodar `GET /cgi-bin/recordFinder.cgi?action=getQuerySize&name=AccessControlCard` em um leitor do cliente. O leitor testado tinha 49. Se lá houver mais de mil, a varredura volta ao centro do problema, já que o filtro é ignorado pelo firmware e não há como evitar o download pelo protocolo.
2. **New Relic no horário do incidente:** latência do event loop, duração da transação de upload de face, e se havia sync global rodando em paralelo.
3. **Confirmar se o travamento coincide com sync individual ou global.** O sync global comprime por leitor e por pessoa, e é o candidato mais forte a saturar 2 vCPUs.
