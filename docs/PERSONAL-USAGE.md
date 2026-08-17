# Personal installation and project usage

This fork is maintained for personal use across trusted repositories. It keeps
the original Apache-2.0 attribution while using `MerouaneBen/cc-plugin-codex`
as the only distribution source.

OpenAI's plugin documentation recommends a marketplace for private or
repo-scoped distribution and requires a new Codex task after installation so
the installed skills and hooks are loaded. This repository therefore contains
its own `.agents/plugins/marketplace.json` and treats `main` as the installable
release line.

## Install once

Prerequisites:

- Node.js 18 or newer.
- A current Codex CLI or Codex desktop app with plugin support.
- Claude Code installed and authenticated: `claude auth status` must succeed.

Install from the maintained fork:

```bash
codex plugin marketplace add MerouaneBen/cc-plugin-codex --ref main
codex plugin add cc@merouane
```

Start a new Codex task, then run:

```text
$cc:setup
```

If setup asks for a restart, restart Codex, start another new task, and rerun
the same command. Setup is authoritative: do not assume hooks or writable state
roots are ready until it reports them ready.

Useful inventory commands:

```bash
codex plugin marketplace list
codex plugin list --marketplace merouane --available
```

## Configure an existing project

The plugin is installed once for Codex, not copied into every repository.
Project-specific policy belongs in the repository's root `AGENTS.md`. Add a
section like this and adapt the test command and base branch:

```md
## Claude Code peer workflow

- Run the project test command before requesting review.
- Use `$cc:review --background --scope working-tree --model haiku` for the
  normal pre-commit review of local changes.
- A queued job ID proves reservation only. Treat `$cc:status <job-id>` as the
  authority for launch and terminal status, and use `$cc:result <job-id>` for
  findings.
- Use `$cc:adversarial-review --background` for migrations, security-sensitive
  configuration, concurrency, or architecture changes.
- Use `$cc:rescue --fresh --write <task>` only when Claude is explicitly
  authorized to edit. Review its diff and rerun tests before committing.
- Reviews are read-only. Do not let review jobs commit, push, publish, deploy,
  or change the working tree.
- If a background job must stop, run `$cc:cancel <job-id>`. Repeating the same
  explicit cancellation is safe and must report the persisted terminal state.
```

No project `.codex/config.toml` entry is required for the plugin itself.
`$cc:setup` manages the global native-hook feature gates and plugin-data
writable roots. Keep repository behavior in `AGENTS.md`; keep one-off review
scope, model, and effort choices in the command that launches the job.

## Real use case: review a feature before commit

Assume an existing application has uncommitted implementation and tests.

1. Run the repository's own tests.
2. Launch a non-blocking, read-only review:

   ```text
   $cc:review --background --scope working-tree --model haiku
   ```

3. Save the returned job ID. The initial `queued` state is not proof that
   Claude started.
4. Verify materialization:

   ```text
   $cc:status review-abc123
   ```

   A launched background job exposes authoritative job state and a launch
   receipt. A failed forwarder becomes a stored failure instead of optimistic
   success.

5. Continue other work, then open the persisted result:

   ```text
   $cc:result review-abc123
   ```

6. Apply accepted fixes in Codex, rerun the project tests, and request another
   review because evidence from the previous diff is stale.
7. Commit only after the final tests and review pass.

For a risky migration, replace the first command with:

```text
$cc:adversarial-review --background --scope working-tree --model sonnet challenge rollback, concurrency, and data-loss assumptions
```

For a bounded implementation delegated to Claude:

```text
$cc:rescue --fresh --write implement the accepted fix only; run the focused tests and report changed files
```

## Cancellation behavior

`$cc:cancel <job-id>` supports every active lifecycle point:

- A reserved or queued job becomes terminal and releases `.reserve` / `.claim`
  routing markers.
- A running job is terminated only after PID identity validation.
- A failed termination becomes `cancel_failed` and retains PID/PGID recovery
  metadata instead of claiming success.
- A repeated explicit cancellation returns the stored terminal status without
  mutating it.
- If the cancel command itself is interrupted, stale `cancelling` state is
  recovered on the next state read.

When more than one job is active, always pass the job ID. The no-ID form fails
closed rather than guessing.

## Update and verify

After a new version lands on `main`:

```bash
codex plugin marketplace upgrade merouane
codex plugin add cc@merouane
```

Start a new Codex task and run `$cc:setup`. Then perform this smoke sequence in
a disposable repository:

```text
$cc:review --background --scope working-tree --model haiku
$cc:status <job-id>
$cc:result <job-id>
```

Also reserve or launch a slow disposable job, cancel it twice with the same ID,
and confirm both `$cc:status` and `$cc:result` report the same terminal job.

## Maintenance policy

- `main` is always installable.
- Develop on a focused branch and merge only after `npm run check` and GitHub CI
  pass.
- Bump `package.json` and `.codex-plugin/plugin.json` together for each release;
  the plugin cache is versioned.
- Add the release behavior to `CHANGELOG.md`.
- Keep a release tag for every installed version so rollback remains explicit.
- Preserve the original `LICENSE`, `NOTICE`, and attribution.
- Do not run or publish the removed Sendbird marketplace-update workflow.

Rollback is repository-controlled: check out the last known-good release tag,
make that release the current `main`, then refresh and reinstall from the
`merouane` marketplace. Verify `$cc:setup` and the smoke sequence before using
the rollback in a real project.

References:

- [OpenAI: package and distribute plugins](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
