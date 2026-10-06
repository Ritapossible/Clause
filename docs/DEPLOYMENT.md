# Build and deploy

This document covers how to build the contract, deploy it to Studio or
Bradbury, prove it on chain, and ship the web app.

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Python | 3.11+ with `pytest` | Contract rules, build, tests, mutation check |
| Node | 20+ | Deploy scripts, scenarios, web app |
| GEN | Faucet GEN on Studio; testnet GEN on Bradbury | Deploying and running scenarios |

## 1. Test and build the contract

```bash
python3 -m pytest tests/direct          # 112 tests
python3 tests/mutation_check.py         # 41 mutants; all must be killed
python3 deploy/build_contract.py        # writes contracts/build/clause*.py and clause*.min.py
```

Clause is two contracts built from four source files:

| Source | In the escrow | In the jury |
| --- | --- | --- |
| `contracts/clause_core.py` (the pure rules) | yes | yes |
| `contracts/clause_prompts.py` (the jury prompt, the location excerpt, reading an answer) | | yes |
| `contracts/contract_shell.py` (the escrow's storage and entrypoints) | yes | |
| `contracts/jury_shell.py` (the jury's `rule` and its consensus block) | | yes |

`build_contract.py` joins each set into one file under the pinned GenVM runner
header, and the minifier writes the deployed `clause.min.py` (escrow) and
`clause_jury.min.py` (jury), dropping whatever a contract does not use.
Never edit the build output by hand.

**Size budget.** Bradbury caps a transaction at 2^24 gas, and a deploy costs
about 0.96M gas plus 782 per byte. That puts the deployed file's limit at
about 19.5 KB per contract. Today the escrow is 16,316 bytes and the jury
8,660; `test_it_fits_bradburys_gas_cap` checks both and fails the build
before a deploy would.

## 2. Keys

The scripts read keys from the directory in `CLAUSE_KEYS`. Each file is one
hex private key:

| File | Role |
| --- | --- |
| `principal.key` | Deploys the contract |
| `agent.key` | The buyer in the scenarios |
| `vendor.key` | The seller in the scenarios |

Keep the directory outside the repository, with `chmod 600` on each file.
Never commit keys. On Studio, fund the accounts from the faucet; on Bradbury,
send them testnet GEN.

## 3. Deploy

```bash
cd deploy && npm ci
export CLAUSE_KEYS=/path/to/keys
node deploy.mjs studio        # or: node deploy.mjs bradbury
```

`deploy.mjs` deploys the jury first, then the escrow with the jury's address,
a 0.01 GEN bond floor and the network's appeal window (`APPEAL_SECONDS`;
300 on Studio, 2,400 on Bradbury). It checks `status()` and writes both
addresses, their deploy hashes and the appeal window to
`deploy/deployments.json` under the network's name.

## 4. Prove it on chain

```bash
node scenario.mjs studio          # about an hour
node scenario.mjs bradbury        # a few hours: every transaction takes minutes
node appeal_scenario.mjs studio   # an appeal of the jury; the escrow still pays
```

`scenario.mjs` runs every case as real transactions, in phases:

1. Every deal is funded, delivered and disputed.
2. The jury is convened once per dispute, and every verdict is recorded
   against what the case expects, including any that miss.
3. The script waits out the appeal window, then the escrow applies each
   ruling, and the credits each verdict must produce are checked.
4. The deadline cases are settled.
5. The seller withdraws, and its wallet balance is read until the GEN
   arrives. The escrow's books (`balance == held + owed`) are checked, and
   the jury contract is checked to hold nothing.

| Case | What it shows |
| --- | --- |
| 1a | A dispute citing a clause that is not in the spec |
| 1b | The same demand attached to a real clause |
| 2 | 2 cities against "exactly 3" |
| 3 | "Ignore the spec" in the dispute text |
| 4 | Two clauses, one broken |
| 5 | A forged answer block in the work |
| 6 | A 404 |
| 7 | An unreachable host: three jury rounds, each recorded and sent to the escrow; the third is `unavailable`, a neutral refund |
| 8 | An invoice whose total is wrong, and the same invoice with the right total; 3 runs each on Studio |
| 9 | A defect past the 4,000-character cut, with and without a location |

Cases 3, 4, 5 and 9 without a location run on Studio only. Results go to
`deploy/scenario-<network>.json`.

To measure a jury change without rerunning everything:

```bash
ONLY=8,9 RUNS=5 OUT=jury-check.json node scenario.mjs studio
node summarize.mjs scenario-studio-jury1.json scenario-studio.json   # every verdict, as a table
```

Every verdict lands in the record, including misses; `summarize.mjs` marks
them. This is how the first prompt's 1-in-3 on case 8 was found, and how the
fix was measured.

`appeal_scenario.mjs` deploys a fresh pair, has the jury rule, appeals that
transaction at once, records whether the jury contract stays readable, and
then requires `settle` and `withdraw` on the escrow to move the GEN. It
writes `deploy/appeal-<network>.json`.

The delivered work comes from `examples/`, served from this repository's
`main` branch, so push `examples/` before running a scenario on a fresh fork.
`deploy/probes/` holds the probe that measured how a fetch reports a 404 and
an unreachable host.

## 5. Ship the web app

The app reads contract addresses from `deploy/deployments.json` at build
time. After a new deploy, commit that file and the app picks it up on the
next build.

```bash
cd frontend
npm ci
npm run typecheck && npx tsx scripts/parity.ts
npm run build                       # writes frontend/dist
npm run preview -- --port 4173 &
node scripts/e2e.mjs http://localhost:4173   # two-person flow on Studio + phone-width checks
```

**Vercel:**

1. Import the repository.
2. Set the Root Directory to `frontend` (or leave the root, whose
   `vercel.json` builds `frontend/`).
3. Set `VITE_REOWN_PROJECT_ID`. Add the deployed domain to the Reown
   project's allowlist.
4. Every push to `main` redeploys.

## Release checklist

Before you deploy a new contract version:

- [ ] `pytest tests/direct`, `mutation_check.py`, `parity.ts` and
      `npm run typecheck` all pass.
- [ ] The `release` strings in `contract_shell.py` and `jury_shell.py` are
      bumped, and the change is described in the README.
- [ ] Every new rule has a test, and a mutant that removes it is killed.
- [ ] Both deployed files fit the gas budget.
- [ ] The scenario passes on Studio, then on Bradbury, and the appeal
      scenario passes on Studio.
- [ ] The e2e flow passes against the new address.
- [ ] The threat model is updated for any new entrypoint or state.

**A new version is a new contract.** Clause has no upgrade path, by design:
an admin who could change the code could change a pinned deal. Deals on the
old contract finish there; the app can keep reading both (roadmap item 3.2).
