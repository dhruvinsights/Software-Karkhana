# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""Sign-in code rules: the things that stop account takeover."""

import pytest

from app import otp
from app.otp import OtpError, OtpStore


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def make():
    clock = Clock()
    return OtpStore(clock), clock


def test_code_is_six_digits_and_verifies_once():
    store, _ = make()
    code = store.issue("a@x.com")
    assert len(code) == 6 and code.isdigit()
    store.verify("a@x.com", code)
    with pytest.raises(OtpError):
        store.verify("a@x.com", code)  # single use


def test_well_known_codes_are_never_accepted():
    store, _ = make()
    store.issue("a@x.com")
    for guess in ("123456", "9068", "009068", "000000"):
        with pytest.raises(OtpError):
            store.verify("a@x.com", guess)


def test_unknown_email_is_rejected():
    store, _ = make()
    with pytest.raises(OtpError):
        store.verify("nobody@x.com", "123456")


def test_expired_code_is_rejected():
    store, clock = make()
    code = store.issue("a@x.com")
    clock.now += otp.TTL_SECONDS + 1
    with pytest.raises(OtpError):
        store.verify("a@x.com", code)


def test_locks_out_after_max_wrong_guesses_even_for_the_right_code():
    store, _ = make()
    code = store.issue("a@x.com")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(otp.MAX_ATTEMPTS):
        with pytest.raises(OtpError):
            store.verify("a@x.com", wrong)
    with pytest.raises(OtpError) as err:
        store.verify("a@x.com", code)
    assert err.value.status == 429


def test_resend_cooldown_then_new_code_replaces_old():
    store, clock = make()
    first = store.issue("a@x.com")
    with pytest.raises(OtpError) as err:
        store.issue("a@x.com")
    assert err.value.status == 429 and err.value.retry_after
    clock.now += otp.RESEND_COOLDOWN + 1
    second = store.issue("a@x.com")
    if second != first:
        with pytest.raises(OtpError):
            store.verify("a@x.com", first)
    store.verify("a@x.com", second)


def test_codes_are_per_email():
    store, _ = make()
    a = store.issue("a@x.com")
    store.issue("b@x.com")
    with pytest.raises(OtpError):
        store.verify("b@x.com", a if a != store._entries["b@x.com"].code else "x")
