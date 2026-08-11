# AP-54 — chat-identity-merge-reparent-enablement: open the door for Person-merge to re-parent chat rows

> **⛔ DO NOT RUN THIS STANDALONE. This slice is `NOT_CODE_READY` (DD-103).** It is not a worktree you
> open today — it is the specified target that the future **Person-merge** slice must absorb. Opening it
> alone is a scope-design error and a `HALT` condition (see the manifest). This launcher exists so that
> whoever builds Person-merge inherits a pinned design direction and a hard constraint, not a blank page.

## What is structurally blocked (the fact, verified on disk 2026-08-11)

`packages/db/migrations/0031_chat_schema_core.sql` makes re-parenting chat rows inside a merge
transaction **structurally impossible**, not merely unimplemented:

- `chat_members_identity_immutable` (0031:209-217) — `BEFORE UPDATE OF channel_id, person_id` — raises
  **unconditionally** when `person_id` changes.
- `chat_channels_identity_immutable` (0031:227-237) — `BEFORE UPDATE OF kind, tenant_id, dm_key` — raises
  **unconditionally** when `dm_key` changes (and `dm_key` encodes the person pair `least:greatest`).
- Three composite FKs to `memberships`, all **NOT `DEFERRABLE`**: `chat_channels_created_by_membership_fk`
  (0031:93-94), `chat_members_membership_fk` (0031:113), `chat_messages_membership_fk` (0031:148), plus
  the prerequisite `memberships_id_person_tenant_uq` (0031:53-54). Immediate checking blocks any
  multi-row repoint that is only consistent at `COMMIT`.

Both triggers were added in 0031 rounds 1-2 to close a **real security bypass**. **Do not propose
removing them.** The spec still requires re-parent: `feature_inapp_chat_tech.md` row 10 (*"Account merge
-> chat authorship | Re-parent author_person_id/members về canonical person"*) and acceptance row 11
(*"Merge 2 person -> authorship/members hội tụ canonical"*); `identity-model.md:234-237` confirms
physical re-parent is this codebase's default (tombstone-in-place is the named exception, `pay_code`
only). DD-103 is where "schema hasn't caught up yet" is recorded — **do not edit the spec to
'tombstone'** to make it match the schema.

## The design direction to argue for (NOT to finalize here)

Read `docs/autopilot/contracts/autopilot-chat-identity-merge-reparent-enablement.md` §"Design direction"
in full. In one paragraph:

- **Escape hatch = a merge-scoped bypass inside the two immutability triggers, gated on DB-ROLE
  IDENTITY.** The trigger allows the identity-changing UPDATE **only** when `current_user` is a
  dedicated Person-merge role (e.g. a `person_merge_definer`), i.e. only when the UPDATE runs inside a
  `SECURITY DEFINER` merge function owned by that role. Every other caller — above all `app` (NOBYPASSRLS
  runtime) — still hits the `RAISE EXCEPTION`. Authorization is **proven at the database level** because
  Postgres enforces role identity: the app cannot set `current_user` to the merge role; it can only be
  reached by the privileged `SET ROLE` or by calling the definer function. **Reject any GUC/flag design**
  (`SET LOCAL app.merge_authorized = on`, a session var, an app-layer check) — any session can set those,
  so they are not provable authorization.
- **FKs -> `DEFERRABLE INITIALLY IMMEDIATE`** so the merge transaction can `SET CONSTRAINTS ALL DEFERRED`
  and repoint `memberships` + the chat rows atomically, checked once at `COMMIT`.
- **Regression test** runs a real re-parent inside a single **deferred** transaction, proving (a) the
  merge role CAN re-parent, (b) `app`/any non-merge role still CANNOT (bypass stays closed), (c) the DM
  exactly-2-members and `dm_key`-consistency invariants hold at `COMMIT`.

## Why it cannot be finalized now (the blocker)

DD-103 (owner-final) defers the exact shape to the Person-merge slice because it **depends on what the
real merge transaction is** — which does not exist (zero `mergePersons`/`merge_persons`/`mergeIdentity`
in `packages`/`apps`). Open, merge-transaction-dependent design questions the contract enumerates:
which role owns the merge; the exact column set to repoint (`person_id`, `author_person_id`, `dm_key`,
and `created_by_person_id` — which has a composite FK but **no** immutability trigger); which of the
three composite FKs actually need deferring; and the **`dm_key` UNIQUE collision** when both persons
already share a DM with the same peer (two DM channels must collapse into one — a merge-conflict case,
echoing the money "combine two state records" rule and the `pay_code` DD-02 "decide at build time"
precedent). Designing these blind is the rework DD-103 rejects, and DD-103's hard constraint puts all
three deliverables **in the Person-merge slice**.

## What to actually do

- **If you are here to build Person-merge:** treat this contract + manifest as the pinned
  schema-enablement portion of your slice. Re-derive the migration number, design the escape hatch
  against your real merge transaction along the direction above, land the DEFERRABLE FK and the
  deferred-transaction test **in your slice**, and run the security round the manifest specifies.
- **If you are here for anything else:** this is not a runnable slice. Do not register it. Do not open a
  worktree. Re-read DD-103.

`NEXT_REVIEW_TRIGGER`: a Person-merge slice/spec (a merged or in-design `mergePersons`/`merge_persons`
transaction defining the merge role and sequence) exists on `origin/main` — at which point re-open this
contract and finalize the escape-hatch DDL against it.
