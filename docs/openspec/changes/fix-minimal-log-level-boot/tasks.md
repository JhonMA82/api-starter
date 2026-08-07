# Tasks: fix-minimal-log-level-boot

- [x] Reproduce bug: generate minimal project and confirm LOG_LEVEL ConfigError without .env
- [x] Fix `packages/config/src/env.ts`: add `.default("info")` to LOG_LEVEL
- [x] Fix `generator/src/create-project.ts`: always include `cp .env.example .env` in GENERATED.md and printSummary
- [x] Update `docs/reference/environment.md`: reflect LOG_LEVEL default
- [x] Update `packages/config/src/env.test.ts`: adjust missing LOG_LEVEL expectation and ConfigError test
- [x] Verify generated minimal boots without .env and with cp
- [x] Run relevant tests: `bun test`, `bun run typecheck`, `bun run lint`, generator tests
