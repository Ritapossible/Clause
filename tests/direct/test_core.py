"""The rules that decide without a model: what can be funded, what a dispute
may cite, what the jury's answer does, and what every deadline does."""

import copy
import itertools

import pytest
from conftest import BUYER, CITIES, FORMAT, GEN, OTHER, SELLER, T0, TIMING

import clause_core as core


def spec(*clauses, value=None, timing=TIMING, buyer=BUYER, seller=SELLER):
    clauses = list(clauses) or [dict(CITIES)]
    value = sum(c["amount"] for c in clauses) if value is None else value
    return core.spec_errors(clauses, value=value, timing=timing, buyer=buyer, seller=seller)


def deal(*clauses):
    clauses = list(clauses) or [dict(CITIES), dict(FORMAT)]
    return core.open_deal(deal_id=0, buyer=BUYER, seller=SELLER, clauses=clauses, timing=TIMING, now=T0)


# --- what can be funded -------------------------------------------------------


def test_a_checkable_spec_funds():
    assert spec(dict(CITIES), dict(FORMAT)) == []


@pytest.mark.parametrize(
    "test",
    [
        "Do good work",
        "The copy is high-quality and professional",
        "The design looks great on every page",
        "Everything works as expected for us",
        "short",
    ],
)
def test_untestable_acceptance_tests_get_no_clause(test):
    assert core.acceptance_test_error(test) != ""
    assert spec(dict(CITIES, test=test)) != []


@pytest.mark.parametrize(
    "test",
    [
        "The response contains exactly 3 city names",
        'The deliverable is JSON with a top-level key "cities"',
        "The article is between 800 and 1200 words",
        "Every heading is in English",
        "The file is a PNG image of 1024x1024 pixels",
    ],
)
def test_checkable_acceptance_tests_are_accepted(test):
    assert core.acceptance_test_error(test) == ""


def test_the_gen_sent_must_equal_the_clause_amounts():
    assert spec(dict(CITIES), value=CITIES["amount"]) == []
    assert any("must equal" in e for e in spec(dict(CITIES), value=CITIES["amount"] - 1))
    assert any("must equal" in e for e in spec(dict(CITIES), value=CITIES["amount"] + 1))


def test_spec_shape_errors():
    assert spec(dict(CITIES), dict(CITIES)) and any("duplicate" in e for e in spec(dict(CITIES), dict(CITIES)))
    assert any("id" in e for e in spec(dict(CITIES, id="Cities!")))
    assert any("amount" in e for e in spec(dict(CITIES, amount=0), value=0))
    assert any("unknown fields" in e for e in spec(dict(CITIES, bonus=1)))
    assert any("buyer and the seller" in e for e in spec(dict(CITIES), seller=BUYER))
    assert any("review_seconds" in e for e in spec(dict(CITIES), timing=dict(TIMING, review_seconds=10)))
    assert core.spec_errors([], value=0, timing=TIMING, buyer=BUYER, seller=SELLER)
    many = [dict(CITIES, id="c%d" % i) for i in range(core.MAX_CLAUSES + 1)]
    assert any("at most" in e for e in spec(*many))


def test_the_spec_digest_pins_every_clause_field():
    base = core.spec_digest([CITIES, FORMAT])
    assert core.spec_digest([dict(CITIES), dict(FORMAT)]) == base
    for field, value in (("test", "The response contains exactly 4 city names"), ("amount", 1), ("criterion", "Other cities")):
        assert core.spec_digest([dict(CITIES, **{field: value}), FORMAT]) != base


def test_dispute_bond_is_a_tenth_with_a_floor():
    assert core.dispute_bond(100 * GEN, 1 * GEN) == 10 * GEN
    assert core.dispute_bond(5 * GEN, 1 * GEN) == 1 * GEN


# --- the jury -----------------------------------------------------------------


U, M, D = core.VERDICT_UNMET, core.VERDICT_MET, core.VERDICT_UNDETERMINED


@pytest.mark.parametrize("leader,own", list(itertools.product((U, M, D), repeat=2)))
def test_agreement_table(leader, own):
    """unmet stands only on agreement; a validator sure of unmet vetoes a
    release; met and undetermined both release and agree."""
    expected = {
        (U, U): True, (U, M): False, (U, D): False,
        (M, U): False, (M, M): True, (M, D): True,
        (D, U): False, (D, M): True, (D, D): True,
    }[(leader, own)]
    assert core.jury_agrees(leader_verdict=leader, own_verdict=own) is expected


def test_a_hesitant_fail_is_undetermined():
    assert core.reading_to_verdict(core.READ_FAILS, 59) == D
    assert core.reading_to_verdict(core.READ_FAILS, 60) == U
    assert core.reading_to_verdict(core.READ_SATISFIES, 5) == M
    assert core.reading_to_verdict(core.READ_CANNOT_TELL, 99) == D
    assert core.reading_to_verdict("anything else", 99) == D


# --- deliveries and disputes ----------------------------------------------------


def delivered(*clauses, at=T0 + 10):
    d = deal(*clauses)
    core.deliver(d, uri="https://example.test/work.json", digest="a" * 64, now=at)
    return d


def test_a_dispute_must_cite_a_clause_in_the_pinned_spec():
    """A complaint about a requirement that is not in the spec has nowhere to
    go: it is refused before any model runs."""
    d = delivered()
    with pytest.raises(core.ClauseError, match="no clause 'capitals' in the pinned spec"):
        core.open_dispute(d, clause_id="capitals", by=BUYER, text="cities must be capitals", bond=10**30, floor=GEN, now=T0 + 20)
    assert [l["state"] for l in d["lines"]] == [core.LINE_IN_REVIEW, core.LINE_IN_REVIEW]


def test_only_the_buyer_disputes_inside_the_window_with_the_bond():
    d = delivered()
    with pytest.raises(core.ClauseError, match="only the buyer"):
        core.open_dispute(d, clause_id="cities", by=SELLER, text="", bond=10**30, floor=GEN, now=T0 + 20)
    with pytest.raises(core.ClauseError, match="bond"):
        core.open_dispute(d, clause_id="cities", by=BUYER, text="", bond=10 * GEN - 1, floor=GEN, now=T0 + 20)
    with pytest.raises(core.ClauseError, match="review window"):
        core.open_dispute(d, clause_id="cities", by=BUYER, text="", bond=10 * GEN, floor=GEN, now=T0 + 10 + 601)
    line = core.open_dispute(d, clause_id="cities", by=BUYER, text="only two", bond=10 * GEN, floor=GEN, now=T0 + 20)
    assert line["state"] == core.LINE_DISPUTED and line["dispute"]["rule_by"] == T0 + 20 + 900
    with pytest.raises(core.ClauseError, match="not open for review"):
        core.open_dispute(d, clause_id="cities", by=BUYER, text="", bond=10 * GEN, floor=GEN, now=T0 + 21)


def test_delivery_rules():
    d = deal()
    with pytest.raises(core.ClauseError, match="64 hex"):
        core.deliver(d, uri="https://x", digest="nope", now=T0)
    with pytest.raises(core.ClauseError, match="http"):
        core.deliver(d, uri="ftp://x", digest="a" * 64, now=T0)
    with pytest.raises(core.ClauseError, match="deadline"):
        core.deliver(deal(), uri="https://x", digest="a" * 64, now=T0 + 3601)
    assert core.deliver(d, uri="https://x", digest="a" * 64, now=T0 + 5) == ["cities", "format"]
    with pytest.raises(core.ClauseError, match="nothing to redeliver"):
        core.deliver(d, uri="https://y", digest="b" * 64, now=T0 + 6)


# --- rulings ---------------------------------------------------------------------


def disputed():
    d = delivered()
    core.open_dispute(d, clause_id="cities", by=BUYER, text="", bond=10 * GEN, floor=GEN, now=T0 + 20)
    return d, d["lines"][0]


def test_unmet_keeps_the_line_and_returns_the_bond():
    d, line = disputed()
    credits = core.apply_ruling(line, verdict=U, buyer=BUYER, seller=SELLER, now=T0 + 30, redelivery_seconds=1800)
    assert credits == {BUYER: 10 * GEN}
    assert line["state"] == core.LINE_FAILED and line["redeliver_by"] == T0 + 30 + 1800
    assert core.escrowed(d) == 150 * GEN  # the failed line is still held


def test_met_releases_the_line_and_forfeits_the_bond_to_the_seller():
    _, line = disputed()
    assert core.apply_ruling(line, verdict=M, buyer=BUYER, seller=SELLER, now=T0, redelivery_seconds=1) == {SELLER: 110 * GEN}
    assert line["state"] == core.LINE_RELEASED


def test_undetermined_releases_the_line_and_returns_the_bond():
    _, line = disputed()
    credits = core.apply_ruling(line, verdict=D, buyer=BUYER, seller=SELLER, now=T0, redelivery_seconds=1)
    assert credits == {SELLER: 100 * GEN, BUYER: 10 * GEN}


def test_only_a_disputed_line_is_ruled():
    d = delivered()
    with pytest.raises(core.ClauseError):
        core.apply_ruling(d["lines"][0], verdict=M, buyer=BUYER, seller=SELLER, now=T0, redelivery_seconds=1)


def test_a_redelivery_reopens_only_the_failed_line():
    d, line = disputed()
    core.apply_ruling(line, verdict=U, buyer=BUYER, seller=SELLER, now=T0 + 30, redelivery_seconds=1800)
    assert core.deliver(d, uri="https://example.test/v2.json", digest="b" * 64, now=T0 + 40) == ["cities"]
    assert line["state"] == core.LINE_IN_REVIEW and "dispute" not in line
    assert d["deliveries"] == 2 and d["lines"][1]["state"] == core.LINE_IN_REVIEW


# --- deadlines: the escrow resolves on its own clock --------------------------------


def test_no_delivery_refunds_everything():
    d = deal()
    assert core.apply_deadlines(d, T0 + 3600) == {}
    assert core.apply_deadlines(d, T0 + 3601) == {BUYER: 150 * GEN}
    assert core.escrowed(d) == 0


def test_an_undisputed_line_releases_when_the_window_closes():
    d = delivered()
    assert core.apply_deadlines(d, T0 + 10 + 600) == {}
    assert core.apply_deadlines(d, T0 + 10 + 601) == {SELLER: 150 * GEN}


def test_a_dispute_nobody_rules_lapses_to_the_seller_with_the_bond_returned():
    d, line = disputed()
    credits = core.apply_deadlines(d, T0 + 20 + 901)
    assert credits[SELLER] == 150 * GEN and credits[BUYER] == 10 * GEN
    assert line["state"] == core.LINE_RELEASED and line["lapsed"]


def test_a_failed_line_nobody_redelivers_refunds_the_buyer():
    d, line = disputed()
    core.apply_ruling(line, verdict=U, buyer=BUYER, seller=SELLER, now=T0 + 30, redelivery_seconds=1800)
    credits = core.apply_deadlines(d, T0 + 30 + 1801)
    assert credits == {BUYER: 100 * GEN, SELLER: 50 * GEN}
    assert line["state"] == core.LINE_REFUNDED


def test_deadlines_are_idempotent_and_conserve_value():
    """Whatever order events and deadlines arrive in, every GEN funded or
    bonded ends credited exactly once."""
    for verdict in (U, M, D, None):
        d, line = disputed()
        total = 150 * GEN + 10 * GEN
        paid = {}
        if verdict:
            for k, v in core.apply_ruling(line, verdict=verdict, buyer=BUYER, seller=SELLER, now=T0 + 30, redelivery_seconds=1800).items():
                paid[k] = paid.get(k, 0) + v
        for t in (T0 + 700, T0 + 5000, T0 + 10**6, T0 + 10**6):
            for k, v in core.apply_deadlines(d, t).items():
                paid[k] = paid.get(k, 0) + v
        assert sum(paid.values()) == total, verdict
        assert core.escrowed(d) == 0
        assert all(l["state"] in core.TERMINAL for l in d["lines"])
