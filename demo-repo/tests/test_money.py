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

from invoicekit.money import CurrencyMismatch, Money


def test_of_accepts_strings():
    assert Money.of("10.50", "USD").amount == Decimal("10.50")


def test_rejects_unknown_currency():
    with pytest.raises(ValueError):
        Money.of("1", "XXX")


def test_rejects_float_amounts():
    with pytest.raises(TypeError):
        Money(10.5, "USD")  # type: ignore[arg-type]


def test_quantize_rounds_half_up():
    assert Money.of("2.345", "USD").quantize().amount == Decimal("2.35")


def test_quantize_jpy_has_no_minor_unit():
    assert Money.of("100.5", "JPY").quantize().amount == Decimal("101")


def test_add_same_currency():
    assert (Money.of("1.10", "EUR") + Money.of("2.20", "EUR")).amount == Decimal("3.30")


def test_add_different_currency_fails():
    with pytest.raises(CurrencyMismatch):
        Money.of("1", "EUR") + Money.of("1", "USD")
