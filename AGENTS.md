# Repository Guidelines

## Project Structure & Module Organization

This is a Bun + TypeScript toolkit for the `seal-home` CLI and optional MCP server. Entry points are `src/cli.ts`, `src/server.ts`, and `src/probe.ts`. Shared config, auth, token, and HTTP code is under `src/core/`. Seal-specific API and tool logic is under `src/domains/seal/`.

Tests are colocated as `*.test.ts` files in `src/`. OpenAPI source YAML lives in `openapi/`; bundled output is `dist/openapi.json`. Example enterprise configs are in `enterprises/example.*.json`; real configs must stay untracked. Project skills live under `skills/seal-home/`.

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run dev`: run `src/server.ts` with watch mode.
- `bun run start`: run the MCP server once.
- `bun run cli -- <args>`: execute CLI commands, such as `bun run cli version`.
- `bun run probe`: run the local connectivity/config probe.
- `bun run check`: type-check with `tsc --noEmit`.
- `bun test`: run all colocated Bun tests.
- `bun run openapi:bundle`: rebuild `dist/openapi.json`.

## Coding Style & Naming Conventions

Use TypeScript ES modules with explicit `.js` import extensions for local files. Validate external data with Zod or narrow types before use. Follow existing style: two-space indentation, double quotes, omitted trailing semicolons, `camelCase` variables/functions, `PascalCase` classes/types, and lowercase hyphenated filenames such as `token-store.ts`.

Prefer small domain functions over broad utility modules. Keep CLI output JSON on stdout and diagnostics/errors on stderr.

## Testing Guidelines

Use `bun:test` with `describe`, `test`, and `expect`. Place tests next to covered code using `name.test.ts`, for example `src/core/config/loader.test.ts`. Tests that change environment variables or working directories must restore them in `afterEach`.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects, often `Add ...` or `Refine ...`, such as `Add compact approval rule listing`. Keep subjects under roughly 72 characters.

Pull requests should include a short summary, tests run, and any config or OpenAPI regeneration notes. Link related issues when available. Add screenshots only for UI or documentation rendering changes.

## Security & Configuration Tips

Never commit real enterprise credentials, Seal tokens, service logs, or local generated state. Use `enterprises/example.hose.json` or `enterprises/example.direct.json` as templates, then place real configs in `enterprises/local.json` or `~/.config/seal-home/enterprises`. For auth or tenant changes, verify with `bun run probe` or `seal-home auth diagnose`.

## Agent-Specific Instructions

Do not create `.codex/skills`; Codex is compatible with `.agents/skills`, and this project treats `.agents/` as authoritative. At project scope, prefer `AGENT.md` instructions when present.
