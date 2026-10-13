// node --test infra/render-app-spec.test.mjs  (needs bash + jq, both on CI runners)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./render-app-spec.sh", import.meta.url));
const DIGEST = `sha256:${"a".repeat(64)}`;
const VPC = "11111111-2222-4333-8444-555555555555";

const committed = {
  name: "x",
  vpc: { id: "__VPC_ID__" },
  jobs: [{ name: "migrate", image: { digest: "__IMAGE_DIGEST__" }, envs: [{ key: "DATABASE_URL_MIGRATION", type: "SECRET" }] }],
  services: [
    {
      name: "web",
      image: { digest: "__IMAGE_DIGEST__" },
      envs: [{ key: "LOG_LEVEL", value: "info" }, { key: "DATABASE_URL", type: "SECRET" }],
    },
  ],
  workers: [{ name: "worker", image: { digest: "__IMAGE_DIGEST__" }, envs: [{ key: "DATABASE_URL", type: "SECRET" }] }],
};
const live = {
  jobs: [{ name: "migrate", envs: [{ key: "DATABASE_URL_MIGRATION", type: "SECRET", value: "EV[1:mig]" }] }],
  services: [{ name: "web", envs: [{ key: "DATABASE_URL", type: "SECRET", value: "EV[1:web]" }] }],
  workers: [{ name: "worker", envs: [{ key: "DATABASE_URL", type: "SECRET", value: "EV[1:wrk]" }] }],
};

function render(spec, liveSpec, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  const livePath = path.join(dir, "live.json");
  writeFileSync(livePath, JSON.stringify(liveSpec));
  return spawnSync("bash", [SCRIPT, livePath], {
    input: JSON.stringify(spec),
    encoding: "utf8",
    env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, ...env },
  });
}

test("fills placeholders and copies each secret from the SAME component (same key, different value)", () => {
  const r = render(committed, live);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.vpc.id, VPC);
  assert.equal(out.services[0].image.digest, DIGEST);
  assert.equal(out.services[0].envs[1].value, "EV[1:web]");
  assert.equal(out.workers[0].envs[0].value, "EV[1:wrk]");
  assert.equal(out.jobs[0].envs[0].value, "EV[1:mig]");
});

test("fails closed when a secret is missing in the live app, naming it", () => {
  const r = render(committed, { ...live, workers: [{ name: "worker", envs: [] }] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing secret in live app: workers\/worker\/DATABASE_URL/);
  assert.equal(r.stdout, "");
});

test("does not let a secret on one component satisfy another (migration URL never reaches runtime)", () => {
  const spec = JSON.parse(JSON.stringify(committed));
  spec.services[0].envs.push({ key: "DATABASE_URL_MIGRATION", type: "SECRET" });
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /services\/web\/DATABASE_URL_MIGRATION/);
});

test("rejects a malformed digest, a non-UUID VPC, and an unresolved placeholder", () => {
  assert.notEqual(render(committed, live, { IMAGE_DIGEST: "latest" }).status, 0);
  assert.notEqual(render(committed, live, { VPC_ID: "abc" }).status, 0);
  const spec = JSON.parse(JSON.stringify(committed));
  spec.domains = [{ domain: "__APP_DOMAIN__" }];
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unresolved placeholder: __APP_DOMAIN__/);
  assert.equal(JSON.parse(render(spec, live, { APP_DOMAIN: "app.example.com" }).stdout).domains[0].domain, "app.example.com");
});
