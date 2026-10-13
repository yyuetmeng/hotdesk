# Web App Backend

Flask REST API with a Supabase (Postgres) connector.

## Healthcheck

Start the server first:

```bat
python run.py
```

| Endpoint | Purpose | curl command |
|---|---|---|
| `GET /api/health` | API liveness | `curl http://127.0.0.1:5000/api/health` |
| `GET /api/health/db` | Database connectivity | `curl http://127.0.0.1:5000/api/health/db` |

Expected responses:

```json
{ "status": "ok" }
```

```json
{ "status": "ok", "database": "connected" }
```

If the database check fails it returns HTTP `503` with:

```json
{ "status": "error", "database": "<error detail>" }
```
