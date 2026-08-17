/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Durable handshake for Codex-managed background forwarding agents.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  JOB_CLAIM_SUFFIX,
  JOB_RESERVATION_SUFFIX,
  generateJobId,
  nowIso,
  patchJob,
  readJobFile,
  resolveJobsDir,
  sanitizeId,
  writeJobFile,
} from "./state.mjs";

export const DEFAULT_BACKGROUND_LAUNCH_TIMEOUT_MS = 60_000;
export const DEFAULT_BACKGROUND_LAUNCH_POLL_INTERVAL_MS = 50;
export const BACKGROUND_LAUNCH_TIMEOUT_ENV = "CC_PLUGIN_BACKGROUND_LAUNCH_TIMEOUT_MS";

const MIN_BACKGROUND_LAUNCH_TIMEOUT_MS = 1_000;
const MAX_BACKGROUND_LAUNCH_TIMEOUT_MS = 15 * 60_000;

const SUCCESSFUL_LAUNCH_STATUSES = new Set(["queued", "running", "completed"]);
const ABORT_REASONS = new Set([
  "spawn-agent-unavailable",
  "spawn-agent-failed",
  "spawn-agent-no-id",
  "network-unavailable-no-escalation",
  "sandbox-escalation-forbidden",
  "forwarder-exec-rejected",
  "launch-receipt-failed",
  "launch-timeout",
]);

const ABORT_REASON_MESSAGES = new Map([
  [
    "network-unavailable-no-escalation",
    "Host network is unavailable and the approval policy forbids sandbox escalation; Claude Code was not started.",
  ],
  [
    "sandbox-escalation-forbidden",
    "The host approval policy forbids the required sandbox escalation; Claude Code was not started.",
  ],
  [
    "forwarder-exec-rejected",
    "Codex rejected the forwarding agent's companion command before Claude Code started.",
  ],
  [
    "launch-timeout",
    "The Codex forwarding agent did not materialize a Claude Code job before the launch timeout.",
  ],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveBackgroundLaunchTimeoutMs(value) {
  const configuredValue = value ?? process.env[BACKGROUND_LAUNCH_TIMEOUT_ENV];
  if (configuredValue == null || String(configuredValue).trim() === "") {
    return DEFAULT_BACKGROUND_LAUNCH_TIMEOUT_MS;
  }
  const parsed = Number(configuredValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BACKGROUND_LAUNCH_TIMEOUT_MS;
  }
  return Math.min(
    MAX_BACKGROUND_LAUNCH_TIMEOUT_MS,
    Math.max(MIN_BACKGROUND_LAUNCH_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

function resolveMarkerFile(workspaceRoot, jobId, suffix) {
  const safeJobId = sanitizeId(jobId, "job ID");
  return path.join(resolveJobsDir(workspaceRoot), `${safeJobId}${suffix}`);
}

export function resolveReservedJobFile(workspaceRoot, jobId) {
  return resolveMarkerFile(workspaceRoot, jobId, JOB_RESERVATION_SUFFIX);
}

export function resolveClaimedJobFile(workspaceRoot, jobId) {
  return resolveMarkerFile(workspaceRoot, jobId, JOB_CLAIM_SUFFIX);
}

function readMarkerFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readRoutingMarker(workspaceRoot, jobId) {
  return (
    readMarkerFile(resolveClaimedJobFile(workspaceRoot, jobId)) ??
    readMarkerFile(resolveReservedJobFile(workspaceRoot, jobId))
  );
}

export function reserveBackgroundJobId(workspaceRoot, options) {
  const prefix = sanitizeId(options.prefix, "job prefix");
  const label = options.label ?? prefix;
  const jobsDir = resolveJobsDir(workspaceRoot);
  const launchTimeoutMs = resolveBackgroundLaunchTimeoutMs(options.launchTimeoutMs);
  fs.mkdirSync(jobsDir, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateJobId(prefix);
    const reservationPath = resolveReservedJobFile(workspaceRoot, candidate);
    const payload = {
      jobId: candidate,
      kind: options.kind ?? prefix,
      workspaceRoot,
      ownerSessionId: options.ownerSessionId ?? null,
      parentThreadId: options.parentThreadId ?? null,
      reservedAt: nowIso(),
      routingState: "reserved",
    };
    try {
      fs.writeFileSync(
        reservationPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      if (options.materializePlaceholder) {
        const isReview = payload.kind === "review";
        writeJobFile(workspaceRoot, candidate, {
          id: candidate,
          kind: isReview ? "review" : "task",
          kindLabel: isReview ? "review" : "rescue",
          title: isReview ? "Claude Code Review" : "Claude Code Rescue",
          workspaceRoot,
          jobClass: isReview ? "review" : "task",
          summary: isReview
            ? "Background review awaiting forwarding agent"
            : "Background rescue awaiting forwarding agent",
          write: false,
          createdAt: payload.reservedAt,
          updatedAt: payload.reservedAt,
          status: "queued",
          phase: "queued",
          routingState: "reserved",
          launchDeadlineAt: new Date(
            Date.now() + launchTimeoutMs,
          ).toISOString(),
          ...(payload.ownerSessionId ? { sessionId: payload.ownerSessionId } : {}),
          ...(payload.parentThreadId ? { parentThreadId: payload.parentThreadId } : {}),
        });
      }
      return payload;
    } catch (error) {
      if (error?.code === "EEXIST") {
        continue;
      }
      try {
        fs.rmSync(reservationPath, { force: true });
      } catch {}
      throw error;
    }
  }

  throw new Error(`Failed to reserve a unique Claude Code ${label} job id.`);
}

export function claimBackgroundJobId(workspaceRoot, jobId, options = {}) {
  const safeJobId = sanitizeId(jobId, "job ID");
  const existingJob = readJobFile(workspaceRoot, safeJobId);
  const isRoutingPlaceholder =
    existingJob?.status === "queued" && existingJob?.routingState === "reserved";
  if (existingJob && !isRoutingPlaceholder) {
    throw new Error(`Claude Code job id ${safeJobId} already exists.`);
  }

  const reservationPath = resolveReservedJobFile(workspaceRoot, safeJobId);
  const claimPath = resolveClaimedJobFile(workspaceRoot, safeJobId);
  try {
    fs.renameSync(reservationPath, claimPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (fs.existsSync(claimPath)) {
        throw new Error(`Claude Code job id ${safeJobId} is already claimed.`);
      }
      throw new Error(
        `Claude Code job id ${safeJobId} is not reserved. Reserve one with the companion reserve-job helper before reusing it.`,
      );
    }
    throw error;
  }

  const marker = readMarkerFile(claimPath);
  if (!marker) {
    try {
      fs.renameSync(claimPath, reservationPath);
    } catch {}
    throw new Error(`Claude Code job id ${safeJobId} has an invalid reservation.`);
  }
  const routingClaimedAt = nowIso();
  const launchTimeoutMs = resolveBackgroundLaunchTimeoutMs(options.launchTimeoutMs);
  patchJob(workspaceRoot, safeJobId, {
    routingState: "claimed",
    routingClaimedAt,
    launchDeadlineAt: new Date(
      Date.parse(routingClaimedAt) + launchTimeoutMs,
    ).toISOString(),
  });
  return marker;
}

export function releaseBackgroundJobId(workspaceRoot, jobId) {
  for (const markerPath of [
    resolveReservedJobFile(workspaceRoot, jobId),
    resolveClaimedJobFile(workspaceRoot, jobId),
  ]) {
    try {
      fs.rmSync(markerPath, { force: true });
    } catch {}
  }
}

function createLaunchFailureRecord(workspaceRoot, jobId, marker, reason, forwardingAgentId) {
  const completedAt = nowIso();
  const isReview = marker?.kind === "review";
  const safeReason = ABORT_REASONS.has(reason) ? reason : "launch-receipt-failed";
  const errorMessage =
    ABORT_REASON_MESSAGES.get(safeReason) ??
    `The Codex forwarding agent failed before Claude Code started (${safeReason}).`;
  const record = {
    id: jobId,
    kind: isReview ? "review" : "task",
    kindLabel: isReview ? "review" : "rescue",
    title: isReview ? "Claude Code Review" : "Claude Code Rescue",
    workspaceRoot,
    jobClass: isReview ? "review" : "task",
    summary: isReview
      ? "Background review failed before launch"
      : "Background rescue failed before launch",
    write: false,
    createdAt: marker?.reservedAt ?? completedAt,
    updatedAt: completedAt,
    completedAt,
    status: "failed",
    phase: "failed",
    routingState: "failed",
    routingFailureReason: safeReason,
    errorMessage,
    ...(marker?.ownerSessionId ? { sessionId: marker.ownerSessionId } : {}),
    ...(marker?.parentThreadId ? { parentThreadId: marker.parentThreadId } : {}),
    ...(forwardingAgentId ? { forwardingAgentId } : {}),
  };
  writeJobFile(workspaceRoot, jobId, record);
  releaseBackgroundJobId(workspaceRoot, jobId);
  return record;
}

export function abortBackgroundLaunch(workspaceRoot, jobId, options = {}) {
  const safeJobId = sanitizeId(jobId, "job ID");
  const existing = readJobFile(workspaceRoot, safeJobId);
  const isAbortablePlaceholder =
    existing?.status === "queued" &&
    ["reserved", "claimed"].includes(existing?.routingState);
  if (existing && !isAbortablePlaceholder) {
    throw new Error(
      `Claude Code job ${safeJobId} already materialized with status ${existing.status}.`,
    );
  }
  const marker = readRoutingMarker(workspaceRoot, safeJobId) ?? existing;
  if (!marker) {
    throw new Error(`Claude Code job id ${safeJobId} is not reserved.`);
  }
  return createLaunchFailureRecord(
    workspaceRoot,
    safeJobId,
    marker,
    options.reason ?? "launch-receipt-failed",
    options.forwardingAgentId ?? null,
  );
}

export async function waitForBackgroundLaunchReceipt(workspaceRoot, jobId, options = {}) {
  const safeJobId = sanitizeId(jobId, "job ID");
  const forwardingAgentId = sanitizeId(options.forwardingAgentId, "forwarding agent ID");
  const timeoutMs = options.timeoutMs == null
    ? resolveBackgroundLaunchTimeoutMs()
    : Math.max(1, Number(options.timeoutMs) || DEFAULT_BACKGROUND_LAUNCH_TIMEOUT_MS);
  const pollIntervalMs = Math.max(
    10,
    Number(options.pollIntervalMs) || DEFAULT_BACKGROUND_LAUNCH_POLL_INTERVAL_MS,
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const storedJob = readJobFile(workspaceRoot, safeJobId);
    if (storedJob) {
      if (
        storedJob.status === "queued" &&
        ["reserved", "claimed"].includes(storedJob.routingState) &&
        !storedJob.launchReceipt
      ) {
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
        continue;
      }
      if (!SUCCESSFUL_LAUNCH_STATUSES.has(storedJob.status)) {
        releaseBackgroundJobId(workspaceRoot, safeJobId);
        throw new Error(
          `Claude Code job ${safeJobId} materialized with terminal status ${storedJob.status}.`,
        );
      }
      if (
        storedJob.forwardingAgentId &&
        storedJob.forwardingAgentId !== forwardingAgentId
      ) {
        throw new Error(
          `Claude Code job ${safeJobId} already belongs to forwarding agent ${storedJob.forwardingAgentId}.`,
        );
      }
      const launchReceipt =
        storedJob.launchReceipt ?? `launch-${randomBytes(8).toString("hex")}`;
      const launchConfirmedAt = storedJob.launchConfirmedAt ?? nowIso();
      const confirmedJob = patchJob(workspaceRoot, safeJobId, {
        forwardingAgentId,
        launchReceipt,
        launchConfirmedAt,
        routingState: "launched",
      });
      releaseBackgroundJobId(workspaceRoot, safeJobId);
      return {
        workspaceRoot,
        jobId: safeJobId,
        forwardingAgentId,
        launchReceipt,
        status: confirmedJob?.status ?? storedJob.status,
        phase: confirmedJob?.phase ?? storedJob.phase ?? null,
        launchConfirmedAt,
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  const failure = abortBackgroundLaunch(workspaceRoot, safeJobId, {
    reason: "launch-timeout",
    forwardingAgentId,
  });
  throw new Error(`${failure.errorMessage} Job: ${safeJobId}.`);
}
