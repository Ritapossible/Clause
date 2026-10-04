# Architecture

## The question

A spec is a list of clauses, pinned when the escrow is funded. The seller
delivers one artifact. For a disputed clause, the jury answers one question:

> Does the delivered work fail this clause, as written?

The jury sees the clause (what was asked, and its acceptance test) and the
work, and nothing the buyer wrote. A dispute contributes only two things:
*which clause* to check, and optionally *where in the work to look*. It has no
way to add a requirement, argue a reading, or instruct the jury.

## Two contracts: the money and the jury

```
                 ┌──────────────────────────────┐
  buyer, seller  │  Clause escrow               │  holds every deal, credit and clock
  anyone ───────►│  create_deal  deliver        │  runs no model
                 │  dispute      settle         │
                 │  withdraw     apply_ruling ──┼──┐  the only read of the jury
                 └──────────────▲───────────────┘  │  (a view call)
                                │ get_deal (view)  │ ruling_of (view)
                 ┌──────────────┴───────────────┐  │
  anyone ───────►│  Clause jury                 │◄─┘
                 │  rule(escrow, deal, clause)  │  fetches the work, runs the model,
                 │  ruling_of, status           │  records a ruling; holds no GEN
                 └──────────────────────────────┘
```

- **The escrow** (`contracts/contract_shell.py`, deployed as
  `clause.min.py`) holds every deal's GEN, its credits and every clock. It
  never calls a model or fetches anything.
- **The jury** (`contracts/jury_shell.py`, deployed as `clause_jury.min.py`)
  reads a disputed clause from the escrow, asks the question, and records
  the ruling in its own storage, keyed by the escrow it read. It holds no
  GEN and no deal.
- **`apply_ruling`** on the escrow pulls that ruling once it is
  `appeal_seconds` old. This is the escrow's only read of the jury contract.
  `settle`, `withdraw` and every other entrypoint never touch it.

**Why two contracts.** An appeal of a transaction on Studio was measured to
leave the appealed contract unreadable at its non-final state ("Contract not
deployed"). In Remit, a contract that had to read the appealed one in order
to pay could not pay. If Clause's rulings ran inside the escrow, an appeal of
a ruling would freeze the very contract whose clocks are meant to guarantee
payment. With the split, an appeal can at worst make the jury unreadable:
`apply_ruling` then fails, the dispute lapses on the escrow's own clock, and
`settle` and `withdraw` move the GEN. `deploy/appeal_scenario.mjs` tests
exactly this on Studio.

**Why the escrow pulls instead of the jury pushing.** A view call from one
Intelligent Contract to another is measured and works on Studio and Bradbury
(Remit's rail read its guard this way). A message pushed from the jury into
the escrow would be a second mechanism with its own delivery semantics, and
on Bradbury `on="finalized"` messages have been measured to be dropped.

**The appeal window.** A ruling becomes applicable `appeal_seconds` after it
was recorded (300 s on Studio, 2,400 s on Bradbury; Remit's measured finality
windows). An appeal of the jury's transaction therefore has its window
before any GEN is credited. A dispute nobody rules, or whose ruling nobody
applies, lapses `appeal_seconds` after its ruling deadline, so a ruling made
in time can always be applied first.

## Lifecycle of a clause

```
create_deal (buyer, payable: exactly the sum of the clause amounts)
   every acceptance test must be checkable, or the funding is refused and
   the GEN credited back
        │
     FUNDED ─────────── no delivery by deliver_by ──────────► REFUNDED
        │
   deliver (seller: one URL + its sha256)
        │
    IN_REVIEW ───────── review window closes, no dispute ────► RELEASED
        │
   dispute (buyer, payable: the bond; cites this clause's id; optional location)
   citing an id not in the spec: refused, recorded, no jury, bond back
        │
    DISPUTED ───────── no ruling applied by rule_by + appeal ─► RELEASED, bond back
        │
   jury.rule (anyone) ── work unreachable: nothing recorded; try again
        │
   escrow.apply_ruling (anyone), once the ruling is appeal_seconds old
        ├── met ──────────────────────────────────────────────► RELEASED, bond to seller
        ├── undetermined ─────────────────────────────────────► RELEASED, bond back
        └── unmet ──► FAILED, bond back
                        ├── redeliver by redeliver_by ──► IN_REVIEW (only this clause)
                        └── no redelivery ──────────────► REFUNDED
```

`settle(deal_id)` (anyone) applies every arrow labelled with a deadline. It is
arithmetic over the deal record: no jury, no other contract, no transfer.
Each clause of a deal is independent; one broken clause does not hold the
rest.

## Money: credit, then withdraw

Rulings and deadlines never move value. They credit what each party is owed
(`owed[address]`), and `withdraw()` sends it. A ruling can never fail because
a transfer failed, and a party that is owed GEN can always take it in a
separate, simple transaction. The pattern follows Recourse's settlement
design.

Value goes to a wallet through an EVM contract interface
(`@gl.evm.contract_interface`, then `.emit_transfer(value=...)`). Measured on
Studio and Bradbury, the wallet is credited when the transaction finalises.
`gl.get_contract_at(wallet).emit_transfer` treats a wallet as an Intelligent
Contract and credits nothing; it is not used.

The escrow's books always balance: `balance == held + owed`, where `held` is
every unresolved line plus every open bond. The scenario scripts check it on
chain, and check that the jury contract's balance is zero.

### A payable call never reverts once value has arrived

Measured on Studio: the GEN sent with a call that reverts **stays in the
contract**. A payable entrypoint that raised would swallow the payment. So
`create_deal` and `dispute` refuse without reverting: they record why
(`refusal_of(address)`, and on the deal for a dispute) and credit the value
back to the sender. `tests/direct/test_built.py` holds both entrypoints to
containing no `raise`.

## The jury

```python
leader():    fetch the work
             no answer (exception, 5xx, 429)  -> {"artifact": "unread"}             # no verdict
             404 / 410                        -> unmet, artifact "missing"          # no model call
             2xx, bytes differ from digest    -> unmet, artifact "changed"          # no model call
             2xx, bytes match                 -> exec_prompt(build_prompt(clause, work, excerpt))
                                                 -> reading -> verdict
validator(): fetch and classify again; the artifact state must match exactly;
             re-answer the same question; accept by jury_agrees
then:        "unread" -> the call is refused; nothing is recorded
             otherwise -> the ruling is recorded for this dispute's round
```

**What counts as reading the work.** Measured on Studio with a probe contract
(`deploy/probes/probe-web-studio.json`):

- a 404 comes back as a normal response with `status: 404`;
- an unreachable host raises `NondetException`.

So the contract can tell the server's definite answer from no answer:

- **Bytes that differ from the pinned digest, or a 404/410,** are the
  seller's: it pinned the work and changed or removed it. These are ruled
  unmet with no model call, and the seller may redeliver.
- **No answer at all is not a verdict on anyone.** The call is refused,
  nothing is recorded, anyone can convene the jury again, and if nothing
  lands by the deadline the clause pays the seller.

Before this rule, the same missing file could end two opposite ways:
validators who all failed to fetch agreed on "unmet", while validators who
failed differently disagreed and the clause paid at its deadline.

**The model reads; the contract rules.** The model returns a reading
(`fails`, `satisfies` or `cannot_tell`), a reason code and a confidence.
`reading_to_verdict` maps it:

- `fails` with confidence 60 or more is `unmet`;
- a hesitant `fails`, or `cannot_tell`, is `undetermined`;
- `satisfies` is `met`.

An unreadable answer is `undetermined`, so it never keeps money from the
seller.

**Fail closed toward paying the seller.** The buyer carries the burden of a
dispute. Under `jury_agrees`:

- the same verdict agrees;
- `unmet` stands only on agreement;
- a validator that is itself sure the clause failed vetoes a release: the
  round fails, and if no ruling lands by the deadline the clause releases
  anyway;
- `met` and `undetermined` both release, so they agree.

GenLayer accepts the leader's answer when a majority of validators agree.

**One ruling per dispute.** Each dispute has a round (`deliveries.opened_at`).
The jury refuses to rule twice on the same round, and the escrow applies only
a ruling whose round matches the open dispute. A stale ruling, from before a
redelivery, can never be applied.

**The fetch is inline in both closures**, and every value the closures capture
is a plain Python value: a storage proxy does not survive into the
validator's sandbox.

## What the jury is told

`build_prompt(criterion, test, artifact_text, excerpt, where)` in
`contracts/clause_prompts.py` takes the clause, the work and, optionally, a
slice of the same work. The dispute text is not a parameter, which is why it
cannot reach the jury.

- The work is labelled untrusted, and its structure-shaped text is disarmed
  (`neutralize`).
- The instruction is to check only what the acceptance test states, in its
  ordinary sense, without adding requirements or judging taste.
- The work is cut at 4,000 characters, and the prompt says so when it is.

**A location, not an argument.** A dispute may carry a location: a byte span
(`bytes:5600-5800`, up to 2,000 bytes) or a JSON pointer (`/items/71`). Each
validator slices the location out of the bytes it fetched and verified. It
shows the slice under "A LOCATION IN THE SAME WORK (the buyer chose where to
look; it is not an argument)":

- A byte span is named by its numbers.
- A pointer's own text is **never** shown, because the buyer wrote it; the
  section says only "one JSON value inside the work".
- The slice is the seller's bytes, disarmed like the rest of the work.

This lets a buyer who is right about byte 5,731 show the jury byte 5,731,
without putting the complaint back in the prompt.

## The checkability gate

An acceptance test is funded only if it names something a reader can check:

- a digit, a quoted value, or a structural word (key, section, words, JSON,
  items, …);
- and no taste word (good, professional, quality, …).

The rule is `acceptance_test_error` in `clause_core.py`. The app runs the same
rule in the browser (`frontend/src/lib/spec.ts`), along with the location
rule, and `frontend/scripts/parity.ts` holds both to the engine's answers. It
is a heuristic, and the threat model says so.

## One escrow, many deals

Every deal lives in one escrow contract, each as a JSON record. That keeps
the product to two addresses, at a cost: transactions on one Intelligent
Contract execute in order. A jury round no longer runs on the escrow, so it
does not delay the escrow's other transactions. It still delays the next
round on the jury contract.

## Build

```
contracts/clause_core.py     every rule that needs no model; pure Python
contracts/clause_prompts.py  the jury's question, the location excerpt, how an answer is read
contracts/contract_shell.py  the escrow: storage, entrypoints, apply_ruling
contracts/jury_shell.py      the jury: rule, the consensus block, ruling_of
        │
        └── deploy/build_contract.py ──► contracts/build/clause.py       + clause.min.py       (escrow)
                                     ──► contracts/build/clause_jury.py + clause_jury.min.py  (jury)
```

Bradbury caps a transaction at 2^24 gas, and a deploy costs about 0.96M gas
plus 782 per byte, so a deployed file must stay under about 19.5 KB. The
split leaves room:

| Contract | Deployed size |
| --- | --- |
| Escrow | 16,316 bytes |
| Jury | 8,660 bytes |

The minifier strips docstrings and comments, drops unreachable definitions,
and shortens names. `tests/direct/test_scenarios.py` runs the readable and
the minified files of both contracts side by side in a GenVM stand-in, and
requires identical results.

The runner is pinned:
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`. The header
must be followed immediately by code.
