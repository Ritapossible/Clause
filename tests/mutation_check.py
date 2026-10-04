"""Mutation harness: every rule must have a test that fails without it.

Each entry weakens or deletes one rule in a source file. The contract is
rebuilt from the mutant (so the tests that run the deployed bytes see it), the
suite runs, and it must FAIL. A mutant that survives names an untested rule.

    python3 tests/mutation_check.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, "contracts", "clause_core.py")
PROMPTS = os.path.join(ROOT, "contracts", "clause_prompts.py")
SHELL = os.path.join(ROOT, "contracts", "contract_shell.py")
BUILD = os.path.join(ROOT, "contracts", "build")

# (name, what it breaks, original fragment, mutated fragment, file)
MUTATIONS = [
    ("uncited-dispute-allowed", "a dispute must cite a clause in the pinned spec",
     '    raise ClauseError(\n        "no clause %r in the pinned spec;', '    return deal["lines"][0]\n    raise ClauseError(\n        "no clause %r in the pinned spec;', CORE),
    ("vague-test-funded", "a taste word makes a test unfundable",
     "        if w in VAGUE_WORDS:", "        if False:", CORE),
    ("anchorless-test-funded", "a test must name something checkable",
     "    if not (has_digit or has_quote or has_anchor):", "    if False:", CORE),
    ("amount-not-matched", "the GEN sent must equal the clause amounts",
     "    if not errors and total != int(value):", "    if False:", CORE),
    ("unmet-fails-open", "unmet stands only on agreement",
     "    if leader_verdict == VERDICT_UNMET:\n        return False", "    if False:\n        return False", CORE),
    ("unmet-veto-lost", "a validator sure of unmet vetoes a release",
     "    return own_verdict != VERDICT_UNMET", "    return True", CORE),
    ("hesitant-fail-counts", "a hesitant fails is undetermined",
     "VERDICT_UNMET if int(confidence) >= MIN_UNMET_CONFIDENCE else VERDICT_UNDETERMINED", "VERDICT_UNMET", CORE),
    ("met-bond-returned", "a dispute against met work forfeits the bond to the seller",
     '        _credit(credits, seller, int(line["amount"]) + bond)', '        _credit(credits, seller, int(line["amount"]))\n        _credit(credits, buyer, bond)', CORE),
    ("unmet-pays-seller", "unmet keeps the line from the seller",
     "        line[\"state\"] = LINE_FAILED", "        line[\"state\"] = LINE_RELEASED", CORE),
    ("no-delivery-no-refund", "no delivery by the deadline refunds the buyer",
     '        if state == LINE_FUNDED and not deal.get("delivery") and now > int(deal["deliver_by"]):', "        if False:", CORE),
    ("window-never-releases", "an undisputed line releases when the window closes",
     '        elif state == LINE_IN_REVIEW and now > int(line["review_until"]):', "        elif False:", CORE),
    ("dispute-never-lapses", "a dispute nobody rules releases at the ruling deadline",
     '        elif state == LINE_DISPUTED and now > int(line["dispute"]["rule_by"]):', "        elif False:", CORE),
    ("late-dispute-allowed", "a dispute must be inside the review window",
     '    if int(now) > int(line["review_until"]):\n        raise ClauseError("the review window', '    if False:\n        raise ClauseError("the review window', CORE),
    ("cheap-dispute", "a dispute must post the bond",
     "    if int(bond) < required:", "    if False:", CORE),
    ("seller-disputes", "only the buyer disputes",
     '    if normalize_address(by) != deal["buyer"]:', "    if False:", CORE),
    ("redelivery-reopens-all", "a redelivery reopens only the failed lines",
     '        targets = [l for l in deal["lines"] if l["state"] == LINE_FAILED and now <= int(l["redeliver_by"])]',
     '        targets = [l for l in deal["lines"] if l["state"] not in TERMINAL]', CORE),
    ("work-not-neutralized", "the delivered work cannot forge the prompt's structure",
     "        neutralize(str(artifact_text)[:MAX_ARTIFACT]),", "        str(artifact_text)[:MAX_ARTIFACT],", PROMPTS),
    ("unreadable-answer-unmet", "an unreadable answer never keeps money from the seller",
     "    else:\n        reading = READ_CANNOT_TELL", "    else:\n        reading = READ_FAILS", PROMPTS),
    ("dispute-text-to-jury", "the jury never sees the dispute text",
     'build_prompt(criterion=criterion, test=test, artifact_text=_text), response_format="json")\n            )\n            _out',
     'build_prompt(criterion=criterion, test=test + " " + str(line["dispute"]["text"]), artifact_text=_text), response_format="json")\n            )\n            _out', SHELL),
    ("unverified-work-judged", "work that is not at its digest cannot meet a clause",
     '                return json.dumps({"verdict": VERDICT_UNMET, "reason": "work_unverifiable"', '                return json.dumps({"verdict": VERDICT_MET, "reason": "work_unverifiable"', SHELL),
    ("seller-can-be-anyone-delivering", "only the seller delivers",
     '        if self._me() != deal["seller"]:', "        if False:", SHELL),
    ("double-withdraw", "withdraw zeroes what it sends",
     "        self.owed[me] = u256(0)", "        pass", SHELL),
]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)


def main():
    files = sorted({m[4] for m in MUTATIONS})
    originals = {f: open(f).read() for f in files}
    snap = tempfile.mkdtemp()
    shutil.copytree(BUILD, os.path.join(snap, "build"))
    suite = [sys.executable, "-m", "pytest", "tests/direct", "-q", "-x", "-p", "no:cacheprovider"]
    if run(suite).returncode != 0:
        print("BASELINE SUITE IS RED")
        return 2
    killed, survived, unapplied = [], [], []
    try:
        for name, why, old, new, target in MUTATIONS:
            src = originals[target]
            if old == new or src.count(old) != 1:
                unapplied.append((name, why))
                continue
            try:
                open(target, "w").write(src.replace(old, new, 1))
                if run([sys.executable, "deploy/build_contract.py"]).returncode != 0:
                    killed.append(name)
                    continue
                result = run(suite)
            finally:
                open(target, "w").write(src)
            (killed if result.returncode != 0 else survived).append(name if result.returncode != 0 else (name, why))
    finally:
        for f, text in originals.items():
            open(f, "w").write(text)
        shutil.rmtree(BUILD)
        shutil.copytree(os.path.join(snap, "build"), BUILD)
        shutil.rmtree(snap)
    if run(suite).returncode != 0:
        print("RESTORE FAILED")
        return 3
    print("mutants killed   : %d" % len(killed))
    print("mutants survived : %d" % len(survived))
    print("not applied      : %d" % len(unapplied))
    for name, why in unapplied:
        print("  ?  %-30s %s" % (name, why))
    for name, why in survived:
        print("  !  %-30s UNTESTED: %s" % (name, why))
    return 1 if survived or unapplied else 0


if __name__ == "__main__":
    sys.exit(main())
