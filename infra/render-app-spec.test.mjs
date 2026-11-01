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
// here-string temp file lands there, not in the system temp dir) and removes it afterwards. A string spec is
// passed as raw stdin; `KEY_ROOT: undefined` in `env` leaves the variable unset.
function render(spec, liveSpec, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  try {
    const livePath = path.join(dir, "live.json");
    writeFileSync(livePath, JSON.stringify(liveSpec));
    return spawnSync("bash", [SCRIPT, livePath], {
      input: typeof spec === "string" ? spec : JSON.stringify(spec),
      encoding: "utf8",
      env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, KEY_ROOT: "aws-kms", TMPDIR: dir, ...env },
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
        env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, KEY_ROOT: "aws-kms", TMPDIR: dir },
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
// the SECRET keys of each component. Staging and production use the same list per component. Here the keys common
// to both key roots; the two key-root sets (section 2.2 of docs/sessions/web-mvp-phase5-readiness-p5-kms-root-key-choice.md)
// are KEY_ROOT_ENVS, hard-coded too, never derived from the renderer's own lists. DATABASE_CA_CERT (lane L89) is in
// every SECRET list: each of these components reads a database (the derived check is AS1-AS3 below).
const EXPECTED_ENVS = {
  web: {
    GENERAL: ["PROCESS_ROLE", "TRUSTED_INGRESS_PROVIDER", "APP_BASE_URL", "CSP_SCRIPT_NONCE_ENABLED", "DB_EXPECTED_ROLE"]
      .concat(["GENDER_COLLECTION_ENABLED", "KMS_PROVIDER"]),
    SECRET: ["DATABASE_URL", "DISCOVERY_DATABASE_URL", "DISCOVERY_CURSOR_KEY", "GOOGLE_OAUTH_CLIENT_ID"]
      .concat(["GOOGLE_OAUTH_CLIENT_SECRET", "LINK_CODE_LOOKUP_HMAC_KEY", "DATABASE_CA_CERT"]),
  },
  discovery: {
    GENERAL: ["PROCESS_ROLE", "TRUSTED_INGRESS_PROVIDER", "CSP_SCRIPT_NONCE_ENABLED", "DB_EXPECTED_ROLE"],
    SECRET: ["DISCOVERY_DATABASE_URL", "DISCOVERY_CURSOR_KEY", "DATABASE_CA_CERT"],
  },
  worker: {
    GENERAL: ["PROCESS_ROLE", "APP_BASE_URL", "KMS_PROVIDER", "OUTBOX_DISPATCH_SCHEDULE_ENABLED"],
    SECRET: ["DATABASE_URL_DIRECT", "DATABASE_CA_CERT"],
  },
  migrate: { GENERAL: ["PROCESS_ROLE"], SECRET: ["DATABASE_URL_MIGRATION", "DATABASE_CA_CERT"] },
};
const KEY_ROOT_ENVS = {
  "aws-kms": {
    web: {
      GENERAL: ["AWS_REGION"],
      SECRET: ["KMS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "KMS_ENCRYPTED_AUTH_PEPPER"]
        .concat(["KMS_ENCRYPTED_CONNECTOR_PEPPER"]),
    },
    worker: {
      GENERAL: ["AWS_REGION"],
      SECRET: ["KMS_KEY_ID", "KMS_ENCRYPTED_CONNECTOR_PEPPER", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    },
  },
  local: { web: { GENERAL: [], SECRET: ["ENCRYPTION_KEY"] }, worker: { GENERAL: [], SECRET: ["ENCRYPTION_KEY"] } },
};
const ROOTS = ["aws-kms", "local"];

// One key-root set of a component (none on discovery and migrate).
function rootSet(root, name) {
  return KEY_ROOT_ENVS[root][name] ?? { GENERAL: [], SECRET: [] };
}

// The sorted `<KEY> <TYPE>` list of a component: its common keys plus the sets of `roots`.
function expectedEnvs(name, roots) {
  const tables = [EXPECTED_ENVS[name], ...roots.map((root) => rootSet(root, name))];
  return tables.flatMap((t) => [...t.GENERAL.map((k) => `${k} GENERAL`), ...t.SECRET.map((k) => `${k} SECRET`)]).sort();
}

// Every component RS fills, with the kind RS keys a live secret by (`<kind>/<name>/<key>`).
function components(spec) {
  return ["services", "workers", "jobs"].flatMap((kind) => (spec[kind] ?? []).map((c) => ({ kind, c })));
}

// The fake live app: the committed spec itself, every SECRET (both key-root sets) with its own fake ciphertext,
// every KMS_PROVIDER set to `root`, `.name` unchanged.
function fakeLive(spec, root = "aws-kms") {
  return variant(spec, (l) => {
    for (const { kind, c } of components(l)) {
      for (const env of c.envs) {
        if (env.type === "SECRET") env.value = `EV[1:${kind}-${c.name}-${env.key}]`;
        if (env.key === "KMS_PROVIDER") env.value = root;
      }
    }
  });
}

// The spec's components are exactly `ids` (`<kind>/<name>`), each with exactly its EXPECTED_ENVS keys and types;
// every entry has scope RUN_TIME, no committed SECRET has a value key, and every KMS_PROVIDER is the placeholder
// the renderer fills from KEY_ROOT (a literal one is a half-switched spec, row 9). Both key-root sets are declared.
function assertEnvKeys(spec, ids) {
  assert.deepEqual(components(spec).map(({ kind, c }) => `${kind}/${c.name}`).sort(), [...ids].sort());
  for (const { c } of components(spec)) {
    assert.deepEqual(c.envs.map((e) => `${e.key} ${e.type}`).sort(), expectedEnvs(c.name, ROOTS), c.name);
    for (const env of c.envs) {
      assert.equal(env.scope, "RUN_TIME", `${c.name}/${env.key}`);
      if (env.type === "SECRET") assert.ok(!("value" in env), `${c.name}/${env.key}`);
      if (env.key === "KMS_PROVIDER") assert.equal(env.value, "__KMS_PROVIDER__", `${c.name}/${env.key}`);
    }
  }
}

// One env of a component, by kind, name and key.
function findEnv(spec, kind, name, key) {
  return spec[kind].find((c) => c.name === name).envs.find((e) => e.key === key);
}

// Rows 3 and 5: each committed spec under each root, against a live app with the other set and one without it.
for (const [label, file, domain] of [
  ["infra/app.staging.yaml", STAGING, "staging.example.test"],
  ["infra/app.prod.yaml", PROD, "example.test"],
]) {
  for (const root of ROOTS) {
    test(`renders ${label} with fake secrets under KEY_ROOT=${root}`, () => {
      const spec = readSpec(file);
      const liveSpec = fakeLive(spec, root);
      const env = { APP_DOMAIN: domain, KEY_ROOT: root };
      const r = render(spec, liveSpec, env);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");
      // A live app without the other set renders the same spec: the other set is dropped, never read.
      const other = ROOTS.find((x) => x !== root);
      const lean = variant(liveSpec, (l) => {
        for (const { c } of components(l)) {
          const drop = rootSet(other, c.name);
          c.envs = c.envs.filter((e) => ![...drop.GENERAL, ...drop.SECRET].includes(e.key));
        }
      });
      const r2 = render(spec, lean, env);
      assert.deepEqual([r2.status, r2.stderr, r2.stdout], [0, "", r.stdout]);
      const out = JSON.parse(r.stdout);
      const ids = (s) => components(s).map(({ kind, c }) => `${kind}/${c.name}`);
      assert.deepEqual(ids(out), ids(spec));
      // Exactly the common keys plus this root's set; each SECRET is the fake of its own kind, name and key.
      for (const { kind, c } of components(out)) {
        assert.deepEqual(c.envs.map((e) => `${e.key} ${e.type}`).sort(), expectedEnvs(c.name, [root]), c.name);
        for (const e of c.envs) if (e.type === "SECRET") assert.equal(e.value, `EV[1:${kind}-${c.name}-${e.key}]`);
      }
      assert.equal(findEnv(out, "services", "web", "KMS_PROVIDER").value, root);
      assert.equal(findEnv(out, "workers", "worker", "KMS_PROVIDER").value, root);
      assert.doesNotMatch(r.stdout, /__[A-Za-z0-9_]+__/);
      // The migration credential appears once in the whole document, on the migrate job.
      assert.equal(r.stdout.split('"DATABASE_URL_MIGRATION"').length, 2);
      assert.ok(out.jobs.find((j) => j.name === "migrate").envs.some((e) => e.key === "DATABASE_URL_MIGRATION"));
    });
  }
}

test("staging spec carries exactly the content-table keys per component", () => {
  const counts = (roots) => Object.fromEntries(Object.keys(EXPECTED_ENVS).map((n) => [n, expectedEnvs(n, roots).length]));
  assert.deepEqual(counts(ROOTS), { web: 21, discovery: 7, worker: 12, migrate: 3 });
  assert.deepEqual(counts(["aws-kms"]), { web: 20, discovery: 7, worker: 11, migrate: 3 });
  assert.deepEqual(counts(["local"]), { web: 15, discovery: 7, worker: 7, migrate: 3 });
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
  // Row 11: a duplicate key fails too (the renderer does not check duplicates).
  const twice = variant(spec, (s) => s.services.find((c) => c.name === "web").envs.push({ key: "ENCRYPTION_KEY", scope: "RUN_TIME", type: "SECRET" }));
  assert.throws(() => assertEnvKeys(twice, STAGING_IDS), assert.AssertionError, "ENCRYPTION_KEY twice on web");
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

// The staging spec (changed by `spec`) rendered under KEY_ROOT=root against its fake live app for that root
// (changed by `live`), which carries every secret of both sets.
function renderStaging(root, { spec = () => {}, live = () => {} } = {}) {
  const committed = variant(readSpec(STAGING), spec);
  return render(committed, variant(fakeLive(committed, root), live), { APP_DOMAIN: "staging.example.test", KEY_ROOT: root });
}

function dropEnv(spec, kind, name, key) {
  const c = spec[kind].find((x) => x.name === name);
  c.envs = c.envs.filter((e) => e.key !== key);
}

test("KEY_ROOT unset or empty fails before stdin is read (row 1)", () => {
  for (const KEY_ROOT of [undefined, ""]) {
    assertRefused(renderStaging(KEY_ROOT), /KEY_ROOT: KEY_ROOT is required/, String(KEY_ROOT));
    // An empty stdin meets this check first, not `empty spec on stdin`.
    const empty = render("", live, { KEY_ROOT });
    assertRefused(empty, /KEY_ROOT: KEY_ROOT is required/, `empty stdin, ${KEY_ROOT}`);
    assert.doesNotMatch(empty.stderr, /empty spec on stdin/);
  }
});

test("KEY_ROOT outside aws-kms|local fails before stdin, never echoing the value (row 2)", () => {
  for (const KEY_ROOT of ["gcp-kms", "AWS-KMS", " local", " ", "plain-fake-root"]) {
    const r = renderStaging(KEY_ROOT);
    assertRefused(r, /render: KEY_ROOT must be aws-kms or local/, JSON.stringify(KEY_ROOT));
    assert.doesNotMatch(r.stderr, /gcp-kms|AWS-KMS|plain-fake-root/, KEY_ROOT);
    assertRefused(render("", live, { KEY_ROOT }), /render: KEY_ROOT must be aws-kms or local/, `empty stdin, ${KEY_ROOT}`);
  }
});

test("aws-kms: a chosen-set secret missing in the live app fails closed (row 4)", () => {
  const r = renderStaging("aws-kms", { live: (l) => dropEnv(l, "workers", "worker", "KMS_KEY_ID") });
  assertRefused(r, /render: missing secret in live app: workers\/worker\/KMS_KEY_ID - set it in DO first/);
  assert.doesNotMatch(r.stderr, /EV\[/);
});

test("local: ENCRYPTION_KEY missing in the live app fails closed (row 6)", () => {
  const r = renderStaging("local", { live: (l) => dropEnv(l, "workers", "worker", "ENCRYPTION_KEY") });
  assertRefused(r, /render: missing secret in live app: workers\/worker\/ENCRYPTION_KEY - set it in DO first/);
  assert.doesNotMatch(r.stderr, /EV\[/);
});

test("local: a live ENCRYPTION_KEY that is not an EV ciphertext fails without the value (row 7)", () => {
  const r = renderStaging("local", { live: (l) => (findEnv(l, "services", "web", "ENCRYPTION_KEY").value = "plain-fake-key") });
  assertRefused(r, /render: live secret is not an EV ciphertext: services\/web\/ENCRYPTION_KEY/);
  assert.doesNotMatch(r.stderr, /plain-fake-key/);
});

test("a live KMS_PROVIDER that differs from KEY_ROOT or is absent fails, naming the component only (row 8)", () => {
  const setLive = (kind, name, value) => (l) => (findEnv(l, kind, name, "KMS_PROVIDER").value = value);
  for (const [label, root, live, id] of [
    ["live web aws-kms under local", "local", setLive("services", "web", "aws-kms"), "services/web"],
    ["live worker without KMS_PROVIDER", "aws-kms", (l) => dropEnv(l, "workers", "worker", "KMS_PROVIDER"), "workers/worker"],
    ["live web left as the creation copy", "aws-kms", setLive("services", "web", "__KMS_PROVIDER__"), "services/web"],
  ]) {
    const r = renderStaging(root, { live });
    assert.ok(r.status !== 0 && r.stdout === "" && r.stderr.split("\n").some((l) => l.endsWith(`render: KMS_PROVIDER differs from KEY_ROOT: ${id}`)), label);
    assert.doesNotMatch(r.stderr, /aws-kms|local|__KMS_PROVIDER__|EV\[/, label);
  }
});

test("a half-switched spec (a literal KMS_PROVIDER) fails at the guard and the placeholder pin (row 9)", () => {
  const literal = (s) => (findEnv(s, "services", "web", "KMS_PROVIDER").value = "aws-kms");
  const r = renderStaging("local", { spec: literal });
  assertRefused(r, /render: KMS_PROVIDER differs from KEY_ROOT: services\/web$/m);
  assert.doesNotMatch(r.stderr, /aws-kms|local/);
  assert.throws(() => assertEnvKeys(variant(readSpec(STAGING), literal), STAGING_IDS), assert.AssertionError);
});

test("a valued SECRET or an untyped env in the NON-chosen set fails before the drop (row 10)", () => {
  const valued = (s) => (findEnv(s, "services", "web", "ENCRYPTION_KEY").value = "plain-fake-key");
  const r = renderStaging("aws-kms", { spec: valued });
  assertRefused(r, /render: committed SECRET carries a value: ENCRYPTION_KEY/);
  assert.doesNotMatch(r.stderr, /plain-fake-key/);
  const untyped = renderStaging("local", { spec: (s) => delete findEnv(s, "workers", "worker", "AWS_REGION").type });
  assertRefused(untyped, /render: env type must be GENERAL or SECRET: AWS_REGION/);
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

// --- create mode (render_app_spec_create_mode): an app's first creation, no live spec ---
// The argv after the script is `args`; no live file is written. Same env and TMPDIR handling as render().
function renderArgs(spec, args, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  try {
    return spawnSync("bash", [SCRIPT, ...args], {
      input: typeof spec === "string" ? spec : JSON.stringify(spec),
      encoding: "utf8",
      env: { PATH: process.env.PATH, IMAGE_DIGEST: DIGEST, VPC_ID: VPC, KEY_ROOT: "aws-kms", TMPDIR: dir, ...env },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function renderCreate(spec, env = {}) {
  return renderArgs(spec, ["--create"], env);
}

// Every SECRET-typed object of a document, wherever it sits (the objects themselves, not copies).
function secretEntries(doc) {
  const found = [];
  JSON.stringify(doc, (k, v) => {
    if (v !== null && typeof v === "object" && String(v.type).toUpperCase() === "SECRET") found.push(v);
    return v;
  });
  return found;
}

const CREATE_SPECS = [
  ["infra/app.staging.yaml", STAGING, "staging.example.test"],
  ["infra/app.prod.yaml", PROD, "example.test"],
];

test("create mode: fills every placeholder for the committed staging and production specs", () => {
  for (const [label, file, domain] of CREATE_SPECS) {
    for (const root of ROOTS) {
      const at = `${label} KEY_ROOT=${root}`;
      const r = renderCreate(readSpec(file), { APP_DOMAIN: domain, KEY_ROOT: root });
      assert.equal(r.status, 0, `${at}: ${r.stderr}`);
      assert.equal(r.stderr, "", at);
      assert.doesNotMatch(r.stdout, /__[A-Za-z0-9_]+__/, at);
      const out = JSON.parse(r.stdout);
      assert.equal(out.vpc.id, VPC, at);
      assert.ok(out.domains.some((d) => d.domain === domain), at);
      for (const { c } of components(out)) assert.equal(c.image.digest, DIGEST, `${at} ${c.name}`);
      assert.equal(findEnv(out, "services", "web", "KMS_PROVIDER").value, root, at);
      assert.equal(findEnv(out, "workers", "worker", "KMS_PROVIDER").value, root, at);
      assert.equal(findEnv(out, "services", "web", "APP_BASE_URL").value, `https://${domain}`, at);
    }
  }
});

test("create mode: a malformed digest, VPC, domain or KEY_ROOT is refused naming the key, never the value", () => {
  const spec = readSpec(STAGING);
  for (const [env, message] of [
    [{ IMAGE_DIGEST: "sha256:plain-fake-$(id)" }, /render: IMAGE_DIGEST must be sha256:<64 hex>/],
    [{ IMAGE_DIGEST: `${DIGEST}\nplain-fake` }, /render: IMAGE_DIGEST must be sha256:<64 hex>/],
    [{ VPC_ID: "plain-fake-vpc;id" }, /render: VPC_ID must be a UUID/],
    [{ APP_DOMAIN: "plain-fake.example.test/$(id)" }, /render: APP_DOMAIN is not a hostname/],
    [{ APP_DOMAIN: "Plain-Fake.example.test" }, /render: APP_DOMAIN is not a hostname/],
    [{ KEY_ROOT: "plain-fake-root" }, /render: KEY_ROOT must be aws-kms or local/],
    [{ IMAGE_DIGEST: undefined }, /IMAGE_DIGEST: IMAGE_DIGEST is required/],
    [{ VPC_ID: undefined }, /VPC_ID: VPC_ID is required/],
    [{ KEY_ROOT: undefined }, /KEY_ROOT: KEY_ROOT is required/],
  ]) {
    const label = JSON.stringify(env);
    const r = renderCreate(spec, { APP_DOMAIN: "staging.example.test", ...env });
    assertRefused(r, message, label);
    assert.doesNotMatch(r.stderr, /plain-fake|Plain-Fake/, label);
  }
});

test("create mode: a SECRET that carries a value is refused and its value is never printed", () => {
  const worker = (s) => s.workers.find((w) => w.name === "worker");
  for (const [label, change, message] of [
    [
      "a chosen-set SECRET in an envs list",
      (s) => (findEnv(s, "services", "web", "DATABASE_URL").value = "plain-fake-secret"),
      /render: committed SECRET carries a value: DATABASE_URL/,
    ],
    [
      "a NON-chosen-set SECRET, which the drop would remove",
      (s) => (findEnv(s, "services", "web", "ENCRYPTION_KEY").value = "plain-fake-secret"),
      /render: committed SECRET carries a value: ENCRYPTION_KEY/,
    ],
    [
      "a SECRET under a misspelled `env` list, outside every envs list",
      (s) => (worker(s).env = [{ key: "DATABASE_URL_DIRECT", type: "SECRET", value: "plain-fake-secret" }]),
      /render: create mode would emit a SECRET with a value$/m,
    ],
    [
      "a SECRET whose value is false",
      (s) => (findEnv(s, "workers", "worker", "DATABASE_URL_DIRECT").value = false),
      /render: create mode would emit a SECRET with a value$/m,
    ],
  ]) {
    const r = renderCreate(variant(readSpec(STAGING), change), { APP_DOMAIN: "staging.example.test" });
    assertRefused(r, message, label);
    assert.doesNotMatch(r.stderr, /plain-fake-secret/, label);
  }
});

test("create mode: every SECRET of the committed staging and production specs stays valueless", () => {
  // After the drop: the common SECRET names plus the chosen set, hard-coded as the content tables are.
  const counts = {
    "infra/app.staging.yaml": { "aws-kms": 23, local: 16 },
    "infra/app.prod.yaml": { "aws-kms": 20, local: 13 },
  };
  for (const [label, file, domain] of CREATE_SPECS) {
    for (const root of ROOTS) {
      const at = `${label} KEY_ROOT=${root}`;
      const r = renderCreate(readSpec(file), { APP_DOMAIN: domain, KEY_ROOT: root });
      assert.equal(r.status, 0, `${at}: ${r.stderr}`);
      const found = secretEntries(JSON.parse(r.stdout));
      assert.equal(found.length, counts[label][root], at);
      for (const s of found) assert.ok(!("value" in s), `${at} ${s.key}`);
      assert.doesNotMatch(r.stdout, /EV\[/, at);
    }
  }
});

test("create mode: DATABASE_URL_MIGRATION outside the PRE_DEPLOY job fails the render", () => {
  const base = renderCreate(committed);
  assert.equal(base.status, 0, base.stderr);
  const surfaces = {
    services: (spec) => spec.services[0].envs.push({ key: "DATABASE_URL_MIGRATION", value: "x" }),
    workers: (spec) => spec.workers[0].envs.push({ key: "DATABASE_URL_MIGRATION", value: "x" }),
    functions: (spec) => (spec.functions = [{ name: "f", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }]),
    static_sites: (spec) => (spec.static_sites = [{ name: "s", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }]),
    "top-level envs": (spec) => (spec.envs = [{ key: "DATABASE_URL_MIGRATION", value: "x" }]),
    "POST_DEPLOY job": (spec) =>
      spec.jobs.push({ name: "post", kind: "POST_DEPLOY", envs: [{ key: "DATABASE_URL_MIGRATION", value: "x" }] }),
    "the migrate job's kind edited to POST_DEPLOY": (spec) => (spec.jobs[0].kind = "POST_DEPLOY"),
  };
  for (const [name, mutate] of Object.entries(surfaces)) {
    assertRefused(renderCreate(variant(committed, mutate)), /render: DATABASE_URL_MIGRATION outside the PRE_DEPLOY job/, name);
  }
});

test("create mode: the other key-root set is dropped under each KEY_ROOT", () => {
  const ids = (s) => components(s).map(({ kind, c }) => `${kind}/${c.name}`);
  for (const [label, file, domain] of CREATE_SPECS) {
    const spec = readSpec(file);
    for (const root of ROOTS) {
      const at = `${label} KEY_ROOT=${root}`;
      const r = renderCreate(spec, { APP_DOMAIN: domain, KEY_ROOT: root });
      assert.equal(r.status, 0, `${at}: ${r.stderr}`);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(ids(out), ids(spec), at);
      for (const { c } of components(out)) {
        assert.deepEqual(c.envs.map((e) => `${e.key} ${e.type}`).sort(), expectedEnvs(c.name, [root]), `${at} ${c.name}`);
      }
      const other = ROOTS.find((x) => x !== root);
      for (const name of ["web", "worker"]) {
        const drop = rootSet(other, name);
        for (const key of [...drop.GENERAL, ...drop.SECRET]) assert.ok(!r.stdout.includes(`"${key}"`), `${at} ${key}`);
      }
    }
  }
});

test("create mode: an unresolved placeholder fails, printing the token and nothing around it", () => {
  const long = (s) => (findEnv(s, "services", "web", "PROCESS_ROLE").value = "prefix-super-long-value-__NOPE__-suffix");
  const r = renderCreate(variant(readSpec(STAGING), long), { APP_DOMAIN: "staging.example.test" });
  assertRefused(r, /render: unresolved placeholder: __NOPE__$/m);
  assert.doesNotMatch(r.stderr, /super-long-value/);
  // APP_DOMAIN unset: the staging spec keeps __APP_DOMAIN__, and the render fails naming only that token.
  const noDomain = renderCreate(readSpec(STAGING), { APP_DOMAIN: undefined });
  assertRefused(noDomain, /render: unresolved placeholder: __APP_DOMAIN__$/m, "APP_DOMAIN unset");
});

test("create mode: a live-spec argument with --create fails and no mixed mode renders", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "render-"));
  try {
    const livePath = path.join(dir, "live.json");
    writeFileSync(livePath, JSON.stringify(live));
    for (const args of [
      ["--create", livePath],
      [livePath, "--create"],
      ["--create", "--create"],
      ["--create", path.join(dir, "absent.json")],
    ]) {
      const label = args.map((a) => path.basename(a)).join(" ");
      const r = renderArgs(committed, args);
      assertRefused(r, /render: --create takes no live spec/, label);
      assert.doesNotMatch(r.stderr, /EV\[/, label);
    }
    // A live file literally named --create is reached by its path: update mode, its secret copied.
    const named = path.join(dir, "--create");
    writeFileSync(named, JSON.stringify(live));
    const update = renderArgs(committed, [named]);
    assert.equal(update.status, 0, update.stderr);
    assert.equal(JSON.parse(update.stdout).workers[0].envs[0].value, "EV[1:wrk]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create mode: empty stdin fails instead of rendering 0 bytes", () => {
  assertRefused(renderCreate(""), /render: empty spec on stdin/, "empty");
  assertRefused(renderCreate("null"), /render: committed spec has no name/, "null");
  assertRefused(renderCreate(JSON.stringify(committed).repeat(2)), /render: stdin must hold exactly one JSON document/, "two documents");
});

test("create mode: renders exactly what update mode renders, minus the copied SECRET values", () => {
  for (const [label, file, domain] of CREATE_SPECS) {
    const spec = readSpec(file);
    for (const root of ROOTS) {
      const at = `${label} KEY_ROOT=${root}`;
      const env = { APP_DOMAIN: domain, KEY_ROOT: root };
      const update = render(spec, fakeLive(spec, root), env);
      const created = renderCreate(spec, env);
      assert.equal(update.status, 0, `${at}: ${update.stderr}`);
      assert.equal(created.status, 0, `${at}: ${created.stderr}`);
      const expected = JSON.parse(update.stdout);
      for (const s of secretEntries(expected)) delete s.value;
      assert.deepEqual(JSON.parse(created.stdout), expected, at);
    }
  }
});

test("update mode: no live-spec argument still fails with the usage text", () => {
  assertRefused(renderArgs(committed, []), /usage: render-app-spec\.sh <live-spec\.json> < committed\.json/);
});

// The update-mode cases of rows 9 and 10, through create mode: neither check is behind `$create`.
test("create mode: a hand-edited env whose type line is missing or misspelled is refused by key, in either key-root set", () => {
  for (const root of ROOTS) {
    for (const type of [undefined, "SECRET "]) {
      const spec = variant(readSpec(STAGING), (s) => {
        const env = findEnv(s, "workers", "worker", "AWS_REGION");
        if (type === undefined) delete env.type;
        else env.type = type;
      });
      const r = renderCreate(spec, { APP_DOMAIN: "staging.example.test", KEY_ROOT: root });
      assertRefused(r, /render: env type must be GENERAL or SECRET: AWS_REGION/, `KEY_ROOT=${root} type=${type}`);
    }
  }
});

test("create mode: a half-switched spec (a literal KMS_PROVIDER that differs from KEY_ROOT) fails, naming the component only", () => {
  const literal = (s) => (findEnv(s, "services", "web", "KMS_PROVIDER").value = "aws-kms");
  const r = renderCreate(variant(readSpec(STAGING), literal), { APP_DOMAIN: "staging.example.test", KEY_ROOT: "local" });
  assertRefused(r, /render: KMS_PROVIDER differs from KEY_ROOT: services\/web$/m);
  assert.doesNotMatch(r.stderr, /aws-kms|local/);
});

test("create mode: on the owner's UTF-8 shell a non-ASCII letter in the digest, VPC or domain is refused", () => {
  const utf8 = { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
  for (const [env, message] of [
    [{ IMAGE_DIGEST: `sha256:${"a".repeat(63)}é` }, /render: IMAGE_DIGEST must be sha256:<64 hex>/],
    [{ VPC_ID: `${VPC.slice(0, -1)}é` }, /render: VPC_ID must be a UUID/],
    [{ APP_DOMAIN: "staging.exémple.test" }, /render: APP_DOMAIN is not a hostname/],
  ]) {
    const r = renderCreate(readSpec(STAGING), { APP_DOMAIN: "staging.example.test", ...utf8, ...env });
    assertRefused(r, message, JSON.stringify(env));
  }
});

// Round 1 of lane L88 (probes C_v_top_secret, C_v_static_secret): a SECRET that fill() never covers is refused in
// create mode too, so no app is created from a spec that every later update would refuse.
test("create mode: a SECRET in the app-level envs is refused, as every update would refuse it", () => {
  const spec = variant(committed, (s) => (s.envs = [{ key: "SHARED_API_TOKEN", type: "SECRET" }]));
  assertRefused(renderCreate(spec), /render: unfilled SECRET outside services\/workers\/jobs$/m, "create");
  assertRefused(render(spec, live), /render: unfilled SECRET outside services\/workers\/jobs$/m, "update");
});

test("create mode: a SECRET in a static site's envs is refused, as every update would refuse it", () => {
  const spec = variant(committed, (s) => (s.static_sites = [{ name: "landing", envs: [{ key: "BUILD_TOKEN", type: "secret" }] }]));
  assertRefused(renderCreate(spec), /render: unfilled SECRET outside services\/workers\/jobs$/m, "create");
  assertRefused(render(spec, live), /render: unfilled SECRET outside services\/workers\/jobs$/m, "update");
});

// --- Lane L89: DATABASE_CA_CERT on every component with a database (readiness section 2.5) ---
// Derived, not listed: a component reads a database iff it has a DATABASE_URL* or *_DATABASE_URL key, and each one
// declares the CA its connection verifies against exactly once, as a valueless RUN_TIME SECRET (the owner pastes it
// per component in the console). Returns the sorted `<kind>/<name>` ids it checked, compared with CA_IDS.
const DB_URL_KEY = /^DATABASE_URL|_DATABASE_URL$/;
const CA_ENTRY = { key: "DATABASE_CA_CERT", scope: "RUN_TIME", type: "SECRET" };
const CA_IDS = {
  "infra/app.staging.yaml": ["jobs/migrate", "services/discovery", "services/web", "workers/worker"],
  "infra/app.prod.yaml": ["jobs/migrate", "services/web", "workers/worker"],
};
function assertCaDeclared(spec) {
  const db = components(spec).filter(({ c }) => c.envs.some((e) => DB_URL_KEY.test(e.key)));
  for (const { kind, c } of db) {
    assert.deepEqual(c.envs.filter((e) => e.key === "DATABASE_CA_CERT"), [CA_ENTRY], `${kind}/${c.name}`);
  }
  return db.map(({ kind, c }) => `${kind}/${c.name}`).sort();
}

for (const [as, label, file] of [
  ["AS1", "infra/app.staging.yaml", STAGING],
  ["AS2", "infra/app.prod.yaml", PROD],
]) {
  test(`${as} ${label}: every component with a database URL declares DATABASE_CA_CERT once, valueless`, () => {
    assert.deepEqual(assertCaDeclared(readSpec(file)), CA_IDS[label]);
  });
}

test("AS3 a CA entry dropped, valued, GENERAL or duplicated, or a new DB service without one, fails the check", () => {
  const spec = readSpec(STAGING);
  assert.deepEqual(assertCaDeclared(spec), CA_IDS["infra/app.staging.yaml"]); // the positive control
  const changes = {
    dropped: (envs, i) => envs.splice(i, 1),
    valued: (envs, i) => (envs[i].value = "EV[1:ca]"),
    general: (envs, i) => (envs[i].type = "GENERAL"),
    duplicated: (envs, i) => envs.push({ ...envs[i] }),
  };
  for (const id of CA_IDS["infra/app.staging.yaml"]) {
    const [kind, name] = id.split("/");
    for (const [what, change] of Object.entries(changes)) {
      const bad = variant(spec, (s) => {
        const envs = s[kind].find((c) => c.name === name).envs;
        change(envs, envs.findIndex((e) => e.key === "DATABASE_CA_CERT"));
      });
      assert.throws(() => assertCaDeclared(bad), assert.AssertionError, `${id} ${what}`);
    }
  }
  // Both key shapes count as a database: a new service reading one without the CA fails.
  for (const key of ["DATABASE_URL", "REPORTING_DATABASE_URL"]) {
    const bad = variant(spec, (s) => s.services.push({ name: "api", envs: [{ key, scope: "RUN_TIME", type: "SECRET" }] }));
    assert.throws(() => assertCaDeclared(bad), assert.AssertionError, `a new service with ${key}`);
  }
});

test("AS4 neither App Spec carries a certificate body: the CA is pasted in the console, never committed", () => {
  for (const file of [STAGING, PROD]) assert.doesNotMatch(readFileSync(file, "utf8"), /-----BEGIN /, file);
});

test("AS5 update mode: the live CA missing on one component fails, naming that component", () => {
  for (const [label, file, domain] of CREATE_SPECS) {
    const spec = readSpec(file);
    for (const id of CA_IDS[label]) {
      const [kind, name] = id.split("/");
      // Every other component keeps its CA: the lookup is per component, a CA on web does not cover worker.
      const lean = variant(fakeLive(spec), (l) => dropEnv(l, kind, name, "DATABASE_CA_CERT"));
      const r = render(spec, lean, { APP_DOMAIN: domain });
      const want = new RegExp(`render: missing secret in live app: ${id}/DATABASE_CA_CERT - set it in DO first$`, "m");
      assertRefused(r, want, `${label} ${id}`);
      assert.doesNotMatch(r.stderr, /EV\[/, `${label} ${id}`);
    }
  }
});

test("AS6 create mode: DATABASE_CA_CERT stays a valueless SECRET on every DB component under both key roots", () => {
  for (const [label, file, domain] of CREATE_SPECS) {
    for (const root of ROOTS) {
      const r = renderCreate(readSpec(file), { APP_DOMAIN: domain, KEY_ROOT: root });
      assert.equal(r.status, 0, `${label} KEY_ROOT=${root}: ${r.stderr}`);
      assert.deepEqual(assertCaDeclared(JSON.parse(r.stdout)), CA_IDS[label], `${label} KEY_ROOT=${root}`);
    }
  }
});
