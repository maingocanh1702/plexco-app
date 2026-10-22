/**
 * L27 units U3a and U3b: the source-scan guard G1-G4 of
 * docs/sessions/web-mvp-phase3-readiness-p3-strip-invisible-member-names.md (section 11, default B8).
 * A writer the inventory missed keeps names unstripped, so these fail when a SQL writer of
 * persons.display_name, memberships.display_name, tenants.name or sessions.venue_address appears
 * without public_name_strip_invisible (G1: function bodies in the catalog; G2: bare statements and
 * DO blocks of the migration files, plus functions of files after 0069), when a new trigger on the
 * four tables could rewrite one unseen (G3), or when a TypeScript writer appears unpinned (G4).
 * Each guard keeps a row that feeds a planted counter-example to the same matcher.
 * L29 unit U5a (RO-L29-3 group 5): G1 also accepts the rule public.member_name_apply_rule (0070),
 * only while the rule's own definition strips first; L29-G1 (L29 readiness section 11) pins every
 * writer a migration after 0069 defines to the rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/** The guarded column of each table (tenants.name as a whole word: display_name never counts). */
const COLUMN: Record<string, RegExp> = {
  persons: /\bdisplay_name\b/,
  memberships: /\bdisplay_name\b/,
  tenants: /\bname\b/,
  sessions: /\bvenue_address\b/,
};
/** An INSERT, UPDATE or MERGE on one of the four tables (quoted or not) or on a format()
 * placeholder (%I, %s, %L, %1$I, %-10s: a table passed as an argument, so unknown); the rest up
 * to `;`. */
const WRITE =
  /\b(?:insert\s+into|update|merge\s+into)\s+(?:only\s+)?(?:(?:"?public"?|%[\d$*-]*[isl])\.)?"?(persons|memberships|tenants|sessions|%[\d$*-]*[isl])\b"?(?=([^;]*))/g;
/** An INSERT's column list; without one (VALUES, a query, DEFAULT VALUES) it writes every column. */
const LIST = /^\s*(?:as\s+\w+\s*)?\(\s*"?\w+"?\s*[,)]/;
const STRIP = "public_name_strip_invisible(";

/** Lower-cased, with `--` and block comments blanked in place (offsets and line numbers kept). */
const clean = (sql: string) =>
  sql.toLowerCase().replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
/** Each write statement of the text that writes a guarded column, or any column of a placeholder
 * table (fail-closed: the table is unknown): [head, table, rest up to `;`]. */
const writeHits = (sql: string) =>
  [...clean(sql).matchAll(WRITE)].filter(
    ([head, table, rest]) =>
      table!.startsWith("%") ||
      COLUMN[table!]!.test(rest!) ||
      (head.startsWith("insert") && !LIST.test(rest!)),
  );
/** The tables whose guarded column a write statement of the text names, one entry per write. */
const writes = (sql: string) => writeHits(sql).map(([, table]) => table!);

/** Section 11's pinned SQL writers (G1) and triggers (G3), measured at the 0069 tail. */
const WRITERS = [
  "auth_login_google",
  "channel_identity_detach",
  "create_guest_membership",
  "create_host_added_person",
  "person_profile_update",
  "tenant_profile_update",
  "tenant_provision",
  "zalo_identity_resolve",
];
/** "table.trigger timing function" (timing from tgtype): a re-created trigger must match all three. */
const TRIGGERS = [
  "memberships.trg_memberships_chat_provision after chat_memberships_provision_trg",
];
/** channel_identity_detach's only write (A3): a new person row with a NULL display name. */
const NULL_INSERT = "insert into public.persons (display_name, status) values (null, 'active')";

/** RO-L29-3 group 5: a listed writer may strip through the rule (0070) instead of calling the helper
 * directly, schema-qualified as every 0070 definer calls it (a look-alike name or an unqualified call
 * does not count), and only while every catalog definition of the rule reads its argument through
 * the helper alone: each use of p_value or $1 is exactly public.public_name_strip_invisible(p_value),
 * so the strip comes before any other processing and the transitive guarantee is tested, not
 * assumed. A renamed parameter fails closed. Threat model: drift in a later migration, not a hostile
 * author (who could edit this file); ceiling: substring presence, as STRIP's. */
const RULE = "public.member_name_apply_rule(";
const RULE_NAME = "member_name_apply_rule";
const STRIP_ARG = `public.${STRIP}p_value)`;
const stripsFirst = (src: string) => {
  const body = clean(src);
  return body.includes(STRIP_ARG) && !/\bp_value\b|\$1\b/.test(body.split(STRIP_ARG).join(" "));
};
/** The six definers 0070 re-creates (P2, T1, T2, P3, P4, M2), each calling the rule. */
const VIA_RULE = [
  "auth_login_google",
  "create_guest_membership",
  "create_host_added_person",
  "tenant_profile_update",
  "tenant_provision",
  "zalo_identity_resolve",
];
type Fn = { sig: string; name: string; src: string };
/** G1 violations, each naming its function: unlisted writer, listed writer without the strip, stale entry,
 * and (RO-L29-3 group 5) a definition of the rule that does not strip first. */
function g1(fns: Fn[]): string[] {
  const writers = fns.filter((f) => writes(f.src).length > 0);
  const rules = fns.filter((f) => f.name === RULE_NAME);
  const unsafe = rules.filter((r) => !stripsFirst(r.src));
  const ruleStrips = rules.length > 0 && unsafe.length === 0;
  return [
    ...unsafe.map((r) => `rule without the strip first ${r.sig}`),
    ...writers.flatMap((f) => {
      const src = clean(f.src);
      if (!WRITERS.includes(f.name))
        return [`unlisted writer ${f.sig} (${writes(src).join(", ")})`];
      // channel_identity_detach is exempt while each of its write statements equals NULL_INSERT,
      // plus an optional `returning <ident> into <ident>` (0055:203 ends RETURNING id INTO v_new).
      const nullOnly =
        f.name === "channel_identity_detach" &&
        writeHits(src).every(([h, , r]) => {
          const stmt = (h + r!).replace(/\s+/g, " ").trim();
          return (
            stmt.startsWith(NULL_INSERT) &&
            /^(?: returning \w+ into \w+)?$/.test(stmt.slice(NULL_INSERT.length))
          );
        });
      // Ceiling: presence, not data flow (the helper, or the rule while it strips first, anywhere in
      // a listed body passes); RC-BODY pins only the seven definers 0069 re-creates.
      const strips = src.includes(STRIP) || (ruleStrips && src.includes(RULE));
      return strips || nullOnly ? [] : [`listed writer without the strip ${f.sig}`];
    }),
    ...WRITERS.filter((w) => !writers.some((f) => f.name === w)).map((w) => `stale entry ${w}`),
  ];
}

type Hit = { file: string; line: number; sql: string };
// ponytail: a simple statement splitter (quotes and dollar tags kept whole, comments blanked first).
// CREATE FUNCTION/PROCEDURE statements are skipped with their bodies because G1 reads them from
// pg_proc, except in files after 0069: a pg_temp or dropped helper never reaches pg_proc. DO bodies
// are scanned. A table passed as a format() argument (format('UPDATE %I ...', 'memberships')) is
// a placeholder write: WRITE counts it in G1 and G2. Ceiling: `--` inside a string literal, E''
// escapes, BEGIN ATOMIC bodies in a file and SQL text assembled at run time, such as a target table
// built by string concatenation ('UPDATE ' || v_table) or a guarded column passed as a format()
// argument with a literal table (format('UPDATE memberships SET %I = $1', v_col)), in G1 too.
// RC-BODY pins only the seven definers 0069 re-creates (member-name-invisible-chars.test.ts), so
// review is the backstop for a new function; a real SQL parser if one bites.
/** G2: the statements, DO blocks and post-0069 functions of a file that write a guarded column. */
function g2(file: string, raw: string): Hit[] {
  const text = clean(raw);
  const late = Number.parseInt(file, 10) > 69;
  const tag = /\$(?:[a-z_][a-z0-9_]*)?\$/y;
  const hits: Hit[] = [];
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    tag.lastIndex = i;
    const quote = text[i] === "'" ? "'" : text[i] === "$" ? tag.exec(text)?.[0] : undefined;
    if (quote) {
      const close = text.indexOf(quote, i + quote.length);
      i = close < 0 ? text.length - 1 : close + quote.length - 1;
    } else if (i === text.length || text[i] === ";") {
      const sql = text.slice(from, i).trim();
      const fn =
        /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:"?(\w+)"?\.)?"?(\w+)/.exec(sql);
      // A function is G1's (pg_proc), except after 0069: there it must strip or be a WRITERS member.
      const skip =
        fn && (!late || sql.includes(STRIP) || (fn[1] !== "pg_temp" && WRITERS.includes(fn[2]!)));
      if (sql && !skip && writes(sql).length > 0) {
        hits.push({ file, line: text.slice(0, text.indexOf(sql, from)).split("\n").length, sql });
      }
      from = i + 1;
    }
  }
  return hits;
}
const g3 = (rows: string[]) => [
  ...rows.filter((r) => !TRIGGERS.includes(r)).map((r) => `unlisted trigger ${r}`),
  ...TRIGGERS.filter((t) => !rows.includes(t)).map((t) => `missing trigger ${t}`),
];

const migration = (file: string) =>
  readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
const CLEANUP = "0069_member_name_invisible_chars.sql";

let ctx: RlsTestContext;
let fns: Fn[];
let triggers: string[];

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_member_name_writer_guard");
  const procs = await ctx.owner.query<Fn>(
    `SELECT p.oid::regprocedure::text AS sig, p.proname AS name,
            CASE WHEN p.prosqlbody IS NULL THEN p.prosrc ELSE pg_get_functiondef(p.oid) END AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`,
  );
  fns = procs.rows;
  const trgs = await ctx.owner.query<{ trg: string }>(
    `SELECT c.relname || '.' || t.tgname || CASE WHEN (t.tgtype & 2) <> 0 THEN ' before ' ELSE ' after ' END
            || p.proname AS trg
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY($1) ORDER BY 1`,
    [Object.keys(COLUMN)],
  );
  triggers = trgs.rows.map((r) => r.trg);
});
afterAll(async () => {
  await ctx?.teardown();
});

describe("G1 catalog: every function that writes the four columns is pinned and strips", () => {
  it("holds on the migrated catalog", () => {
    expect(g1(fns), "G1 violations (by function)").toEqual([]);
  });
  it("fails on a planted unlisted writer, a listed writer without the strip, a stale entry", () => {
    const listed = fns.find((f) => f.name === "tenant_profile_update")!;
    const planted: Fn[] = [
      ...fns.filter((f) => f !== listed && f.name !== "zalo_identity_resolve"),
      { ...listed, src: "begin update tenants set name = btrim(p_name) where id = p_id; end" },
      {
        sig: "planted(text)",
        name: "planted",
        src: "insert into public.persons (display_name) values ($1)",
      },
      {
        sig: "inert()",
        name: "inert",
        src: "-- update persons set display_name = 'x';\nselect display_name from persons for update; update persons set status = 'x';",
      },
    ];
    expect(g1(planted).sort()).toEqual(
      [
        `listed writer without the strip ${listed.sig}`,
        "stale entry zalo_identity_resolve",
        "unlisted writer planted(text) (persons)",
      ].sort(),
    );
  });
  it("fails on channel_identity_detach's real body plus a raw UPDATE of persons.display_name", () => {
    const detach = fns.find((f) => f.name === "channel_identity_detach")!;
    const src = `${detach.src}\nUPDATE persons SET display_name = p_label;`;
    expect(g1(fns.map((f) => (f === detach ? { ...f, src } : f)))).toEqual([
      `listed writer without the strip ${detach.sig}`,
    ]);
  });
  it("fails on a detach NULL insert with a second VALUES row or an upsert of the name", () => {
    const detach = fns.find((f) => f.name === "channel_identity_detach")!;
    for (const tail of [
      ", (p_label, 'active')",
      " on conflict (id) do update set display_name = p_label",
    ]) {
      const src = `${detach.src}\n${NULL_INSERT}${tail};`;
      expect(g1(fns.map((f) => (f === detach ? { ...f, src } : f))), tail).toEqual([
        `listed writer without the strip ${detach.sig}`,
      ]);
    }
  });
  it("fails on a table passed as a format argument, and passes it once the value strips", () => {
    const detach = fns.find((f) => f.name === "channel_identity_detach")!;
    const g1With = (value: string) => {
      const src = `${detach.src}\nEXECUTE format('UPDATE %I SET display_name = ${value} WHERE id = $2', 'memberships');`;
      return g1(fns.map((f) => (f === detach ? { ...f, src } : f)));
    };
    expect(g1With("$1")).toEqual([`listed writer without the strip ${detach.sig}`]);
    expect(g1With(`${STRIP}$1)`)).toEqual([]);
  });
  it("pins the rule: one definition, reading its argument only through the helper, called by six", () => {
    const rules = fns.filter((f) => f.name === RULE_NAME);
    expect(
      rules.map((f) => stripsFirst(f.src)),
      "one rule, stripping first",
    ).toEqual([true]);
    const callers = fns.filter((f) => WRITERS.includes(f.name) && clean(f.src).includes(RULE));
    expect(callers.map((f) => f.name).sort(), "the listed writers calling it").toEqual(VIA_RULE);
  });
  it("fails on a rule that does not strip first, and then on each writer calling it", () => {
    const rule = fns.find((f) => f.name === RULE_NAME)!;
    const callers = fns
      .filter((f) => VIA_RULE.includes(f.name))
      .map((f) => `listed writer without the strip ${f.sig}`);
    for (const src of [
      "begin return public.public_name_strip_invisible(btrim(p_value)); end",
      "declare v text := btrim(p_value); begin return public.public_name_strip_invisible(v); end",
      "begin if p_value ~ 'x' then return null; end if; return public.public_name_strip_invisible(p_value); end",
      "begin return public.public_name_strip_invisible(p_value) || $1; end",
      "begin return x_public_name_strip_invisible(p_value); end",
      "begin return btrim(p_value); end",
    ]) {
      expect(g1(fns.map((f) => (f === rule ? { ...f, src } : f))).sort(), src).toEqual(
        [`rule without the strip first ${rule.sig}`, ...callers].sort(),
      );
    }
    expect(g1(fns.filter((f) => f !== rule)).sort(), "no rule").toEqual([...callers].sort());
    const minimal = { ...rule, src: `begin return ${STRIP_ARG}; end` };
    expect(g1(fns.map((f) => (f === rule ? minimal : f))), "a minimal rule").toEqual([]);
  });
  it("fails on a listed writer calling a look-alike rule, the rule unqualified or another function", () => {
    const listed = fns.find((f) => f.name === "tenant_profile_update")!;
    const g1With = (value: string) => {
      const src = `begin update tenants set name = ${value} where id = p_id; end`;
      return g1(fns.map((f) => (f === listed ? { ...f, src } : f)));
    };
    for (const value of [
      "public.member_name_apply_rule_lite(p_name, false)",
      "x_member_name_apply_rule(p_name, false)",
      "member_name_apply_rule(p_name, false)",
      "public.member_name_tidy(p_name)",
    ]) {
      expect(g1With(value), value).toEqual([`listed writer without the strip ${listed.sig}`]);
    }
    expect(g1With(`${RULE}p_name, false)`), "the rule").toEqual([]);
  });
});

/** L29-G1 (L29 readiness section 11): a function that a migration after 0069 defines and that writes
 * a guarded column calls the rule, except by name P1 person_profile_update (keeps 0069's own rule)
 * and P5 channel_identity_detach (writes NULL only, G1's nullOnly); M3 (NULL) is no writer the
 * scanner sees (it is not in WRITERS), so it needs no name. */
const L29_EXEMPT = ["person_profile_update", "channel_identity_detach"];
/** The functions a file defines: G2's header match, not anchored (comments are blanked first). */
const DEFINES = /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:"?\w+"?\.)?"?(\w+)/g;
// ponytail: the body is the catalog's (pg_proc holds the latest definition) and the file only dates
// it, so a pg_temp or dropped helper of a late file is left to G2; a file-side body split if one bites.
const lateWriters = (files: Record<string, string>, catalog: Fn[]) => {
  const late = Object.entries(files)
    .filter(([file]) => Number.parseInt(file, 10) > 69)
    .flatMap(([, raw]) => [...clean(raw).matchAll(DEFINES)].map(([, name]) => name!));
  return catalog.filter(
    (f) => late.includes(f.name) && !L29_EXEMPT.includes(f.name) && writes(f.src).length > 0,
  );
};
const l29g1 = (files: Record<string, string>, catalog: Fn[]) =>
  lateWriters(files, catalog)
    .filter((f) => !clean(f.src).includes(RULE))
    .map((f) => `post-0069 writer without the rule ${f.sig}`);

describe("L29-G1 migrations after 0069: every writer they define calls the rule", () => {
  const files = Object.fromEntries(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => [f, migration(f)] as const),
  );
  /** A planted migration file defining `name` with `body`, and the catalog it would leave. */
  const plant = (file: string, name: string, body: string) => ({
    files: {
      ...files,
      [file]: `CREATE OR REPLACE FUNCTION public.${name}(p_id uuid, p_name text) RETURNS void\nLANGUAGE plpgsql AS $$\n${body}\n$$;\n`,
    },
    catalog: [
      ...fns.filter((f) => f.name !== name),
      { sig: `${name}(uuid,text)`, name, src: body },
    ],
  });
  const update = (value: string) =>
    `begin update persons set display_name = ${value} where id = p_id; end`;

  it("holds on packages/db/migrations: 0070's six definers, each calling the rule", () => {
    expect(
      lateWriters(files, fns)
        .map((f) => f.name)
        .sort(),
      "the late writers",
    ).toEqual(VIA_RULE);
    expect(l29g1(files, fns)).toEqual([]);
  });
  it("fails on a late writer calling only the helper or neither, also a re-created listed one", () => {
    const cases: [string, string, string][] = [
      ["0070_planted.sql", "planted", update(`${STRIP}p_name)`)],
      ["0071_planted.sql", "planted", update("btrim(p_name)")],
      [
        "0071_planted.sql",
        "tenant_profile_update",
        `begin update tenants set name = btrim(${STRIP}p_name)) where id = p_id; end`,
      ],
    ];
    for (const [file, name, body] of cases) {
      const { files: planted, catalog } = plant(file, name, body);
      expect(l29g1(planted, catalog), `${file} ${name}`).toEqual([
        `post-0069 writer without the rule ${name}(uuid,text)`,
      ]);
    }
  });
  it("passes it once it calls the rule, in a 0069 file, and P1 and P5 by name only", () => {
    const ruled = plant("0071_planted.sql", "planted", update(`${RULE}p_name, false)`));
    expect(l29g1(ruled.files, ruled.catalog), "the rule").toEqual([]);
    const old = plant("0069_planted.sql", "planted", update(`${STRIP}p_name)`));
    expect(l29g1(old.files, old.catalog), "a 0069 file").toEqual([]);
    for (const name of L29_EXEMPT) {
      const real = fns.find((f) => f.name === name)!;
      expect([writes(real.src).length > 0, clean(real.src).includes(RULE)], name).toEqual([
        true,
        false,
      ]);
      expect(l29g1(plant("0071_planted.sql", name, "select 1").files, fns), name).toEqual([]);
    }
  });
});

/** L29-G2 (L29 readiness sections 8 and 11): the bare writers G2 admits, each only between its own
 * file's marker pair and only while it calls its admitting function: 0069's L27-CLEANUP block the
 * helper, 0070's L29-CLEANUP block the rule (accepted through G1's strip-first pin on the rule,
 * which is not restated here). A missing marker admits nothing. */
const CLEANUP_L29 = "0070_member_name_control_chars.sql";
const CLEANUPS: [file: string, tag: string, call: string][] = [
  [CLEANUP, "L27-CLEANUP", STRIP],
  [CLEANUP_L29, "L29-CLEANUP", RULE],
];
/** G2 over `sources`: the hits outside every marked block (file:line), and per block whether each
 * of its hits calls the block's admitting function. */
const admit = (sources: Record<string, string>) => {
  const found = Object.keys(sources)
    .sort()
    .flatMap((f) => g2(f, sources[f]!));
  const blocks = CLEANUPS.map(([file, tag, call]) => {
    const lines = (sources[file] ?? "").split("\n");
    const at = (m: string) => lines.findIndex((l) => l.startsWith(`-- ${tag}-${m}`)) + 1;
    const inside = (h: Hit) => h.file === file && h.line > at("BEGIN") && h.line < at("END");
    const hits = found.filter(inside);
    return { hits, calls: hits.map((h) => h.sql.includes(call)) };
  });
  const admitted = blocks.flatMap((b) => b.hits);
  return {
    outside: found.filter((h) => !admitted.includes(h)).map((h) => `${h.file}:${h.line}`),
    calls: blocks.map((b) => b.calls),
  };
};

describe("G2 migrations: bare statements and DO blocks that write the four columns are pinned", () => {
  it("holds on packages/db/migrations: only 0069's L27-CLEANUP and 0070's L29-CLEANUP blocks", () => {
    const files = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) =>
      f.endsWith(".sql"),
    );
    const sources = Object.fromEntries(files.map((f) => [f, migration(f)] as const));
    const { outside, calls } = admit(sources);
    expect(outside, "bare writers outside the two cleanup blocks (file:line)").toEqual([]);
    expect(calls, "0069's block calls the helper, 0070's the rule").toEqual([[true], [true]]);
  });
  it("fails on a DO block outside both marker pairs in a post-0069 file, or one without its call", () => {
    const raw = migration(CLEANUP_L29);
    const pair = { [CLEANUP]: migration(CLEANUP), [CLEANUP_L29]: raw };
    const block = `do $p$ begin update persons set display_name = ${RULE}x, true); end $p$;`;
    const after = { ...pair, [CLEANUP_L29]: `${raw}\n${block}\n` };
    expect(admit(after), "after 0070's END marker").toEqual({
      outside: [`${CLEANUP_L29}:${raw.split("\n").length + 1}`],
      calls: [[true], [true]],
    });
    const copied = `-- L29-CLEANUP-BEGIN\n${block}\n-- L29-CLEANUP-END\n`;
    expect(admit({ ...pair, "0071_planted.sql": copied }), "markers copied into 0071").toEqual({
      outside: ["0071_planted.sql:2"],
      calls: [[true], [true]],
    });
    const ruleless = { ...pair, [CLEANUP_L29]: raw.split(RULE).join("btrim(") };
    expect(admit(ruleless), "0070's block calling btrim instead of the rule").toEqual({
      outside: [],
      calls: [[true], [false]],
    });
  });
  it("fails on planted bare, DO, quoted and positional writers, past a function, a comment, a grant", () => {
    const planted = [
      "create function f() returns void language plpgsql as $f$ begin update persons set display_name = 'x'; end $f$;",
      "-- update tenants set name = 'a comment';",
      "update public.tenants set name = 'y; still one statement';",
      "do $$ begin update sessions set venue_address = null; end $$;",
      "grant update (display_name) on memberships to app; insert into sessions (status) values ('draft');",
      'update "public"."persons" set display_name = p_raw;',
      "insert into memberships select * from memberships; insert into tenants default values;",
    ].join("\n");
    expect(g2("planted.sql", planted).map((h) => h.line)).toEqual([3, 4, 6, 7, 7]);
  });
  it("fails on a raw pg_temp helper in a file after 0069, and passes it once it strips", () => {
    const sql =
      "create function pg_temp.fix() returns void language sql as $$ update tenants set name = 'raw' $$; select pg_temp.fix();";
    expect(g2("0070_planted.sql", sql).map((h) => h.line)).toEqual([1]);
    expect(g2("0070_planted.sql", sql.replace("'raw'", `${STRIP}'raw')`))).toEqual([]);
    // Named like a WRITERS member, a pg_temp helper is still scanned (pins `fn[1] !== "pg_temp"`).
    const named =
      "create function pg_temp.tenant_provision() returns void language sql as $$ update tenants set name = 'raw' $$;";
    expect(g2("0070_planted.sql", named).map((h) => h.line)).toEqual([1]);
  });
});

describe("G3 triggers: the non-internal triggers on the four tables are exactly the pinned set", () => {
  it("holds on the migrated catalog", () => {
    expect(g3(triggers), "G3 violations (by table.trigger)").toEqual([]);
  });
  it("fails on a planted trigger, a re-timed or re-pointed one, and a missing one", () => {
    const retimed = "memberships.trg_memberships_chat_provision before planted_trg";
    expect(g3(["persons.trg_planted", retimed])).toEqual([
      "unlisted trigger persons.trg_planted",
      `unlisted trigger ${retimed}`,
      `missing trigger ${TRIGGERS[0]}`,
    ]);
  });
});

/** L27 unit U3b, G4: the TypeScript trees section 11 scans, minus tests, apps/web/e2e and fixtures. */
const ROOT = new URL("../../../", import.meta.url);
const TS_DIRS = ["packages/db/src", "packages/db/scripts", "apps/web", "apps/bot/src"];
const SKIP = new Set(["node_modules", ".next", "apps/web/e2e"]);
const FIXTURES = new Set([
  "packages/db/src/test-harness.ts",
  "packages/db/src/roster-money-fixtures.ts",
  "packages/db/scripts/dev-seed-club-members.ts",
]);
/** A Drizzle `.insert(`/`.update(` of one of the four tables, or a raw SQL INSERT or UPDATE of one. */
const TS_WRITE =
  /\.(?:insert|update)\(\s*(?:\w+\.)*(persons|memberships|tenants|sessions)\s*\)|\b(?:insert\s+into|update)\s+(?:only\s+)?(?:"?public"?\.)?"?(persons|memberships|tenants|sessions)\b"?/gi;
/** The guarded column's TS key per table; tenants has none: it may have no direct writer at all. */
const TS_KEY: Record<string, string> = {
  persons: "displayName",
  memberships: "displayName",
  sessions: "venueAddress",
};
/** Section 11's direct writers at the 0069 tail: "file table" -> [writes the column, write sites];
 * a new write site inside a pinned file fails until its pin is reviewed. */
const DIRECT: Record<string, [boolean, number]> = {
  "packages/db/src/roster-service.ts memberships": [true, 1],
  "packages/db/src/session-service.ts sessions": [true, 5],
  "packages/db/src/tenant.ts sessions": [false, 1],
};
/** One of the four tables imported under another name would hide its writes from TS_WRITE. */
const ALIAS = /\bimport\s[^;]*\b(?:persons|memberships|tenants|sessions)\s+as\s+\w/;

const scan = (dir: string): string[] =>
  readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return SKIP.has(d.name) || SKIP.has(rel) ? [] : scan(rel);
    return /(?<!\.test)\.tsx?$/.test(d.name) ? [rel] : [];
  });

// ponytail: file-level presence, not data flow (any stripInvisibleChars( call passes a writer
// file; a table held in a variable escapes the matcher); the MN and TS rows prove the actual strip.
// Not scanned: packages/core, packages/db outside src and scripts, apps/bot outside src,
// apps/web/e2e, the fixtures and .mts/.cts/.js/.mjs/.cjs files (add a tree or extension first).
function g4(files: Record<string, string>, pinned = DIRECT): string[] {
  const hits = Object.entries(files).flatMap(([file, src]) =>
    [...src.matchAll(TS_WRITE)].map((m) => `${file} ${(m[1] ?? m[2])!.toLowerCase()}`),
  );
  const found = new Map<string, number>();
  hits.forEach((h) => found.set(h, (found.get(h) ?? 0) + 1));
  const aliased = Object.entries(files).flatMap(([file, src]) =>
    ALIAS.test(src) ? [`aliased table import ${file}`] : [],
  );
  const bad = [...found].flatMap(([hit, sites]) => {
    const [file, table] = hit.split(" ") as [string, string];
    const key = TS_KEY[table];
    if (!key) return [`tenants direct writer ${file}`];
    const pin = pinned[hit];
    if (pin === undefined) return [`unlisted direct writer ${hit}`];
    if (pin[1] !== sites) return [`write sites ${sites} (pinned ${pin[1]}) ${hit}`];
    const strips = files[file]!.includes("stripInvisibleChars(");
    if (pin[0]) return strips ? [] : [`pinned writer without the strip ${hit}`];
    return files[file]!.includes(key) ? [`pinned non-writer names ${key} ${hit}`] : [];
  });
  const stale = Object.keys(pinned).filter((p) => !found.has(p));
  return [...aliased, ...bad, ...stale.map((p) => `stale entry ${p}`)];
}

describe("G4 TypeScript: every direct writer of the four tables is pinned and strips", () => {
  const all = TS_DIRS.flatMap(scan);
  const files = Object.fromEntries(
    all.filter((f) => !FIXTURES.has(f)).map((f) => [f, readFileSync(new URL(f, ROOT), "utf8")]),
  );
  it("holds on the sources: every tree scanned, the measured direct-writer list", () => {
    const seen = TS_DIRS.filter((d) => all.some((f) => f.startsWith(`${d}/`)));
    expect(seen, "every tree scanned").toEqual(TS_DIRS);
    expect(g4(files), "G4 violations (by file table)").toEqual([]);
  });
  it("fails on planted rows: unlisted, tenants, no strip, key named, stale, extra site, alias", () => {
    const planted = {
      "u.ts": "await tx.insert(schema.persons).values({ displayName });",
      "t.ts": "await db.query(`UPDATE\n  tenants SET name = $1`);",
      "w.ts": "await tx.update(sessions).set({ venueAddress: v.trim() });",
      "n.ts": "await tx.insert(sessions).values({ venueAddress: null });",
      "i.ts": "await tx.select().from(persons); await tx.delete(memberships);",
      "c.ts": "tx.insert(sessions).values(x); tx.update(sessions).set(stripInvisibleChars(y));",
      "a.ts": 'import { sessions as s } from "./schema";',
    };
    const pinned: typeof DIRECT = {
      "w.ts sessions": [true, 1],
      "n.ts sessions": [false, 1],
      "c.ts sessions": [true, 1],
      "gone.ts memberships": [true, 1],
    };
    expect(g4(planted, pinned).sort()).toEqual(
      [
        "unlisted direct writer u.ts persons",
        "tenants direct writer t.ts",
        "pinned writer without the strip w.ts sessions",
        "pinned non-writer names venueAddress n.ts sessions",
        "write sites 2 (pinned 1) c.ts sessions",
        "aliased table import a.ts",
        "stale entry gone.ts memberships",
      ].sort(),
    );
  });
});

describe("G4 TS_WRITE: a raw SQL writer with a quoted schema and a quoted table", () => {
  it('gives a hit on UPDATE "public"."persons" SET display_name = $1', () => {
    const src = 'UPDATE "public"."persons" SET display_name = $1';
    expect([...src.matchAll(TS_WRITE)].map((m) => (m[1] ?? m[2])!.toLowerCase())).toEqual([
      "persons",
    ]);
  });
});

/** L29-G3 (L29 readiness section 11): a TypeScript write site of a guarded column outside the
 * named M1 (roster-service.ts memberships) and V1/V2 (session-service.ts sessions) calls the
 * shared rule of text-safety.ts, checkTypedName( (typed) or normalizeExternalName( (external);
 * stripInvisibleChars( alone is L27's strip, not the rule. G4's TS_WRITE finds the sites. */
const L29_NAMED = [
  "packages/db/src/roster-service.ts memberships",
  "packages/db/src/session-service.ts sessions",
];
const L29_RULE_CALL = /\b(?:checkTypedName|normalizeExternalName)\(/;
/** The "file table" sites of G4's TS_WRITE whose file names the table's TS_KEY (G4's non-writer
 * test), and every tenants site (tenants has no key: fail-closed). */
const columnSites = (files: Record<string, string>) => [
  ...new Set(
    Object.entries(files).flatMap(([file, src]) =>
      [...src.matchAll(TS_WRITE)]
        .map((m) => (m[1] ?? m[2])!.toLowerCase())
        .filter((table) => TS_KEY[table] === undefined || src.includes(TS_KEY[table]!))
        .map((table) => `${file} ${table}`),
    ),
  ),
];
// ponytail: file-level presence like G4 (one call anywhere in a file passes all of its sites); the
// TS validator rows prove the rule per writer.
function l29g3(files: Record<string, string>, named = L29_NAMED): string[] {
  const sites = columnSites(files);
  return [
    ...sites
      .filter((s) => !named.includes(s) && !L29_RULE_CALL.test(files[s.split(" ")[0]!]!))
      .map((s) => `write site without the rule ${s}`),
    ...named.filter((n) => !sites.includes(n)).map((n) => `stale name ${n}`),
  ];
}

describe("L29-G3 TypeScript: a guarded-column write site outside M1 and V1/V2 calls the rule", () => {
  const files = Object.fromEntries(
    TS_DIRS.flatMap(scan)
      .filter((f) => !FIXTURES.has(f))
      .map((f) => [f, readFileSync(new URL(f, ROOT), "utf8")] as const),
  );
  it("holds on the sources: the column write sites are exactly the named M1 and V1/V2", () => {
    expect(columnSites(files).sort(), "the column write sites").toEqual(L29_NAMED);
    expect(l29g3(files), "L29-G3 violations (by file table)").toEqual([]);
  });
  it("fails on planted rows: neither call, only the strip, a look-alike, tenants, a stale name", () => {
    const planted = {
      "u.ts": "await tx.insert(schema.persons).values({ displayName });",
      "s.ts": "await tx.update(memberships).set({ displayName: stripInvisibleChars(v) });",
      "l.ts": "await tx.update(persons).set({ displayName: xcheckTypedName(v) });",
      "t.ts": "await db.query(`UPDATE tenants SET name = $1`);",
      "k.ts": "await tx.update(sessions).set({ venueAddress: checkTypedName(v) });",
      "e.ts": "await tx.insert(persons).values({ displayName: normalizeExternalName(n) });",
      "n.ts": "await tx.update(sessions).set({ status });",
      "m.ts": "await tx.update(memberships).set({ displayName: v });",
    };
    expect(l29g3(planted, ["m.ts memberships", "gone.ts sessions"]).sort()).toEqual(
      [
        "write site without the rule u.ts persons",
        "write site without the rule s.ts memberships",
        "write site without the rule l.ts persons",
        "write site without the rule t.ts tenants",
        "stale name gone.ts sessions",
      ].sort(),
    );
  });
});
