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

"""Money with Decimal arithmetic and per-currency rounding."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# ISO 4217 code -> number of minor-unit digits.
CURRENCIES: dict[str, int] = {"USD": 2, "EUR": 2, "GBP": 2, "INR": 2, "JPY": 0}


class CurrencyMismatch(ValueError):
    """Raised when combining amounts in different currencies."""


@dataclass(frozen=True)
class Money:
    """An immutable amount in one currency.

    Attributes:
        amount: The amount as a Decimal.
        currency: An ISO 4217 code from ``CURRENCIES``.
    """

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        if self.currency not in CURRENCIES:
            raise ValueError(f"unsupported currency: {self.currency}")
        if not isinstance(self.amount, Decimal):
            raise TypeError("amount must be a Decimal")

    @classmethod
    def of(cls, amount: str | int, currency: str) -> Money:
        """Builds Money from a string or int, never a float."""
        return cls(Decimal(str(amount)), currency)

    def quantize(self) -> Money:
        """Rounds half-up to the currency's minor unit."""
        exp = Decimal(1).scaleb(-CURRENCIES[self.currency])
        return Money(self.amount.quantize(exp, rounding=ROUND_HALF_UP), self.currency)

    def __add__(self, other: Money) -> Money:
        self._same(other)
        return Money(self.amount + other.amount, self.currency)

    def __sub__(self, other: Money) -> Money:
        self._same(other)
        return Money(self.amount - other.amount, self.currency)

    def times(self, factor: Decimal | int) -> Money:
        """Multiplies by a Decimal or int factor."""
        return Money(self.amount * Decimal(factor), self.currency)

    def _same(self, other: Money) -> None:
        if self.currency != other.currency:
            raise CurrencyMismatch(f"{self.currency} vs {other.currency}")
