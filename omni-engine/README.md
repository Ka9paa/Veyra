# Veyra Build — Omni Engine Core

Production-oriented reference workspace for Veyra's unified AI builder: canvas intelligence, cross-framework compilation, full-stack feature planning, multi-agent visual refinement, repair, and deployment orchestration.

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm dev
```

Engine runs on `http://localhost:8787`.

Endpoints:
- `GET /health`
- `POST /v1/canvas/interpret`
- `POST /v1/canvas/mutate`
- `POST /v1/features/amplify`
- `POST /v1/repair`
- `POST /v1/deploy`

## Provider config

Keep API keys server-side. Model IDs are configurable because provider catalogs change.

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

The OpenAI adapter uses the Responses API.
