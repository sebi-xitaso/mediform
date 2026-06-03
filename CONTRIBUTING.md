# Contributing to mediform

## Linting and formatting

We use [Biome](https://biomejs.dev) for both linting and formatting.

```bash
bun run lint      # check for violations (exits non-zero on errors)
bun run format    # apply safe fixes and format in place
```

Biome is configured in `biome.json` at the workspace root.
Run `bun run lint` before pushing; the pre-push hook (#66) will enforce this automatically once set up.

## Testing convention

We practise TDD. Choose the school that fits the unit under test:

### Chicago school (state-based)

Use when the subject is a **pure function or a value object** with no external collaborators.
Assert on the returned value or the observable state of the object.
No mocks needed.

Example: testing that `isTerminalStatus("retired")` returns `true`.

### London school (interaction-based)

Use when the subject **orchestrates collaborators** (e.g., a service that calls a repository and a FHIR client).
Mock every collaborator; assert that the right messages were sent with the right arguments.
The test should not touch a real database or network.

Example: testing that `submitForReview` calls `qualityCheckEngine.run(parsed)` and then `store.save(...)`.

### Rule of thumb

> If you can write the test without a mock, use Chicago.
> If the interesting behaviour is *who gets called and with what*, use London.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

Refs: #<issue-number>
```

Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `build`.

## Branch names

```
feature/<issue-number>-<short-description>
```

Example: `feature/9-bun-monorepo`.
