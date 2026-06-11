# Seal Home Agent Notes

These are project-level instructions for AI coding agents working in this repository.

## Runtime

- Use Bun for this project.
- Install dependencies with `bun install` when local tools such as `tsc` are missing.
- Run validation with:
  - `bun run check`
  - `bun test`

## Network

- If GitHub or external network access times out, retry the specific command with the user's local proxy:
  - `https_proxy=http://127.0.0.1:7897`
  - `http_proxy=http://127.0.0.1:7897`
  - `all_proxy=socks5://127.0.0.1:7897`
- Use the proxy only when needed; do not bake it into committed scripts or application runtime defaults.

## Git And PR Flow

- Default branch is `master`.
- When the user says to "直接弄", "发布", "合并前准备", or otherwise asks to ship local changes, use the fixed publish flow:
  1. Inspect `git status --short --branch` and the diff.
  2. Create or use a `codex/<short-description>` branch.
  3. Stage only files that belong to the requested change.
  4. Commit with a terse descriptive message.
  5. Run `bun run check` and `bun test`.
  6. Push to `origin`.
  7. Open a draft PR to `master`.
- Do not merge directly to `master` unless the user explicitly requests a direct merge.
- Prefer draft PRs unless the user asks for ready-for-review.

## CLI Conventions

- Keep `src/cli.ts` thin. Shared behavior belongs under `src/core` or `src/domains`.
- CLI stdout should be JSON for command results. Diagnostics and errors go to stderr.
- Avoid printing sensitive values such as signed URLs, access tokens, refresh tokens, local temp paths, or full raw documents.

## Seal Approval Run Workflows

- Prefer lightweight approval run commands before fetching full records:
  - `seal-home approval-runs pick --sn <单号> --latest`
  - `seal-home approval-runs get <recordId> --summary`
  - `seal-home approval-runs document-summary <recordId>`
  - `seal-home approval-runs attachments <recordId> --summary`
  - `seal-home approval-runs result <recordId> --summary`
- For customer disputes where an attachment allegedly contains missing keywords or clauses, use:
  - `seal-home approval-runs attachment-dispute --sn <单号> --keywords 关键词1,关键词2`

## Documentation

- Update `README.md` for user-facing CLI behavior.
- Update `skills/seal-home/SKILL.md` and focused files under `skills/seal-home/references/` when agent-facing workflows change.
