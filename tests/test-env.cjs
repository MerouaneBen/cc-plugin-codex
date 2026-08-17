/**
 * SPDX-License-Identifier: Apache-2.0
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");

// Unit tests exercise real state-path logic. Give every isolated Node test
// process its own Codex home so a review that runs `npm test` cannot mutate or
// delete the live review job that launched it.
if (!process.env.CC_TEST_ENV_ACTIVE) {
  const testHome = fs.mkdtempSync(
    path.join(os.tmpdir(), `cc-plugin-tests-${process.pid}-`)
  );
  process.env.CC_TEST_ENV_ACTIVE = "1";
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  delete process.env.CODEX_HOME;

  process.once("exit", () => {
    fs.rmSync(testHome, { recursive: true, force: true });
  });
}
