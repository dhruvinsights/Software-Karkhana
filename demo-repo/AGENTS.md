# Agent instructions for invoicekit

Managed by Software Karkhana. Coding agents read this before changing code.

- Python 3.11+, standard library only. No new dependencies.
- Money is always `decimal.Decimal`, never `float`. Round with `Money.quantize()`
  (ROUND_HALF_UP to the currency's minor unit).
- Every public function has a Google-style docstring and type hints.
- Every behaviour change ships with pytest tests in `tests/`.
- Run `python -m pytest -q` before you finish. All tests must pass.
- Keep changes small and inside `invoicekit/` and `tests/`.
