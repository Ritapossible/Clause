"""Clause: the deterministic core.

Every decision that does not need a model lives here, as pure Python with no
``gl.*``, no network and no clock of its own. It is inlined into the deployed
contract by ``deploy/build_contract.py`` and tested directly in milliseconds.

The product in one paragraph. A buyer funds an escrow against a spec made of
clauses, each with a criterion, an acceptance test and an amount. The spec is
pinned when the money is locked. The seller delivers one artifact (a URL and
its sha256). For each clause the buyer may open a dispute inside the review
window, but only by citing a clause id from the pinned spec - a complaint
about a requirement that is not in the spec has nowhere to go. The jury then
answers one question about that clause and that artifact: does the artifact
fail this clause as written? It never sees the buyer's dispute text; the
buyer may only point at a location in the work. Unmet keeps the line for the
buyer (the seller may redeliver once); met or undetermined releases it to the
seller. Work nobody can fetch never pays the seller: each round in which no
validator could read it is recorded, and a dispute with such a round on record
ends in a neutral refund (the clause and the bond back to the buyer) - at
once after ``UNREAD_LIMIT`` rounds, or at its ruling deadline after fewer. The jury is a separate contract: the escrow only reads its ruling, and
every deadline resolves by arithmetic, so the escrow pays or refunds on its
own clock whatever happens to the jury.
"""

import hashlib
import json

# --------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------

LINE_FUNDED = "funded"  # locked, waiting for the delivery
LINE_IN_REVIEW = "in_review"  # delivered; the buyer may dispute until review_until
LINE_DISPUTED = "disputed"  # a dispute cites this clause; the jury may rule
LINE_FAILED = "failed"  # judged unmet; the seller may redeliver until redeliver_by
LINE_RELEASED = "released"  # credited to the seller
LINE_REFUNDED = "refunded"  # credited back to the buyer
LINE_STATES = (LINE_FUNDED, LINE_IN_REVIEW, LINE_DISPUTED, LINE_FAILED, LINE_RELEASED, LINE_REFUNDED)
TERMINAL = (LINE_RELEASED, LINE_REFUNDED)

READ_FAILS = "fails"
READ_SATISFIES = "satisfies"
READ_CANNOT_TELL = "cannot_tell"
READINGS = (READ_FAILS, READ_SATISFIES, READ_CANNOT_TELL)

VERDICT_UNMET = "unmet"
VERDICT_MET = "met"
VERDICT_UNDETERMINED = "undetermined"
VERDICTS = (VERDICT_UNMET, VERDICT_MET, VERDICT_UNDETERMINED)
# Not a reading of the work: the work could not be fetched in UNREAD_LIMIT
# separate jury rounds. A neutral refund, never a payout to the seller.
VERDICT_UNAVAILABLE = "unavailable"
RULING_VERDICTS = VERDICTS + (VERDICT_UNAVAILABLE,)
UNREAD_LIMIT = 3

# What fetching the delivery found. Only a definite answer from the server is
# held against the seller; no answer at all is not a verdict on anyone.
ARTIFACT_VERIFIED = "verified"  # read, and the bytes match the pinned digest
ARTIFACT_CHANGED = "changed"  # read, and the bytes differ: the seller changed the work
ARTIFACT_MISSING = "missing"  # the server said 404/410: the seller removed the work
ARTIFACT_UNREAD = "unread"  # no answer (network error, 5xx, 429): recorded; never pays the seller
ARTIFACT_STATES = (ARTIFACT_VERIFIED, ARTIFACT_CHANGED, ARTIFACT_MISSING, ARTIFACT_UNREAD)
MISSING_STATUS = (404, 410)

# A hesitant "fails" is not a failure: the seller is paid unless the clause
# demonstrably failed. Applied to the leader and every validator alike.
MIN_UNMET_CONFIDENCE = 60

MAX_CLAUSES = 8
MAX_ID = 24
MIN_CRITERION = 8
MIN_TEST = 12
MAX_TEXT = 400
MIN_WINDOW = 60
MAX_WINDOW = 90 * 86400
MAX_EXCERPT = 2000  # bytes a dispute's location may span
MAX_POINTER = 120
BOND_BPS = 1000  # a dispute bond is 10% of the clause's amount, never below the floor
BPS = 10000

TIMINGS = ("delivery_seconds", "review_seconds", "redelivery_seconds", "ruling_seconds")

# The checkability gate. An acceptance test must name something a reader can
# check against the artifact - a number, a quoted literal, or a structural
# thing (a key, a section, a word count) - and must not lean on taste.
VAGUE_WORDS = (
    "good", "great", "nice", "quality", "high-quality", "professional", "satisfactory",
    "appropriate", "reasonable", "excellent", "clean", "polished", "beautiful", "best",
    "acceptable", "adequate", "well", "properly", "decent", "impressive", "engaging",
)
ANCHOR_WORDS = (
    "json", "csv", "yaml", "xml", "html", "markdown", "pdf", "png", "jpg", "svg", "url", "urls",
    "link", "links", "key", "keys", "field", "fields", "column", "columns", "row", "rows",
    "section", "sections", "heading", "headings", "header", "word", "words", "line", "lines",
    "item", "items", "name", "names", "file", "files", "page", "pages", "sentence", "sentences",
    "paragraph", "paragraphs", "character", "characters", "table", "list", "image", "images",
    "language", "english", "french", "spanish", "format", "title", "email", "date", "dates",
)


class ClauseError(ValueError):
    """A condition the caller must not be able to ignore."""


def _int(value, context):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ClauseError("%s: expected an integer, got %r" % (context, value))
    return value


def normalize_address(value, context="address"):
    text = str(value).strip().lower()
    if not text.startswith("0x") or len(text) != 42:
        raise ClauseError("%s: not an address: %r" % (context, value))
    for ch in text[2:]:
        if ch not in "0123456789abcdef":
            raise ClauseError("%s: not hex: %r" % (context, value))
    return text


def is_sha256_hex(value):
    text = str(value).strip().lower()
    if len(text) != 64:
        return False
    for ch in text:
        if ch not in "0123456789abcdef":
            return False
    return True


# --------------------------------------------------------------------------
# The spec: what can be funded
# --------------------------------------------------------------------------


def _words(text):
    out = []
    word = ""
    for ch in str(text).lower():
        if ch.isalnum() or ch == "-":
            word += ch
        else:
            if word:
                out.append(word)
            word = ""
    if word:
        out.append(word)
    return out


def acceptance_test_error(test):
    """Why an acceptance test cannot be funded, or "".

    "Do good work" does not get a clause id. "The response contains exactly 3
    city names" does. A test must be a sentence of some length, must carry an
    anchor - a digit, a quoted literal, or a structural word (key, section,
    words, JSON, ...) - and must not lean on taste words, which make every
    delivery arguable after the fact.
    """
    text = str(test).strip()
    if len(text) < MIN_TEST:
        return "the acceptance test is under %d characters" % MIN_TEST
    if len(text) > MAX_TEXT:
        return "the acceptance test is longer than %d characters" % MAX_TEXT
    words = _words(text)
    for w in words:
        if w in VAGUE_WORDS:
            return "the acceptance test relies on taste (%r)" % w
    has_digit = any(ch.isdigit() for ch in text)
    has_quote = text.count('"') >= 2 or text.count("'") >= 2
    has_anchor = any(w in ANCHOR_WORDS for w in words)
    if not (has_digit or has_quote or has_anchor):
        return "the acceptance test names nothing checkable (a number, a quoted value, or a key/section/word count)"
    return ""


def _clause_id_error(cid):
    text = str(cid)
    if len(text) < 1 or len(text) > MAX_ID:
        return "a clause id is 1-%d characters" % MAX_ID
    for ch in text:
        if ch not in "abcdefghijklmnopqrstuvwxyz0123456789-_":
            return "a clause id is lowercase letters, digits, - and _: %r" % text
    return ""


def _digits(text):
    return text != "" and all(ch in "0123456789" for ch in text)


def locate_error(locate):
    """Why a dispute's location cannot be used, or "". A location tells the
    jury where in the work to look - a byte span ``bytes:START-END`` or a JSON
    pointer such as ``/items/3`` - and never what to conclude. Pointer text is
    never shown to the jury; only the bytes it selects are."""
    text = str(locate)
    if text == "":
        return ""
    if text.startswith("bytes:"):
        parts = text[6:].split("-")
        if len(parts) != 2 or not _digits(parts[0]) or not _digits(parts[1]):
            return "a byte span is bytes:START-END"
        if int(parts[1]) <= int(parts[0]) or int(parts[1]) - int(parts[0]) > MAX_EXCERPT:
            return "a byte span covers 1-%d bytes" % MAX_EXCERPT
        return ""
    if text.startswith("/"):
        if len(text) > MAX_POINTER:
            return "a JSON pointer is at most %d characters" % MAX_POINTER
        for ch in text:
            if ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_-~.":
                return "a JSON pointer uses letters, digits and / _ - ~ ."
        return ""
    return "a location is a byte span (bytes:START-END) or a JSON pointer (/key/0)"


def spec_errors(clauses, *, value, timing, buyer, seller):
    """Every reason this escrow cannot be funded; [] means it can.

    ``clauses`` is a list of {"id", "criterion", "test", "amount"}; ``value``
    the GEN sent, which must equal the sum of the amounts exactly.
    """
    errors = []
    if not isinstance(clauses, list) or not clauses:
        return ["the spec needs at least one clause"]
    if len(clauses) > MAX_CLAUSES:
        errors.append("at most %d clauses" % MAX_CLAUSES)
    seen = set()
    total = 0
    for i, c in enumerate(clauses):
        where = "clause %d" % (i + 1)
        if not isinstance(c, dict):
            errors.append("%s: not an object" % where)
            continue
        extra = set(c.keys()) - {"id", "criterion", "test", "amount"}
        if extra:
            errors.append("%s: unknown fields %s" % (where, sorted(extra)))
        cid = c.get("id", "")
        e = _clause_id_error(cid)
        if e:
            errors.append("%s: %s" % (where, e))
        elif cid in seen:
            errors.append("%s: duplicate id %r" % (where, cid))
        seen.add(cid)
        crit = str(c.get("criterion", "")).strip()
        if len(crit) < MIN_CRITERION or len(crit) > MAX_TEXT:
            errors.append("%s: the criterion is %d-%d characters" % (where, MIN_CRITERION, MAX_TEXT))
        e = acceptance_test_error(c.get("test", ""))
        if e:
            errors.append("%s (%s): %s" % (where, cid, e))
        amount = c.get("amount")
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            errors.append("%s: the amount must be a positive integer" % where)
        else:
            total += amount
    if not errors and total != int(value):
        errors.append("the GEN sent (%d) must equal the clause amounts (%d)" % (int(value), total))
    for key in TIMINGS:
        v = timing.get(key)
        if isinstance(v, bool) or not isinstance(v, int) or v < MIN_WINDOW or v > MAX_WINDOW:
            errors.append("%s must be %d-%d seconds" % (key, MIN_WINDOW, MAX_WINDOW))
    try:
        if normalize_address(buyer) == normalize_address(seller):
            errors.append("the buyer and the seller must differ")
    except ClauseError as exc:
        errors.append(str(exc))
    return errors


def canonical_spec(clauses):
    """The spec exactly as pinned: clause fields only, keys sorted, no spaces."""
    rows = [
        {"id": str(c["id"]), "criterion": str(c["criterion"]).strip(), "test": str(c["test"]).strip(), "amount": int(c["amount"])}
        for c in clauses
    ]
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


def spec_digest(clauses):
    return hashlib.sha256(canonical_spec(clauses).encode("utf-8")).hexdigest()


def dispute_bond(amount, floor):
    """What a dispute on a clause of ``amount`` must post: 10%, never below the floor."""
    amount = _int(amount, "amount")
    floor = _int(floor, "floor")
    return max(floor, amount * BOND_BPS // BPS)


# --------------------------------------------------------------------------
# The jury
# --------------------------------------------------------------------------


def reading_to_verdict(reading, confidence):
    """The model reads; the contract rules. A hesitant "fails" is undetermined."""
    if reading == READ_FAILS:
        return VERDICT_UNMET if int(confidence) >= MIN_UNMET_CONFIDENCE else VERDICT_UNDETERMINED
    if reading == READ_SATISFIES:
        return VERDICT_MET
    return VERDICT_UNDETERMINED


def jury_agrees(*, leader_verdict, own_verdict):
    """Does a validator accept the leader's ruling? Fail closed toward paying
    the seller, because the buyer carries the burden of a dispute.

    - The same verdict is agreement.
    - ``unmet`` (the line is kept from the seller) stands only on agreement.
    - A validator sure the clause failed vetoes a release; the round fails,
      and if no ruling lands by the ruling deadline the line releases anyway.
    - ``met`` and ``undetermined`` both release, so they agree.
    """
    if leader_verdict not in VERDICTS or own_verdict not in VERDICTS:
        raise ClauseError("unknown verdict")
    if leader_verdict == own_verdict:
        return True
    if leader_verdict == VERDICT_UNMET:
        return False
    return own_verdict != VERDICT_UNMET


# --------------------------------------------------------------------------
# Lines: what each event does, and what each deadline does
# --------------------------------------------------------------------------


def _credit(credits, who, amount):
    if amount > 0:
        credits[who] = credits.get(who, 0) + amount


def unread_gap(ruling_seconds):
    """How far apart the rounds that find the work unreadable must be: a
    quarter of the ruling window, so ``UNREAD_LIMIT`` rounds fit inside it and
    one passing outage cannot be counted three times."""
    return max(1, int(ruling_seconds) // (UNREAD_LIMIT + 1))


def unread_retry_error(previous, *, now, ruling_seconds):
    """Why the jury may not be convened again yet on a dispute whose last
    round could not fetch the work ("" when it may)."""
    if not previous or int(previous.get("unread", 0) or 0) <= 0:
        return ""
    ready = int(previous["at"]) + unread_gap(ruling_seconds)
    if int(now) < ready:
        return "the work could not be fetched at %d; the jury may try again from %d" % (int(previous["at"]), ready)
    return ""


def record_unread(previous, *, round_id, now, locate=""):
    """The jury's record of a round in which no validator could fetch the
    work. ``previous`` is the record for this dispute round, or {}. The count
    grows by one per round; at ``UNREAD_LIMIT`` the record carries the
    terminal verdict ``unavailable``."""
    count = 1
    if previous and str(previous.get("round", "")) == str(round_id):
        count = int(previous.get("unread", 0) or 0) + 1
    record = {"round": str(round_id), "unread": count, "artifact": ARTIFACT_UNREAD, "located": locate != "", "at": int(now)}
    if count >= UNREAD_LIMIT:
        record.update({"verdict": VERDICT_UNAVAILABLE, "reason": "work_unavailable", "confidence": 100})
    return record


def accept_ruling(line, ruling, *, now, appeal_seconds):
    """The verdict the escrow may apply from a ruling the jury contract
    recorded. It must be about this dispute (its round), carry a known
    verdict, have been made by the ruling deadline, and be ``appeal_seconds``
    old, so an appeal of the jury's transaction has its window before any GEN
    is credited.

    A record of rounds that could not fetch the work is noted on the line at
    once (``line["unread"]``), so the deadline refunds instead of paying the
    seller; it returns "" while there is no verdict to apply yet."""
    if line["state"] != LINE_DISPUTED:
        raise ClauseError("clause %r is not disputed" % line["id"])
    if not isinstance(ruling, dict) or str(ruling.get("round", "")) != str(line["dispute"]["round"]):
        raise ClauseError("the jury has not ruled on this dispute")
    at = _int(ruling.get("at"), "ruled at")
    if at > int(line["dispute"]["rule_by"]):
        raise ClauseError("the ruling came after the ruling deadline")
    unread = int(ruling.get("unread", 0) or 0)
    if unread > 0:
        line["unread"] = max(int(line.get("unread", 0)), unread)
        if ruling.get("verdict") != VERDICT_UNAVAILABLE or int(now) < at + int(appeal_seconds):
            return ""
    if ruling.get("verdict") not in RULING_VERDICTS:
        raise ClauseError("the ruling has no verdict")
    if int(now) < at + int(appeal_seconds):
        raise ClauseError("the ruling can be applied from %d, after its appeal window" % (at + int(appeal_seconds)))
    return ruling["verdict"]


def apply_ruling(line, *, verdict, buyer, seller, now, redelivery_seconds):
    """A ruling on a disputed line. Returns the credits it makes.

    unmet: the line is kept from the seller (FAILED; the seller may redeliver
    until ``redeliver_by``), and the buyer's bond comes back.
    met: the line releases to the seller, with the bond - a dispute against a
    clause the work met cost the seller a wait.
    undetermined: the line releases to the seller; the bond comes back, since
    an honest doubt is not a frivolous dispute.
    unavailable: nobody could read the work in ``UNREAD_LIMIT`` rounds. A
    neutral refund: the line and the bond go back to the buyer, and nothing is
    paid to the seller for work no one could see.
    """
    if line["state"] != LINE_DISPUTED:
        raise ClauseError("line %s is not disputed" % line["id"])
    if verdict not in RULING_VERDICTS:
        raise ClauseError("unknown verdict %r" % verdict)
    credits = {}
    bond = int(line["dispute"]["bond"])
    if verdict == VERDICT_UNMET:
        line["state"] = LINE_FAILED
        line["redeliver_by"] = int(now) + int(redelivery_seconds)
        _credit(credits, buyer, bond)
    elif verdict == VERDICT_MET:
        line["state"] = LINE_RELEASED
        _credit(credits, seller, int(line["amount"]) + bond)
    elif verdict == VERDICT_UNAVAILABLE:
        line["state"] = LINE_REFUNDED
        line["unavailable"] = True
        _credit(credits, buyer, int(line["amount"]) + bond)
    else:
        line["state"] = LINE_RELEASED
        _credit(credits, seller, int(line["amount"]))
        _credit(credits, buyer, bond)
    line["decided_at"] = int(now)
    return credits


def apply_deadlines(deal, now, appeal_seconds=0):
    """Resolve every line whose clock has run out. Pure arithmetic: no jury,
    no other contract. Returns the credits made. A dispute lapses
    ``appeal_seconds`` after its ruling deadline, so a ruling made in time can
    always be applied first.

    - funded, and the delivery deadline passed with nothing delivered: refund.
    - in review, and the review window closed without a dispute: release.
    - disputed, and no ruling landed by the ruling deadline: release, and the
      bond goes back (nobody is marked as having lost) - unless a jury round
      found the work unreadable (``line["unread"]``): then a neutral refund,
      the line and the bond back to the buyer. Work nobody could read is
      never paid for.
    - failed, and no redelivery by the redelivery deadline: refund.
    """
    credits = {}
    buyer, seller = deal["buyer"], deal["seller"]
    now = int(now)
    for line in deal["lines"]:
        state = line["state"]
        if state == LINE_FUNDED and not deal.get("delivery") and now > int(deal["deliver_by"]):
            line["state"] = LINE_REFUNDED
            _credit(credits, buyer, int(line["amount"]))
        elif state == LINE_IN_REVIEW and now > int(line["review_until"]):
            line["state"] = LINE_RELEASED
            _credit(credits, seller, int(line["amount"]))
        elif state == LINE_DISPUTED and now > int(line["dispute"]["rule_by"]) + int(appeal_seconds):
            line["lapsed"] = True
            if int(line.get("unread", 0)) > 0:
                line["state"] = LINE_REFUNDED
                line["unavailable"] = True
                _credit(credits, buyer, int(line["amount"]) + int(line["dispute"]["bond"]))
            else:
                line["state"] = LINE_RELEASED
                _credit(credits, seller, int(line["amount"]))
                _credit(credits, buyer, int(line["dispute"]["bond"]))
        elif state == LINE_FAILED and now > int(line["redeliver_by"]):
            line["state"] = LINE_REFUNDED
            _credit(credits, buyer, int(line["amount"]))
        else:
            continue
        line["decided_at"] = now
    return credits


def open_deal(*, deal_id, buyer, seller, clauses, timing, now):
    """The record a funded escrow starts as."""
    return {
        "id": int(deal_id),
        "buyer": normalize_address(buyer, "buyer"),
        "seller": normalize_address(seller, "seller"),
        "created_at": int(now),
        "spec_digest": spec_digest(clauses),
        "timing": {k: int(timing[k]) for k in TIMINGS},
        "deliver_by": int(now) + int(timing["delivery_seconds"]),
        "delivery": None,
        "deliveries": 0,
        "lines": [
            {
                "id": str(c["id"]),
                "criterion": str(c["criterion"]).strip(),
                "test": str(c["test"]).strip(),
                "amount": int(c["amount"]),
                "state": LINE_FUNDED,
            }
            for c in clauses
        ],
    }


def deliver(deal, *, uri, digest, now):
    """The seller's delivery: the first, or a redelivery for failed lines.

    Returns the ids of the lines it opened for review. Raises when there is
    nothing a delivery can open: the first delivery is late, or no failed line
    is still inside its redelivery window.
    """
    if not is_sha256_hex(digest):
        raise ClauseError("the delivery digest must be 64 hex characters")
    if not str(uri).startswith("https://") and not str(uri).startswith("http://"):
        raise ClauseError("the delivery must be an http(s) URL")
    now = int(now)
    review = int(deal["timing"]["review_seconds"])
    if deal.get("delivery") is None:
        if now > int(deal["deliver_by"]):
            raise ClauseError("the delivery deadline has passed")
        targets = [l for l in deal["lines"] if l["state"] == LINE_FUNDED]
    else:
        targets = [l for l in deal["lines"] if l["state"] == LINE_FAILED and now <= int(l["redeliver_by"])]
        if not targets:
            raise ClauseError("nothing to redeliver")
    deal["delivery"] = {"uri": str(uri), "digest": str(digest).strip().lower(), "at": now}
    deal["deliveries"] = int(deal.get("deliveries", 0)) + 1
    for line in targets:
        line["state"] = LINE_IN_REVIEW
        line["review_until"] = now + review
        line.pop("dispute", None)
        line.pop("unread", None)
    return [l["id"] for l in targets]


def find_line(deal, clause_id):
    """The line a dispute cites. A clause that is not in the pinned spec is
    refused here, before any model runs: the buyer cannot win by naming a
    requirement that did not exist when the money was locked."""
    for line in deal["lines"]:
        if line["id"] == str(clause_id):
            return line
    raise ClauseError(
        "no clause %r in the pinned spec; a dispute must cite one of: %s"
        % (str(clause_id)[:40], ", ".join(l["id"] for l in deal["lines"]))
    )


def open_dispute(deal, *, clause_id, by, text, bond, floor, now, locate=""):
    """The buyer disputes one clause, inside its review window, with a bond.
    ``text`` is kept for people; it is never shown to the jury. ``locate`` may
    point the jury at a part of the work (``locate_error``)."""
    if normalize_address(by) != deal["buyer"]:
        raise ClauseError("only the buyer may dispute")
    line = find_line(deal, clause_id)
    if line["state"] != LINE_IN_REVIEW:
        raise ClauseError("clause %r is not open for review (it is %s)" % (line["id"], line["state"]))
    if int(now) > int(line["review_until"]):
        raise ClauseError("the review window for clause %r has closed" % line["id"])
    required = dispute_bond(int(line["amount"]), int(floor))
    if int(bond) < required:
        raise ClauseError("the dispute bond for clause %r is %d" % (line["id"], required))
    e = locate_error(locate)
    if e:
        raise ClauseError(e)
    line["state"] = LINE_DISPUTED
    line["dispute"] = {
        "bond": int(bond),
        "text": str(text)[:1000],
        "opened_at": int(now),
        "rule_by": int(now) + int(deal["timing"]["ruling_seconds"]),
        "locate": str(locate),
        "round": "%d.%d" % (int(deal.get("deliveries", 0)), int(now)),
    }
    return line


def escrowed(deal):
    """GEN this deal still holds: every non-terminal line, plus open bonds."""
    total = 0
    for line in deal["lines"]:
        if line["state"] not in TERMINAL:
            total += int(line["amount"])
        if line["state"] == LINE_DISPUTED:
            total += int(line["dispute"]["bond"])
    return total
