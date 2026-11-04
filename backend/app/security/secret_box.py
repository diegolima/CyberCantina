"""Encryption at rest for provider credentials (Fernet, auto-generated key file)."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Protocol

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("cybercantina.security.secret_box")

SECRET_KEY_ENV = "CYBERCANTINA_SECRET_KEY"
SECRET_KEY_FILENAME = ".cantina_secret.key"


class SecretBox(Protocol):
    """Symmetric sealing of short secrets (bearer tokens)."""

    def seal(self, plaintext: str) -> bytes: ...

    def open(self, ciphertext: bytes) -> str: ...


class SecretDecryptionError(RuntimeError):
    """Raised when a stored secret cannot be decrypted (key rotated or lost)."""


class FernetSecretBox:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)

    def seal(self, plaintext: str) -> bytes:
        return self._fernet.encrypt(plaintext.encode("utf-8"))

    def open(self, ciphertext: bytes) -> str:
        try:
            return self._fernet.decrypt(bytes(ciphertext)).decode("utf-8")
        except InvalidToken as exc:
            raise SecretDecryptionError(
                "Stored provider credential could not be decrypted (secret key changed or missing)."
            ) from exc


_BOX_CACHE: dict[str, FernetSecretBox] = {}


def _write_key_file(path: Path) -> bytes:
    key = Fernet.generate_key()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(key)
    logger.info("Generated new provider secret key at %s", path)
    return key


def load_secret_box(db_path: str) -> FernetSecretBox:
    """Resolve the key from ``CYBERCANTINA_SECRET_KEY`` or an auto-generated 0600 file beside the DB."""
    env_key = os.environ.get(SECRET_KEY_ENV, "").strip()
    cache_key = f"env:{env_key}" if env_key else f"file:{Path(db_path).resolve().parent}"
    cached = _BOX_CACHE.get(cache_key)
    if cached is not None:
        return cached
    if env_key:
        box = FernetSecretBox(env_key.encode("utf-8"))
    else:
        key_path = Path(db_path).resolve().parent / SECRET_KEY_FILENAME
        try:
            key = key_path.read_bytes().strip()
        except FileNotFoundError:
            try:
                key = _write_key_file(key_path)
            except FileExistsError:  # lost a creation race with another worker
                key = key_path.read_bytes().strip()
        box = FernetSecretBox(key)
    _BOX_CACHE[cache_key] = box
    return box
