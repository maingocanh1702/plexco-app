// node --test infra/render-app-spec.test.mjs  (needs bash + jq, both on CI runners)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      envs: [{ key: "LOG_LEVEL", type: "GENERAL", value: "info" }, { key: "DATABASE_URL", type: "SECRET" }],
    },
  ],
  workers: [{ name: "worker", image: { digest: "__IMAGE_DIGEST__" }, envs: [{ key: "DATABASE_URL", type: "SECRET" }] }],
};
const live = {
  name: "x",
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

// A deep copy of a fixture with one change applied.
function variant(base, change) {
  const copy = JSON.parse(JSON.stringify(base));
  change(copy);
  return copy;
}

// A refusal: non-zero, the expected message, nothing on stdout.
function assertRefused(r, message, label) {
  assert.notEqual(r.status, 0, label);
  assert.match(r.stderr, message, label);
  assert.equal(r.stdout, "", label);
}

test("fills placeholders and copies each secret from the SAME component (same key, different value)", () => {
  const r = render(committed, live);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout);
  assert.equal(out.vpc.id, VPC);
  assert.equal(out.services[0].image.digest, DIGEST);
  assert.equal(out.services[0].envs[1].value, "EV[1:__WEB__]");
  assert.equal(out.workers[0].envs[0].value, "EV[1:wrk]");
  assert.equal(out.jobs[0].envs[0].value, "EV[1:mig]");
  // The app-spec reference writes `type: secret`: a lower-case SECRET is filled (committed) and found (live).
  const lower = render(
    variant(committed, (s) => (s.services[0].envs[1].type = "secret")),
    variant(live, (l) => (l.workers[0].envs[0].type = "secret")),
  );
  assert.equal(lower.status, 0, lower.stderr);
  assert.equal(lower.stderr, "");
  const lowerOut = JSON.parse(lower.stdout);
  assert.equal(lowerOut.services[0].envs[1].value, "EV[1:__WEB__]");
  assert.equal(lowerOut.workers[0].envs[0].value, "EV[1:wrk]");
});

test("fails closed, naming it, when a secret is missing, carries a value, would be demoted or is another app's", () => {
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
  // A live value that is not even a string is refused by key too, not with jq's generic text.
  const objectValue = variant(live, (l) => (l.workers[0].envs[0].value = { v: "EV[1:obj]" }));
  assertRefused(render(committed, objectValue), /live secret is not an EV ciphertext: workers\/worker\/DATABASE_URL/);
  // A committed SECRET carries NO value: a masked (or pasted) one would become the NEW live value.
  const valued = render(variant(committed, (s) => (s.services[0].envs[1].value = "********")), live);
  assertRefused(valued, /committed SECRET carries a value: DATABASE_URL/);
  assert.doesNotMatch(valued.stderr, /\*{8}/);
  // A GENERAL env over a live SECRET of the same component and key would blank or demote that secret.
  const general = { key: "DATABASE_URL", type: "GENERAL", value: "plain-fake" };
  const demoted = render(variant(committed, (s) => (s.services[0].envs[1] = general)), live);
  assertRefused(demoted, /live SECRET would be demoted to a plain env: services\/web\/DATABASE_URL/);
  assert.doesNotMatch(demoted.stderr, /plain-fake/);
  // Secrets are copied from the same app only: the message names the field, never either name.
  const other = render(committed, { ...live, name: "other-app" });
  assertRefused(other, /live spec \.name differs from the committed \.name/);
  assert.doesNotMatch(other.stderr, /other-app/);
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
  // Every committed env is typed GENERAL or SECRET (any case): a missing or misspelled type is refused by key.
  for (const env of [{ key: "DATABASE_URL" }, { key: "DATABASE_URL", type: "SECRET " }]) {
    const typo = render(variant(committed, (s) => (s.services[0].envs[1] = env)), live);
    assertRefused(typo, /env type must be GENERAL or SECRET: DATABASE_URL/, JSON.stringify(env));
  }
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
    // Exactly one document: two (a multi-document YAML through yq) or none (blank stdin) are refused.
    for (const [label, input] of [["two documents", JSON.stringify(committed).repeat(2)], ["no document", " \n"]]) {
      assertRefused(spawn(input), /stdin must hold exactly one JSON document/, label);
    }
    // The name must be a non-blank string.
    for (const name of [5, " "]) {
      assertRefused(spawn(JSON.stringify({ ...committed, name })), /committed spec has no name/, String(name));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("errors print only a token or a key, never the string around it or a value", () => {
  const spec = JSON.parse(JSON.stringify(committed));
  spec.services[0].envs.push({ key: "X", type: "GENERAL", value: "prefix-super-long-value-__NOPE__-suffix" });
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unresolved placeholder: __NOPE__/);
  assert.doesNotMatch(r.stderr, /super-long-value/);
  assert.equal(r.stdout, "");
  // jq's own error text quotes the offending input. A live string where an array belongs leaves the
  // secret missing (named).
  const long = `EV[1:FAKECIPHER-${"x".repeat(300)}]`;
  for (const bad of [{ ...live, services: long }, variant(live, (l) => (l.services[0].envs = long))]) {
    const leak = render(committed, bad);
    assertRefused(leak, /missing secret in live app: services\/web\/DATABASE_URL/);
    assert.doesNotMatch(leak.stderr, /FAKECIPHER/);
  }
  // A committed list is absent or an array: `false` is not read as absent, nor an object as a list
  // (either would drop components or envs, their live secrets included, and still exit 0); a string
  // fails naming the field.
  const lists = {
    "web envs: false": ["envs", (s) => (s.services[0].envs = false)],
    "jobs: false": ["jobs", (s) => (s.jobs = false)],
    "services: {}": ["services", (s) => (s.services = {})],
    "services: a string": ["services", (s) => (s.services = "plain-fake-svc")],
    "workers: {}": ["workers", (s) => (s.workers = {})],
  };
  for (const [label, [field, change]] of Object.entries(lists)) {
    const bad = render(variant(committed, change), live);
    assertRefused(bad, /must be an array/, label);
    assert.ok(bad.stderr.includes(`render: ${field} must be an array`), label);
    assert.doesNotMatch(bad.stderr, /plain-fake-svc/, label);
  }
  // Any other jq error is replaced by RS's own message.
  const shape = render({ ...committed, services: ["plain-fake-svc"] }, live);
  assertRefused(shape, /render: the input is not the expected JSON shape/);
  assert.doesNotMatch(shape.stderr, /plain-fake-svc/);
});

test("rejects a malformed digest, a non-UUID VPC, and an unresolved placeholder", () => {
  assert.notEqual(render(committed, live, { IMAGE_DIGEST: "latest" }).status, 0);
  assert.notEqual(render(committed, live, { VPC_ID: "abc" }).status, 0);
  const spec = JSON.parse(JSON.stringify(committed));
  spec.domains = [{ domain: "__APP_DOMAIN__" }];
  const r = render(spec, live);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unresolved placeholder: __APP_DOMAIN__/);
  const ok = render(spec, live, { APP_DOMAIN: "app.example.com" });
  assert.equal(ok.stderr, "");
  assert.equal(JSON.parse(ok.stdout).domains[0].domain, "app.example.com");
});

// --- D3 YAML subset reader: begin ---
// The App Spec files are written in a strict YAML subset (D3) that this reader accepts exactly. Anything outside
// it throws, naming the 1-based line: a construct a real YAML parser could read differently fails the test
// instead of being misread (fail closed).
function yamlFail(n, what) {
  throw new Error(`yaml subset: line ${n}: ${what}`);
}

// Anchors, aliases, tags, flow collections, block scalars, single quotes and complex keys are outside the subset:
// their indicators are refused anywhere outside a double-quoted scalar and a comment. Returns the line without
// its comment (a `#` at the start or after a space, outside a double-quoted scalar).
function yamlContent(line, n) {
  const names = {
    "&": "anchor", "*": "alias", "!": "tag", "'": "single quote", "?": "complex key", "{": "flow map", "}": "flow map",
    "[": "flow sequence", "]": "flow sequence", "|": "block scalar", ">": "block scalar",
  };
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i).replace(/ +$/, "");
    else if (!quoted && names[c]) yamlFail(n, names[c]);
  }
  return line;
}

// The significant lines (not blank, not a full-line comment) with their number and indentation (spaces only).
// Tabs, trailing spaces, document markers (more than one document) and directives are refused.
// So is any other character outside printable ASCII, comments included: CR, NEL, LS and PS end a line in YAML.
function yamlLines(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const n = i + 1;
    if (line.includes("\t")) yamlFail(n, "tab");
    if (/[^\x20-\x7e]/.test(line)) yamlFail(n, "character outside printable ASCII");
    if (line.endsWith(" ")) yamlFail(n, "trailing space");
    if (/^(---|\.\.\.)( |$)/.test(line)) yamlFail(n, "document marker");
    if (line.startsWith("%")) yamlFail(n, "directive");
    const content = yamlContent(line, n);
    const indent = /^ */.exec(content)[0].length;
    if (content.length > indent) out.push({ n, indent, text: content.slice(indent) });
  });
  return out;
}

// Two spaces per level: a nested block opens exactly two columns under its key. A sequence item is a mapping
// that starts on the dash line, its further keys at the item column (dash + 2); a scalar item or a sequence
// nested in a sequence is refused, and so is a key with neither a value nor a deeper block (no null).
function yamlBlock(lines, at, indent) {
  if (lines[at].indent !== indent) yamlFail(lines[at].n, "wrong indentation");
  return /^-( |$)/.test(lines[at].text) ? yamlSeq(lines, at, indent) : yamlMap(lines, at, indent);
}

function yamlSeq(lines, at, indent) {
  const items = [];
  let i = at;
  while (i < lines.length && lines[i].indent === indent && /^-( |$)/.test(lines[i].text)) {
    const rest = lines[i].text.slice(2);
    if (!/^[A-Za-z_][A-Za-z0-9_]*:( |$)/.test(rest)) yamlFail(lines[i].n, "sequence item is not a mapping");
    lines[i] = { n: lines[i].n, indent: indent + 2, text: rest }; // the item's first key, at the item column
    const [item, next] = yamlMap(lines, i, indent + 2);
    items.push(item);
    i = next;
  }
  return [items, i];
}

// Keys are identifiers; one a YAML 1.1 parser would type (yes, on, null...) or a repeated one is refused.
function yamlMap(lines, at, indent) {
  const entries = new Map();
  let i = at;
  while (i < lines.length && lines[i].indent === indent) {
    const { n, text } = lines[i];
    const m = /^([A-Za-z_][A-Za-z0-9_]*):(?: (.*))?$/.exec(text);
    if (!m) yamlFail(n, "expected a key: value line");
    if (/^(null|true|false|yes|no|on|off|y|n)$/i.test(m[1])) yamlFail(n, "ambiguous key");
    if (entries.has(m[1])) yamlFail(n, "duplicate key");
    i += 1;
    if (m[2] !== undefined) entries.set(m[1], yamlScalar(m[2], n));
    else if (i < lines.length && lines[i].indent > indent) {
      const [value, next] = yamlBlock(lines, i, indent + 2);
      entries.set(m[1], value);
      i = next;
    } else yamlFail(n, "key with no value");
  }
  return [Object.fromEntries(entries), i];
}

// A double-quoted scalar has no escape: its value is the text between the quotes. A plain scalar is an integer
// without a leading zero, true or false, or a string of [A-Za-z0-9_./-] starting with a letter, `_` or `/`. Any
// other plain form (null, ~, yes/no/on/off/y/n, another case of true/false, a float, a leading zero, a date, 0x..,
// 1_000, .inf) is one a YAML 1.1 parser such as Ruby Psych could type differently: refused. So is an integer
// outside Number's safe range, which would lose digits here.
function yamlScalar(raw, n) {
  if (raw.startsWith('"')) {
    const end = raw.indexOf('"', 1);
    if (end < 0) yamlFail(n, "unterminated double-quoted scalar");
    if (raw.slice(1, end).includes("\\")) yamlFail(n, "backslash escape");
    if (end !== raw.length - 1) yamlFail(n, "text after a double-quoted scalar");
    return raw.slice(1, end);
  }
  if (/^(0|-?[1-9][0-9]*)$/.test(raw)) {
    const v = Number(raw);
    if (!Number.isSafeInteger(v)) yamlFail(n, "integer out of range");
    return v;
  }
  if (raw === "true" || raw === "false") return raw === "true";
  if (!/^[A-Za-z_/][A-Za-z0-9_./-]*$/.test(raw) || /^(null|yes|no|on|off|y|n|true|false)$/i.test(raw)) {
    yamlFail(n, "ambiguous plain scalar");
  }
  return raw;
}

// Entry point: the document is one block mapping at column 0, every significant line consumed.
function parseYamlSubset(text) {
  const lines = yamlLines(text);
  if (lines.length === 0 || /^-( |$)/.test(lines[0].text)) {
    yamlFail(lines.length ? lines[0].n : 1, "top-level document is not a mapping");
  }
  const [doc, next] = yamlMap(lines, 0, 0);
  if (next < lines.length) yamlFail(lines[next].n, "wrong indentation");
  return doc;
}

function readSpec(file) {
  return parseYamlSubset(readFileSync(file, "utf8"));
}
// --- D3 YAML subset reader: end ---

const STAGING = fileURLToPath(new URL("./app.staging.yaml", import.meta.url));
const PROD = fileURLToPath(new URL("./app.prod.yaml", import.meta.url));
const STAGING_IDS = ["services/web", "services/discovery", "workers/worker", "jobs/migrate"];

// The content tables of the readiness file (section 2.6), hard-coded, never derived from a spec: the GENERAL and
// the SECRET keys of each component. Staging and production use the same list per component.
const EXPECTED_ENVS = {
  web: {
    GENERAL: ["PROCESS_ROLE", "TRUSTED_INGRESS_PROVIDER", "APP_BASE_URL", "CSP_SCRIPT_NONCE_ENABLED", "DB_EXPECTED_ROLE"]
      .concat(["GENDER_COLLECTION_ENABLED", "KMS_PROVIDER", "AWS_REGION"]),
    SECRET: ["DATABASE_URL", "DISCOVERY_DATABASE_URL", "DISCOVERY_CURSOR_KEY", "GOOGLE_OAUTH_CLIENT_ID"]
      .concat(["GOOGLE_OAUTH_CLIENT_SECRET", "KMS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"])
      .concat(["KMS_ENCRYPTED_AUTH_PEPPER", "KMS_ENCRYPTED_CONNECTOR_PEPPER", "LINK_CODE_LOOKUP_HMAC_KEY"]),
  },
  discovery: {
    GENERAL: ["PROCESS_ROLE", "TRUSTED_INGRESS_PROVIDER", "CSP_SCRIPT_NONCE_ENABLED", "DB_EXPECTED_ROLE"],
    SECRET: ["DISCOVERY_DATABASE_URL", "DISCOVERY_CURSOR_KEY"],
  },
  worker: {
    GENERAL: ["PROCESS_ROLE", "APP_BASE_URL", "KMS_PROVIDER", "AWS_REGION", "OUTBOX_DISPATCH_SCHEDULE_ENABLED"],
    SECRET: ["DATABASE_URL_DIRECT", "KMS_KEY_ID", "KMS_ENCRYPTED_CONNECTOR_PEPPER", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  },
  migrate: { GENERAL: ["PROCESS_ROLE"], SECRET: ["DATABASE_URL_MIGRATION"] },
};

// Every component RS fills, with the kind RS keys a live secret by (`<kind>/<name>/<key>`).
function components(spec) {
  return ["services", "workers", "jobs"].flatMap((kind) => (spec[kind] ?? []).map((c) => ({ kind, c })));
}

// The fake live app: the committed spec itself, every SECRET with its own fake ciphertext, `.name` unchanged.
function fakeLive(spec) {
  return variant(spec, (l) => {
    for (const { kind, c } of components(l)) {
      for (const env of c.envs) if (env.type === "SECRET") env.value = `EV[1:${kind}-${c.name}-${env.key}]`;
    }
  });
}

// Each SECRET of a spec by `<kind>/<name>/<key>`, with its value.
function secrets(spec) {
  const entries = components(spec).flatMap(({ kind, c }) =>
    c.envs.filter((e) => e.type === "SECRET").map((e) => [`${kind}/${c.name}/${e.key}`, e.value]),
  );
  return Object.fromEntries(entries);
}

// The spec's components are exactly `ids` (`<kind>/<name>`), each with exactly its EXPECTED_ENVS keys and types;
// every entry has scope RUN_TIME and no committed SECRET has a value key.
function assertEnvKeys(spec, ids) {
  assert.deepEqual(components(spec).map(({ kind, c }) => `${kind}/${c.name}`).sort(), [...ids].sort());
  for (const { c } of components(spec)) {
    const { GENERAL, SECRET } = EXPECTED_ENVS[c.name];
    const want = [...GENERAL.map((k) => `${k} GENERAL`), ...SECRET.map((k) => `${k} SECRET`)].sort();
    assert.deepEqual(c.envs.map((e) => `${e.key} ${e.type}`).sort(), want, c.name);
    for (const env of c.envs) {
      assert.equal(env.scope, "RUN_TIME", `${c.name}/${env.key}`);
      if (env.type === "SECRET") assert.ok(!("value" in env), `${c.name}/${env.key}`);
    }
  }
}

for (const [label, file, domain] of [
  ["infra/app.staging.yaml", STAGING, "staging.example.test"],
  ["infra/app.prod.yaml", PROD, "example.test"],
]) {
  test(`renders ${label} with fake secrets`, () => {
    const spec = readSpec(file);
    const liveSpec = fakeLive(spec);
    const r = render(spec, liveSpec, { APP_DOMAIN: domain });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const out = JSON.parse(r.stdout);
    // Each SECRET carries the fake value of its own component kind, name and key; none is left out or added.
    assert.deepEqual(secrets(out), secrets(liveSpec));
    assert.doesNotMatch(r.stdout, /__[A-Za-z0-9_]+__/);
    // The migration credential appears once in the whole document, on the migrate job.
    assert.equal(r.stdout.split('"DATABASE_URL_MIGRATION"').length, 2);
    assert.ok(out.jobs.find((j) => j.name === "migrate").envs.some((e) => e.key === "DATABASE_URL_MIGRATION"));
  });
}

test("staging spec carries exactly the content-table keys per component", () => {
  const counts = Object.entries(EXPECTED_ENVS).map(([name, t]) => [name, t.GENERAL.length + t.SECRET.length]);
  assert.deepEqual(Object.fromEntries(counts), { web: 19, discovery: 6, worker: 10, migrate: 2 });
  const spec = readSpec(STAGING);
  assertEnvKeys(spec, STAGING_IDS);
  // Negative control: dropping any one SECRET entry from the spec fails the check.
  for (const { kind, c } of components(spec)) {
    c.envs.forEach((env, i) => {
      if (env.type !== "SECRET") return;
      const dropped = variant(spec, (s) => s[kind].find((x) => x.name === c.name).envs.splice(i, 1));
      assert.throws(() => assertEnvKeys(dropped, STAGING_IDS), assert.AssertionError, `${c.name}/${env.key}`);
    });
  }
});

test("production spec is shape 3", () => {
  const spec = readSpec(PROD);
  assert.deepEqual(spec.services.map((s) => s.name), ["web"]);
  assert.equal(spec.services[0].instance_count, 1);
  assert.deepEqual(spec.workers.map((w) => w.name), ["worker"]);
  // No component named discovery anywhere: every `name` field of the document.
  const names = [];
  JSON.stringify(spec, (k, v) => {
    if (k === "name") names.push(v);
    return v;
  });
  assert.ok(!names.includes("discovery"), names.join(","));
  const gender = spec.services[0].envs.find((e) => e.key === "GENDER_COLLECTION_ENABLED");
  assert.deepEqual(gender, { key: "GENDER_COLLECTION_ENABLED", scope: "RUN_TIME", type: "GENERAL", value: "false" });
  // Production's web, worker and migrate carry the same lists as staging's: a dropped SECRET fails here too.
  assertEnvKeys(spec, ["services/web", "workers/worker", "jobs/migrate"]);
});

test("a missing live secret fails closed for the staging spec", () => {
  const spec = readSpec(STAGING);
  const liveSpec = variant(fakeLive(spec), (l) => {
    const discovery = l.services.find((s) => s.name === "discovery");
    discovery.envs = discovery.envs.filter((e) => e.key !== "DISCOVERY_CURSOR_KEY");
  });
  const r = render(spec, liveSpec, { APP_DOMAIN: "staging.example.test" });
  assertRefused(r, /render: missing secret in live app: services\/discovery\/DISCOVERY_CURSOR_KEY - set it in DO first/);
  assert.doesNotMatch(r.stderr, /EV\[/);
});

test("the YAML subset reader refuses constructs outside the subset", () => {
  const refused = [
    ["anchor", 2, "name: x\nbase: &b 1\n"],
    ["alias", 3, "name: x\n# a comment\nref: *b\n"],
    ["tag", 2, "name: x\nn: !!str 1\n"],
    ["flow map", 3, "name: x\nimage:\n  m: {a: 1}\n"],
    ["flow sequence", 2, "name: x\ns: [1, 2]\n"],
    ["block scalar", 2, "name: x\nb: |\n  text\n"],
    ["document marker", 2, "name: x\n---\nother: y\n"],
    ["tab", 3, "name: x\nimage:\n\tdigest: d\n"],
    ["single quote", 4, "name: x\n\nservices:\n  - name: 'web'\n"],
    ["duplicate key", 3, "name: x\nregion: sgp\nname: y\n"],
    ["ambiguous plain scalar", 2, "name: x\nflag: yes\n"],
    ["character outside printable ASCII", 2, "name: x\n# a\rregion: sgp\n"],
    ["character outside printable ASCII", 2, "name: x\n# a\f\n"],
    ["character outside printable ASCII", 2, "name: x\n# a\u{2028}region: sgp\n"],
    ["character outside printable ASCII", 2, "name: x\n# a\u{85}region: sgp\n"],
    ["integer out of range", 2, "name: x\ncount: 9007199254740993\n"],
  ];
  for (const [construct, line, input] of refused) {
    assert.throws(() => parseYamlSubset(input), { message: `yaml subset: line ${line}: ${construct}` }, construct);
  }
});

test("every ingress rule keeps the full request path", () => {
  // On the rendered specs, built as the render tests build them: the invariant protects what DO receives.
  const rendered = (file, domain) => {
    const spec = readSpec(file);
    const r = render(spec, fakeLive(spec), { APP_DOMAIN: domain });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const staging = rendered(STAGING, "staging.example.test");
  const prod = rendered(PROD, "example.test");
  const routes = (spec) => spec.ingress.rules.map((rule) => `${rule.match.path.prefix} -> ${rule.component.name}`).sort();
  assert.deepEqual(routes(staging), ["/discover -> discovery", "/api/discover -> discovery", "/ -> web"].sort());
  assert.deepEqual(routes(prod), ["/ -> web"]);
  for (const rule of [...staging.ingress.rules, ...prod.ingress.rules]) {
    assert.equal(rule.component.preserve_path_prefix, true, rule.match.path.prefix);
    assert.ok(!("rewrite" in rule.component), rule.match.path.prefix);
  }
});
