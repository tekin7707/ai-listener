# Spec: ai-listener — Azure DevOps Pipeline Trigger Service

**Status:** Active
**Last update:** 2026-05-16

> Türkçe versiyon: [SPEC.tr.md](SPEC.tr.md)

---

## Purpose

When a user clicks the **AI Agent** action button on an Azure DevOps work item, this
HTTP service receives the call from the
[azure-ai-extension](../azure-ai-extension/), validates conditions, and triggers
the appropriate Azure Pipeline. The pipeline runs on a self-hosted agent
([ai-scripts](../ai-scripts/)) which invokes Claude Code to make the change,
commits it on a per-work-item branch, and opens a pull request.

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

Single endpoint. Accepts payloads from the extension or any other compatible trigger.

**Auth:** HTTP Basic
```
Authorization: Basic base64(<WEBHOOK_USER>:<WEBHOOK_PASSWORD>)
```

**Minimal expected body (extension format):**
```json
{
  "resource": { "workItemId": 1234 }
}
```

`eventType` and `resource.fields` are optional — accepted but ignored. The
listener fetches the actual work item from Azure DevOps and evaluates conditions
against that.

### `GET /ping`

Health check. Returns `pong`. Suitable for nginx upstream probes.

---

## Trigger Conditions

The following two conditions must hold (AND):

| Field | Rule |
|---|---|
| `System.State` | Must equal `WEBHOOK_TRIGGER_STATE` env (default: `To Do`), case-insensitive. Board template state-transition rules can block `Backlog → In Progress` style direct jumps, so we filter eligible state early. |
| `System.Tags` | At least one tag in the form `<TAG_PREFIX>:<repo>` (default prefix: `ai-agent`), where `<repo>` is defined in [config/repos.json](config/repos.json). |

Additional optional tags interpreted by the agent (not by the listener):

| Tag | Purpose |
|---|---|
| `<TAG_PREFIX>-model:<sonnet\|opus\|haiku>` | Override Claude model for this work item |
| `<TAG_PREFIX>-turns:<N>` | Override max turns; final value = N × 10 (clamped 1..5) |

Legacy combined form `<TAG_PREFIX>:<repo>:<model>` is still parsed but the
dedicated `-model:` tag takes precedence.

### Response shape

All responses are JSON.

| HTTP | `status` | `code` | Meaning |
|---|---|---|---|
| 200 | `triggered` | `OK` | Pipeline triggered. Body: `{ status, workItemId, repoName, runId }` |
| 200 | `skipped` | `STATE_NOT_ALLOWED` | Work item is not in the configured trigger state |
| 200 | `skipped` | `TAG_MISSING` | No `<TAG_PREFIX>:<repo>` tag found |
| 200 | `skipped` | `REPO_EMPTY` | `<TAG_PREFIX>:` is present but the repo name is empty |
| 200 | `skipped` | `REPO_UNKNOWN` | Tagged repo is not defined in repos.json |
| 200 | `debounced` | — | Another concurrent request is being handled |
| 200 | `duplicate` | — | Same fingerprint seen in the last 120s |
| 200 | `cooldown` | — | A pipeline was triggered in the last 180s. Body: `{ status, workItemId, pipelineRunId }` |
| 400 | — | — | `workItemId` missing. Body: `{ error, reason }` |
| 401 | — | — | Basic Auth failed |
| 500 | — | — | Work item fetch or pipeline trigger failed |

Skipped responses include a `reason` field with a human-readable explanation
in the configured language (see `AI_AGENT_LANG`).

---

## Pipeline Trigger Call

```
POST <AZURE_DEVOPS_ORG>/<project>/_apis/pipelines/<pipelineId>/runs?api-version=7.1
Authorization: Basic base64(":<repo-pat>")
Content-Type: application/json
Body: { "templateParameters": { "workItemId": "<id>" } }
```

`<project>`, `<pipelineId>` and the trigger `<pat>` all come from a single
nested [config/projects.json](config/projects.json) (gitignored). Schema:

```json
{
  "<ProjectName>": {
    "triggerPat": "<azure-devops-pat>",
    "repos": [
      { "repo": "<lowercase-repo-name>", "pipelineId": "<id>" }
    ]
  }
}
```

See [config/projects.example.json](config/projects.example.json) for the
template. Internally the listener flattens this into a repo-keyed index
([lib/repoIndex.js](src/lib/repoIndex.js)); the `triggerPat` cascades from
the project entry to each of its repos.

**Pipeline trigger** uses this lookup order:

1. **`repos[i].pat`** inside a project entry — per-repo override (rare; use
   only when one repo genuinely needs a unique PAT)
2. **`<project>.triggerPat`** — project-level PAT (recommended)
3. **`AZURE_DEVOPS_PAT`** env — listener-wide fallback

**Work item fetch** ([workitem.js](src/services/workitem.js)) always uses
`AZURE_DEVOPS_PAT` because the fetch endpoint is organization-scoped (no
project context yet at fetch time). Use a service-account PAT here with
`Work Items (Read)` across all projects you care about.

Adding a new repo: append an entry to its project's `repos` array.
Adding a new project: (1) Variable Group + agent pool authorization on the
Azure side (see deploy-steps.md) and (2) a new top-level entry in
`projects.json` with its `triggerPat` and `repos`.

---

## Configuration (`.env`)

| Variable | Description | Default |
|---|---|---|
| `PORT` | Express listening port | `3000` |
| `WEBHOOK_USER` | Basic Auth username | — |
| `WEBHOOK_PASSWORD` | Basic Auth password | — |
| `WEBHOOK_TRIGGER_STATE` | Work item state required to trigger | `To Do` |
| `AI_AGENT_TAG_PREFIX` | Trigger tag prefix | `ai-agent` |
| `AI_AGENT_LANG` | UI language for response messages (`en`, `tr`) | `en` |
| `REDIS_HOST` | Redis hostname (compose service name) | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | — |
| `REDIS_DB` | Redis DB index | `1` |
| `AZURE_DEVOPS_ORG` | ADO org URL | — |
| `AZURE_DEVOPS_PAT` | PAT for fetching work items (Read on Work Items) | — |
| `WEBHOOK_DUPLICATE_WINDOW_SECONDS` | Duplicate window in seconds | `120` |
| `WEBHOOK_COOLDOWN_SECONDS` | Cooldown after a trigger in seconds | `180` |

> `AZURE_DEVOPS_PAT` is the **work item fetch PAT** (org-scoped service account).
> Pipeline trigger PATs are layered (see "Pipeline Trigger Call" above):
> per-repo override → `projects.json` per-project PAT → this env as fallback.

---

## Internal Flow

1. **Auth** — Basic Auth must match `WEBHOOK_USER:WEBHOOK_PASSWORD` or 401.
2. **Payload** — `resource.workItemId` is required, else 400.
3. **Fetch work item** — Azure DevOps REST API (`System.State`, `System.Tags`, etc).
4. **Analyzer** ([analyzer.js](src/services/analyzer.js)) — state, tag, repo checks.
5. **Lock** — `ado:webhook:lock:<wiId>` 15s TTL. Concurrent second request → `debounced`.
6. **Duplicate** — `ado:webhook:duplicate:<sha256(fingerprint)>` 120s TTL. Same field changes → `duplicate`.
7. **Cooldown** — `ado:webhook:cooldown:<wiId>` 180s TTL. Recent run → `cooldown`.
8. **Trigger** ([pipeline.js](src/services/pipeline.js)) — POST to Azure pipeline runs API.
9. **Cooldown write** — set after a successful trigger.

Redis errors at any dedup/cooldown step **fail open** (continue, log warning).

---

## Localization

User-facing strings (response `reason` field, log messages) live in
[src/lib/i18n/en.json](src/lib/i18n/en.json) and
[src/lib/i18n/tr.json](src/lib/i18n/tr.json). Add a new language by dropping a
JSON file with the same keys and setting `AI_AGENT_LANG=<code>`.

Extension UI auto-detects browser language via `navigator.language` and falls
back to English.

---

## Out of Scope (this version)

- Pipeline run result polling back to listener
- Retries beyond the cooldown mechanism
- Per-tenant isolation (single-org/single-tenant deployment)
- Webhook auth schemes other than Basic
- Custom monitoring/metrics endpoints

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | Node.js (>= 18 LTS) |
| Framework | Express ^4 |
| Redis client | `ioredis` |
| HTTP | `axios` |
| Logger | `winston` |
| Env | `dotenv` |
| Container | Docker Compose |
| Reverse proxy (prod) | nginx (edge service) |

---

## Related Components

- [azure-ai-extension](../azure-ai-extension/) — Adds the toolbar action button, POSTs to this service.
- [ai-scripts](../ai-scripts/) — Self-hosted Azure agent + Claude Code orchestration the pipeline calls into.

---

## Running

### Local

```bash
cd ai-listener
cp .env.example .env  # fill in
cp config/repos.example.json config/repos.json  # add PATs per repo
docker compose up -d --build
curl http://localhost:5004/ping  # → pong
```

### Production (Hetzner VPS pattern)

See [doc/deploy-steps.md](doc/deploy-steps.md). Summary:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Override (`docker-compose.prod.yml`):
- Removes host port mapping (listener accessible only through nginx)
- Joins the `edge_web` external network
- nginx server block: [doc/nginx-ai-azure.conf](doc/nginx-ai-azure.conf)
