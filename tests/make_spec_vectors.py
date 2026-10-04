"""Writes tests/fixtures/spec_vectors.json: acceptance tests and the engine's
answer for each, for frontend/scripts/parity.ts to check the browser's copy
of the rule against."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "contracts"))
import clause_core as core  # noqa: E402

TESTS = [
    "The response contains exactly 3 city names",
    'The deliverable is JSON with a top-level key "cities"',
    "The article is between 800 and 1200 words",
    "Every heading is in English",
    "Do good work",
    "The copy is high-quality and professional",
    "Everything works as expected for us",
    "short",
    "x" * 401,
    "   padded test with 3 items   ",
    "It's the client's call",
    "Logo is well designed and 512 pixels",
    "Has a table of contents",
    "Résumé lists 2 previous employers",
    "Contains the phrase 'thank you'",
    "Delivered as one PDF document",
    "All good-looking components",
    "Uses the brand colours throughout",
]

if __name__ == "__main__":
    out = [{"test": t, "error": core.acceptance_test_error(t)} for t in TESTS]
    path = os.path.join(os.path.dirname(__file__), "fixtures", "spec_vectors.json")
    with open(path, "w") as h:
        json.dump(out, h, indent=1, ensure_ascii=False)
    print("wrote %d vectors" % len(out))
