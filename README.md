# mediform

A custom DSL and LLM-assisted authoring tool for clinical questionnaires that compiles to FHIR R4.

## Workspace layout

This is a Bun monorepo. The workspace contains four packages:

| Package | Path | Role |
|---|---|---|
| `mediform-core` | `packages/mediform-core` | Shared types, parser, and FHIR compiler. All other packages import from here. |
| `api` | `apps/api` | Elysia HTTP server. Serves all REST endpoints (SUC-01 through SUC-14). |
| `patient` | `apps/patient` | Svelte SPA for patients. Routes under `/q/:id` and `/r/:responseId`. |
| `employee` | `apps/employee` | Svelte SPA for nurses and trained staff. Routes under `/staff/*`. |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://www.docker.com) (for HAPI FHIR — see issue #12)

## Getting started

```sh
# Install all workspace dependencies
bun install

# Run the API server in watch mode
bun run dev:api

# Type-check all packages
bun run typecheck

# Run all tests
bun test
```

## HAPI FHIR (local dev)

A `docker-compose.yml` at the workspace root starts a local HAPI FHIR R4 server on port 8080.

```sh
# Start the HAPI FHIR server in the background
docker compose up hapi -d

# Stop the server (data volume is preserved)
docker compose down

# Stop the server and remove all persisted data
docker compose down -v
```

The server exposes its capability statement at `http://localhost:8080/fhir/metadata`.
The API reads `HAPI_BASE_URL` (default: `http://localhost:8080/fhir`) to reach it.

## Contributing

See `CONTRIBUTING.md` for the TDD convention (London vs. Chicago school) and commit message format.
