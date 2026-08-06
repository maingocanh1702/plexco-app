<!-- review-readiness: historical -->

# Historical inventory — FE design docs, 2026-07-31

> **Classification:** Historical session evidence only. This file is not a readiness assessment, design gate, plan, or authorization to build `.pen`/runtime.
> **Scope:** Records the comparison that motivated the Plexco FE projection layer. Current authority remains each linked Product/BE contract plus repository readiness policy.

## Snapshot inventory

| Dimension | SaaS Bot Tele snapshot reported in the session | Plexco live evidence at `0c5808fc7cf50d139bdd9c4ee79917bf4059c4f4` |
|---|---|---|
| Product/technical feature docs | Separate FE/BE packs were reported; not re-verified from this repo | 24 Product feature docs + 24 BE companion docs |
| FE projection docs | Separate FE specs were reported | 12 Draft FE design specs under `docs/channels/web/FE/` |
| BRD-to-Pen guidance | Project-specific playbook was reported | `../../templates/brd-to-pen-playbook.md` v3.0 |
| Design tokens | Rich role/color system was reported | Light/dark, typography, spacing, radius, shadow and motion duration/easing tokens are present |
| Designer package | No separate kickoff package was reported in the original snapshot | `designer-kickoff.md`, `design-brief.md`, theme direction, frontend pipeline and handoff templates |
| `.pen` evidence | A large BotShopez artifact and audit were reported, but this file does not certify completeness/readiness | `design.pen` exists as untracked WIP; no current audit in this file |

## What the comparison established

- Plexco's Product/BE contracts are engineering-heavy, so a separate designer-readable FE projection is useful.
- The FE layer must preserve source provenance, runtime truth, capability gates, privacy and fail-closed boundaries; it must not invent DTOs or imply implementation.
- A visual artifact, object count or file size is inventory evidence only. It does not prove screen coverage, contract fidelity, accessibility, `PLAN_READY`, `CODE_READY`, `ENABLE_READY` or `IMPLEMENTED`.
- The 12 FE specs are a separate projection layer now; the older claim that Plexco had no separate FE specs is superseded.

## Current use

Use this document only to understand why the FE pack was created. For current work:

1. Open the exact FE spec.
2. Follow its pinned Product/BE authority and negative scope.
3. Re-pin repository truth.
4. Apply `docs/standards/review-code-readiness-gate.md` before issuing a readiness verdict.

_Historical comparison inventory · 2026-07-31 · no active verdict_
