# Clause

**Escrow that pays on the spec you wrote.**

Clause is an escrow web app for paid work, built on
[GenLayer](https://genlayer.com) Intelligent Contracts. The buyer locks
payment against a spec written as clauses. A dispute has to cite one of those
clauses, and a jury of AI validators answers a single question about it:

> Does the delivered work fail this clause, as written?

The jury never sees the buyer's complaint. A complaint about something the
spec never asked for has no clause to cite, so it never reaches a model.

**Live on GenLayer Studio and the Bradbury testnet** · the docs are built into
the web app (Docs in the menu), with the sources in [`docs/`](docs/README.md) ·
built following [skills.genlayer.com](https://skills.genlayer.com)

---

## Contents

- [The problem](#the-problem)
- [How Clause works](#how-clause-works)
- [What has been shown, and what has not](#what-has-been-shown-and-what-has-not)
- [Deployed contracts](#deployed-contracts)
- [The web app](#the-web-app)
- [On-chain results](#on-chain-results)
- [Contract reference](#contract-reference)
- [Security and limits](#security-and-limits)
- [Development](#development)
- [Project layout](#project-layout)
- [Roadmap](#roadmap)
- [License](#license)

## The problem

In freelancing, and in paid jobs between AI agents, escrow is not where
payments go wrong. The usual fight is a buyer who rejects the work for a
reason that was not in the spec when the money was locked: "the cities should
have been capitals", "it should have been in French".

A normal smart contract can hold the funds, but it cannot read the work. An
arbitrator who reads both sides' arguments can be talked into a new reading
of the spec. Clause narrows what the jury is allowed to look at, and keeps
the money in a contract that does not depend on the jury at all.

## How Clause works

Clause is two contracts per network. The **escrow** holds the GEN, every deal
and every clock, and never runs a model. The **jury** runs the model and
holds nothing.

| | Step | What happens |
| --- | --- | --- |
| 01 | **Fund** | The buyer names the seller, writes the spec as clauses (an id, what is asked, an acceptance test, an amount) and sends exactly the total. The spec's sha256 is pinned on the deal. |
| 02 | **Checkability gate** | Each acceptance test must name something checkable: a number, a quoted value or a structure. Tests built on taste words ("good", "professional") are refused at funding, and the GEN is credited back. |
| 03 | **Deliver** | The seller delivers one URL and its sha256. Every clause opens for review. If nothing is delivered by the deadline, the buyer is refunded. |
| 04 | **Dispute by citation** | During a clause's review window, the buyer may dispute that clause by its id, with a bond (10% of the clause, at least 0.01 GEN), and may point at a location in the work. A dispute citing an id that is not in the spec is refused: no model runs and the bond is credited back. |
| 05 | **The jury rules** | The dispute convenes the jury contract itself; anyone can convene it again if a round could not decide. Each validator fetches the work and checks its digest, then answers the one question from the clause, the work and the bytes at the buyer's location. The jury records the ruling. |
| 06 | **The escrow applies it** | After an appeal window, anyone applies the ruling to the escrow. **unmet** keeps the clause's money for the buyer, and the seller may redeliver once. **met** pays the seller, plus the bond. **undetermined** pays the seller and returns the bond. |
| 07 | **Every clock is in the escrow** | `settle` (anyone) applies every deadline that has passed: undisputed clauses pay, a dispute with no ruling applied lapses to the seller - or refunds the buyer if the jury could not fetch the work - and undelivered work refunds. It never reads the jury. |
| 08 | **Withdraw** | Rulings and deadlines credit what each party is owed, and `withdraw` sends it. |

### Three design decisions

**The money does not depend on the jury.** On Studio, an appeal was measured
to leave the appealed contract unreadable. So rulings run on the jury
contract, and the escrow reads it in exactly one place, `apply_ruling`. If an
appeal makes the jury unreadable, the dispute lapses on the escrow's own
clock, and `settle` and `withdraw` still move the GEN.
`deploy/appeal_scenario.mjs` appeals a real ruling on Studio to show it.

**A missing file is not a failed test.** It was measured on Studio that a 404
is a normal response and an unreachable host raises. So:

- bytes that differ from the digest, or a 404, are the seller's: unmet, with
  no model call;
- no answer at all is never paid for. Every dispute convenes the jury
  itself, so the work is fetched at least once even if nobody pursues the
  dispute. Each round that cannot fetch the work is recorded, and the jury
  sends it to the escrow itself. Rounds must be a
  quarter of the ruling window apart. The third is the verdict
  **unavailable**: a neutral refund, the clause and the bond back to the
  buyer. With fewer rounds, the deadline refunds the same way instead of
  paying the seller. Work that becomes readable again is ruled on as usual.
  Tested in `tests/direct/test_scenarios.py` (cases 5c-5e; 5d is a dispute
  nobody pursues).

**The buyer can point, never argue.** The jury reads the first 4,000
characters of the work. A dispute may carry a byte span or a JSON pointer,
and each validator shows the jury those bytes of the verified work, labelled
as a location. The pointer's text and the complaint never reach the prompt.
Getting the bytes in front of the jury is not the same as the jury using
them. Measured on the same catalog: unmet on Studio (97 with jury 1, 100 with jury 2), but **undetermined (80) on Bradbury**, where the jury called the test ambiguous and the seller was paid.

## What has been shown, and what has not

**The claim that needs no model is the citation rule.** A clause that was not
pinned never reaches a model. Case 1a shows it on both networks, and it is
the product's strongest guarantee.

The jury itself has been shown on a small sample, stated as small:

- **Counting cases** (1b, 2, 3, 4, 5): a list of names against "exactly 3".
  These show that the complaint never arrives and that forged structure does
  not steer the jury. A model passes them by counting, so they are not a
  test of judgment.
- **One case that needs more than counting** (case 8): an invoice whose note
  says "the total below is correct" while its four amounts add up to 10 less.
  The model has to do the sum, and the work's own prose argues for the wrong
  answer. **With the first jury prompt, it was ruled correctly in only 1 of 3
  runs on Studio**: the other two came back met, at confidence 99 and 100.
  The prompt was then changed: what the work says about itself is a claim,
  not evidence, and the model writes down its calculation before it decides.
  With the new prompt (jury release 2), the case was ruled correctly in 3 of
  3 runs on Studio and 1 of 1 on Bradbury, and the correct-total control was
  met every time. Both records are published. **But case 8 is the file the
  prompt was changed to catch**, so passing it afterwards is a fix for that
  file, not a rate.
- **Two held-out cases** (10 and 11) were written after the change and
  committed, with their expected verdicts and the frozen jury build's hash,
  before they ran (`examples/HELD-OUT.md`):
  - case 10, a timesheet whose `total_hours` is half an hour off, with an
    "approved" note;
  - case 11, an order with one `line_total` that is not `qty × unit_price`,
    and no note.

  Each was ruled as expected in 6 of 6 runs on Studio (3 with the error,
  3 without). They are still arithmetic, the same check the prompt was changed to make it do, so they show the fix carries to other sums and products, not that the jury judges anything beyond arithmetic. Twelve confident arithmetic passes do not stand
  in for the case below.
- **Not yet run:** a test that can honestly be read two ways. That is where a
  jury of models is weakest, and it is the first item of the calibration work
  on the roadmap.

## Deployed contracts

| Network | Escrow | Jury |
| --- | --- | --- |
| GenLayer Studio | [`0xC254Dd250b56941C7024a478E880c5859F329Ebf`](https://explorer-studio.genlayer.com/address/0xC254Dd250b56941C7024a478E880c5859F329Ebf) | [`0xfaf7be070e483D2b884FDD93Cc611F0c3616d0bE`](https://explorer-studio.genlayer.com/address/0xfaf7be070e483D2b884FDD93Cc611F0c3616d0bE) |
| Bradbury testnet | [`0x7950E82CC97978141A5126078198e0F7bA192061`](https://explorer-bradbury.genlayer.com/address/0x7950E82CC97978141A5126078198e0F7bA192061) | [`0x9D3219a52f03c231F46c213b921e019C5E648DEA`](https://explorer-bradbury.genlayer.com/address/0x9D3219a52f03c231F46c213b921e019C5E648DEA) |

- Releases: escrow `clause/3`, jury `clause-jury/3` (work nobody can fetch is
  never paid for; see "A missing file is not a failed test").
- Appeal window: 300 s on Studio, 2,400 s on Bradbury.
- Dispute bond floor: 0.01 GEN.
- The earlier release, `clause/2` (Studio escrow
  `0xA3DE12a40Cf80B473B945C1f84a0BFE55976C3F2`, Bradbury escrow
  `0x6A5c02527e1504f416c5e47F68129f1Afc1FbF02`), holds every case recorded
  below except the `unavailable` runs. The app keeps its deals at their
  numbers (Studio #0-24, Bradbury #0-6); new deals are numbered after them.
- Deployed code: `contracts/build/clause.min.py` (escrow, 16,316 bytes) and
  `clause_jury.min.py` (jury, 9,184 bytes).
- The web app reads the addresses from `deploy/deployments.json` at build
  time.

## The web app

The web app in `frontend/` is built with Vite, React and TypeScript, using
[genlayer-js](https://www.npmjs.com/package/genlayer-js) for the chain and
Reown AppKit for wallets.

| Page | What it is for |
| --- | --- |
| **Product** | The problem, the rules, the flow, and the record of what has and has not been shown |
| **How it works** | The lifecycle in six steps |
| **App: Deals** | Every escrow on the contract, with a filter for your own; what you are owed, and withdraw |
| **App: Fund a deal** | The clause editor, checked in the browser with the contract's own rules |
| **App: Deal** | Each clause's state and clock. Deliver, dispute by citation (with an optional location), convene the jury, apply the ruling, settle. |
| **Docs** | The full documentation (introduction, user guide, integration, architecture, threat model, build and deploy, roadmap), rendered from `docs/` |

**Wallets.** Connect any EVM wallet through Reown AppKit, and switch between
Studio and Bradbury in the app. On Studio, **Studio burner** creates a key in
the browser and funds it from Studio's faucet, so anyone can try the whole
flow without a wallet.

```bash
cd frontend && npm ci && npm run dev          # http://localhost:5173
```

**Vercel:**

1. Import the repository, with the Root Directory set to `frontend` (or the
   root `vercel.json`).
2. Set `VITE_REOWN_PROJECT_ID`, and add the domain to the Reown project's
   allowlist.
3. Deploy. No other configuration is needed.

## On-chain results

Every case is a real transaction, recorded in `deploy/scenario-*.json`. Every
jury verdict is recorded against what the case expects, including any that
missed. The mechanics each verdict must produce (refusals, credits, states,
the books) are checked.

### Every jury verdict

| Case | What the model must do | Expected | Studio, jury 1 | Studio, jury 2 | Bradbury, jury 2 |
| --- | --- | --- | --- | --- | --- |
| 1a | (none: refused before any model) | refused | refused, bond back | refused, bond back | refused, bond back |
| 1b | count, with an invented demand on the real clause | met | met (99) | met (100) | met (100) |
| 2 | count: 2 names against "exactly 3" | unmet | unmet (100) | | unmet (100) |
| 3 | count, with "ignore the spec" in the dispute | met | met (98) | | |
| 4 | count, two clauses | unmet; other paid | unmet (99); format paid | | |
| 5 | count, with a forged answer block | unmet | unmet (99) | | |
| 6 | (none: the URL returns 404) | unmet, no model | unmet (100), missing | unmet (100), missing | unmet (100), missing |
| 7 | (none: the host is unreachable) | *clause/2:* no ruling; paid at deadline. *clause/3:* unavailable; refunded | no ruling; paid (clause/2) | no ruling; paid (clause/2) | no ruling; paid (clause/2) |
| 8 | add four amounts; the work says its total is correct; it is not | unmet | **1 of 3**: unmet (100), met (99), met (100) | **3 of 3**: unmet (100) ×3 | 1 of 1: unmet (100) |
| 8 | the same invoice with the right total | met | 3 of 3: met (100, 99, 100) | 3 of 3: met (100) ×3 | 1 of 1: met (100) |
| 9 | a missing price at byte 5,731, no location | (cannot be seen) | undetermined (80) | undetermined (95) | |
| 9 | the same, pointed at `/items/71` | unmet | unmet (97) | unmet (100) | **undetermined (80)**, a miss; the seller was paid |
| 10 *(held out)* | add seven hours; an "approved" note; the total is 0.5 off | unmet | | 3 of 3: unmet (100) ×3 | |
| 10 *(held out)* | the same timesheet, total right | met | | 3 of 3: met (100, 99, 100) | |
| 11 *(held out)* | check `qty × unit_price` on four lines; one is 44.79 for 44.97 | unmet | | 3 of 3: unmet (100) ×3 | |
| 11 *(held out)* | the same order, every line right | met | | 3 of 3: met (99, 99, 100) | |

**Case 7 under `clause/3`, after a review asked that unreadable work never
pay the seller.** On Studio (`deploy/scenario-studio-unavailable.json`): the
dispute convened the jury itself - round 1 was recorded as `unread` 12
seconds later with no `rule` call - and the jury's own message noted it on
the escrow within a second, with nobody applying anything; an immediate
retry was refused; rounds 2 and 3, a quarter of the ruling window apart,
were also unread, and the third was the verdict `unavailable`; after the
appeal window the escrow refunded the buyer 0.06 GEN (the clause and the
bond), credited the seller nothing, and the buyer withdrew it. 0 failed
checks. Bradbury: in progress.

Records:

- `deploy/scenario-studio-jury1.json`: jury 1, every case;
- `deploy/scenario-studio.json`: jury 2;
- `deploy/scenario-studio-heldout.json`: cases 10 and 11, pre-registered in
  `examples/HELD-OUT.md`;
- `deploy/scenario-bradbury.json`: jury 2 on Bradbury. Its runner process
  died during the appeal wait, so the verdicts were read back from
  `ruling_of` on the jury contract and the run was finished by
  `deploy/resume_scenario.mjs`; the file says so. Jury 1 is the first prompt; jury 2 adds "what the work says about
itself is a claim, not evidence" and asks for the calculation first.

### The money

| Check | Result |
| --- | --- |
| Credits per verdict, after each ruling's appeal window | Checked for every applied ruling, on both networks |
| A ruling applied before its appeal window | Refused, on both networks |
| A dispute ruled twice | Refused, on both networks |
| Seller withdraws | Studio, jury 1 run: +0.55 GEN, exactly what was owed. Studio, held-out run: +0.36 GEN, exactly. Bradbury: +0.21990 GEN, the 0.22 owed less 0.0001 GEN fee for its own withdraw transaction. |
| Books (`balance == held + owed`) | Studio jury 1: 0.39 = 0.30 + 0.09. Studio held-out: 0.86 = 0.72 + 0.14. Bradbury: 0.21 = 0.15 + 0.06. The jury contract holds 0 on both networks. |
| **An appeal of the jury (Studio, `deploy/appeal-studio.json`)** | The jury ruled met (98); the ruling was appealed at once; the jury contract became unreadable ("execution failed") and stayed so. `apply_ruling` was refused; the dispute lapsed; `settle` released the clause; the seller withdrew exactly 0.05 GEN; the books balanced. |

## Contract reference

**Escrow** (`contracts/contract_shell.py`), `Clause(jury, bond_floor, appeal_seconds)`:

| Method | Kind | Who | What it does |
| --- | --- | --- | --- |
| `create_deal(seller, clauses_json, delivery_seconds, review_seconds, redelivery_seconds, ruling_seconds)` | write, payable | buyer | Funds a deal against a pinned spec. Returns the deal id, or -1 and credits the GEN back if the spec is refused. |
| `deliver(deal_id, uri, digest)` | write | seller | The first delivery, or a redelivery of clauses that were ruled unmet. |
| `dispute(deal_id, clause_id, text, locate)` | write, payable | buyer | Disputes one clause, with the bond as value and an optional location. A refusal is recorded and the bond credited back. It never reverts. |
| `apply_ruling(deal_id, clause_id)` | write | anyone | Applies the jury's ruling on this dispute once it is `appeal_seconds` old. The escrow's only read of the jury. |
| `settle(deal_id)` | write | anyone | Applies every deadline that has passed. |
| `withdraw()` | write | anyone owed | Sends the caller what it is owed. |
| `get_deal`, `bond_for`, `owed_to`, `refusal_of`, `status` | view | | The deal record, the bond a dispute needs, credits, the last refusal, totals |

**Jury** (`contracts/jury_shell.py`), `ClauseJury()`:

| Method | Kind | Who | What it does |
| --- | --- | --- | --- |
| `rule(escrow, deal_id, clause_id)` | write, non-deterministic | anyone | Reads the disputed clause from the escrow, fetches the work, runs the jury, and records the ruling. If the work cannot be fetched at all, it is refused and nothing is recorded. |
| `ruling_of(escrow, deal_id, clause_id)`, `status` | view | | The recorded ruling; the release and count |

A spec is a JSON list of 1 to 8 clauses, with each amount an integer in wei:

```json
[
  {
    "id": "cities",
    "criterion": "A list of African cities for the travel page",
    "test": "The response contains exactly 3 city names",
    "amount": 50000000000000000
  }
]
```

The integration guide in the docs has genlayer-js examples, the deal record,
and every error message.

## Security and limits

The threat model (T1 to T12) is in the docs. Here is what is **not** solved:

- **The jury is a majority vote of models,** shown on a small sample. Case 8
  is the one case that needs more than counting, and its record is above.
- **The checkability gate is a heuristic.** "Contains 3 relevant sections"
  passes it, and "relevant" is still a judgement.
- **A ruling the escrow has applied is not reversed by a later appeal.** The
  appeal window is sized to finality to make that unlikely.
- **A seller who takes their host offline** (rather than deleting the file)
  for the whole ruling window is paid at the deadline. Pinning to
  content-addressed storage is on the roadmap.
- **The work is public,** and the jury reads its first 4,000 characters plus
  a location.

## Development

**Requirements:** Python 3.11+ with `pytest`, and Node 20+.

```bash
python3 -m pytest tests/direct          # 112 tests: rules, prompt, both builds, scenarios
python3 tests/mutation_check.py         # 41 mutants, one per rule; all must be killed
python3 deploy/build_contract.py        # rebuild contracts/build/ (both contracts)
cd frontend && npm run typecheck && npx tsx scripts/parity.ts
```

| Check | What it proves |
| --- | --- |
| Direct tests | Every rule, the prompt, both built contracts, and every case, including the jury contract going unreadable mid-dispute. No chain is needed. |
| Deployed bytes | Every case runs on the readable builds and on the `.min.py` files in a GenVM stand-in, and the results must be identical. |
| Mutation | Each mutant removes one rule, and the tests must kill all 32. |
| Parity | The app's spec and location checks agree with the contract on every vector. |
| Gas | Each deployed file fits Bradbury's 2^24 gas cap. |

Deploying and running the scenarios is covered in the docs (Build and
deploy). The scripts read keys from `CLAUSE_KEYS`, a directory of `*.key`
files that is never committed.

## Project layout

```
contracts/clause_core.py      every rule that needs no model (pure Python)
contracts/clause_prompts.py   the jury's question, the location excerpt, how an answer is read
contracts/contract_shell.py   the escrow: storage, entrypoints, apply_ruling
contracts/jury_shell.py       the jury: rule and its consensus block
contracts/build/              generated: readable (tested) and .min.py (deployed), per contract
deploy/                       build, deploy, scenario and appeal scripts; on-chain records; probes
tests/direct/                 the test suite; genvm_stub.py runs the built contracts
tests/mutation_check.py       the mutation check
frontend/                     the web app, including the docs page
docs/                         the documentation the web app renders
examples/                     the delivered work the scenarios use
```

## Roadmap

The roadmap is the last page of the docs. It covers:

- the design rules that never change;
- the gaps between this demo and a product;
- four phases of work, each with acceptance criteria: usable on testnet,
  trust and economics, production readiness, and ecosystem;
- sequencing, metrics, risks and non-goals.

The first item on it is the one this README admits is missing: jury cases
with two honest readings, run repeatedly, with every verdict published.

## Author

Rita Egwuatu ([@Ritapossible](https://github.com/Ritapossible)), built with
Claude Code on [GenLayer](https://genlayer.com).

## License

MIT. See [LICENSE](LICENSE).
