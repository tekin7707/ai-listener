# Spec: ai-listener — Türkçe Özet

> Bu Türkçe özet **referans**tır; resmi/güncel kaynak [SPEC.md](SPEC.md) (İngilizce).
> İki belge arasında çelişki olursa İngilizce versiyon geçerlidir.

## Amaç

Azure DevOps work item toolbar'ındaki **AI Agent** butonuna basıldığında,
[azure-ai-extension](../azure-ai-extension/) bu servisi POST ile çağırır.
Listener koşulları kontrol eder ve uygun Azure Pipeline'ı tetikler. Pipeline
self-hosted bir agent ([ai-scripts](../ai-scripts/)) üzerinde çalışır ve
Claude Code'u koşturarak kodu yazdırır, branch açıp commit eder, PR oluşturur.

## Tetikleme Koşulları (her ikisi de gerekli)

| Alan | Kural |
|---|---|
| `System.State` | `WEBHOOK_TRIGGER_STATE` (varsayılan: `To Do`) ile eşleşmeli |
| `System.Tags` | `<TAG_PREFIX>:<repo>` formatında (varsayılan prefix: `ai-agent`) en az bir etiket |

Opsiyonel:
- `<TAG_PREFIX>-model:<sonnet\|opus\|haiku>` — model override
- `<TAG_PREFIX>-turns:<N>` — max turn override (N × 10)

## Yanıtlar

| HTTP | `status` / `code` | Anlam |
|---|---|---|
| 200 | `triggered` | Pipeline tetiklendi (runId döner) |
| 200 | `skipped` / `STATE_NOT_ALLOWED` | İstenmeyen state |
| 200 | `skipped` / `TAG_MISSING` | Tetikleyici tag yok |
| 200 | `skipped` / `REPO_EMPTY` | Tag'de repo adı boş |
| 200 | `skipped` / `REPO_UNKNOWN` | Repo tanımsız |
| 200 | `duplicate` | Aynı fingerprint son 120s'de |
| 200 | `cooldown` | Son 180s'de bir tetik var |
| 200 | `debounced` | Eşzamanlı istek |
| 400 | — | `workItemId` eksik |
| 401 | — | Auth başarısız |
| 500 | — | İç hata |

## Dil

`AI_AGENT_LANG=tr` ile yanıt mesajları Türkçe; `en` ile İngilizce. Varsayılan: `en`.

Tüm env değişkenleri ve detay için: [SPEC.md](SPEC.md).
