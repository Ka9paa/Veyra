# Operations

## Windows / Git Bash

```bash
cd ~/Downloads
unzip VEYRA_BUILD_OMNI_ENGINE.zip
cd VEYRA_BUILD_OMNI_ENGINE
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm dev
```

## macOS / Linux

```bash
unzip VEYRA_BUILD_OMNI_ENGINE.zip
cd VEYRA_BUILD_OMNI_ENGINE
corepack enable
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm dev
```

Production: managed Postgres with PITR, Redis HA, isolated build runners, secret manager, centralized logs/traces, queue workers, canary rollout, and rollback.
