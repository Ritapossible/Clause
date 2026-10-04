# Clause

**Escrow that pays on the spec you wrote.**

Clause is escrow for paid work, built on [GenLayer](https://genlayer.com)
Intelligent Contracts. The buyer locks payment against a spec written as
clauses, each with an amount and an acceptance test. A dispute must cite one
of those clauses, and a jury of AI validators answers a single question about
it:

> Does the delivered work fail this clause, as written?

## The problem

In freelancing, and in paid jobs between AI agents, escrow is not where
payments go wrong. The usual fight is a buyer who rejects the work for a
reason that was not in the spec when the money was locked. A normal smart
contract can hold the funds, but it cannot read the work. An arbitrator who
reads both sides' arguments can be talked into a new reading of the spec.

## The rules

1. **The spec is pinned with the money.** Each clause's acceptance test must
   name something checkable. A test built on taste ("do good work") is refused
   at funding.
2. **A dispute must cite a clause.** A complaint about a requirement that was
   never in the spec has no clause to cite. It is refused before any model
   runs, and the bond goes back.
3. **The jury reads the clause, not the complaint.** Validators see the clause
   and the work. The buyer can point at a location in the work, but their
   words never reach the jury.
4. **The money does not depend on the jury.** The escrow and the jury are
   separate contracts. Every clock is in the escrow, which pays or refunds on
   its own even if the jury contract becomes unreadable.

## What has been shown, and what has not

The claim that holds without any model is the citation rule. **A clause that
was not pinned never reaches a model.** Case 1a shows it on both networks.

The jury itself has been shown on a small sample, stated as small:

| What the case asks of the model | Cases | What it shows |
| --- | --- | --- |
| Count names against "exactly 3" | 1b, 2, 3, 4, 5 | That the complaint never arrives and forged structure does not steer the jury. A model passes by counting; this is not a test of judgment. |
| Add four amounts and compare them with a stated total, while the work's own note says the total is right | 8, three runs each way on Studio, one on Bradbury | **The first jury prompt got the wrong total right in only 1 of 3 runs.** Two came back met, at confidence 99 and 100. The prompt now says the work's claims about itself are not evidence, and asks the model to write its calculation first. With it: 3 of 3 on Studio, 1 of 1 on Bradbury, and the correct-total control met every time. **But this is the file the prompt was changed for**, so that is a fix for this file, not a rate. |
| Two held-out arithmetic cases, written after the change and committed with their expected verdicts before they ran: a timesheet total with an "approved" note, and a multiplication error in one order line | 10 and 11, three runs each way on Studio | 12 of 12 as pre-registered (`examples/HELD-OUT.md`). Better evidence than the tuned file; still a small sample, not a rate. |
| Find a defect past the 4,000 characters the jury reads | 9, with and without a location | Without a location: undetermined, as expected. With one: unmet on Studio with both prompts, **but undetermined (80) on Bradbury**, a miss. A location helps; it does not guarantee the jury looks. |
| **A test that can honestly be read two ways** | **not yet run** | This is where a jury of models is weakest. It is the first item of the calibration work in the [roadmap](ROADMAP.md). |

Every verdict recorded on chain, including the misses, is in the repository:

- `deploy/scenario-studio-jury1.json`: every case, with the first prompt;
- `deploy/scenario-studio.json` and `deploy/scenario-bradbury.json`: the
  current contracts.

## These docs

| Page | For |
| --- | --- |
| [User guide](USER-GUIDE.md) | Buyers and sellers: funding, writing acceptance tests, delivering, disputing, the jury, deadlines, money, refusals, FAQ |
| [Integration](INTEGRATION.md) | Developers and AI agents: addresses, genlayer-js calls, outcomes, the method reference for both contracts, the deal record, the spec format |
| [Architecture](ARCHITECTURE.md) | How the two contracts work: the lifecycle, money, the jury's rules, fetching, locations, the build |
| [Threat model](THREAT-MODEL.md) | Each attack, what stops it, the test that proves it, and what is left |
| [Build and deploy](DEPLOYMENT.md) | Tests, building, deploying, the on-chain scenarios, the appeal test, the release checklist |
| [Roadmap](ROADMAP.md) | From demo to product: what does not change, the gaps, four phases with acceptance criteria, metrics, risks |

Built on [GenLayer](https://genlayer.com), following
[skills.genlayer.com](https://skills.genlayer.com).
