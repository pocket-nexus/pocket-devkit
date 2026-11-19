# Repository Instructions

- Layout: one directory per device (`vita/` today); `vendor/pocketjs` is the
  PocketJS submodule every tool imports from. Do not add directories for
  devices that have no system yet. README.md describes `vita/`.
- The loop: `bun run setup` once, `bun run check` (type check and host tests)
  before every commit, `bun run vita build` for the VPK (requires `$VITASDK`;
  `bun vita/tools/sdk.ts <dir>` installs the pinned one). Nothing here runs on a
  device or emulator in CI; physical results go in the PR description.
- When the submodule moves: rerun `bun run check`; if `vita/test/lockfile.test.ts`
  fails, copy `vendor/pocketjs/Cargo.lock` to `vita/program/Cargo.lock` and run
  `cargo metadata` in `vita/program` to prune it.
- Import PocketJS tools by relative path into `vendor/pocketjs`; application
  code imports `@pocketjs/framework/*` and Solid from `solid-js`.
- Commits and pull requests use Conventional Commits: `type(scope): summary`,
  for example `feat(vita): …`, `fix: …`, `docs: …`. No Co-authored-by trailer.
- Keep validation logs, captures and build receipts in ignored
  `.pocket-build/validation/<task>/<run>/`, not in Git.
- Documentation prose states the mechanism and bolds concrete engineering
  facts. No slogans, no meta-framing, no empty intensifiers ("simply",
  "elegant"), and no adverbs modifying a verb or adjective ("just",
  "actually", "properly"): delete the adverb or replace it with the fact.
- Design and planning documents stay out of the repository.
