"""Streaming upload staging, ffprobe container/codec validation, and ffmpeg first-frame extraction."""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import HTTPException, UploadFile

from app.dependencies import render_webp_bytes
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import safe_resolve_staging_file_path

logger = logging.getLogger("cybercantina.video_processor")

ALLOWED_MP4_CODECS = frozenset({"h264", "hevc", "av1"})
ALLOWED_WEBM_CODECS = frozenset({"vp8", "vp9", "av1"})
_STREAM_CHUNK_BYTES = 64 * 1024
_PROBE_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class VideoProbeMetadata:
    """Validated container, codec, dimension, and byte-size metadata for an uploaded video."""

    container: Literal["mp4", "webm"]
    mime_type: Literal["video/mp4", "video/webm"]
    extension: Literal[".mp4", ".webm"]
    video_codec: str
    width: int
    height: int
    duration_ms: int | None
    byte_size: int


def ensure_ffmpeg_available() -> tuple[str, str]:
    """Return paths to ffmpeg and ffprobe binaries or raise HTTP 503 if unavailable."""
    ffmpeg_bin = shutil.which("ffmpeg")
    ffprobe_bin = shutil.which("ffprobe")
    if not ffmpeg_bin or not ffprobe_bin:
        raise HTTPException(
            status_code=503,
            detail="Video processing is unavailable on this server (ffmpeg/ffprobe not installed).",
        )
    return ffmpeg_bin, ffprobe_bin


def cleanup_staging_paths(*paths: Path | None) -> None:
    """Best-effort removal of staging temporary files."""
    for p in paths:
        if p is not None:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass


async def stream_upload_to_staging(
    upload: UploadFile,
    *,
    media_dir: str | Path,
    max_bytes: int,
) -> Path:
    """Stream an UploadFile in 64 KB chunks to .staging/, enforcing max_bytes mid-stream."""
    staging_name = f"stage_{uuid.uuid4().hex}.part"
    staging_path = safe_resolve_staging_file_path(media_dir, staging_name)
    staging_path.parent.mkdir(parents=True, exist_ok=True)

    total_written = 0
    max_mb = max_bytes / (1024 * 1024)
    try:
        with staging_path.open("wb") as out_f:
            while True:
                chunk = await upload.read(_STREAM_CHUNK_BYTES)
                if not chunk:
                    break
                total_written += len(chunk)
                if total_written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Video exceeds the maximum allowed upload size ({max_mb:.1f} MB).",
                    )
                out_f.write(chunk)
        if total_written == 0:
            raise HTTPException(status_code=400, detail="Empty video upload payload.")
        return staging_path
    except BaseException:
        cleanup_staging_paths(staging_path)
        raise


def _detect_magic_container(header: bytes) -> Literal["mp4", "webm"] | None:
    """Inspect leading magic bytes to distinguish genuine MP4 vs WebM vs rejected containers (.mov/.mkv/etc)."""
    if len(header) < 12:
        return None
    # WebM uses EBML header 0x1A45DFA3 and must declare the 'webm' DocType in the header block.
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        if b"webm" in header[:64].lower():
            return "webm"
        return None
    # ISO BMFF MP4 has 'ftyp' at bytes 4..8; reject QuickTime ('qt  ') major brand.
    if header[4:8] == b"ftyp":
        major_brand = header[8:12]
        if major_brand == b"qt  ":
            return None
        return "mp4"
    return None


def probe_video_file(path: Path) -> VideoProbeMetadata:
    """Validate that a staged file is a playable MP4 or WebM with standard web video codecs."""
    _, ffprobe_bin = ensure_ffmpeg_available()
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Video upload file is missing.")
    byte_size = path.stat().st_size
    if byte_size <= 0:
        raise HTTPException(status_code=400, detail="Empty video upload payload.")

    with path.open("rb") as f:
        header = f.read(64)
    magic_container = _detect_magic_container(header)
    if magic_container is None:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video container. Only MP4 and WebM videos are accepted.",
        )

    try:
        proc = subprocess.run(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=400, detail="Timed out inspecting uploaded video.") from exc
    except OSError as exc:
        logger.warning("ffprobe execution error: %s", sanitize_log_value(exc))
        raise HTTPException(status_code=503, detail="Failed invoking ffprobe for video inspection.") from exc

    if proc.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is not a valid MP4 or WebM video.",
        )

    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Failed parsing video metadata.") from exc

    fmt = payload.get("format") or {}
    format_names = {
        tok.strip().lower()
        for tok in str(fmt.get("format_name") or "").split(",")
        if tok.strip()
    }
    tags = fmt.get("tags") or {}
    major_brand = str(tags.get("major_brand") or "").strip().lower()

    if magic_container == "mp4":
        if "mp4" not in format_names or major_brand == "qt":
            raise HTTPException(
                status_code=400,
                detail="Unsupported container format. Only standard MP4 and WebM videos are accepted.",
            )
    elif magic_container == "webm":
        if "webm" not in format_names:
            raise HTTPException(
                status_code=400,
                detail="Unsupported container format. Only standard MP4 and WebM videos are accepted.",
            )

    streams = payload.get("streams") or []
    video_stream = next(
        (s for s in streams if isinstance(s, dict) and s.get("codec_type") == "video"),
        None,
    )
    if video_stream is None:
        raise HTTPException(status_code=400, detail="Uploaded file contains no video stream.")

    codec_name = str(video_stream.get("codec_name") or "").strip().lower()
    allowed_codecs = ALLOWED_MP4_CODECS if magic_container == "mp4" else ALLOWED_WEBM_CODECS
    if codec_name not in allowed_codecs:
        allowed_desc = ", ".join(sorted(allowed_codecs))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported {magic_container.upper()} video codec '{codec_name or 'unknown'}'. "
                f"Accepted codecs: {allowed_desc}."
            ),
        )

    try:
        width = int(video_stream.get("width") or 0)
        height = int(video_stream.get("height") or 0)
    except (TypeError, ValueError):
        width, height = 0, 0
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="Video stream has invalid frame dimensions.")

    duration_ms: int | None = None
    raw_duration = video_stream.get("duration") or fmt.get("duration")
    if raw_duration is not None:
        try:
            dur_val = float(raw_duration)
            if dur_val > 0:
                duration_ms = int(round(dur_val * 1000))
        except (TypeError, ValueError):
            duration_ms = None

    if magic_container == "mp4":
        return VideoProbeMetadata(
            container="mp4",
            mime_type="video/mp4",
            extension=".mp4",
            video_codec=codec_name,
            width=width,
            height=height,
            duration_ms=duration_ms,
            byte_size=byte_size,
        )
    return VideoProbeMetadata(
        container="webm",
        mime_type="video/webm",
        extension=".webm",
        video_codec=codec_name,
        width=width,
        height=height,
        duration_ms=duration_ms,
        byte_size=byte_size,
    )


def extract_first_frame_webp(
    video_path: Path,
    *,
    media_dir: str | Path,
    max_size: int = 1920,
) -> bytes:
    """Extract the first frame of a validated video and return normalized WebP bytes."""
    ffmpeg_bin, _ = ensure_ffmpeg_available()
    frame_png_path = safe_resolve_staging_file_path(
        media_dir, f"frame_{uuid.uuid4().hex}.png"
    )
    frame_png_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            [
                ffmpeg_bin,
                "-v",
                "error",
                "-y",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(frame_png_path),
            ],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
        if proc.returncode != 0 or not frame_png_path.is_file() or frame_png_path.stat().st_size == 0:
            raise HTTPException(
                status_code=400,
                detail="Could not extract a valid first frame from the uploaded video.",
            )
        png_bytes = frame_png_path.read_bytes()
        return render_webp_bytes(png_bytes, square_crop=False, max_size=max_size)
    except HTTPException:
        raise
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=400, detail="Timed out extracting first video frame.") from exc
    except Exception as exc:
        logger.warning("First-frame extraction failed: %s", sanitize_log_value(exc))
        raise HTTPException(status_code=400, detail="Could not extract first frame from video.") from exc
    finally:
        cleanup_staging_paths(frame_png_path)
