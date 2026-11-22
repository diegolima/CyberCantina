"""Streaming authenticated encryption envelope (ZCCENC01) for password-protected .zcc archives.

Format (big-endian):
- 8B  magic: b"ZCCENC01"
- 4B  time_cost (uint32)
- 4B  memory_kib (uint32)
- 4B  parallelism (uint32)
- 4B  chunk_size (uint32)
- 16B salt
- 12B base_nonce
Total header size = 52 bytes.

Body: sequence of chunks until a final chunk (is_final == 1) followed immediately by EOF:
- 4B  plaintext_len (uint32)
- 1B  is_final (uint8: 0 or 1)
- (plaintext_len + 16)B AES-256-GCM ciphertext + 16-byte authentication tag

Per-chunk nonce = base_nonce XOR chunk_index (12-byte big-endian).
AAD = header_bytes (52B) || chunk_index (uint64 BE) || is_final (uint8).
"""

from __future__ import annotations

import os
import struct
from pathlib import Path

from argon2.low_level import Type as Argon2Type
from argon2.low_level import hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ZCC_ENC_MAGIC = b"ZCCENC01"
HEADER_STRUCT = struct.Struct(">8sIIII16s12s")
CHUNK_PREFIX_STRUCT = struct.Struct(">IB")
AAD_SUFFIX_STRUCT = struct.Struct(">QB")
GCM_TAG_BYTES = 16
KEY_BYTES = 32
SALT_BYTES = 16
NONCE_BYTES = 12

# Default Argon2id & chunking parameters (strong KDF, bounded server RAM)
DEFAULT_TIME_COST = 3
DEFAULT_MEMORY_KIB = 65536  # 64 MiB
DEFAULT_PARALLELISM = 2
DEFAULT_CHUNK_SIZE = 256 * 1024  # 256 KiB

# Hard server safety bounds when parsing untrusted headers
MIN_TIME_COST = 1
MAX_TIME_COST = 10
MIN_MEMORY_KIB = 8192  # 8 MiB
MAX_MEMORY_KIB = 262144  # 256 MiB
MIN_PARALLELISM = 1
MAX_PARALLELISM = 8
MIN_CHUNK_SIZE = 4096  # 4 KiB
MAX_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MiB


class ZccCryptoError(Exception):
    """Base exception for encrypted .zcc envelope errors."""


class ZccCryptoFormatError(ZccCryptoError):
    """Raised when an encrypted .zcc header or framing is malformed or unsafe."""


class ZccDecryptionError(ZccCryptoError):
    """Raised when password verification or chunk authentication fails."""


def _derive_key(
    password: str,
    salt: bytes,
    *,
    time_cost: int,
    memory_kib: int,
    parallelism: int,
) -> bytes:
    if not password:
        raise ZccDecryptionError("Password must not be empty.")
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=time_cost,
        memory_cost=memory_kib,
        parallelism=parallelism,
        hash_len=KEY_BYTES,
        type=Argon2Type.ID,
    )


def _chunk_nonce(base_nonce: bytes, chunk_index: int) -> bytes:
    base_int = int.from_bytes(base_nonce, "big")
    return (base_int ^ chunk_index).to_bytes(NONCE_BYTES, "big")


def is_encrypted_zcc_file(path: Path) -> bool:
    """Return True if ``path`` begins with the ZCCENC01 encrypted envelope magic."""
    try:
        with path.open("rb") as fh:
            return fh.read(len(ZCC_ENC_MAGIC)) == ZCC_ENC_MAGIC
    except OSError:
        return False


def is_encrypted_zcc_bytes(data: bytes) -> bool:
    """Return True if ``data`` begins with the ZCCENC01 encrypted envelope magic."""
    return len(data) >= len(ZCC_ENC_MAGIC) and data[: len(ZCC_ENC_MAGIC)] == ZCC_ENC_MAGIC


def encrypt_file_to_zcc_enc(
    src_path: Path,
    dst_path: Path,
    password: str,
    *,
    time_cost: int = DEFAULT_TIME_COST,
    memory_kib: int = DEFAULT_MEMORY_KIB,
    parallelism: int = DEFAULT_PARALLELISM,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> Path:
    """Stream-encrypt ``src_path`` into ``dst_path`` using ZCCENC01 (Argon2id + chunked AES-256-GCM)."""
    if not password or not isinstance(password, str):
        raise ValueError("Password must be a non-empty string.")
    if not (MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE):
        raise ValueError("Invalid encryption chunk size.")

    salt = os.urandom(SALT_BYTES)
    base_nonce = os.urandom(NONCE_BYTES)
    header = HEADER_STRUCT.pack(
        ZCC_ENC_MAGIC,
        time_cost,
        memory_kib,
        parallelism,
        chunk_size,
        salt,
        base_nonce,
    )
    key = _derive_key(
        password,
        salt,
        time_cost=time_cost,
        memory_kib=memory_kib,
        parallelism=parallelism,
    )
    aead = AESGCM(key)

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with src_path.open("rb") as fin, dst_path.open("wb") as fout:
            fout.write(header)
            chunk_index = 0
            current = fin.read(chunk_size)
            while True:
                nxt = fin.read(chunk_size)
                is_final = 1 if not nxt else 0
                nonce = _chunk_nonce(base_nonce, chunk_index)
                aad = header + AAD_SUFFIX_STRUCT.pack(chunk_index, is_final)
                ct = aead.encrypt(nonce, current, aad)
                fout.write(CHUNK_PREFIX_STRUCT.pack(len(current), is_final))
                fout.write(ct)
                if is_final:
                    break
                current = nxt
                chunk_index += 1
        return dst_path
    except Exception:
        dst_path.unlink(missing_ok=True)
        raise


def decrypt_zcc_enc_to_file(
    src_path: Path,
    dst_path: Path,
    password: str,
    *,
    max_output_bytes: int,
) -> Path:
    """Stream-decrypt a ZCCENC01 archive at ``src_path`` into ``dst_path`` with strict size bounds."""
    if not password or not isinstance(password, str):
        raise ZccDecryptionError("Password is required.")

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with src_path.open("rb") as fin:
            header = fin.read(HEADER_STRUCT.size)
            if len(header) != HEADER_STRUCT.size:
                raise ZccCryptoFormatError("Encrypted archive header is truncated.")

            (
                magic,
                time_cost,
                memory_kib,
                parallelism,
                chunk_size,
                salt,
                base_nonce,
            ) = HEADER_STRUCT.unpack(header)

            if magic != ZCC_ENC_MAGIC:
                raise ZccCryptoFormatError("Unrecognized encrypted archive header.")
            if not (MIN_TIME_COST <= time_cost <= MAX_TIME_COST):
                raise ZccCryptoFormatError("Unsupported KDF time cost in archive header.")
            if not (MIN_MEMORY_KIB <= memory_kib <= MAX_MEMORY_KIB):
                raise ZccCryptoFormatError("Unsupported KDF memory cost in archive header.")
            if not (MIN_PARALLELISM <= parallelism <= MAX_PARALLELISM):
                raise ZccCryptoFormatError("Unsupported KDF parallelism in archive header.")
            if not (MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE):
                raise ZccCryptoFormatError("Unsupported chunk size in archive header.")

            key = _derive_key(
                password,
                salt,
                time_cost=time_cost,
                memory_kib=memory_kib,
                parallelism=parallelism,
            )
            aead = AESGCM(key)

            total_written = 0
            chunk_index = 0
            saw_final = False
            with dst_path.open("wb") as fout:
                while True:
                    prefix = fin.read(CHUNK_PREFIX_STRUCT.size)
                    if not prefix:
                        break
                    if len(prefix) != CHUNK_PREFIX_STRUCT.size:
                        raise ZccDecryptionError("Encrypted archive is truncated.")
                    pt_len, is_final = CHUNK_PREFIX_STRUCT.unpack(prefix)
                    if is_final not in (0, 1) or pt_len > chunk_size:
                        raise ZccCryptoFormatError("Invalid encrypted chunk framing.")
                    if total_written + pt_len > max_output_bytes:
                        raise ZccCryptoFormatError(
                            "Decrypted archive exceeds maximum allowed size."
                        )

                    ct_len = pt_len + GCM_TAG_BYTES
                    ct = fin.read(ct_len)
                    if len(ct) != ct_len:
                        raise ZccDecryptionError("Encrypted archive chunk is truncated.")

                    nonce = _chunk_nonce(base_nonce, chunk_index)
                    aad = header + AAD_SUFFIX_STRUCT.pack(chunk_index, is_final)
                    try:
                        pt = aead.decrypt(nonce, ct, aad)
                    except InvalidTag as exc:
                        raise ZccDecryptionError(
                            "Incorrect password or corrupted encrypted archive."
                        ) from exc

                    fout.write(pt)
                    total_written += len(pt)
                    chunk_index += 1
                    if is_final == 1:
                        saw_final = True
                        if fin.read(1):
                            raise ZccDecryptionError("Unexpected trailing data after final chunk.")
                        break

            if not saw_final:
                raise ZccDecryptionError("Encrypted archive ended before final chunk.")
        return dst_path
    except Exception:
        dst_path.unlink(missing_ok=True)
        raise
