# Clause - Roadmap: from demo to a usable product

Clause works today, on two networks, for the cases it was built to show. This
document covers what separates it from something people and agents rely on
for real paid work, and the order in which to close those gaps.

- [Where Clause is today](#where-clause-is-today)
- [What does not change](#what-does-not-change)
- [The gaps](#the-gaps)
- [Phase 1 - Usable on testnet](#phase-1---usable-on-testnet)
- [Phase 2 - Trust and economics](#phase-2---trust-and-economics)
- [Phase 3 - Production readiness](#phase-3---production-readiness)
- [Phase 4 - Ecosystem](#phase-4---ecosystem)
- [Sequencing](#sequencing)
- [How we will measure progress](#how-we-will-measure-progress)
- [Risks and open questions](#risks-and-open-questions)
- [Non-goals](#non-goals)

Every item has an id (`1.4`), a reason, a scope, and a **done when** line,
which is the test that closes it. Durations are estimates for a small team
and depend on the GenLayer platform where noted.

## Where Clause is today

**Release `clause/1`: a working demo.**

| Works | Evidence |
| --- | --- |
| Escrow per clause, funded in GEN, on Studio and Bradbury | Deployed contracts, `deploy/deployments.json` |
| A dispute must cite a clause of the pinned spec | Case 1a on both networks |
| The jury reads the clause and the work, never the complaint | Cases 1b and 3 on both networks |
| Injection in the work does not steer the jury | Case 5 on both networks |
| Every state has a clock in the escrow; `settle` resolves it | Case 4; deadline tests |
| A checkability gate on acceptance tests | Contract and in-browser, held equal by `parity.ts` |
| Credit-then-withdraw; `balance == held + owed` | Checked on chain after every scenario |
| A web app for both parties, phone-ready | Two-person browser e2e on Studio |
| 75 tests, 24 killed mutants, a gas-budget test | `tests/` |

**What makes it a demo, not a product:** it has had no real users. The jury's
accuracy is shown on six cases, not measured on hundreds. The work must be
public and short. Nothing tells a party a clock is running out. Nobody has
audited it. It runs only on testnets, in a currency with no value.

## What does not change

These are Clause's design rules. Every item below has to keep them, and any
proposal that breaks one is out of scope.

1. **A dispute cites a clause of the pinned spec.** Nothing else can be
   disputed.
2. **The jury never sees the dispute text.** It reads the clause and the work.
3. **The spec cannot change unless both parties sign the change** (2.5).
4. **Every clock lives in the escrow.** No outcome depends on a person,
   another contract or a keeper showing up, only on someone calling `settle`,
   which anyone can do.
5. **Credit, then withdraw.** No ruling depends on a transfer.
6. **Fail closed toward paying the seller.** The buyer carries the burden of
   a dispute.
7. **No admin can move a deal's money or change a ruling.** Not now, and not
   after launch.

## The gaps

| # | Gap today | Who it hurts | Closed by |
| --- | --- | --- | --- |
| G1 | A satisfied buyer cannot pay early; a deal cannot be cancelled by agreement | Both | 1.1 |
| G2 | Nobody is told when a window opens or closes, and nothing pays until someone calls `settle` | Both | 1.2 |
| G3 | No per-party index; the app reads every deal one by one | Both, integrators | 1.3 |
| G4 | The seller must find stable hosting and compute a digest themselves | Sellers | 1.4 |
| G5 | The jury reads one URL, as text, up to 4,000 characters | Sellers of real work | 1.5 |
| G6 | Writing checkable tests is a skill most buyers don't have | Buyers | 1.6 |
| G7 | Jury accuracy is shown on 6 cases, not measured | Everyone | 1.7 |
| G8 | Agents must hand-write genlayer-js calls | Agent builders | 1.8 |
| G9 | The contract is within 0.5 KB of Bradbury's deploy budget | Development | 1.9 |
| G10 | No appeals | The losing party of a wrong ruling | 2.1 |
| G11 | Delivered work is public | Anyone with confidential work | 2.2 |
| G12 | Nobody is paid to call `rule` or `settle`; the project has no revenue | Sustainability | 2.3 |
| G13 | No track record for sellers; nothing at stake for a seller who delivers junk | Buyers | 2.4 |
| G14 | Scope cannot change after funding | Both | 2.5 |
| G15 | All clauses are delivered at once; no milestones | Longer jobs | 2.6 |
| G16 | Native GEN only | Anyone pricing work in stable value | 2.7 |
| G17 | Not audited; no monitoring or incident process; testnet only | Everyone | 3.x |

---

## Phase 1 - Usable on testnet

**Goal:** real buyers and sellers, and real agents, complete paid work on
Bradbury without help from us. **Estimate:** 0-3 months.

### 1.1 Early acceptance, cancellation and decline

**Why.** Today a satisfied buyer still waits out the review window, and a deal
both parties want to end has to run out its clocks.

**Scope** (contract):

- `accept(deal_id, clause_id)`: the buyer releases an `in_review` (or
  `failed`) clause to the seller immediately. `accept(deal_id, "*")` releases
  every open clause.
- `decline(deal_id)`: the seller refuses a deal before delivering, and every
  line is refunded at once.
- `cancel(deal_id)`: a two-step mutual cancel before delivery. The buyer
  proposes, the seller confirms, and every line is refunded.

**Done when** each call has tests and a killed mutant, it appears in the deal
view, and the conservation invariant holds across all of them.

### 1.2 Notifications and a public keeper

**Why.** Nothing moves until someone calls `settle`, and a party who misses a
review window loses the right to dispute.

**Scope:**

- **A keeper service** that watches every deal and calls `settle` shortly
  after each deadline passes, and `rule` on disputed clauses nobody has
  convened. It is open source, anyone can run one, and it holds no special
  permission: it is a convenience, never a dependency (rule 4).
- **Notifications** for "delivered", "window closes in 24h / 1h", "disputed",
  "ruled", "you are owed GEN". Channels: email, Telegram and webhooks, by
  opt-in subscription to an address. No sign-in beyond signing a message
  with the wallet.
- A **calendar file** (.ics) of a deal's deadlines on the deal page.

**Done when** a test deal on Bradbury settles with nobody pressing a button,
and both parties receive every notification on two channels.

### 1.3 Indexer and party views

**Why.** The app reads deals one at a time. That is fine at 10 deals and
unusable at 10,000.

**Scope:**

- Contract: a `deals_of(address, offset, limit)` view backed by a per-party
  index, and a `deals_page(offset, limit)` view, budget permitting (1.9).
- An off-chain indexer that reads transactions and deal records into a
  database, with a read-only REST and GraphQL API: deals by party, by state,
  and by deadline; totals; jury statistics.
- App: **My deals** by default, search by deal id or address, and an
  "action needed" inbox (deliver, review, rule, settle, withdraw).

**Done when** the deals page loads in under 1 s at 10,000 deals, and the API
is documented in [INTEGRATION.md](INTEGRATION.md).

### 1.4 Delivery helper

**Why.** A seller who edits the file at the URL, or hosts it somewhere that
goes down, loses the clause as unverified. That is correct, but avoidable.

**Scope:**

- **Upload and pin** from the deal page: the app pins the file to IPFS
  (through a pinning provider) or commits it to a repository, then fills in
  the content-addressed URL and its sha256.
- **Pre-flight checks** before `deliver`:
  - the URL serves the same bytes twice, from two locations;
  - the file is text the jury can read;
  - the size is under the jury's limit (with a warning naming the clauses
    whose evidence would be cut off).
- **Re-pin reminders** until every clause is final.

**Done when** a seller with no hosting of their own delivers from a phone in
under a minute, and a pre-flight check catches an over-long or binary file.

### 1.5 Larger and structured work

**Why.** Real deliverables are several files, longer than 4,000 characters,
and not always plain text.

**Scope:**

- **A manifest delivery.** The seller delivers a JSON manifest listing files
  and their sha256s, and the manifest's own digest is pinned. Each clause may
  name an `evidence` path; the jury fetches only that file, so each clause is
  judged on the part of the work it is about.
- **A higher text limit**, set by measuring prompt size against GenVM limits
  and model context on Bradbury, not guessed. The ruling records when the
  work was truncated.
- **Formats.** Extracted text for PDF and DOCX, and structured summaries for
  JSON and CSV (row counts, keys), computed identically by every validator.
  Images stay out of scope until validators can read them.

**Done when** a 3-file, 30,000-character delivery is judged correctly per
clause in the calibration corpus (1.7), and the deployed contract still fits
its budget (1.9).

### 1.6 Spec assistant and templates

**Why.** The checkability gate stops empty specs, but a buyer still needs to
write tests that a reader can check.

**Scope:**

- **Templates** for common jobs: translation, copywriting, data collection,
  data labelling, research summary, code-adjacent text (README, docs),
  design briefs as text. Each comes with tested acceptance tests.
- **An assistant** in the clause editor. It suggests rewrites for vague tests
  ("good SEO" becomes "the title contains the phrase …"), splits two-fact
  clauses, and flags tests the jury cannot see (images, links, running code).
  It runs off-chain, is advisory only, and never edits the spec silently.
- **A "would the jury agree?" preview.** Run the jury prompt on a sample of
  the work before funding, off-chain, and show the reading.

**Done when** first-time users in testing write specs that pass the gate in
under 3 minutes, and fewer than 10% of their clauses are rated "arguable" by
a review panel.

### 1.7 Jury calibration and a public accuracy report

**Why.** "Every case ended where it should" is six cases. A product needs a
measured error rate, published before people rely on it.

**Scope:**

- **A labelled corpus** of at least 300 (clause, work, expected verdict)
  cases. It covers each acceptance-test pattern, near-misses (2 vs 3, 799 vs
  800 words), ambiguous tests, adversarial work (injection, structure
  forgery, Unicode tricks, the answer hidden in the work) and adversarial
  clauses.
- **A harness** that runs the corpus through the exact prompt and
  `read_answer`. It runs off-chain against several models, and on Studio and
  Bradbury for a sample.
- **A published report** on each release: the false-unmet rate (the costly
  error, since it keeps money from a seller who did the work), the false-met
  rate, the undetermined rate, and agreement across validators.
- **A release gate:** a prompt or model change ships only if the false-unmet
  rate does not rise.

**Done when** the report is in `docs/`, the gate runs in CI, and the
false-unmet rate is under 2% on the corpus.

### 1.8 SDKs and an MCP server for agents

**Why.** Clause's best fit is agent-to-agent work. Agents should not have to
learn receipt shapes and lossless JSON.

**Scope:**

- **TypeScript and Python SDKs:** typed `createDeal`, `deliver`, `dispute`,
  `rule`, `settle`, `withdraw` and the views; the three outcomes
  (applied / refused / no consensus) built in; a spec builder that runs the
  gate locally.
- **An MCP server** exposing the same calls as tools, so an AI agent can hire,
  deliver and dispute with a wallet it controls, with spending limits set by
  its owner.
- **Example agents:** a buyer agent that checks acceptance tests
  deterministically before disputing, and a seller agent that redelivers on
  an unmet ruling.

**Done when** two independent agents complete a deal, with a dispute and a
redelivery, using only the MCP server.

### 1.9 Contract size budget

**Why.** The deployed file is 18,983 bytes against a budget of about
19.5 KB. Items 1.1, 1.3 and 1.5 do not fit as written.

**Scope** (pick by measurement):

- **Split the contract:** a rules library contract holding the pure
  functions, and a thin escrow calling it. The cost is one more address to
  verify, and cross-contract call latency.
- **Move the text** of the checkability gate's word lists into storage,
  written once at deploy.
- **Raise the budget** if GenLayer's gas limits change.

**Done when** every Phase 1 contract item fits, with a 10% margin, and the
size test enforces the new budget.

### 1.10 Product polish

Done when each item ships:

- live countdowns, and a per-clause timeline on the deal page;
- a share link for a deal, with a preview card;
- wallet deep links that work on phones;
- clear empty and error states for every action;
- accessibility: keyboard paths, focus states, and contrast checked in both
  themes;
- translation of the interface (English, French, Spanish, Portuguese).

**Phase 1 exit criteria:**

- 50 deals by people outside the team, on Bradbury, with fewer than 5%
  needing our help;
- the false-unmet rate published and under 2%;
- every deadline settled by the keeper;
- an agent-to-agent deal run through MCP.

---

## Phase 2 - Trust and economics

**Goal:** Clause is safe to use when the parties don't know each other and
the stakes are real, and it pays for its own operation. **Estimate:** 3-6
months.

### 2.1 Appeals

**Why.** A wrong ruling is final today. A wrong unmet costs a seller a
redelivery and possibly the clause; a wrong met costs a buyer the clause.

**Scope:**

- An **appeal window** after a ruling, during which the losing side posts a
  larger bond, and a larger validator set rules again. This uses GenLayer's
  own appeal mechanism where it is stable, or a second `rule` round with more
  validators.
- Credits from a ruling are **deferred** until the appeal window closes,
  which keeps rule 5.
- **One appeal per ruling.** The appeal's ruling is final, and the loser's
  bond goes to the winner.
- **Blocked on the platform:** an appeal on Studio has been measured to leave
  the appealed contract unreadable ([THREAT-MODEL.md](THREAT-MODEL.md) T10).
  Ship only after that is fixed, and after testing it on Bradbury.

**Done when** an appealed ruling on Bradbury reverses a seeded wrong verdict,
both bonds settle correctly, and the invariant holds.

### 2.2 Private delivery

**Why.** Most paid work is not meant to be public. Today the URL is on chain
and validators fetch it.

**Scope** (reveal on dispute):

- The seller delivers a **digest and an encrypted copy** (or a private link)
  that only the buyer can read. Nothing readable goes on chain.
- If the buyer **disputes**, the seller must make the work fetchable by
  validators (a time-limited URL) before the ruling. If they don't, the work
  is unverified, and the clause is unmet, as today.
- Undisputed work is never exposed. Disputed work is exposed only to the
  validators, for the length of the ruling.
- **Stated limitation:** validators can read disputed work. GenLayer has no
  confidential compute today; if it gets one, Clause uses it.

**Done when** an undisputed private deal leaves nothing readable on chain, and
a disputed one rules correctly within the reveal window.

### 2.3 Protocol fee and caller rewards

**Why.** `rule` and `settle` cost gas, and nobody is paid to call them. The
project has no revenue to fund hosting, the keeper, audits or the calibration
work.

**Scope:**

- A **protocol fee** taken from released amounts only, never from refunds,
  stated on every deal before funding. Start at 0.5-1%; the final figure
  comes from the costs measured in Phase 1.
- **Caller rewards** paid from the fee:
  - a fixed reward to whoever calls `settle` on a deal with an expired clock;
  - a reward to whoever convenes a ruling that lands.
  This makes the keeper (1.2) one of many, not the only one.
- A **treasury address** set at deploy and immutable for the release. Its
  balance and flows are visible in the indexer.

**Done when** independent keepers settle deals for the reward, and the fee
covers measured operating costs at the target volume.

### 2.4 Seller reputation and an optional seller stake

**Why.** A buyer has no way to know if a seller delivers, and a seller who
delivers junk risks only their time.

**Scope:**

- **On-chain counts** per address: deals completed, clauses met, clauses
  unmet, redeliveries, disputes lost as buyer. These are facts from rulings,
  not ratings. They are shown on the deal page and in the funding form.
- An **optional seller stake** a buyer may require at funding (for example
  10% of the deal). It is returned on completion, and a clause's share is
  forfeited to the buyer when that clause ends `refunded` after an unmet
  ruling.
- No reviews, no stars. Clause enforces what was written, not taste.

**Done when** the counts are in the deal view and the API, and the stake
round-trips correctly in every terminal state, with tests and mutants.

### 2.5 Change orders

**Why.** Real scope changes. Today the only way is a new deal.

**Scope:**

- `propose_change(deal_id, new_clauses, top_up)` by either party, then
  `accept_change` by the other.
- The amended spec gets a **new pinned digest**. Old clauses that are already
  final stay final, and money moves only by an explicit top-up or a refund in
  the change.
- An unaccepted proposal expires. **No unilateral change, ever** (rule 3).

**Done when** a deal with an accepted change order settles correctly on both
the old and the new clauses, and the history of digests is visible.

### 2.6 Milestones

**Why.** Longer jobs are delivered in stages. Today every clause opens on the
same delivery.

**Scope:**

- Clauses can be grouped into **milestones**, each with its own delivery
  deadline and delivery.
- Milestone *n+1*'s clock starts when milestone *n* is delivered (or at a
  fixed date). Each milestone settles independently.
- Still no partial credit within a clause: split the work into more clauses.

**Done when** a three-milestone deal runs end to end on Bradbury, with a
dispute in the middle one.

### 2.7 Stable-value escrow

**Why.** Work is priced in stable value. GEN moves.

**Scope:**

- Escrow in an ERC-20 stablecoin once GenLayer supports token transfers from
  Intelligent Contracts, or through a bridge.
- The same credit-then-withdraw rules per token.
- **Blocked on the platform:** token support on GenLayer.

**Done when** a deal funded in a stablecoin settles and withdraws on testnet,
and the invariant holds per token.

### 2.8 Jury prompts per type of work

**Why.** One prompt serves all work today. Checks for "is this French" and for
"does this CSV have 100 rows" are different.

**Scope:**

- An optional **work type** on the deal (text, data, translation, code-adjacent
  text). The prompt adds a short, fixed checklist for that type: count rows
  exactly, compare headings, and so on.
- The dispute text **still never enters**, and each prompt is versioned and
  gated by the calibration corpus (1.7).

**Done when** each type beats the generic prompt on its slice of the corpus,
with no rise in the false-unmet rate.

**Phase 2 exit criteria:**

- an appeal reverses a seeded wrong ruling on Bradbury;
- a private deal leaves nothing readable on chain;
- the fee covers operating cost at the Phase 2 volume;
- the seller stake, change orders and milestones ship with tests and
  mutants.

---

## Phase 3 - Production readiness

**Goal:** Clause can hold real value on GenLayer mainnet. **Estimate:** 6-12
months, gated on GenLayer mainnet.

### 3.1 Security

- An **external audit** of the contract, the jury prompt, and the off-chain
  pieces that touch money (SDK, MCP server, keeper).
- **A written state machine**, with properties checked by property-based
  tests:
  - conservation: `balance == held + owed`;
  - no double payment;
  - every line reaches a terminal state;
  - no path in which the dispute text reaches the prompt.
- A **bug bounty**, with a published scope and payout table, live before
  mainnet.
- **A prompt red team:** a standing adversarial corpus added to 1.7, and a
  reward for any work or clause that flips a verdict against its label.

### 3.2 Versioning and a registry

- Every release is a **new, immutable contract**. Deals finish on the release
  they were funded on (rule 7).
- A **registry** lists each release's address, release string, audit report
  and status (current or legacy). The app and SDKs read all releases, and
  fund only on the current one.
- **A migration path for users**, not for funds: legacy deals stay readable
  and settleable forever.

### 3.3 Limits and a staged rollout

- **Per-deal and total-value caps** at launch, raised in published steps as
  the volume handled without incident grows.
- An **allowlisted beta** of sellers and agents first, then open access.

### 3.4 Operations

- **Monitoring:** the conservation invariant, stuck deals, consensus failure
  rates, jury disagreement, and keeper liveness. Alerts go to an on-call
  rota.
- **An incident runbook** and a public status page.
- **A "stop new deals" switch** for the current release, used only in an
  incident. It blocks `create_deal` and nothing else. Every existing deal
  keeps every clock, ruling and withdrawal (rules 4 and 7). The holder is a
  multisig, and every use is published.

### 3.5 Legal and compliance

- Terms of service and a privacy policy for the web app, the indexer and the
  notifications.
- Clear wording: Clause is software that enforces a spec. It is not a court,
  an arbitrator or a custodian.
- Sanctions screening at the web app and API, as required where they operate.
  The contract stays permissionless.
- Guidance on which kinds of work suit Clause, and which don't (anything
  needing a human judgement of quality).

### 3.6 Mainnet

- Deploy the audited release on GenLayer mainnet when it is available, with
  the caps from 3.3.
- Run the full scenario suite on mainnet with small amounts, and publish the
  record, as was done for Studio and Bradbury.

**Phase 3 exit criteria:**

- the audit is complete, with every finding fixed or accepted in writing;
- the bounty is live;
- the mainnet scenario record is published;
- 30 days on mainnet with the invariant holding and no incident above low
  severity.

---

## Phase 4 - Ecosystem

**Goal:** Clause becomes the default way to pay for checkable work, by people
and by agents. **Estimate:** 12 months and beyond.

### 4.1 Embeddable checkout

A "Pay with Clause" widget and hosted checkout: a platform pre-fills the spec
and the parties fund in one step, without leaving the platform.

### 4.2 Platform integrations

Webhooks and SDK recipes for freelance boards, bounty platforms and agent
marketplaces. Each integration is listed with its spec templates.

### 4.3 An open spec standard

The spec format is published as a versioned JSON Schema, with the canonical
digest rules and the checkability gate. Other tools can then produce and
check Clause specs, and other GenLayer contracts can settle work through
Clause.

### 4.4 Multi-party deals and subcontracting

One buyer and several sellers, each owning named clauses. A seller can fund a
sub-deal whose clauses mirror their own, so a chain of agents can split a job,
with each link enforced by its own clause.

### 4.5 Evidence beyond text

Clauses whose evidence is a signed attestation (a CI run, a signed lab
result, an oracle reading) checked by the contract, with the jury reading the
attested text. This is for work whose acceptance test is "the test suite
passes", which a model reading text cannot check today.

---

## Sequencing

```
Phase 1 (0-3 mo)    1.9 size budget ─┬─► 1.1 accept/cancel ─► 1.3 index views
                                     └─► 1.5 manifest + limits
                    1.7 calibration ─────► gates every prompt change from here on
                    1.2 keeper/notify,  1.4 delivery helper,  1.6 assistant,  1.8 SDK/MCP,  1.10 polish

Phase 2 (3-6 mo)    2.3 fee + rewards ─► (funds 1.2 keepers at scale)
                    2.1 appeals  [blocked: platform appeals stable on Bradbury]
                    2.2 private delivery,  2.4 reputation/stake,  2.5 change orders,  2.6 milestones
                    2.7 stable value  [blocked: token support on GenLayer]
                    2.8 typed prompts  [needs 1.7]

Phase 3 (6-12 mo)   3.1 audit + bounty ─► 3.3 caps ─► 3.6 mainnet  [blocked: GenLayer mainnet]
                    3.2 registry,  3.4 operations,  3.5 legal

Phase 4 (12 mo +)   4.1 checkout,  4.2 integrations,  4.3 open standard,  4.4 multi-party,  4.5 attestations
```

Three things decide the pace:

- **The contract size budget (1.9)** gates most contract features. Do it
  first.
- **The calibration corpus (1.7)** gates every jury change. Do it in
  parallel, and early.
- **Platform dependencies:** stable appeals, token support and mainnet. When
  one slips, the item waits; nothing is shipped on top of a measured platform
  bug.

## How we will measure progress

| Metric | Today | Phase 1 target | Phase 2 target | Phase 3 target |
| --- | --- | --- | --- | --- |
| Deals completed by people outside the team | 0 | 50 | 500 | 5,000 on mainnet |
| Deals needing help from the team | n/a | < 5% | < 2% | < 1% |
| False-unmet rate on the corpus | not measured | < 2% | < 1.5% | < 1% |
| Disputes per deal | n/a | measured | < 15% | < 10% |
| Deadlines settled by keepers, not by hand | 0% | 100% on Bradbury | 100% | 100% |
| Median time to fund a deal (first-time user) | n/a | < 5 min | < 3 min | < 2 min |
| Conservation invariant | holds | holds, monitored | holds, monitored | holds, alerting, audited |
| Agent deals via SDK or MCP | 0 | 10 | 200 | 2,000 |

## Risks and open questions

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| Model verdicts drift when validators change models | Medium | Rulings change for the same input | Calibration gate (1.7); per-release reports; prompts versioned and tested on several models |
| Specs that pass the gate but stay arguable | High | Disputes the jury resolves as undetermined, which pays the seller | Assistant and templates (1.6); show the undetermined rate per test pattern |
| Sellers fail to keep work at its digest | Medium | Honest work ruled unmet | Pinning and pre-flight (1.4) |
| Platform bugs (appeals, receipt shapes, gas) | Medium | Delays; stuck transactions | Measure on Studio and Bradbury before relying on a feature; keep every clock in the escrow |
| The contract outgrows the deploy budget | High | Features blocked | 1.9 first |
| Legal treatment of escrow in some places | Medium | Front-end restrictions | 3.5; the contract stays a tool, not a custodian |
| Low volume makes fees and keepers uneconomic | Medium | Slow settlement | Anyone can settle (rule 4); team-run keeper until rewards cover it |

**Open questions:**

- What fee is low enough not to deter use and high enough to fund keepers?
  Answer with Phase 1 cost data.
- Should "undetermined" ever split the clause instead of paying the seller?
  Today the rule is simple and favours the party without the burden. Revisit
  only with corpus data.
- How long should appeal windows be, given that they defer every credit?

## Non-goals

These are out of scope, now and later:

- **Judging quality or taste.** If a clause needs taste, Clause is the wrong
  tool, and the gate says so.
- **Reading the dispute text, in any form.** Not summarised, not "only for
  context".
- **An admin who can move a deal's money or override a ruling.**
- **Reviews and star ratings.** Reputation is built from ruling facts only
  (2.4).
- **Holding funds outside the contract.** No custodial accounts, no
  off-chain balances.
