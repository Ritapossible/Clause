# Clause - User guide

This guide is for the two people in a deal: the **buyer**, who pays for work,
and the **seller**, who does it. It covers how to use the web app, how to write
a spec that holds up, and what happens at every step.

- [Before you start](#before-you-start)
- [The deal in one page](#the-deal-in-one-page)
- [For buyers](#for-buyers)
- [Writing a spec that holds up](#writing-a-spec-that-holds-up)
- [For sellers](#for-sellers)
- [The jury](#the-jury)
- [Deadlines and settle](#deadlines-and-settle)
- [Money: bonds, gas and withdraw](#money-bonds-gas-and-withdraw)
- [When the contract refuses something](#when-the-contract-refuses-something)
- [FAQ](#faq)

## Before you start

**Pick a network** in the app bar:

| Network | What it is | Speed | GEN |
| --- | --- | --- | --- |
| GenLayer Studio | GenLayer's hosted development network | A transaction lands in seconds; a jury round takes about 20 seconds | Free from the faucet; no value |
| Bradbury testnet | GenLayer's public testnet | A transaction takes minutes | Testnet GEN; no value |

**Pick a wallet:**

- **Studio burner** (Studio only). The app creates a key in your browser and
  funds it from Studio's faucet. This is the fastest way to try Clause. The
  key lives only in this browser, so anyone with access to the browser can use
  it. Use it for testing only.
- **Connect wallet.** Any EVM wallet, through Reown AppKit (MetaMask, Rabby,
  WalletConnect wallets on your phone, and others). The app asks the wallet to
  switch to the network you picked.

To try a full deal on your own, open the app in two browsers (or one normal
and one private window). Make one the buyer and one the seller, each with its
own burner.

## The deal in one page

```
Buyer funds  ──►  Seller delivers  ──►  Review window  ──►  Paid to seller
   │                    │                     │
   │ no delivery        │                     │ buyer disputes one clause, by id, with a bond
   │ by the deadline    │                     ▼
   ▼                    │                Jury rules on that clause
Refunded to buyer       │                 ├─ met ────────────► paid to seller (+ the bond)
                        │                 ├─ undetermined ───► paid to seller (bond back to buyer)
                        │                 └─ unmet ──────────► held for the buyer (bond back)
                        │                                        │
                        └──────── seller redelivers once ◄───────┤
                                                                 └─ no redelivery ──► refunded to buyer
```

Every clause of a deal goes through this on its own. One disputed clause never
holds up payment for the others.

## For buyers

### 1. Fund a deal

Open **Fund a deal**.

1. **Seller**: the seller's address. It must differ from yours.
2. **Clauses**: one to eight. Each one has:

   | Field | Rule | Example |
   | --- | --- | --- |
   | Clause id | 1-24 characters: lowercase letters, digits, `-` and `_`. A dispute cites this id. | `cities` |
   | What is asked | 8-400 characters, in plain words | `A list of African cities for the travel page` |
   | Acceptance test | 12-400 characters. Must be checkable (see the next section). | `The response contains exactly 3 city names` |
   | Amount | In GEN. Paid or refunded on its own. | `0.05` |

3. **Timing**: pick a preset or keep the default.

   | | Demo preset | Standard preset | What it means |
   | --- | --- | --- | --- |
   | Delivery by | 1 hour | 7 days | How long after funding the seller has to deliver. If nothing is delivered in time, everything is refunded. |
   | Review window | 5 minutes (30 on Bradbury) | 3 days | How long after delivery you have to dispute a clause. After that, it pays. |
   | Ruling deadline | 30 minutes | 2 days | How long after a dispute a ruling can land. If nobody rules in time, the clause pays the seller and your bond comes back. |
   | Redelivery | 30 minutes | 3 days | How long the seller has to redeliver after an unmet ruling. If nobody redelivers, the clause is refunded. |

   Each window can be anything from 60 seconds to 90 days.

4. The app checks your spec with the contract's own rules as you type. When
   it passes, press **Fund … GEN** and confirm in your wallet. You send exactly the
   sum of the clause amounts.

Once funded, the spec is **pinned**: its sha256 is on the deal, and no clause
can change.

### 2. Review the delivery

When the seller delivers, the deal page shows the URL and its sha256, and
every clause shows **In review** with a countdown. Open the work and check
each clause against its acceptance test.

- **Satisfied?** Do nothing. Each clause pays the seller when its window
  closes.
- **A clause is not met?** Dispute that clause before its window closes.

### 3. Dispute a clause

On the clause, press **Dispute**. The app shows the bond: 10% of the clause
amount, never less than 0.01 GEN.

- You can add a note. **The note is kept on the deal for people to read, and
  it is never shown to the jury.** The jury reads only the clause and the
  work, so arguing in the note changes nothing.
- You can only dispute clauses in the spec. If your objection is not in any
  clause's acceptance test, the jury will find the clause met, and you lose
  the bond.

### 4. Convene the jury

Anyone can press **Convene the jury** on a disputed clause: you, the seller, or
anyone else. On Studio a round takes about 20 seconds; on Bradbury it takes
minutes. See [the jury](#the-jury) for what each verdict does.

### 5. Withdraw

Refunds and returned bonds are credited to you. Open **Deals**: the **Owed to
you** card shows the total. Press **Withdraw** to send it to your wallet.

## Writing a spec that holds up

The acceptance test is the most important sentence in a deal. If the test is
clear, the jury does not need to interpret anything.

### The checkability gate

The contract refuses an acceptance test unless it passes all of these checks:

1. It is 12-400 characters long.
2. It contains **at least one anchor**:
   - a digit (`exactly 3`, `at least 500 words`, `before 2026-01-01`), or
   - a quoted value (`contains the heading "Pricing"`), or
   - a structural word: json, csv, markdown, html, key, field, column, row,
     section, heading, word(s), line(s), item(s), name(s), file, page,
     sentence, paragraph, character(s), table, list, image, title, email,
     date, url, link, format, language, english, french, spanish, and similar.
3. It contains **no taste word**: good, great, nice, quality, high-quality,
   professional, satisfactory, appropriate, reasonable, excellent, clean,
   polished, beautiful, best, acceptable, adequate, well, properly, decent,
   impressive, engaging.

The gate is a word-level heuristic. Passing it does not make a test precise.
"Contains 3 relevant sections" passes, but "relevant" is still a judgement.

### Patterns that work

| Instead of | Write |
| --- | --- |
| Good blog post about GenLayer | The post is between 800 and 1,200 words and mentions "Intelligent Contracts" at least twice |
| Professional translation | The document is in French and has the same 6 section headings as the source, translated |
| A clean dataset | The file is CSV with the columns "name", "country", "population" and at least 100 rows |
| Fix the bug | The README's install section lists the command "npm ci" |
| Nice landing page copy | The copy has a title under 60 characters and exactly 3 bullet points |

Rules of thumb:

- **One clause, one fact.** If a requirement has two parts, make two clauses.
  Each one is paid and disputed on its own.
- **Count things.** Numbers are where the jury is most reliable.
- **Quote the exact strings** that must appear.
- **Say the format.** If the work must be JSON, say so.
- **Don't test what the jury can't see.** The jury reads the delivered file as
  text. It cannot run code, open links inside the work, see images, or check
  facts on the internet.

### What the jury can read

- **One URL per delivery**, fetched over http(s) and read as text (UTF-8).
  Plain text, Markdown, JSON, CSV and HTML source all work. PDFs and images
  arrive as bytes the model cannot read.
- **The first 4,000 characters.** Anything after that is not shown to the
  jury. Put what the clauses check near the top, or keep the work short.
  Raising this limit is on the [roadmap](ROADMAP.md).

## For sellers

### Deliver

1. Put the work at a URL that will **keep serving exactly the same bytes**,
   for example:
   - a raw file in a GitHub repository, pinned to a commit
     (`https://raw.githubusercontent.com/<owner>/<repo>/<commit>/file.json`);
   - an IPFS gateway URL;
   - any static host you control and will not change.
2. On the deal page, paste the URL. Press **Compute digest**: the app fetches
   the URL, as the validators will, and fills in the digest.
3. Press **Deliver** before the delivery deadline.

**Keep the URL alive and unchanged until every clause is paid.** If a
dispute happens, every validator fetches the URL and hashes the bytes. If the
bytes are missing or different, the work counts as **unverified**, and an
unverified delivery is ruled unmet without a model call.

### Get paid

Clauses nobody disputes pay you when their review window closes. Anyone can
press **Apply the deadlines that have passed** (`settle`) to record it, then
withdraw from **Deals**.

### If a clause is ruled unmet

You can **redeliver once**, inside the redelivery window. A redelivery reopens
review only for the clauses that were ruled unmet; clauses already paid stay
paid. Deliver a new URL and digest the same way. If you don't redeliver, the
clause is refunded to the buyer when the window closes.

### Your protections

- The buyer cannot add requirements after funding: a dispute must cite a
  clause, and the jury reads only the clause.
- A frivolous dispute costs the buyer: when the jury finds the clause met, you
  receive the clause amount **and** the buyer's bond.
- The buyer cannot stall payment. If nobody convenes the jury before the
  ruling deadline, the clause pays you.

## The jury

When a disputed clause is ruled, each GenLayer validator independently:

1. fetches the delivery URL and checks its sha256;
2. reads the clause (what was asked and the acceptance test) and the work,
   and nothing else;
3. answers: *does the delivered work fail this clause, as written?*

| Verdict | When | The clause | The bond |
| --- | --- | --- | --- |
| **unmet** | The work clearly fails the test (confidence 60 or more), or the work could not be verified | Held for the buyer; the seller may redeliver once | Back to the buyer |
| **met** | The work satisfies the test | Paid to the seller | Paid to the seller |
| **undetermined** | A hesitant fail, or a test that can honestly be read both ways | Paid to the seller | Back to the buyer |

The jury fails closed toward paying the seller, because the buyer brings the
dispute. An unmet ruling stands only if validators re-answering the question
agree. If a round fails to reach consensus, anyone can convene the jury again
before the ruling deadline.

## Deadlines and settle

Every state has a clock, and the contract applies clocks by arithmetic when
anyone calls `settle` (the **Apply the deadlines that have passed** button):

| State | Clock | When it runs out |
| --- | --- | --- |
| Awaiting delivery | Delivery deadline | Refunded to the buyer |
| In review | Review window | Paid to the seller |
| Disputed | Ruling deadline | Paid to the seller; bond back to the buyer |
| Unmet, awaiting redelivery | Redelivery window | Refunded to the buyer |

The deal page shows each clock, measured by the contract's own time. Nothing
moves until someone calls `settle`, but anyone can call it, at any time.

## Money: bonds, gas and withdraw

- **Escrow.** The buyer sends exactly the total of the clause amounts. The
  contract holds it.
- **Dispute bond.** 10% of the disputed clause, at least 0.01 GEN.
- **Gas.** Every transaction costs gas in GEN, paid by whoever sends it. On
  Studio gas is free. On Bradbury, a withdraw costs about 0.0001 GEN.
- **Credit, then withdraw.** Rulings, deadlines and refused calls never send
  GEN directly. They credit the party, and **Withdraw** sends everything you
  are owed in one transaction.
- **No fees.** Clause takes no cut today.

## When the contract refuses something

A refused **funding** or **dispute** does not revert. The contract records why
and credits your GEN back (withdraw it from **Deals**). The app shows the
reason. Common ones:

| Message | What to do |
| --- | --- |
| `the acceptance test relies on taste ('good')` | Replace the taste word with something countable or quotable. |
| `the acceptance test names nothing checkable` | Add a number, a quoted value or a structural word. |
| `the GEN sent (…) must equal the clause amounts (…)` | Send exactly the total. The app does this for you. |
| `the buyer and the seller must differ` | Use a different seller address. |
| `delivery_seconds must be 60-7776000 seconds` | Choose windows between 1 minute and 90 days. |
| `no clause 'x' in the pinned spec; a dispute must cite one of: …` | Cite one of the listed ids. |
| `clause 'x' is not open for review (it is released)` | The clause has already resolved. |
| `the review window for clause 'x' has closed` | Too late to dispute; the clause pays. |
| `the dispute bond for clause 'x' is …` | Send at least the bond the app shows. |

Other calls (deliver, rule, withdraw) refuse by reverting, and they carry no
GEN, so nothing is lost:

| Message | Meaning |
| --- | --- |
| `only the seller may deliver` | Connect the seller's wallet. |
| `the delivery deadline has passed` | Too late; settle refunds the buyer. |
| `nothing to redeliver` | No clause is unmet and inside its redelivery window. |
| `the delivery digest must be 64 hex characters` | Use **Compute digest**. |
| `clause is not disputed` | Only a disputed clause can be ruled. |
| `the ruling deadline has passed; settle releases the clause` | Press settle. |
| `nothing is owed to this address` | There is nothing to withdraw. |

## FAQ

**Can the buyer accept early?** Not yet. A clause pays when its review window
closes. Early acceptance is on the [roadmap](ROADMAP.md).

**Can a deal be cancelled?** Only by its clocks: no delivery means a refund.
Mutual cancellation is on the roadmap.

**Is the work private?** No. The URL is on chain and validators must fetch it,
so treat delivered work as public. Private delivery is on the roadmap.

**Who pays for the jury?** Whoever convenes it pays that transaction's gas.

**Can a ruling be appealed?** Not in this release. See
[THREAT-MODEL.md](THREAT-MODEL.md) T10 and the roadmap.

**What if the jury is wrong?** A wrong unmet gives the seller one redelivery
before the buyer is refunded. A wrong met pays the seller. The narrow question
and the checkability gate are there to make this rare, not impossible.
