"""Unit tests for ZCCENC01 streaming authenticated encryption envelope."""

from __future__ import annotations

import os
import struct
from pathlib import Path

import pytest

from app.security.zcc_crypto import (
    HEADER_STRUCT,
    ZCC_ENC_MAGIC,
    ZccCryptoFormatError,
    ZccDecryptionError,
    decrypt_zcc_enc_to_file,
    encrypt_file_to_zcc_enc,
    is_encrypted_zcc_bytes,
    is_encrypted_zcc_file,
)


def test_encrypt_decrypt_roundtrip_multi_chunk_and_empty(tmp_path: Path) -> None:
    # 1. Multi-chunk payload (> 3 chunks at 4 KiB chunk size for fast tests)
    src = tmp_path / "payload.zcc"
    enc = tmp_path / "payload.enc.zcc"
    dec = tmp_path / "payload.dec.zcc"
    raw = os.urandom(15_000)
    src.write_bytes(raw)

    encrypt_file_to_zcc_enc(
        src,
        enc,
        "correct-horse-battery-staple",
        time_cost=1,
        memory_kib=8192,
        parallelism=1,
        chunk_size=4096,
    )
    assert is_encrypted_zcc_file(enc) is True
    assert is_encrypted_zcc_bytes(enc.read_bytes()) is True
    assert is_encrypted_zcc_file(src) is False
    assert raw not in enc.read_bytes()

    decrypt_zcc_enc_to_file(
        enc,
        dec,
        "correct-horse-battery-staple",
        max_output_bytes=1024 * 1024,
    )
    assert dec.read_bytes() == raw

    # 2. Empty payload roundtrip
    empty_src = tmp_path / "empty.zcc"
    empty_enc = tmp_path / "empty.enc.zcc"
    empty_dec = tmp_path / "empty.dec.zcc"
    empty_src.write_bytes(b"")
    encrypt_file_to_zcc_enc(
        empty_src,
        empty_enc,
        "pw",
        time_cost=1,
        memory_kib=8192,
        parallelism=1,
        chunk_size=4096,
    )
    decrypt_zcc_enc_to_file(empty_enc, empty_dec, "pw", max_output_bytes=1024)
    assert empty_dec.read_bytes() == b""


def test_wrong_password_and_tamper_detection(tmp_path: Path) -> None:
    src = tmp_path / "src.zcc"
    enc = tmp_path / "enc.zcc"
    dec = tmp_path / "dec.zcc"
    src.write_bytes(b"CyberCantina secret payload " * 400)

    encrypt_file_to_zcc_enc(
        src,
        enc,
        "secret123",
        time_cost=1,
        memory_kib=8192,
        parallelism=1,
        chunk_size=4096,
    )

    # Wrong password
    with pytest.raises(ZccDecryptionError):
        decrypt_zcc_enc_to_file(enc, dec, "wrong-password", max_output_bytes=1024 * 1024)
    assert not dec.exists()

    # Flip a byte in ciphertext
    tampered = bytearray(enc.read_bytes())
    tampered[-5] ^= 0xFF
    tampered_path = tmp_path / "tampered.zcc"
    tampered_path.write_bytes(bytes(tampered))
    with pytest.raises(ZccDecryptionError):
        decrypt_zcc_enc_to_file(tampered_path, dec, "secret123", max_output_bytes=1024 * 1024)
    assert not dec.exists()

    # Truncated file
    truncated_path = tmp_path / "truncated.zcc"
    truncated_path.write_bytes(enc.read_bytes()[:-10])
    with pytest.raises(ZccDecryptionError):
        decrypt_zcc_enc_to_file(truncated_path, dec, "secret123", max_output_bytes=1024 * 1024)
    assert not dec.exists()

    # Trailing garbage after final chunk
    trailing_path = tmp_path / "trailing.zcc"
    trailing_path.write_bytes(enc.read_bytes() + b"\x00")
    with pytest.raises(ZccDecryptionError):
        decrypt_zcc_enc_to_file(trailing_path, dec, "secret123", max_output_bytes=1024 * 1024)
    assert not dec.exists()


def test_unsafe_header_kdf_bounds_and_max_output_bytes(tmp_path: Path) -> None:
    dec = tmp_path / "dec.zcc"
    # Crafted header requesting 1 GiB Argon2id memory -> rejected before KDF runs
    bad_header = HEADER_STRUCT.pack(
        ZCC_ENC_MAGIC,
        3,
        1024 * 1024,  # 1 GiB KiB > MAX_MEMORY_KIB (256 MiB)
        2,
        4096,
        b"\x01" * 16,
        b"\x02" * 12,
    )
    bad_path = tmp_path / "bad_kdf.zcc"
    bad_path.write_bytes(bad_header + struct.pack(">IB", 0, 1) + b"\x00" * 16)
    with pytest.raises(ZccCryptoFormatError):
        decrypt_zcc_enc_to_file(bad_path, dec, "pw", max_output_bytes=1024 * 1024)

    # Exceeding max_output_bytes aborts decryption
    src = tmp_path / "big.zcc"
    enc = tmp_path / "big.enc.zcc"
    src.write_bytes(b"A" * 10_000)
    encrypt_file_to_zcc_enc(
        src,
        enc,
        "pw",
        time_cost=1,
        memory_kib=8192,
        parallelism=1,
        chunk_size=4096,
    )
    with pytest.raises(ZccCryptoFormatError):
        decrypt_zcc_enc_to_file(enc, dec, "pw", max_output_bytes=5_000)
    assert not dec.exists()
