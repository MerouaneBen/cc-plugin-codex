# Claude Code Review Runtime Reference

Use this document only when the main Codex thread or a built-in forwarding child is executing a Claude Code `review` or `adversarial-review` command.
This is an internal runtime reference, not a public skill. It captures the exact companion-command contract and the foreground/background execution boundary.
The public skill already resolved the active plugin root from its `SKILL.md` path. Reuse that path here. Do not derive a new runtime path from this document or the current working tree.

Primary helper:
- `node "<plugin-root>/scripts/claude-companion.mjs" review ...`
- `node "<plugin-root>/scripts/claude-companion.mjs" adversarial-review ...`

Execution boundary:
- Foreground review stays on the main Codex thread. Do not satisfy foreground review through a review subagent, a generic review-runner role, or any background worker abstraction.
- Background review uses exactly one built-in forwarding child through `spawn_agent`.
- Never satisfy either mode with raw `claude`, `claude-code`, `claude review`, hand-rolled `bash -lc ...claude...`, or detached companion shell backgrounding.
- If the resolved companion command fails, surface that failure instead of improvising a different executor.

Foreground contract:
- Strip `--wait` and `--background` before building the companion command.
- Foreground command:
  - `review --view-state on-success ...`
  - `adversarial-review --view-state on-success ...`
- Resolve permissions from explicit host context before running the companion. If host network is enabled, omit `sandbox_permissions`, including under approval policy `Never`. If network is unavailable and escalation is permitted, use `sandbox_permissions: "require_escalated"` with the justification `Allow the Claude Code companion to contact the Claude API for this requested review.` If network is unavailable and approval policy is `Never`, do not invoke the companion; foreground returns `network-unavailable-no-escalation`, while background reserves the job then runs `background-launch-abort --reason network-unavailable-no-escalation` without spawning a child. Treat unstated network availability as unavailable. Never probe the policy with a deliberately rejected escalation request.
- Return companion stdout faithfully and do not add review execution commentary around it.

Background contract:
- Use `background-routing-context --kind review --json` before spawning the forwarding child.
- Require a non-empty forwarding-agent id from the actual `spawn_agent` tool result. Assistant intent or prose is not evidence that the child was accepted.
- If `spawn_agent` is unavailable or fails, run `background-launch-abort` for the reserved job and do not use success language.
- After `spawn_agent` accepts the child, report only that forwarding is queued and launch is not yet verified. An asynchronous spawn ends the parent turn before materialization can be confirmed reliably.
- The reserved job is visible as `queued`; the child records routing state `launched` and a non-empty launch receipt when the companion command starts. `$cc:status <job-id>` is the durable authority, and an unmaterialized reservation becomes `failed` after the bounded deadline.
- Preserve `--job-id` only when reserved by the parent helper.
- Whenever preserving that reserved `--job-id`, also pass `--cwd <workspace-root>` using `workspaceRoot` from the same helper response. Reserved job ids are workspace-scoped.
- Preserve `--owner-session-id` only when the parent helper returned a non-empty owner session id.
- Preserve the parent notification path only when the helper returned a non-empty parent thread id.
- Never emit an empty routing placeholder such as `--owner-session-id  --job-id`.
- The built-in child runs exactly one shell command:
  - `review --view-state defer ...`
  - `adversarial-review --view-state defer ...`
- The child must be a pure forwarder:
  - return stdout only
  - ignore stderr progress chatter such as `[cc] ...`
  - do not inspect the repo or perform the review itself
  - run the companion command as one blocking foreground shell-tool call, not as a background terminal/session
  - do not request a shell session id, poll a shell session later, or return before the companion command exits
  - if the available shell tool is `exec_command`, call it once in non-interactive mode and wait for command exit in that same call
  - when using `exec_command`, apply the host permission matrix above and make exactly one valid call
  - if the child command is rejected before launch, the forwarding child makes exactly one local recovery call without `sandbox_permissions`: `background-launch-abort --job-id <reserved-job-id> --reason forwarder-exec-rejected --cwd <workspace-root> --json`; this recovery call is the sole exception to the one-command rule
  - use at most one `send_input` completion notification on success
  - mention the tool name `send_input` literally in the child instructions
  - use the exact tool shape `send_input({ target: <parent-thread-id>, message: <steering-message> })`
  - do not silently drop the completion notification path when the parent provided a non-empty parent thread id

Spawn-agent defaults:
- `fork_context: false`
- `reasoning_effort: "medium"`
- Omit `agent_type` and `model`. The child then uses the built-in default agent and inherits the parent model. Codex only advertises `agent_type` when custom agents are configured, and it owns the model catalog, so pinning either one breaks across host releases.

Completion steering:
- When a reserved review job id exists, steer to:
  - `Background Claude Code review finished. Open it with $cc:result <reserved-job-id>.`
  - `Background Claude Code adversarial review finished. Open it with $cc:result <reserved-job-id>.`
- Otherwise steer to `$cc:status` first, then `$cc:result`.
- Use that same steering message as the child's own final assistant message for background mode.
- Never inline raw review text in the notification or in the child's final assistant message for background mode.
