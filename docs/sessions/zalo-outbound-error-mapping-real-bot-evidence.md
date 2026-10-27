# Zalo outbound error mapping: real-bot evidence (template)

Status: TEMPLATE, no response recorded yet. This file is the evidence the backlog row
`zalo-outbound-error-mapping-real-bot-verification` (docs/autopilot-backlog.md) waits for: that row closes by hand, as
its `close_by` line says, once every class in section 2 has a recorded real-bot response or a dated "not provocable"
line. A commit alone never closes it.

Who fills it: only the holder of the real Zalo bot token (the owner, or a lane the owner gives the token to for this
run). Nobody else provokes, records or pastes anything here.

## 1. Redaction rule (binding for every slot of this file)

- Never write a bot token, any part of a request URL (the URL carries the token: `/bot<TOKEN>/<method>`,
  packages/db/src/zalo-bot-api.ts:4-8), a chat id, a Zalo user id, a webhook URL token or webhook secret, a phone
  number or a display name.
- Record only: the HTTP status; the values of `ok` and `error_code`; the `description` text with every id, name or
  number that identifies a person, a chat or the bot replaced by `<redacted>`; the date (YYYY-MM-DD).
- Never paste a command line, a shell history, a log line or a screenshot: each can carry the token.
- In doubt, leave the slot empty and write "withheld (redaction)".

## 2. What the run checks: the shipped mapping

The mapping below is the one the DD-138 row `p3-m6-zalo-outbound Z-6` (docs/standards/decisions.md) records as
shipped by L4 (#66); its numbers are defaults pending live verification (packages/db/src/zalo-bot-api.ts:14, :134).
Against a local fake server it is pinned by packages/db/src/zalo-bot-api-fake-server-matrix.test.ts (the real
`sendMessage` and `classifyZaloError`) and apps/bot/src/projectors/zalo-dm-error-mapping-matrix.test.ts (the zalo_dm
projector's result per class). A fake cannot show what the real Zalo API answers: that is what this file records.

| # | Class | Shipped outcome | Fake test IDs | Hit by (section 3) | Observed? |
|---|---|---|---|---|---|
| C1 | HTTP 401 | dead-letter `zalo_unauthorized` | A-8 | | |
| C2 | HTTP 429 | retry `zalo_rate_limited` | A-9 | | |
| C3 | HTTP 5xx | retry `zalo_server_error` | A-10 | | |
| C4 | any other HTTP 4xx | this recipient terminal `zalo_rejected` | A-11 | | |
| C5 | a 2xx with `ok: false`, by its integer `error_code`: 401 dead-letter `zalo_unauthorized`; 429 retry `zalo_rate_limited`; 500 or more retry `zalo_server_error`; any other integer, or none, this recipient terminal `zalo_rejected` | as listed | A-12 to A-16 | | |
| C6 | a 2xx without a boolean `ok`, a body that is not JSON, a body over 64 KiB, or a body cut after the 2xx | this recipient terminal `zalo_bad_response` (never resent) | A-17 to A-20 | | |
| C7 | no answer within the 5 s timeout | retry `zalo_timeout` | A-21 | | |
| C8 | a network failure (no HTTP answer) | retry `zalo_network` | A-22 | | |

"Observed?": `yes (P<n>)`, or `not provocable: <one line why>, <date>`.

## 3. Provocations (one row per attempt)

These are attempts, not predictions: which class the real API answers with is unknown until it is recorded, which is
the point of this file. Send each one with the real bot to your own test chat only, with a plain test text such as
"plexco evidence P1".

| # | Attempt | HTTP status | `ok` | `error_code` | `description` (redacted) | Class (section 2) | Shipped outcome as expected? | Date |
|---|---|---|---|---|---|---|---|---|
| P1 | control: one ordinary send to your own test chat | | | | | (success expected) | | |
| P2 | the same send with one character of the token changed | | | | | | | |
| P3 | the same send with an old token the bot no longer accepts, if you have one | | | | | | | |
| P4 | a send to a chat id that has never messaged the bot | | | | | | | |
| P5 | a send with an empty text | | | | | | | |
| P6 | a send with a very long text (write the length used, never the text) | | | | | | | |
| P7 | a fast burst of sends to your own test chat, stopped at the first throttling answer or after 20 sends (write the count) | | | | | | | |
| P8 | a send with the sending machine's network switched off (a local network failure, not a Zalo answer) | | | | | | | |

A 5xx, a timeout, a body that is not JSON, an oversize body or a cut body cannot be provoked on demand: record one only
if it happens during the run (its own row and date); otherwise mark the class `not provocable` in section 2.

## 4. After the run

- When every class C1 to C8 reads `yes (P<n>)` or `not provocable`, the backlog row closes by hand as its `close_by`
  line says.
- A response whose class does not give the outcome section 2 expects (for example a token the bot no longer accepts
  answered as `ok: false` with an `error_code` other than 401) is a finding: record it here and raise it as an owner
  decision on the DD-138 Z-6 row. This file never changes the mapping, and the code does not change in the same PR.
