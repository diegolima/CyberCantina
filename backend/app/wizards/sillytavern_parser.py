"""Parser and normalizer for SillyTavern character cards (V1/V2 JSON and embedded PNGs)."""

from __future__ import annotations

import base64
import io
import json
import re
import struct
from typing import Any
from pydantic import BaseModel, Field
from PIL import Image


class SillyTavernRawCard(BaseModel):
    """Normalized intermediate representation of a SillyTavern character card."""

    name: str = "Unknown Character"
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    creator: str = ""
    creator_notes: str = ""
    system_prompt: str = ""
    post_history_instructions: str = ""
    tags: list[str] = Field(default_factory=list)
    alternate_greetings: list[str] = Field(default_factory=list)
    character_book_entries: list[dict[str, Any]] = Field(default_factory=list)
    raw_json_str: str = ""


class ExtractedCardPackage(BaseModel):
    """Extracted card payload and optional image artwork bytes."""

    card: SillyTavernRawCard
    image_bytes: bytes | None = None
    image_format: str | None = None


def _replace_macros(text: str, char_name: str) -> str:
    """Replace template macros like {{char}} and {{user}} with readable equivalents."""
    if not text:
        return ""
    # {{char}} -> Character name
    text = re.sub(r"\{\{char\}\}", char_name, text, flags=re.IGNORECASE)
    text = re.sub(r"<CHAR>", char_name, text, flags=re.IGNORECASE)
    text = re.sub(r"<BOT>", char_name, text, flags=re.IGNORECASE)
    # {{user}} -> you
    text = re.sub(r"\{\{user\}\}", "you", text, flags=re.IGNORECASE)
    text = re.sub(r"<USER>", "you", text, flags=re.IGNORECASE)
    return text.strip()


def _clean_tags(raw_tags: Any) -> list[str]:
    """Extract and sanitize tags, stripping hash symbols and splitting if needed."""
    if not raw_tags:
        return []
    tags_list: list[str] = []
    if isinstance(raw_tags, str):
        # Could be space or comma separated
        raw_items = re.split(r"[\s,]+", raw_tags)
    elif isinstance(raw_tags, list):
        raw_items = []
        for it in raw_tags:
            if isinstance(it, str):
                raw_items.extend(re.split(r"[\s,]+", it))
    else:
        raw_items = []

    seen = set()
    for item in raw_items:
        clean = item.lstrip("#").strip().lower()
        if clean and clean not in seen:
            seen.add(clean)
            tags_list.append(clean)
    return tags_list


def _extract_png_chara_chunk(png_bytes: bytes) -> str | None:
    """Extract base64-encoded chara or ccv3 metadata chunk directly from raw PNG bytes."""
    if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return None

    # 1. Try reading via Pillow PngInfo
    try:
        img = Image.open(io.BytesIO(png_bytes))
        for key in ("chara", "ccv3", "Description", "Comment"):
            val = img.info.get(key)
            if val and isinstance(val, str) and len(val.strip()) > 10:
                # Validate if it looks like base64 or raw JSON
                val_clean = val.strip()
                if val_clean.startswith("{") and val_clean.endswith("}"):
                    return val_clean
                try:
                    decoded = base64.b64decode(val_clean).decode("utf-8")
                    if decoded.strip().startswith("{"):
                        return decoded
                except Exception:
                    pass
    except Exception:
        pass

    # 2. Binary fallback chunk scanner
    offset = 8
    total_len = len(png_bytes)
    while offset + 8 <= total_len:
        length, chunk_type = struct.unpack(">I4s", png_bytes[offset : offset + 8])
        chunk_data_offset = offset + 8
        offset = chunk_data_offset + length + 4  # +4 for CRC
        if offset > total_len:
            break

        if chunk_type in (b"tEXt", b"iTXt"):
            chunk_data = png_bytes[chunk_data_offset : chunk_data_offset + length]
            # Keyword is null-terminated
            null_pos = chunk_data.find(b"\x00")
            if null_pos != -1:
                keyword = chunk_data[:null_pos].decode("latin-1", errors="ignore")
                if keyword in ("chara", "ccv3"):
                    raw_text = chunk_data[null_pos + 1 :].decode("latin-1", errors="ignore")
                    if chunk_type == b"iTXt":
                        # iTXt format: keyword\0 compression_flag(1) compression_method(1) lang\0 translated_key\0 text
                        parts = chunk_data[null_pos + 1 :]
                        if len(parts) >= 2:
                            # Skip compression_flag, method, and null-terminated lang & trans key
                            cur = 2
                            cur = parts.find(b"\x00", cur) + 1
                            cur = parts.find(b"\x00", cur) + 1
                            raw_text = parts[cur:].decode("utf-8", errors="ignore")
                    try:
                        decoded = base64.b64decode(raw_text.strip()).decode("utf-8")
                        if decoded.strip().startswith("{"):
                            return decoded
                    except Exception:
                        if raw_text.strip().startswith("{"):
                            return raw_text.strip()

    return None


def parse_sillytavern_json(raw_json_str: str) -> SillyTavernRawCard:
    """Parse and normalize SillyTavern V1 or V2 JSON payload."""
    try:
        data = json.loads(raw_json_str)
    except Exception as exc:
        raise ValueError(f"Invalid JSON string: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("Root card JSON must be an object.")

    # Determine if V2 specification wrapper
    card_dict: dict[str, Any] = data
    if data.get("spec") == "chara_card_v2" and isinstance(data.get("data"), dict):
        card_dict = data["data"]
    elif "data" in data and isinstance(data.get("data"), dict) and "name" in data["data"]:
        card_dict = data["data"]

    name = str(card_dict.get("name", "Unknown Character")).strip() or "Unknown Character"

    # Normalize macros across primary text fields
    description = _replace_macros(str(card_dict.get("description", "")), name)
    personality = _replace_macros(str(card_dict.get("personality", "")), name)
    scenario = _replace_macros(str(card_dict.get("scenario", "")), name)
    first_mes = _replace_macros(str(card_dict.get("first_mes", "")), name)
    mes_example = _replace_macros(str(card_dict.get("mes_example", "")), name)
    creator = str(card_dict.get("creator", "")).strip()
    creator_notes = str(card_dict.get("creator_notes", "")).strip()
    system_prompt = str(card_dict.get("system_prompt", "")).strip()
    post_history = str(card_dict.get("post_history_instructions", "")).strip()

    # Clean tags
    tags = _clean_tags(card_dict.get("tags", []))

    # Alternate greetings
    alt_greetings_raw = card_dict.get("alternate_greetings")
    if not isinstance(alt_greetings_raw, list):
        alt_greetings_raw = []
    alt_greetings = [
        _replace_macros(str(g), name)
        for g in alt_greetings_raw
        if isinstance(g, str) and g.strip()
    ]

    # Append alternate greetings to creator_notes so they are never lost
    if alt_greetings:
        formatted_alts = "\n\n### Alternate Greetings\n" + "\n\n".join(
            f"**Greeting {idx + 1}:**\n{g}" for idx, g in enumerate(alt_greetings)
        )
        creator_notes = f"{creator_notes}\n{formatted_alts}".strip()

    # Lorebook / Character book entries
    extensions = card_dict.get("extensions")
    character_book = card_dict.get("character_book") or (
        extensions.get("character_book", {}) if isinstance(extensions, dict) else {}
    )
    raw_entries: list[Any] = []
    if isinstance(character_book, dict):
        book_entries = character_book.get("entries")
        if isinstance(book_entries, list):
            raw_entries = book_entries
        elif isinstance(book_entries, dict):
            raw_entries = list(book_entries.values())

    entries: list[dict[str, Any]] = []
    for entry in raw_entries:
        if not isinstance(entry, dict) or entry.get("enabled") is False:
            continue
        raw_content = str(entry.get("content") or "").strip()
        if not raw_content:
            continue
        normalized_entry = dict(entry)
        normalized_entry["content"] = _replace_macros(raw_content, name)
        if entry.get("comment"):
            normalized_entry["comment"] = _replace_macros(str(entry["comment"]), name)
        if entry.get("name"):
            normalized_entry["name"] = _replace_macros(str(entry["name"]), name)
        entries.append(normalized_entry)

    return SillyTavernRawCard(
        name=name,
        description=description,
        personality=personality,
        scenario=scenario,
        first_mes=first_mes,
        mes_example=mes_example,
        creator=creator,
        creator_notes=creator_notes,
        system_prompt=system_prompt,
        post_history_instructions=post_history,
        tags=tags,
        alternate_greetings=alt_greetings,
        character_book_entries=entries,
        raw_json_str=raw_json_str,
    )


def extract_card_from_bytes(
    file_bytes: bytes,
    filename: str = "",
) -> ExtractedCardPackage:
    """Extract card payload from either raw JSON or a character PNG."""
    filename_lower = filename.lower()

    # 1. Check if PNG
    if file_bytes.startswith(b"\x89PNG\r\n\x1a\n") or filename_lower.endswith(".png"):
        json_str = _extract_png_chara_chunk(file_bytes)
        if not json_str:
            raise ValueError(
                "Uploaded PNG does not contain a SillyTavern 'chara' or 'ccv3' character metadata chunk."
            )
        card = parse_sillytavern_json(json_str)
        return ExtractedCardPackage(
            card=card,
            image_bytes=file_bytes,
            image_format="png",
        )

    # 2. Try JSON decoding
    try:
        decoded_text = file_bytes.decode("utf-8")
        card = parse_sillytavern_json(decoded_text)
        return ExtractedCardPackage(
            card=card,
            image_bytes=None,
            image_format=None,
        )
    except Exception as exc:
        raise ValueError(
            f"Failed to parse file as SillyTavern card: {exc}. "
            "Please upload a valid .json card or a .png character card with embedded metadata."
        ) from exc
