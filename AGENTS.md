# Repository Guidelines

## Project Structure & Module Organization

The Deno CLI lives in `src/`; `src/main.ts` assembles commands, while modules
such as `games.ts`, `config.ts`, and `browser.ts` own game definitions,
persisted configuration, and browser integration. Reusable game automation is
under `workflows/` as paired YAML and shell files. Tooling is declared in
`mise.toml`, Deno imports are pinned by `deno.jsonc` and `deno.lock`, and
release automation lives in `.github/workflows/release.yml` and
`.releaserc.json`. Build output belongs in ignored `dist/`.

## Build, Test, and Development Commands

Use `mise` so local work matches CI:

- `mise run check` runs Deno linting, formatting checks, and type checking.
- `mise run build` compiles `dist/konaste-x86_64-unknown-linux-gnu`; pass
  `--arch=aarch64-unknown-linux-gnu` for ARM64.
- `mise run install-cli` installs the development CLI into Deno's tool root.
- `mise exec -- deno run -A src/main.ts --help` runs the CLI directly without
  installing it.
- `mise exec -- hk fix` applies configured Deno fixes and validates Pkl files.

## Coding Style & Naming Conventions

Follow `deno fmt` defaults (two-space indentation, semicolons, and double
quotes). Use `camelCase` for values and functions, `PascalCase` for types, and
lowercase descriptive module names such as `winereg.ts`. Keep explicit `.ts`
extensions in relative imports. Prefer typed data models and small modules;
comments should explain non-obvious design intent, constraints, invariants, or
external behavior rather than restate code.

## Testing Guidelines

There is currently no standalone test suite or coverage threshold. Run
`mise run check` before submitting; do not introduce new failures, and document
any baseline failures. For important logic that types or static checks cannot
guarantee, add focused Deno tests named `*_test.ts` near the module and run them
with `mise exec -- deno test -A`. Use integration tests for external boundaries
when practical. Exercise affected CLI commands manually when behavior crosses
browser, desktop, Wine, OBS, or keyring boundaries.

## Commit & Pull Request Guidelines

Recent history follows concise Conventional Commit subjects: `feat:`, `fix:`,
`docs:`, `ci:`, `build:`, `style:`, and `chore:`. Keep each commit to one
logical change. Pull requests should explain user-visible impact, list
verification commands, link relevant issues, and include logs or screenshots
when browser or game-launch behavior changes. Never commit authorization URLs,
tokens, keyring contents, or files from `~/.config/konaste/`.
