// The demo stack shown in the atlas.yaml section (StackVisualizer). Names and ports match the real footage in public/media
// (the orbit-shop demo project recorded from Atlas Desktop).

export const YAML = `name: orbit-shop

infra:
  compose_file: docker-compose.yml

services:
  database:
    port: 54320
  migrate:
    command: bun run db:migrate
    oneshot: true
    depends_on: { database: healthy }
  api:
    command: bun run dev:api
    port: 4100
    health: http://localhost:4100/health
    depends_on: { migrate: completed_successfully }
  web:
    command: bun run dev:web
    port: 4101
    depends_on: { api: healthy }
  worker:
    command: bun run dev:worker
    restart: on_failure
    depends_on: { api: healthy }`;
