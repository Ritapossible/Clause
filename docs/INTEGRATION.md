# Integration guide

This guide is for developers and AI agents that use Clause from code: a
marketplace that funds deals for its users, an agent that hires another agent,
or a script that delivers work. Everything the web app does goes through the
calls below. There is no backend and no API key.

- [Addresses](#addresses)
- [Concepts](#concepts)
- [Calling the contract with genlayer-js](#calling-the-contract-with-genlayer-js)
- [Reading a transaction's outcome](#reading-a-transactions-outcome)
- [Method reference](#method-reference)
- [The deal record](#the-deal-record)
- [The spec format](#the-spec-format)
- [Delivering work](#delivering-work)
- [An agent-to-agent flow](#an-agent-to-agent-flow)
- [Limits](#limits)

## Addresses

Clause is two contracts per network: the **escrow** (holds GEN, deals, credits
and clocks) and the **jury** (runs the model, records rulings, holds nothing).

| Network | Escrow | Jury | genlayer-js chain |
| --- | --- | --- | --- |
| GenLayer Studio | `0xC254Dd250b56941C7024a478E880c5859F329Ebf` | `0xfaf7be070e483D2b884FDD93Cc611F0c3616d0bE` | `studionet` |
| Bradbury testnet | `0x7950E82CC97978141A5126078198e0F7bA192061` | `0x9D3219a52f03c231F46c213b921e019C5E648DEA` | `testnetBradbury` |

The canonical list, with each network's `appeal_seconds`, is
`deploy/deployments.json`. Read it from there rather than hard-coding these.

## Concepts

- **Deal.** One escrow between one buyer and one seller, with 1-8 clauses.
  Deals are numbered from 0 on each contract.
- **Clause (line).** An id, a criterion, an acceptance test and an amount.
  Each line has its own state and is paid or refunded on its own.
- **Line states:** `funded`, `in_review`, `disputed`, `failed`, `released`,
  `refunded`. `released` and `refunded` are final.
- **Verdicts:** `unmet`, `met`, `undetermined`.
- **Credit, then withdraw.** No call except `withdraw` sends GEN. Rulings,
  deadlines and refusals credit `owed[address]`.
- **Rule, then apply.** `jury.rule(escrow, deal, clause)` records a ruling on
  the jury contract. `escrow.apply_ruling(deal, clause)` applies it once it is
  `appeal_seconds` old. Until then, nothing moves.
- **Time.** All times are Unix seconds from the contract's clock. `get_deal`
  returns `now`, so compare deadlines against it, not against your machine's
  clock.
- **Amounts** are integers in wei (1 GEN = 10^18). Views return them as JSON
  numbers that can exceed 2^53: parse them losslessly (as strings or BigInt).

## Calling the contract with genlayer-js

```bash
npm install genlayer-js
```

```js
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";   // or testnetBradbury

const CLAUSE = "0xC254Dd250b56941C7024a478E880c5859F329Ebf";   // the escrow
const JURY = "0xfaf7be070e483D2b884FDD93Cc611F0c3616d0bE";
const account = createAccount(process.env.PRIVATE_KEY);
const client = createClient({ chain: studionet, account });

// Read
const status = JSON.parse(await client.readContract({ address: CLAUSE, functionName: "status", args: [] }));
const deal = JSON.parse(await client.readContract({ address: CLAUSE, functionName: "get_deal", args: [0] }));

// Write: fund a deal for 0.05 GEN
const spec = [{
  id: "cities",
  criterion: "A list of African cities for the travel page",
  test: "The response contains exactly 3 city names",
  amount: 50000000000000000n,
}];
const total = spec.reduce((a, c) => a + c.amount, 0n);
// Amounts must be JSON integers. JSON.stringify cannot write a BigInt, and a
// JS number loses precision above 2^53, so write the digits directly.
const specJson = JSON.stringify(spec, (_, v) => (typeof v === "bigint" ? `@@${v}@@` : v))
  .replace(/"@@(\d+)@@"/g, "$1");
const hash = await client.writeContract({
  address: CLAUSE,
  functionName: "create_deal",
  args: [SELLER, specJson, 3600, 300, 1800, 1800],
  value: total,
});
const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 400, interval: 3000 });
```

`JSON.parse` loses precision on wei amounts. The examples use it for brevity.
In production, use a lossless parser; the app's is `parseLossless` in
`frontend/src/lib/money.ts`.

Amounts in the spec must be JSON **integers** in wei. A string such as
`"50000000000000000"` is refused. The web app writes exact integers the same
way (`specJson` in `frontend/src/views/NewDeal.tsx`).

## Reading a transaction's outcome

A receipt has three possible outcomes. Read all three, because "accepted" does
not mean "applied":

| Outcome | Receipt (Studio) | Receipt (Bradbury) | Meaning |
| --- | --- | --- | --- |
| **Applied** | `result_name: MAJORITY_AGREE` and leader status `return` | `resultName: AGREE` and `txExecutionResultName: FINISHED_WITH_RETURN` | Validators agreed and the call returned normally. State changed. |
| **Refused** | agreement, and leader status `contract_error` | agreement, and an `ERROR`/`ROLLBACK` execution result | Validators agreed the contract raised. Nothing changed. |
| **No consensus** | anything else | anything else | The round failed. Nothing changed; it is safe to retry. |

`interpret()` in `frontend/src/chain/clause.ts` and `outcome()` in
`deploy/lib.mjs` read both receipt shapes. Copy one of them.

On Bradbury, a receipt can arrive while the round is still `IDLE`. Poll
`getTransaction` until the round is decided before concluding anything.

**Rulings.** Convening the jury is a write to the jury contract; applying
the ruling is a later write to the escrow:

```js
await client.writeContract({ address: JURY, functionName: "rule", args: [CLAUSE, dealId, "cities"] });
const ruling = JSON.parse(await client.readContract({ address: JURY, functionName: "ruling_of", args: [CLAUSE, dealId, "cities"] }));
// ...once ruling.at + appeal_seconds has passed on the contract's clock:
await client.writeContract({ address: CLAUSE, functionName: "apply_ruling", args: [dealId, "cities"] });
```

**Payable calls never refuse by reverting.** `create_deal` and `dispute`
record a refusal and credit the value back. Their transaction is *applied*
even when refused. To tell the difference:

- `create_deal`: the deal count did not increase, and `refusal_of(you)` has a
  fresh `at`.
- `dispute`: the line is still `in_review`, and the deal's `refused` list (and
  `refusal_of(you)`) has the reason.

## Method reference

### Escrow writes

| Method | Value | Caller | Effect | Reverts with |
| --- | --- | --- | --- | --- |
| `create_deal(seller, clauses_json, delivery_seconds, review_seconds, redelivery_seconds, ruling_seconds) -> int` | the exact clause total | buyer | Opens a deal; returns its id. On any spec error: returns -1, credits the value back, records `refusal_of(buyer)`. | never |
| `deliver(deal_id, uri, digest)` | none | seller | The first delivery (all `funded` lines go to `in_review`), or a redelivery (only `failed` lines inside their window). | `only the seller may deliver`, `the delivery deadline has passed`, `nothing to redeliver`, `the delivery digest must be 64 hex characters`, `the delivery must be an http(s) URL`, `unknown deal` |
| `dispute(deal_id, clause_id, text, locate)` | at least `bond_for(deal_id, clause_id)` | buyer | The line goes to `disputed`, the bond is held, and the escrow convenes the jury itself (a message to the jury's `rule`). `locate` is `""`, a byte span `bytes:START-END` (1-2,000 bytes), or a JSON pointer `/a/0`. On any error: the reason is recorded on the deal and in `refusal_of`, and the value is credited back. | never |
| `apply_ruling(deal_id, clause_id)` | none | anyone | Reads the jury's ruling on this dispute and applies it, if it is about this dispute's round, was made by the ruling deadline, and is `appeal_seconds` old. A record of rounds that could not fetch the work is noted on the line at once (`unread`). | `the jury has not ruled on this dispute`, `the ruling can be applied from …, after its appeal window`, `the ruling came after the ruling deadline`, `clause … is not disputed`, `unknown deal` |
| `note_unread(deal_id, clause_id, round, count, at)` | none | the jury contract only | Sent by the jury as a message after a round that could not fetch the work: notes `unread` on the line, so its deadline refunds the buyer. | `only the jury contract notes an unread round`, `clause … is not disputed`, `the jury has not ruled on this dispute` |
| `settle(deal_id)` | none | anyone | Applies every passed deadline on the deal. A no-op if none has passed. Never reads the jury. | `unknown deal` |
| `withdraw()` | none | anyone | Sends the caller everything it is owed. Never reads the jury. | `nothing is owed to this address` |

### Jury writes

| Method | Caller | Effect | Reverts with |
| --- | --- | --- | --- |
| `rule(escrow, deal_id, clause_id)` | anyone | Reads the disputed clause from `escrow`, fetches the work, runs the jury, and records the ruling for this dispute's round. If no validator could fetch the work, records the round as `unread` (count 1-3; the third carries the verdict `unavailable`) and sends `note_unread` to the escrow. | `clause is not disputed`, `the ruling deadline has passed; …`, `this dispute is already ruled; …`, `the work could not be fetched at …; the jury may try again from …` |

Every revert message starts with `[EXPECTED]`.

### Views

| Contract | Method | Returns |
| --- | --- | --- |
| Escrow | `status() -> str` | JSON: `release` (`"clause/2"`), `jury`, `appeal_seconds`, `deals` (count), `held`, `owed`, `balance`, `bond_floor`. Invariant: `balance == held + owed`. |
| Escrow | `get_deal(deal_id) -> str` | The deal record as JSON (below), plus `now`. |
| Escrow | `bond_for(deal_id, clause_id) -> int` | The bond a dispute on that clause must post: `max(floor, amount * 10%)`. |
| Escrow | `owed_to(address) -> int` | What the address can withdraw. |
| Escrow | `refusal_of(address) -> str` | JSON `{reason, at, returned}` for the address's last refused payable call, or `{}`. |
| Jury | `ruling_of(escrow, deal_id, clause_id) -> str` | JSON `{round, verdict, reason, confidence, artifact, located, at}`, or `{}`. |
| Jury | `status() -> str` | JSON: `release` (`"clause-jury/1"`), `ruled` (count). |

### What the jury found (`artifact`)

| Value | Meaning | Ruling |
| --- | --- | --- |
| `verified` | 2xx and the bytes match the digest | The model's reading |
| `changed` | 2xx and the bytes differ | `unmet`, no model call |
| `missing` | 404 or 410 | `unmet`, no model call |
| `unread` | No answer (network error, 5xx, 429) | None: `rule` is refused and nothing is recorded |

### Verdict effects

| Verdict | Line becomes | Seller credited | Buyer credited |
| --- | --- | --- | --- |
| `unmet` | `failed`, with `redeliver_by = now + redelivery_seconds` | nothing | the bond |
| `met` | `released` | amount + bond | nothing |
| `undetermined` | `released` | amount | the bond |

### Deadline effects (`settle`)

| Line state | Condition | Becomes | Credit |
| --- | --- | --- | --- |
| `funded` | no delivery and `now > deliver_by` | `refunded` | buyer: amount |
| `in_review` | `now > review_until` | `released` | seller: amount |
| `disputed` | `now > dispute.rule_by + appeal_seconds`, no unread round noted | `released`, `lapsed: true` | seller: amount; buyer: bond |
| `disputed` | the same, with `unread` noted | `refunded`, `lapsed: true`, `unavailable: true` | buyer: amount + bond |
| `failed` | `now > redeliver_by` | `refunded` | buyer: amount |

## The deal record

```jsonc
{
  "id": 3,
  "buyer": "0x…",                 // lower-case
  "seller": "0x…",
  "created_at": 1767000000,
  "spec_digest": "b5ac…",          // sha256 of the canonical spec
  "timing": { "delivery_seconds": 3600, "review_seconds": 300, "redelivery_seconds": 1800, "ruling_seconds": 1800 },
  "deliver_by": 1767003600,
  "delivery": { "uri": "https://…", "digest": "c939…", "at": 1767000500 },  // null until delivered
  "deliveries": 1,
  "lines": [
    {
      "id": "cities",
      "criterion": "A list of African cities for the travel page",
      "test": "The response contains exactly 3 city names",
      "amount": 50000000000000000,
      "state": "failed",
      "review_until": 1767000800,
      "dispute": { "bond": 10000000000000000, "text": "Only two cities.", "opened_at": 1767000600, "rule_by": 1767002400,
                   "locate": "", "round": "1.1767000600" },
      "verdict": "unmet",
      "reason": "test_failed",
      "confidence": 99,
      "artifact": "verified",       // verified | changed | missing
      "ruled_at": 1767000650,       // when the jury recorded the ruling
      "decided_at": 1767000960,     // when the escrow applied it
      "redeliver_by": 1767002450
    }
  ],
  "refused": [ { "cited": "capitals", "reason": "no clause 'capitals' in the pinned spec; …", "at": 1767000610 } ],
  "now": 1767000700
}
```

Fields appear as the deal progresses: `review_until` on delivery, `dispute` on
a dispute, `verdict`/`reason`/`confidence`/`artifact`/`ruled_at`/`decided_at`
when a ruling is applied,
`redeliver_by` on unmet, `lapsed` on a lapsed dispute, `unread` (rounds that
could not fetch the work) and `unavailable` on a neutral refund. `refused` keeps the last
10 refused disputes.

## The spec format

`clauses_json` is a JSON array of 1-8 objects with exactly these keys:

| Key | Type | Rule |
| --- | --- | --- |
| `id` | string | 1-24 characters from `a-z 0-9 - _`; unique in the spec |
| `criterion` | string | 8-400 characters |
| `test` | string | 12-400 characters; passes the checkability gate ([USER-GUIDE.md](USER-GUIDE.md#the-checkability-gate)) |
| `amount` | integer (wei) | positive |

The contract also requires:

- the value sent to equal the sum of the amounts;
- every timing to be 60 to 7,776,000 seconds (90 days);
- the buyer and seller to differ.

**Spec digest.** `spec_digest` is the sha256 of the canonical spec: the
clauses with only these four keys, `criterion` and `test` trimmed, `amount` as
an integer, keys sorted, and no whitespace (`json.dumps(rows, sort_keys=True,
separators=(",", ":"))`). An integrator can recompute it to prove which spec a
deal pinned. `tests/fixtures/spec_vectors.json` has test vectors.

To check a spec before sending anything, use the same rules the app uses:
`frontend/src/lib/spec.ts` mirrors the contract, and
`frontend/scripts/parity.ts` holds it to the contract's answers.

## Delivering work

1. Host the work at an http(s) URL that serves **the same bytes** for the
   whole deal. Validators fetch it during a ruling, possibly days later.
2. Compute the sha256 of exactly those bytes:
   ```bash
   curl -sL "$URL" | sha256sum
   ```
   ```js
   const bytes = await (await fetch(url)).arrayBuffer();
   const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
     .map((b) => b.toString(16).padStart(2, "0")).join("");
   ```
3. Call `deliver(deal_id, url, digest)`.

During a ruling, each validator fetches the URL, hashes the body and compares
the result with the digest. Different bytes (`changed`) or a 404/410
(`missing`) are ruled `unmet` without a model call. No answer at all
(`unread`) never pays the seller: the round is recorded and sent to the
escrow, `rule` can be called again a quarter of the ruling window later, and
the third unread round is the verdict `unavailable` - a neutral refund of the
clause and the bond to the buyer. A dispute that reaches its deadline with an
unread round noted is refunded the same way. Keep the work reachable until
every dispute on it is ruled.

## An agent-to-agent flow

A buyer agent hires a seller agent to produce a JSON file:

```
buyer:  spec = [{id:"rows", test:"The file is JSON with at least 50 items", …},
                {id:"keys", test:"Every item has the keys \"name\" and \"url\"", …}]
buyer:  create_deal(seller, spec, 86400, 3600, 3600, 3600) value=total     -> deal_id
seller: poll get_deal(deal_id) until it sees the deal; do the work
seller: upload the file; deliver(deal_id, url, sha256)
buyer:  fetch url, check each test locally
        - all pass: do nothing (or settle after review_until)
        - "keys" fails at item 37: dispute(deal_id, "keys", "", "/37") value=bond_for(deal_id,"keys")
          jury.rule(escrow, deal_id, "keys"); after appeal_seconds: escrow.apply_ruling(deal_id, "keys")
seller: if a line is "failed": fix, redeliver before redeliver_by
anyone: settle(deal_id) after the windows close
both:   withdraw()
```

Agent tips:

- Check acceptance tests deterministically on your side before disputing.
  A dispute the jury finds met costs the bond.
- Run `settle` and `apply_ruling` on a schedule for the deals you are part
  of. Nothing pays until someone calls them.
- When a failure is deep in the work, send a location. The jury reads only the
  first 4,000 characters, plus the slice you point at. It may still rule
  undetermined: a located defect was unmet on Studio and undetermined on
  Bradbury.
- Compare every deadline with `get_deal(...).now`.

## Limits

| Limit | Value |
| --- | --- |
| Clauses per deal | 8 |
| Text per criterion or test | 400 characters |
| Dispute note | 1,000 characters stored |
| Work the jury reads | The first 4,000 characters of the delivery, as UTF-8 text, plus up to 2,000 bytes at the dispute's location |
| Appeal window | `appeal_seconds` per escrow: 300 on Studio, 2,400 on Bradbury |
| Windows | 60 seconds to 90 days |
| Redeliveries | One per unmet ruling, within its window |
| Currency | Native GEN only |
| Listing | No per-party index: read `status().deals`, then `get_deal(i)` for each id |
