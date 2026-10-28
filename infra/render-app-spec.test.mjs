// node --test infra/render-app-spec.test.mjs  (needs bash + jq, both on CI runners)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  jobs: [{ name: "migrate", kind: "PRE_DEPLOY", image: { digest: "__IMAGE_DIGEST__" }, envs: [{ key: "DATABASE_URL_MIGRATION", type: "SECRET" }] }],
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
  // Placeholder-shaped on purpose: a copied value is never substituted or scanned (test 1 fails otherwise).
  services: [{ name: "web", envs: [{ key: "DATABASE_URL", type: "SECRET", value: "EV[1:__WEB__]" }] }],
  workers: [{ name: "worker", envs: [{ key: "DATABASE_URL", type: "SECRET", value: "EV[1:wrk]" }] }],
};

// Each call writes its fake live spec to its own dir, makes that dir the spawned bash's TMPDIR (its
// here-string temp file lands there, not in the system temp dir) and removes it afterwards.
function render(spec, liveSpec, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  try {
    const livePath = path.join(dir, "live.json");
    writeFileSync(livePath, JSON.stringify(liveSpec));
    return spawnSync("bash", [SCRIPT, livePath], {
      input: JSON.stringify(spec),
      encoding: "utf8",
      env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, TMPDIR: dir, ...env },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("fills placeholders and copies each secret from the SAME component (same key, different value)", () => {
  const r = render(committed, live);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.vpc.id, VPC);
  assert.equal(out.services[0].image.digest, DIGEST);
  assert.equal(out.services[0].envs[1].value, "EV[1:__WEB__]");
  assert.equal(out.workers[0].envs[0].value, "EV[1:wrk]");
  assert.equal(out.jobs[0].envs[0].value, "EV[1:mig]");
});

test("fails closed when a secret is missing in the live app, naming it", () => {
  const r = render(committed, { ...live, workers: [{ name: "worker", envs: [] }] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing secret in live app: workers\/worker\/DATABASE_URL/);
  assert.equal(r.stdout, "");
  // A masked (or plain) live value would be submitted as a NEW value: refused, naming the key only.
  const masked = render(committed, {
    ...live,
    workers: [{ name: "worker", envs: [{ key: "DATABASE_URL", type: "SECRET", value: "********" }] }],
  });
  assert.notEqual(masked.status, 0);
  assert.match(masked.stderr, /live secret is not an EV ciphertext: workers\/worker\/DATABASE_URL/);
  assert.doesNotMatch(masked.stderr, /\*{8}/);
  assert.equal(masked.stdout, "");
});

test("DATABASE_URL_MIGRATION outside the PRE_DEPLOY job FAILS the render (closed-set guard)", () => {
  const surfaces = {
    services: (spec) => spec.services[0].envs.push({ key: "DATABASE_URL_MIGRATION", value: "x" }),
    workers: (spec) => spec.workers[0].envs.push({ key: "DATABASE_URL_MIGRATION", value: "x" }),
    functions: (spec) => (spec.functions = [{ name: "f", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }]),
    static_sites: (spec) => (spec.static_sites = [{ name: "s", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }]),
    "top-level envs": (spec) => (spec.envs = [{ key: "DATABASE_URL_MIGRATION", value: "x" }]),
    "POST_DEPLOY job": (spec) =>
      spec.jobs.push({ name: "post", kind: "POST_DEPLOY", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }),
  };
  for (const [name, mutate] of Object.entries(surfaces)) {
    const spec = JSON.parse(JSON.stringify(committed));
    mutate(spec); // valued, so it is the GUARD (not the missing-secret check) that rejects it
    const r = render(spec, live);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, /DATABASE_URL_MIGRATION outside the PRE_DEPLOY job/, name);
    assert.equal(r.stdout, "", name);
  }
});

test("a SECRET left valueless on an uncovered surface fails instead of being silently blank", () => {
  const spec = JSON.parse(JSON.stringify(committed));
  spec.functions = [{ name: "f", envs: [{ key: "TOKEN", type: "SECRET" }] }];
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unfilled SECRET outside services\/workers\/jobs/);
  assert.equal(r.stdout, "");
  // The app-spec reference writes `type: secret`: the type compares case-insensitively.
  spec.functions = [{ name: "f", envs: [{ key: "TOKEN", type: "secret" }] }];
  const lower = render(spec, live);
  assert.notEqual(lower.status, 0);
  assert.match(lower.stderr, /unfilled SECRET outside services\/workers\/jobs/);
  assert.equal(lower.stdout, "");
});

test("empty stdin fails instead of rendering 0 bytes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  try {
    const livePath = path.join(dir, "live.json");
    writeFileSync(livePath, JSON.stringify(live));
    const spawn = (input) =>
      spawnSync("bash", [SCRIPT, livePath], {
        input,
        encoding: "utf8",
        env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, TMPDIR: dir },
      });
    const r = spawn("");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /empty spec on stdin/);
    // "null" (an empty YAML document through yq -o=json) is not 0 bytes: the name check refuses it.
    const nameless = spawn("null");
    assert.notEqual(nameless.status, 0);
    assert.match(nameless.stderr, /committed spec has no name/);
    assert.equal(nameless.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unresolved-placeholder error prints only the token, never the whole string", () => {
  const spec = JSON.parse(JSON.stringify(committed));
  spec.services[0].envs.push({ key: "X", value: "prefix-super-long-value-__NOPE__-suffix" });
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unresolved placeholder: __NOPE__/);
  assert.doesNotMatch(r.stderr, /super-long-value/);
  assert.equal(r.stdout, "");
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
