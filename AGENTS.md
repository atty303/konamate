# Repository Guidance

## Verification

- Use `mise run check` as the common entry point for local and CI checks. Keep
  lightweight repository-wide checks in this task.
- For CLI changes, run `mise exec -- deno run -A src/main.ts --help` and
  exercise the affected command with isolated configuration when practical.
- Use `mise run build` to verify compilation. Build output belongs in the
  ignored `dist/` directory.
- Keep live integration checks separate from `mise run check`. Browser, desktop,
  Wine, OBS, and keyring operations can affect host state and require an
  isolated profile or explicit approval before using the real environment.

## Local State and Secrets

- Do not use the existing `~/.config/konaste/`, keyring entries, desktop
  associations, browser profile, or OBS configuration for verification. Use
  temporary paths and disposable state.
- Never commit authorization URLs, tokens, keyring contents, or files from
  `~/.config/konaste/`.

## Release Tasks

- `mise run prepare-release --version=<version>` rewrites the tracked
  `version.json` and builds release artifacts for both supported architectures.
  Run it only as part of the release workflow or when explicitly requested; it
  is not a routine verification command.
