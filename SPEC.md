# Spec: ai-listener — Azure DevOps Pipeline Trigger Service

**Durum:** Güncel
**Son güncelleme:** 2026-05-14
**Yazar:** Mustafa Tekin

---

## Amaç

Azure DevOps work item'ı üzerindeki **"AI ile geliştir"** butonuna basıldığında, work item'ın
etiketlerine göre uygun Azure Pipeline'ı tetikleyen HTTP servisi. Buton bir Azure DevOps
extension ([azure-ai-extension](../azure-ai-extension/)) tarafından sağlanır; tetiklenen
pipeline işi self-hosted bir agent üzerinde ([ai-scripts](../ai-scripts/)) yürütür.

```
Work Item Toolbar (extension) ──POST/Basic Auth──▶ ai-listener
                                                       │
                                                       ▼
                                              Azure DevOps Pipeline
                                                       │
                                                       ▼
                                            self-hosted agent (ai-scripts)
                                                       │
                                                       ▼
                                                  Claude Code
```

---

## API

### `POST /webhook`

Tek endpoint. Hem extension'dan hem ileride başka tetikleyicilerden POST kabul eder.

**Auth:** HTTP Basic
```
Authorization: Basic base64(<WEBHOOK_USER>:<WEBHOOK_PASSWORD>)
```

**Beklenen body (extension formatı, minimum):**
```json
{
  "resource": { "workItemId": 1234 }
}
```

`eventType` ve `resource.fields` opsiyonel — kabul edilir ama listener tetikleme koşullarını
Azure DevOps'tan çektiği work item üzerinden değerlendirir.

### `GET /ping`

Health check. `pong` döner. Edge nginx için kullanılabilir.

---

## Tetikleme Koşulları

Aşağıdaki **tek** koşul sağlanmalı:

| Alan | Kural |
|---|---|
| `System.Tags` | `ai-agent:<repo>` veya `ai-agent:<repo>:<model>` formatında en az bir etiket bulunmalı. `<repo>`, [config/repos.json](config/repos.json)'da tanımlı olmalı. |

`<model>` (opsiyonel) ai-listener tarafında **kullanılmaz** — Azure pipeline parametresine geçirilmez.
ai-scripts içinde [prepare.py](../ai-scripts/agent-scripts/prepare.py) work item'ı kendi okuyup model'i seçer.

> **Not:** Bu servis daha önce `AGENT_USERNAME` env değişkeni ile AssignedTo kontrolü yapardı.
> Bu kısıt **kaldırıldı**. Butona kim basarsa bassın, work item üzerindeki tag yeterli koşulu sağlar.

### Yanıt formatı

Tüm yanıtlar JSON.

| HTTP | `status` | `code` | Anlam |
|---|---|---|---|
| 200 | `triggered` | `OK` | Pipeline tetiklendi. Body: `{ status, workItemId, repoName, runId }` |
| 200 | `skipped` | `TAG_MISSING` | `ai-agent:<repo>` etiketi yok |
| 200 | `skipped` | `REPO_EMPTY` | `ai-agent:` var ama repo adı boş |
| 200 | `skipped` | `REPO_UNKNOWN` | Tag'deki repo `repos.json`'da yok |
| 200 | `debounced` | — | Lock alınamadı, başka istek işleniyor |
| 200 | `duplicate` | — | Aynı fingerprint son 120s'de görüldü |
| 200 | `cooldown` | — | Son 180s'de bir pipeline tetiklenmiş. Body: `{ status, workItemId, pipelineRunId }` |
| 400 | — | — | `workItemId` eksik. Body: `{ error, reason }` |
| 401 | — | — | Basic Auth başarısız. Body: `{ error: "Unauthorized" }` |
| 500 | — | — | Work item çekilemedi veya pipeline tetiklenemedi |

`skipped` yanıtlarında `reason` alanı kullanıcıya gösterilecek açıklayıcı metin içerir; tanımlı
repo isimleri liste halinde dahildir.

---

## İç Akış

1. **Auth kontrolü** — Basic Auth eşleşmezse 401.
2. **Payload kontrolü** — `resource.workItemId` zorunlu; yoksa 400.
3. **Work item çekme** — Azure DevOps REST API ile tags + diğer alanlar çekilir.
4. **Analyzer** ([analyzer.js](src/services/analyzer.js)) — tag'i parse eder, repo'yu doğrular.
5. **Lock** — `ado:webhook:lock:<wiId>` 15s TTL. Aynı anda gelen ikinci istek `debounced`.
6. **Duplicate** — `ado:webhook:duplicate:<sha256(fingerprint)>` 120s TTL. Fingerprint: eventType, wiId, AssignedTo old/new, Title old/new. Aynısı tekrar gelirse `duplicate`.
7. **Cooldown** — `ado:webhook:cooldown:<wiId>` 180s TTL. Önceki run kayıtlıysa `cooldown`.
8. **Trigger** ([pipeline.js](src/services/pipeline.js)) — `repos.json`'daki repo bilgisi ile pipeline tetiklenir.
9. **Cooldown yaz** — Başarılı tetik sonrası key set edilir.

Redis bağlantı hatası: tüm `dedup`/`cooldown` adımlarında **fail-open** (devam et, sadece log).

---

## Azure Pipeline Tetikleme

```
POST <AZURE_DEVOPS_ORG>/<project>/_apis/pipelines/<pipelineId>/runs?api-version=7.1
Authorization: Basic base64(":<repo-pat>")
Content-Type: application/json
Body: { "templateParameters": { "workItemId": "<id>" } }
```

`<project>`, `<pipelineId>`, `<pat>` her repo için ayrı, [config/repos.json](config/repos.json):

```json
{
  "<repo-adı>": {
    "project": "FLOXO",
    "pipelineId": "407",
    "pat": "<azure-devops-pat>"
  }
}
```

Yeni repo eklemek için `repos.json`'a entry eklemek + ilgili Azure pipeline'ın hazır olması yeterli.

---

## Konfigürasyon (`.env`)

| Değişken | Açıklama | Örnek |
|---|---|---|
| `PORT` | Express dinleme portu | `3000` |
| `WEBHOOK_USER` | Basic Auth username | `floxo` |
| `WEBHOOK_PASSWORD` | Basic Auth password | |
| `REDIS_HOST` | Redis hostname (compose servis adı) | `redis` |
| `REDIS_PORT` | Redis portu | `6379` |
| `REDIS_PASSWORD` | Redis şifresi | |
| `REDIS_DB` | Redis DB index | `1` |
| `AZURE_DEVOPS_ORG` | ADO org URL | `https://dev.azure.com/FloTechnology` |
| `AZURE_DEVOPS_PAT` | Work item çekmek için PAT (Read on Work Items) | |
| `WEBHOOK_DUPLICATE_WINDOW_SECONDS` | Duplicate TTL (saniye) | `30` (varsayılan: 120) |
| `WEBHOOK_COOLDOWN_SECONDS` | Cooldown TTL (saniye) | `60` (varsayılan: 180) |

> `repos.json`'daki PAT'lar **pipeline tetikleme** için, `.env`'deki PAT **work item okuma** için kullanılır. Aynı PAT olabilir ama izin kapsamı farklıdır (`Build (Read & Execute)` vs `Work Items (Read)`).

---

## Çalıştırma

### Lokal

```bash
cd ai-listener
cp .env.example .env  # değerleri doldur
cp config/repos.example.json config/repos.json  # her repo için PAT ekle
docker compose up -d --build
curl http://localhost:5004/ping  # → pong
```

Redis aynı compose içinde container olarak ayağa kalkar.

### Production (Hetzner VPS)

Detay: [doc/deploy-steps.md](doc/deploy-steps.md).

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Prod override (`docker-compose.prod.yml`):
- Host port mapping kaldırılır (sadece edge nginx'ten erişilir)
- `edge_web` external network'üne bağlanır
- nginx server block: [doc/nginx-ai-azure.conf](doc/nginx-ai-azure.conf)

---

## Loglama

Winston JSON formatı, stdout.

| Olay | Seviye |
|---|---|
| Servis başladı | `info` |
| Webhook alındı | `info` |
| Work item çekiliyor (sadece url, PAT yok) | `info` |
| Pipeline tetikleniyor | `info` |
| Pipeline tetiklendi (runId) | `info` |
| Koşul sağlanmadı (reason ile) | `info` |
| Lock meşgul / Duplicate / Cooldown | `info` |
| Geçersiz auth (ip ile) | `warn` |
| Geçersiz payload | `warn` |
| Redis hatası | `warn` |
| Work item çekilemedi | `error` |
| Pipeline tetiklenemedi | `error` |
| Azure DevOps API hatası | `error` |

> **Güvenlik notu:** PAT değerleri log'a **yazılmaz**. Sadece çağrılan URL'ler loglanır.

---

## Kapsam Dışı (Bu Versiyon)

- ❌ Pipeline çalışma sonuçlarını listener'a geri raporlama (agent kendisi work item'a yorum ekler)
- ❌ Retry mekanizması (cooldown bunun yerine geçer)
- ❌ Health check / metrics endpoint dışında bir gözetim
- ❌ Çoklu organizasyon (`AZURE_DEVOPS_ORG` tek değer)

---

## Teknoloji

| Katman | Seçim |
|---|---|
| Dil | JavaScript (Node.js >= 18 LTS) |
| Framework | Express ^4 |
| Redis client | `ioredis` |
| HTTP | `axios` |
| Log | `winston` |
| Env yönetimi | `dotenv` |
| Container | Docker + Compose |
| Reverse proxy (prod) | nginx (edge service'i) |

---

## İlgili Bileşenler

- [azure-ai-extension](../azure-ai-extension/): Work item toolbar'a buton ekler, bu servise POST atar.
- [ai-scripts](../ai-scripts/): Pipeline'ın çalıştırdığı self-hosted agent + Claude Code orchestration scriptleri.
