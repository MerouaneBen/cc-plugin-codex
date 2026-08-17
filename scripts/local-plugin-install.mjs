#!/usr/bin/env node

/**
 * Copyright 2026 Sendbird, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

console.error(
  [
    "Local checkout installs are no longer supported.",
    "Install cc from the maintained personal marketplace so Codex owns the active plugin cache:",
    "  codex plugin marketplace add MerouaneBen/cc-plugin-codex --ref main",
    "  codex plugin add cc@merouane",
    "Then start a new Codex task and run `$cc:setup`.",
  ].join("\n")
);
process.exit(1);
