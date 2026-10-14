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

"""Invoices made of line items, with tax."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from invoicekit.money import Money


@dataclass(frozen=True)
class LineItem:
    """One line on an invoice."""

    description: str
    unit_price: Money
    quantity: int = 1

    def __post_init__(self) -> None:
        if self.quantity < 1:
            raise ValueError("quantity must be at least 1")

    def total(self) -> Money:
        """Unit price times quantity."""
        return self.unit_price.times(self.quantity)


@dataclass
class Invoice:
    """An invoice in a single currency.

    Attributes:
        currency: ISO code every line item must use.
        tax_rate: Tax as a fraction, e.g. Decimal("0.18").
        items: The line items.
    """

    currency: str
    tax_rate: Decimal = Decimal("0")
    items: list[LineItem] = field(default_factory=list)

    def add(self, item: LineItem) -> None:
        """Adds a line item in the invoice currency."""
        if item.unit_price.currency != self.currency:
            raise ValueError("line item currency does not match invoice")
        self.items.append(item)

    def subtotal(self) -> Money:
        """Sum of line totals before tax."""
        total = Money(Decimal(0), self.currency)
        for item in self.items:
            total = total + item.total()
        return total.quantize()

    def tax(self) -> Money:
        """Tax on the subtotal."""
        return self.subtotal().times(self.tax_rate).quantize()

    def total(self) -> Money:
        """Subtotal plus tax."""
        return (self.subtotal() + self.tax()).quantize()
