# Clause - Build, deploy and release

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
python3 -m pytest tests/direct          # 75 tests
python3 tests/mutation_check.py         # 24 mutants; all must be killed
python3 deploy/build_contract.py        # writes contracts/build/clause.py and clause.min.py
```

The contract is written in three source files:

- `contracts/clause_core.py`: the pure rules;
- `contracts/clause_prompts.py`: the jury prompt and how its answer is read;
- `contracts/contract_shell.py`: storage, entrypoints and consensus.

`build_contract.py` joins them into one file under the pinned GenVM runner
header, and the minifier writes the deployed `clause.min.py`. Never edit the
build output by hand.

**Size budget.** Bradbury caps a transaction at 2^24 gas, and a deploy costs
about 0.96M gas plus 782 per byte. That puts the deployed file's limit at
about 19.5 KB. It is 18,983 bytes today; `test_it_fits_bradburys_gas_cap`
fails the build before a deploy would. Any new feature has to fit in what is
left or move code out (see the roadmap, item 1.9).

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

`deploy.mjs` deploys `clause.min.py` with a 0.01 GEN bond floor, waits for the
transaction, checks `status()`, and writes the address and deploy hash to
`deploy/deployments.json` under the network's name.

## 4. Prove it on chain

```bash
node scenario.mjs studio      # or: bradbury (allow about an hour)
```

The scenario runs the required cases as real transactions:

- 1a: a dispute citing a clause that is not in the spec;
- 1b: the same demand attached to a real clause;
- 2: 2 cities against "exactly 3";
- 3: "ignore the spec";
- 4: two clauses, one broken;
- 5: a forged answer block in the work.

It then withdraws the seller's credit, reads the wallet balance, and checks
`balance == held + owed`. Results go to `deploy/scenario-<network>.json`. The
delivered work it uses is in `examples/`, served from this repository's `main`
branch, so push `examples/` before running a scenario on a fresh fork.

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
- [ ] The `release` string in `contract_shell.py` is bumped (for example
      `clause/2`), and the change is described in the README.
- [ ] Every new rule has a test, and a mutant that removes it is killed.
- [ ] The deployed file fits the gas budget.
- [ ] The scenario passes on Studio, then on Bradbury.
- [ ] The e2e flow passes against the new address.
- [ ] The threat model is updated for any new entrypoint or state.

**A new version is a new contract.** Clause has no upgrade path, by design:
an admin who could change the code could change a pinned deal. Deals on the
old contract finish there; the app can keep reading both (roadmap item 3.2).
