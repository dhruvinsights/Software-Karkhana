# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from decimal import Decimal

import pytest

from invoicekit import Invoice, LineItem, Money


def make_invoice() -> Invoice:
    inv = Invoice(currency="USD", tax_rate=Decimal("0.10"))
    inv.add(LineItem("Seat licence", Money.of("19.99", "USD"), 3))
    inv.add(LineItem("Onboarding", Money.of("100", "USD")))
    return inv


def test_subtotal():
    assert make_invoice().subtotal().amount == Decimal("159.97")


def test_tax():
    assert make_invoice().tax().amount == Decimal("16.00")


def test_total():
    assert make_invoice().total().amount == Decimal("175.97")


def test_rejects_wrong_currency_item():
    inv = Invoice(currency="USD")
    with pytest.raises(ValueError):
        inv.add(LineItem("x", Money.of("1", "EUR")))


def test_quantity_must_be_positive():
    with pytest.raises(ValueError):
        LineItem("x", Money.of("1", "USD"), 0)


def test_empty_invoice_totals_zero():
    assert Invoice(currency="INR").total().amount == Decimal("0.00")
