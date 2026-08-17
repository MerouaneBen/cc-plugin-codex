/**
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

describe("personal fork distribution", () => {
  it("publishes a complete self-hosted marketplace entry", () => {
    const marketplace = JSON.parse(read(".agents/plugins/marketplace.json"));
    assert.equal(marketplace.name, "merouane");
    assert.equal(marketplace.interface.displayName, "Merouane Personal Plugins");
    assert.equal(marketplace.plugins.length, 1);

    const [plugin] = marketplace.plugins;
    assert.equal(plugin.name, "cc");
    assert.deepEqual(plugin.source, {
      source: "url",
      url: "https://github.com/MerouaneBen/cc-plugin-codex.git",
      ref: "main",
    });
    assert.deepEqual(plugin.policy, {
      installation: "AVAILABLE",
      authentication: "ON_USE",
    });
    assert.equal(plugin.category, "Coding");
  });

  it("keeps package and plugin metadata on the maintained fork", () => {
    const packageJson = JSON.parse(read("package.json"));
    const pluginJson = JSON.parse(read(".codex-plugin/plugin.json"));

    assert.equal(packageJson.version, pluginJson.version);
    assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.equal(packageJson.homepage, "https://github.com/MerouaneBen/cc-plugin-codex");
    assert.equal(
      packageJson.repository.url,
      "git+https://github.com/MerouaneBen/cc-plugin-codex.git"
    );
    assert.equal(pluginJson.repository, "https://github.com/MerouaneBen/cc-plugin-codex");
    assert.match(pluginJson.interface.developerName, /MerouaneBen/);
  });

  it("preserves the upstream license and attribution files", () => {
    for (const fileName of ["LICENSE", "NOTICE"]) {
      assert.equal(fs.existsSync(path.join(PROJECT_ROOT, fileName)), true);
      assert.notEqual(read(fileName).trim(), "");
    }
  });

  it("defaults every supported installer to the maintained marketplace", () => {
    const installer = read("scripts/installer-cli.mjs");
    const localInstall = read("scripts/local-plugin-install.mjs");
    const installShell = read("scripts/install.sh");
    const uninstallShell = read("scripts/uninstall.sh");

    assert.match(installer, /DEFAULT_MARKETPLACE_NAME = "merouane"/);
    assert.match(installer, /DEFAULT_MARKETPLACE_SOURCE = "MerouaneBen\/cc-plugin-codex"/);
    assert.match(localInstall, /codex plugin add cc@merouane/);
    for (const shellScript of [installShell, uninstallShell]) {
      assert.match(shellScript, /github\.com\/MerouaneBen\/cc-plugin-codex/);
      assert.doesNotMatch(shellScript, /github\.com\/sendbird\/cc-plugin-codex/);
    }
  });

  it("does not retain workflows that publish to Sendbird or npm", () => {
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, ".github", "workflows", "update-marketplace.yml")),
      false
    );
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, ".github", "workflows", "publish.yml")),
      false
    );
  });

  it("documents install, project policy, real use, update, and rollback", () => {
    const guide = read("docs/PERSONAL-USAGE.md");
    assert.match(guide, /codex plugin marketplace add MerouaneBen\/cc-plugin-codex --ref main/);
    assert.match(guide, /codex plugin add cc@merouane/);
    assert.match(guide, /Configure an existing project/);
    assert.match(guide, /Real use case/);
    assert.match(guide, /Update and verify/);
    assert.match(guide, /Rollback/);
  });
});
