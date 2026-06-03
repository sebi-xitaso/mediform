# Project: mediform

## Key Documents
- PRD: src/docs/specs/prd.adoc
- Specification: src/docs/specs/
- Architecture: src/docs/arc42/
- Reviews: src/docs/reviews/

## Conventions
- Documentation: Plain English according to Strunk & White
- Testing: TDD (London or Chicago School as appropriate)
- Code: DRY, SOLID, KISS, Ubiquitous Language (DDD)
- Commits: Conventional Commits, reference issue number
- Branches: feature/<issue-number>-<issue-description>
- Use github mcp server for all request regarding github

## Where to Start

The backlog is tracked on GitHub Issues with MoSCoW priorities and dependency cross-references.

**Next up — foundation stories (unblock everything else):**
- #65 Set up Biome for linting and formatting
- #67 SQLite with repository pattern (replace in-memory store)
- #68 Eden Treaty type-safe API client for both SPAs
- #66 Pre-push hook (depends on #65)
- #12 Local HAPI FHIR via docker-compose

**Then — backend endpoints (need #67):**
- #28 POST submit for review (SUC-07)
- #37 POST publish (SUC-12)
- #38 POST retire (SUC-13)
- #19 POST submit response (SUC-02), #20 GET completed response (SUC-03)

**Then — UI (need #68):**
- #30–#35 Employee app stories
- #21–#24 Patient app stories

Stories labeled `open-decision` require an architecture decision before implementation — read the referenced ADR or PRD section first.

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

