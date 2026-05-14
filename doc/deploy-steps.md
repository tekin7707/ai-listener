# Production Deploy — Hetzner VPS (tech-inn)

Hedef: `https://ai-azure.agentechauth.com/webhook` üzerinden çalışan listener + Redis +
ai-scripts agent (Azure self-hosted agent + Claude Code).

VPS: `deploy@tech-inn`, dizin kökü: `/home/deploy/hetzner01/`.
Edge nginx: `/home/deploy/hetzner01/edge/`, external network: `edge_web`.

---

## 1. ai-listener deploy

### 1.1. VPS'te klasör ve repo

```bash
ssh deploy@tech-inn
mkdir -p /home/deploy/hetzner01/ai-listener
cd /home/deploy/hetzner01/ai-listener
git clone https://github.com/tekin7707/ai-listener.git .
# veya scp ile: scp -r ai-listener/* deploy@tech-inn:/home/deploy/hetzner01/ai-listener/
```

### 1.2. `.env` ve `config/repos.json` oluştur

```bash
cd /home/deploy/hetzner01/ai-listener
cp .env.example .env
nano .env
# Doldur:
#   PORT=3000
#   WEBHOOK_SECRET=<production değer — yeni belirle>
#   REDIS_HOST=redis
#   REDIS_PORT=6379
#   REDIS_PASSWORD=<production redis şifresi — yeni belirle>
#   REDIS_DB=1
#   AZURE_DEVOPS_ORG=https://dev.azure.com/FloTechnology
#   AZURE_DEVOPS_PAT=<production PAT — yeni belirle>
#   WEBHOOK_USER=<production basic auth user>
#   WEBHOOK_PASSWORD=<production basic auth password>
#   AGENT_USERNAME=<>
#   TARGET_USERS=<>

cp config/repos.example.json config/repos.json
nano config/repos.json
# Her repo için project + pipelineId + production PAT
```

### 1.3. Compose ile ayağa kaldır

```bash
cd /home/deploy/hetzner01/ai-listener
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f listener
```

Listener `floxo-net` (redis ile) ve `edge_web` (nginx ile) network'lerine bağlı olacak.
Host'a hiçbir port açılmaz (sadece nginx'ten erişilir).

### 1.4. Edge nginx config'i güncelle

`/home/deploy/hetzner01/edge/nginx/conf.d/platform.conf` dosyasını aç:

1. **HTTP→HTTPS redirect** server block'undaki `server_name` satırına `ai-azure.agentechauth.com` ekle.
2. `nginx-ai-azure.conf` içindeki 443 server block'u dosyanın sonuna ekle.

```bash
# Edge'i yeniden başlat
cd /home/deploy/hetzner01/edge
docker compose restart nginx
docker compose logs --tail 30 nginx   # syntax error var mı kontrol
```

### 1.5. Smoke test

```bash
curl -sS https://ai-azure.agentechauth.com/ping
# Beklenen: pong
```

---

## 2. ai-scripts (agent + Claude Code) deploy

### 2.1. VPS'te klasör ve repo

```bash
mkdir -p /home/deploy/hetzner01/ai-scripts
cd /home/deploy/hetzner01/ai-scripts
git clone https://github.com/tekin7707/ai-scripts.git .
```

### 2.2. `secrets.env` oluştur

```bash
nano secrets.env
# Doldur (production değerleri):
#   ADO_PAT=<azure devops pat>
#   CLAUDE_CODE_OAUTH_TOKEN=<claude code oauth token>
```

### 2.3. Compose ile ayağa kaldır

```bash
docker compose up -d --build
docker compose logs -f agent
# "Listening for Jobs" görene kadar bekle
```

> **Not:** Lokal Mac'te zaten aynı `floxo-docker-agent` adıyla bir agent kayıtlı. VPS'te
> aynı isimle başka bir agent register etmek çakışmaya yol açar. İki seçenek:
>
> 1. **Önerilen — Mac'teki agent'ı kapat ve unregister et** (graceful):
>    ```bash
>    cd /Users/mustafa.tekin/projects/ai-agent/ai-scripts && docker compose down
>    ```
>    Yeni start.sh SIGTERM yakalayıp Azure'dan kayıt silecek.
>
> 2. **Agent ismini VPS için farklılaştır**: VPS'teki `ai-scripts/start.sh` içinde
>    `--agent "floxo-docker-agent-vps"` yap. Böylece her iki ortam aynı pool'da
>    paralel kayıtlı kalır.

---

## 3. Extension'ı production URL ile yeniden paketle

Mac'te:

```bash
cd /Users/mustafa.tekin/projects/ai-agent/azure-ai-extension
# .env.local'i prod URL ile güncelle:
cat > .env.local <<'EOF'
WEBHOOK_URL=https://ai-azure.agentechauth.com/webhook
WEBHOOK_USER=<production basic auth user>
WEBHOOK_PASSWORD=<production basic auth password>
EOF

npm run package:rev
# Yeni .vsix: FloTechnology.task-to-hook-0.1.17.vsix
```

Marketplace'e yükle:
- [Publish portal](https://marketplace.visualstudio.com/manage/publishers/FloTechnology) → task-to-hook → Update → yeni `.vsix`'i yükle.
- Organization'a install/share et.

---

## 4. Uçtan uca production testi

1. Bir work item açın, **Tags**'e `ai-agent` ekleyin, **AssignedTo** izin verilen
   bir kullanıcı olsun.
2. **AI ile geliştir** butonuna basın.
3. Loglar:
   ```bash
   # Terminal 1
   ssh deploy@tech-inn 'cd /home/deploy/hetzner01/ai-listener && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f listener'
   # Terminal 2
   ssh deploy@tech-inn 'cd /home/deploy/hetzner01/ai-scripts && docker compose logs -f agent'
   ```
4. Beklenen:
   - Listener → `Webhook alındı` → `Pipeline tetiklendi (runId)`
   - Agent → yeni job pickup → `claude_run.sh` çıktısı

---

## 5. Credential rotation (zorunlu)

Production'a geçmeden mutlaka rotate edilmesi gerekenler:
- **Azure DevOps PAT** — eski PAT lokal git'te ve şu an aktif kullanımda; lokali ve prod'u ayrı PAT'larla çalıştırmak best practice.
- **WEBHOOK_USER / WEBHOOK_PASSWORD** — prod için yeni bir Basic Auth kombinasyonu.
- **REDIS_PASSWORD** — prod için yeni şifre.
- **CLAUDE_CODE_OAUTH_TOKEN** — eski token sızıntı durumunda iptal edilebilir; prod için ayrı bir token önerilir.

Tüm yeni değerler VPS'teki `.env` ve `secrets.env` dosyalarına gelir, Mac lokali eski değerleri kullanmaya devam edebilir.

---

## 6. (Opsiyonel) GitHub Actions ile otomatik deploy

Mevcut `edge` projesindeki [.github/workflows/deploy.yml](deploy-prod.md) pattern'ini referans alarak
her iki repo'ya ekleme yapılabilir. Secret'lar: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`.
İlk kurulumdan sonra ele alınabilir.
