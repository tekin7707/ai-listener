# Spec: Azure DevOps Webhook Dispatcher

**Durum:** Onaylandı  
**Tarih:** 2026-04-17  
**Yazar:** Mustafa Tekin

---

## Problem

Azure DevOps'ta bir work item güncellendiğinde, belirli koşulları sağlayan görevler için
bir Azure Pipeline'ın otomatik tetiklenmesi gerekiyor. Bu tetikleme şu an manuel yapılıyor.
Ayrıca Azure DevOps aynı eventi kısa süre içinde birden fazla gönderebiliyor,
bu da pipeline'ın gereksiz yere çalışmasına neden oluyor.

---

## Çözüm

Bir HTTP servisi yazılacak. Bu servis:

1. Azure DevOps'tan gelen `workitem.updated` webhook'unu karşılayacak
2. 2 dakika içinde aynı `workItemId` tekrar gelirse işlemi atlayacak
3. Koşullar sağlanıyorsa Azure Pipeline'ı tetikleyecek

---

## Tetikleme Koşulları

Her iki koşul da aynı anda sağlanmalıdır:

| # | Koşul | Kaynak |
|---|---|---|
| 1 | Work item'ın tag listesinde `"ai-agent"` içeren en az bir tag bulunmalı | `resource.fields["System.Tags"]` |
| 2 | Work item, izin verilen kullanıcılar listesindeki birine atanmış olmalı | `resource.fields["System.AssignedTo"].uniqueName` |

Koşullardan biri sağlanmıyorsa →  işlem atlanır, log yazılır, `200 OK` dönülür.

---

## Duplicate Önleme

- Aynı `workItemId` için 2 dakika (120 saniye) içinde gelen ikinci istek işlenmez.
- Redis'te key formatı: `ado:webhook:processed:{workItemId}`
- Key'in TTL'i: **120 saniye**
- Redis hatasında: log yazılır, işlem **devam eder** (fail-open).

---

## API

### `POST /webhook`

Azure DevOps'un çağıracağı tek endpoint.

**Header Zorunluluğu:**

```
x-api-key: <WEBHOOK_SECRET değeri>
```

Değer eşleşmezse → `401 Unauthorized` dön.

**Beklenen Body (Azure DevOps formatı):**

```json
{
  "eventType": "workitem.updated",
  "resource": {
    "id": 1234,
    "fields": {
      "System.AssignedTo": {
        "uniqueName": "someone@domain.com"
      },
      "System.Tags": "ai-agent; some-other-tag"
    }
  }
}
```

**Yanıtlar:**

| HTTP Kodu | Durum |
|---|---|
| `200 OK` | İstek işlendi (tetiklendi, atlandı ya da koşul sağlanmadı) |
| `202 Accepted` | Duplicate, işlem atlandı |
| `400 Bad Request` | Geçersiz ya da eksik payload |
| `401 Unauthorized` | API key yanlış veya eksik |
| `500 Internal Server Error` | Beklenmedik sunucu hatası |

---

## Azure Pipeline Tetikleme

- **Organization:** `FloTechnology`
- **Project:** `FLOXO`
- **Pipeline ID:** `404`
- **API:** Azure DevOps REST API `v7.1`

Pipeline'a yalnızca şu parametre geçilir:

```json
{
  "templateParameters": {
    "workItemId": "1234"
  }
}
```

Pipeline yanıtı `2xx` ise başarılı sayılır. Başarısızsa log yazılır, işlem sonlanır (retry yok).

---

## Kullanıcı Listesi

İzin verilen kullanıcılar `.env` dosyasında saklanır, kod içinde hardcode gerekmez.

```
TARGET_USERS=user1@domain.com,user2@domain.com
```

---

## Loglama

Aşağıdaki olaylar log'a yazılır:

| Olay | Log Seviyesi |
|---|---|
| Webhook alındı | `info` |
| Duplicate atlandı | `info` |
| Koşul sağlanmadı (detay ile) | `info` |
| Pipeline tetiklendi (runId ile) | `info` |
| API key geçersiz | `warn` |
| Redis hatası | `warn` |
| Pipeline tetiklenemedi | `error` |
| Beklenmedik hata | `error` |

---

## Konfigürasyon (`.env`)

```
PORT=3000
WEBHOOK_SECRET=<seçilecek>

REDIS_HOST=<redis-host>
REDIS_PORT=6379
REDIS_PASSWORD=<redis-şifresi>
REDIS_DB=1
REDIS_TTL_SECONDS=120

AZURE_DEVOPS_ORG=https://dev.azure.com/FloTechnology
AZURE_DEVOPS_PROJECT=FLOXO
AZURE_DEVOPS_PIPELINE_ID=404
AZURE_DEVOPS_PAT=<pat-token>

TARGET_USERS=user1@flo.com.tr
```

---

## Kapsam Dışı (Bu Versiyon)

- ❌ Retry mekanizması
- ❌ Dead letter queue
- ❌ Çoklu pipeline desteği
- ❌ Health check endpoint
- ❌ Metrics / monitoring

> Not: Çoklu Azure DevOps projesi ve pipeline desteği **ileriki bir versiyon** için planlanmaktadır.
> Yapı bu genişlemeye izin verecek şekilde tasarlanacak, ancak şimdilik implement edilmeyecek.

---

## Teknoloji

### Dil ve Runtime

| Katman | Seçim | Versiyon |
|---|---|---|
| Dil | JavaScript (Node.js) | >= 18 LTS |
| Framework | Express | ^4 |
| Paket yöneticisi | npm | built-in |

### Kütüphaneler

| Amaç | Kütüphane |
|---|---|
| Redis bağlantısı | `ioredis` |
| HTTP istekleri (Azure API) | `axios` |
| Loglama | `winston` |
| Env yönetimi | `dotenv` |

### Proje Yapısı

```
azure/
├── src/
│   ├── app.js              # Express kurulumu, route bağlama
│   ├── routes/
│   │   └── webhook.js      # POST /webhook handler
│   ├── services/
│   │   ├── deduplicator.js # Redis TTL kontrolü
│   │   ├── analyzer.js     # Tetikleme koşulları
│   │   └── pipeline.js     # Azure REST API çağrısı
│   └── lib/
│       ├── redis.js        # Redis bağlantısı (singleton)
│       └── logger.js       # Winston yapılandırması
├── .env                    # Gerçek değerler (git'e girmez)
├── .env.example            # Şablon (git'e girer, değer içermez)
└── package.json
```

---

## Açık Sorular

- [x] `TARGET_USERS` → `mustafa.tekin@flo.com.tr`
- [x] Azure DevOps PAT hazır
- [x] `WEBHOOK_SECRET` → belirlendi
- [ ] `.env` dosyası oluşturulacak (`.env.example` şablondan)
