# Codex-managed background agent POC

## Goal

Validate, inside this fork and without touching DocFlow, that Codex can remain the
manager while a built-in Codex forwarding child launches one Claude Code task and
stores durable, truthful lifecycle evidence.

The POC is successful only when the stored job state distinguishes all three
conditions below:

1. forwarding was accepted by Codex but Claude Code is not yet verified;
2. the companion process really started and produced a launch receipt;
3. forwarding failed or never materialized before the launch deadline.

## Scope

Included:

- `$cc:review --background`;
- `$cc:adversarial-review --background`;
- background `$cc:rescue` routing contracts;
- durable reservation, claim, launch, timeout, status, result, and cleanup state;
- mock-provider E2E tests that execute the actual Codex `spawn_agent` path;
- compatibility with the existing foreground and explicit reservation flows.

Excluded:

- installing this fork in DocFlow;
- allowing concurrent Codex and Claude writers in one checkout;
- production credentials, deployments, or external side effects;
- choosing a general multi-provider control plane;
- publishing a release or opening an upstream pull request.

## Lifecycle contract

| State | Meaning | Permitted user-facing claim |
| --- | --- | --- |
| `queued` + `reserved` | Job id exists; no forwarding child has claimed it | Forwarding is queued; launch is not verified |
| `queued` + `claimed` | One child atomically owns the reservation | Forwarding is queued; launch is not verified |
| `running`/`completed` + `launched` + receipt | Companion job materialized | Claude Code started |
| `failed` + routing failure reason | Spawn failed or launch deadline expired | Launch failed, with the stored reason |

The parent must never infer launch from assistant prose or from the `spawn_agent`
request alone. `$cc:status <job-id>` is the durable authority.

## Controlled scenarios

| ID | Scenario | Expected evidence |
| --- | --- | --- |
| S1 | Reserve a background review | A visible `queued` job with `routingState: reserved` and a bounded deadline |
| S2 | Spawn a real Codex forwarding child | The child runs exactly one foreground companion command |
| S3 | Companion materializes | Atomic claim, `routingState: launched`, non-empty `launchReceipt`, and terminal result addressable by job id |
| S4 | `spawn_agent` is unavailable or fails | Stored failed job with a specific routing failure reason; no success wording |
| S5 | Child never materializes | Status lookup reaps the reservation to `failed` with `launch-timeout` |
| S6 | Duplicate or late child | Claim is rejected and a prior launch failure cannot be overwritten |
| S7 | Existing foreground/reservation flows | No regression in task, review, resume, concurrency, cancel, or result behavior |
| S8 | Cross-platform/project gate | Lint, typecheck, unit, integration, and Codex E2E suites all pass |

## Success criteria

- No optimistic “started” message exists before durable launch evidence.
- A queued reservation is visible through status immediately.
- Exactly one child can claim a reserved job id.
- A child-created launch receipt is stable and visible in status output.
- Missing launchers and bounded timeouts create inspectable failed jobs.
- Late children cannot overwrite terminal launch failure state.
- Existing foreground, background worker, resume, cancellation, and concurrency
  tests remain green.
- The full `npm run check` gate passes from a clean dependency install.
- No DocFlow file, credential, environment, or runtime is used by this POC.

## Evidence commands

```bash
npm ci
npm run check
node --test --test-name-pattern='review --background through' tests/e2e/codex-skills-e2e.test.mjs
```

The E2E provider must not hard-code success state in place of the companion. The
test must reserve a real job id, execute the child companion command, then assert
the stored terminal job, routing state, and launch receipt.

## Adoption sequence

1. Complete and review this repository-contained POC.
2. Install an immutable commit from this fork into a disposable, non-DocFlow test
   repository and run one real read-only Claude review.
3. Compare reliability, latency, cost, cancellation, and failure evidence with
   native Codex delegation.
4. Decide whether to upstream, maintain the fork, or stop.
5. Only after an explicit go decision, design a separate DocFlow pilot in an
   isolated worktree with read-only Claude scope and DocFlow-specific gates.
