# sandbox-sidecar

E2B code-interpreter sidecar for the AnyRouters playground. Runs model-generated
code in an ephemeral [E2B](https://e2b.dev) sandbox and returns stdout/stderr
plus any files the code produced (charts, xlsx, csv, pdf, ...).

This is a **standalone service**, separate from the new-api Go backend. The Go
backend (`POST /pg/execute`) is the only caller — it forwards user requests here
behind a shared internal secret after authenticating the logged-in user. The
sidecar is never exposed to end users directly.

```
browser (new-api JWT) → new-api /pg/execute → sidecar /execute → E2B sandbox
                                                                    ↓
                          files (base64) ←──────────────────────── harvest
```

## API

### `POST /execute`
Header: `X-Internal-Secret: <INTERNAL_SECRET>`

Body:
```json
{ "code": "import pandas as pd; ...", "language": "python" }
```

Response:
```json
{
  "ok": true,
  "stdout": "...",
  "stderr": "...",
  "error": null,
  "files": [
    { "name": "report.xlsx", "mime": "application/vnd...sheet", "size": 4975, "b64": "..." },
    { "name": "chart-1.png", "mime": "image/png", "size": 12000, "b64": "...", "rich": true }
  ],
  "elapsed_ms": 8200
}
```

File harvesting = diff of `/home/user` before/after the run (new or modified
files) **plus** any inline images the kernel captured from `plt.show()`. Per-file
cap `MAX_FILE_BYTES` (10 MiB), count cap `MAX_FILES` (8). Oversized files are
returned as metadata only with `"truncated": true`.

### `GET /health`
`200 { "ok": true }`

## Env
| var | required | default | note |
|---|---|---|---|
| `E2B_API_KEY` | yes | — | E2B api key |
| `INTERNAL_SECRET` | yes | — | shared secret the Go backend presents |
| `PORT` | no | 8080 | Cloud Run sets this |
| `MAX_FILE_BYTES` | no | 10485760 | per-file cap |
| `MAX_FILES` | no | 8 | max files returned |
| `EXEC_TIMEOUT_MS` | no | 120000 | hard cap per run |

## Deploy (anyrouters-prod, us-east1)
```bash
gcloud run deploy sandbox-sidecar \
  --source . --region us-east1 --project anyrouters-prod \
  --no-allow-unauthenticated \
  --set-secrets E2B_API_KEY=E2B_API_KEY:latest,INTERNAL_SECRET=SANDBOX_INTERNAL_SECRET:latest
```
Internal-only; the new-api service account is granted `run.invoker`.
