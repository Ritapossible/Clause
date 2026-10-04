"""Direct (in-memory) suite: no chain, no network, no model."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "contracts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "deploy"))

T0 = 1_700_000_000
BUYER = "0x00000000000000000000000000000000000000b1"
SELLER = "0x00000000000000000000000000000000000000c1"
OTHER = "0x00000000000000000000000000000000000000d1"
GEN = 10**15  # milli-GEN

TIMING = {"delivery_seconds": 3600, "review_seconds": 600, "redelivery_seconds": 1800, "ruling_seconds": 900}

CITIES = {
    "id": "cities",
    "criterion": "A list of African cities for the travel page",
    "test": "The response contains exactly 3 city names",
    "amount": 100 * GEN,
}
FORMAT = {
    "id": "format",
    "criterion": "Machine-readable output",
    "test": 'The deliverable is JSON with a top-level key "cities"',
    "amount": 50 * GEN,
}
