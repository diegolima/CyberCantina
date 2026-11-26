import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useOverlayBackHandler } from "../../hooks/useOverlayBackHandler";

export interface ImageLightboxModalProps {
  url: string;
  label?: string;
  subtitle?: string;
  counterText?: string;
  videoUrl?: string | null;
  videoMimeType?: string | null;
  autoPlayVideo?: boolean;
  autoPlayDelayMs?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onImageError?: () => void;
  onClose: () => void;
}

type LightboxVideoPhase = "idle" | "waiting" | "playing" | "ended";

/**
 * Reusable full-screen lightbox overlay for inspecting world, map, character, persona, and arrival media.
 * Displays the still image immediately (waiting at least 1s before cross-fading into linked video),
 * plays linked videos once (no loop), fades back to the still image on completion, and exposes mute/replay controls.
 */
export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  url,
  label,
  subtitle,
  counterText,
  videoUrl,
  videoMimeType,
  autoPlayVideo = false,
  autoPlayDelayMs = 1000,
  onPrev,
  onNext,
  onImageError,
  onClose,
}) => {
  useOverlayBackHandler({
    id: "image-lightbox-modal",
    isOpen: true,
    priority: 15,
    onClose,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<LightboxVideoPhase>(
    videoUrl && autoPlayVideo ? "waiting" : "idle"
  );
  const [isVideoVisible, setIsVideoVisible] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  // Reset playback state and schedule the 1s still-image pause before auto-playing on slide open/change
  useEffect(() => {
    setIsVideoVisible(false);
    if (!videoUrl) {
      setPhase("idle");
      return;
    }
    if (!autoPlayVideo) {
      setPhase("idle");
      return;
    }
    setPhase("waiting");
    const timer = window.setTimeout(() => {
      setPhase((cur) => (cur === "waiting" ? "playing" : cur));
    }, Math.max(0, autoPlayDelayMs));
    return () => window.clearTimeout(timer);
  }, [url, videoUrl, autoPlayVideo, autoPlayDelayMs]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.defaultMuted = isMuted;
      vid.muted = isMuted;
    }
  }, [isMuted, url, videoUrl]);

  useEffect(() => {
    if (!videoUrl || phase !== "playing") return;
    const vid = videoRef.current;
    if (!vid) return;
    let cancelled = false;
    vid.defaultMuted = isMutedRef.current;
    vid.muted = isMutedRef.current;
    const playPromise = vid.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.then(
        () => {
          if (!cancelled && vid.readyState >= 2) {
            setIsVideoVisible(true);
          }
        },
        (err: any) => {
          // Ignore AbortError from strict-mode/unmount cleanup; only fall back on real playback blocks
          if (!cancelled && err?.name !== "AbortError") {
            setIsVideoVisible(false);
            setPhase("ended");
          }
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, [url, videoUrl, phase]);

  const handlePlayOrReplay = () => {
    if (!videoUrl) return;
    const vid = videoRef.current;
    if (vid) {
      vid.currentTime = 0;
    }
    setIsVideoVisible(false);
    setPhase("playing");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        e.stopPropagation();
        onPrev();
        return;
      }
      if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        e.stopPropagation();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext]);

  const navBtnStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 2,
    background: "rgba(15, 23, 42, 0.85)",
    borderRadius: 999,
    width: 36,
    height: 36,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label || "Image preview"}
      style={{ zIndex: 120, background: "rgba(5, 8, 16, 0.88)", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          position: "relative",
          maxWidth: "92vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClose}
          aria-label="Close image preview"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 3,
            background: "rgba(15, 23, 42, 0.85)",
          }}
        >
          <X size={15} />
        </button>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {onPrev && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onPrev}
              aria-label="Previous image"
              style={{ ...navBtnStyle, left: 10 }}
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div style={{ position: "relative", display: "inline-flex" }}>
            <img
              src={url}
              alt={label || "World scene image"}
              onError={onImageError}
              style={{
                maxWidth: "90vw",
                maxHeight: "80vh",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                objectFit: "contain",
                boxShadow: "0 18px 50px rgba(0, 0, 0, 0.65)",
                display: "block",
              }}
            />
            {videoUrl && (
              <video
                key={`${url}::${videoUrl}`}
                ref={videoRef}
                playsInline
                muted={isMuted}
                preload="auto"
                onPlaying={() => setIsVideoVisible(true)}
                onEnded={() => {
                  setIsVideoVisible(false);
                  setPhase("ended");
                }}
                onError={() => {
                  setIsVideoVisible(false);
                  setPhase("ended");
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  borderRadius: 10,
                  pointerEvents: "none",
                  opacity: phase === "playing" && isVideoVisible ? 1 : 0,
                  transition: "opacity 450ms ease-in-out",
                }}
              >
                <source src={videoUrl} type={videoMimeType || undefined} />
              </video>
            )}
          </div>
          {onNext && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onNext}
              aria-label="Next image"
              style={{ ...navBtnStyle, right: 10 }}
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {(label || subtitle || counterText || videoUrl) && (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-primary)",
              fontSize: "0.84rem",
              fontWeight: 600,
              background: "rgba(15, 23, 42, 0.86)",
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--border-subtle)",
              display: "inline-flex",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {label && <span>{label}</span>}
            {subtitle && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontWeight: 400,
                  fontSize: "0.76rem",
                }}
              >
                {subtitle}
              </span>
            )}
            {counterText && (
              <span
                style={{
                  color: "#6ee7b7",
                  fontWeight: 600,
                  fontSize: "0.74rem",
                }}
              >
                {counterText}
              </span>
            )}
            {videoUrl && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 4,
                  paddingLeft: 8,
                  borderLeft: "1px solid var(--border-subtle)",
                }}
              >
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setIsMuted((m) => !m)}
                  aria-label={isMuted ? "Unmute video" : "Mute video"}
                  title={isMuted ? "Unmute video" : "Mute video"}
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  {isMuted ? "Muted" : "Sound"}
                </button>
                {(phase === "idle" || phase === "ended") ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={handlePlayOrReplay}
                    aria-label={phase === "ended" ? "Replay video" : "Play video"}
                    style={{
                      padding: "2px 8px",
                      fontSize: "0.72rem",
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {phase === "ended" ? (
                      <>
                        <RotateCcw size={12} /> Replay
                      </>
                    ) : (
                      <>
                        <Play size={12} /> Play
                      </>
                    )}
                  </button>
                ) : phase === "playing" && !isVideoVisible ? (
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                      fontWeight: 400,
                    }}
                  >
                    Buffering…
                  </span>
                ) : null}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
