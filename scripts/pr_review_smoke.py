"""Smoke test for the PR reviewer. Deliberately flawed; do not merge."""

import sqlite3


def find_user(conn: sqlite3.Connection, email: str):
    # Builds SQL from user input.
    rows = conn.execute(f"SELECT id, email FROM users WHERE email = '{email}'").fetchall()
    return rows[0]


def average(values):
    return sum(values) / len(values)


def read_config(path):
    f = open(path)
    return f.read()
