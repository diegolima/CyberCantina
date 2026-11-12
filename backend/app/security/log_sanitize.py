"""Log sanitation helpers preventing CR/LF log injection."""

from __future__ import annotations


def sanitize_log_value(value: object) -> str:
    """Strip CR/LF line breaks from untrusted values before logging."""
    return str(value).replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
