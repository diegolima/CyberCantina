import React from "react";
import {
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  VideoOff,
} from "lucide-react";

const VIDEO_EXTS = new Set([".mp4", ".webm"]);
const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
  ".tiff",
  ".tif",
]);

/**
 * Classify a selected File object as an image, supported web video (MP4/WebM), or unsupported.
 */
export function classifyMediaUploadFile(file: {
  name: string;
  type?: string;
}): "image" | "video" | "unsupported" {
  const mime = (file.type || "").toLowerCase().trim();
  const lowerName = (file.name || "").toLowerCase().trim();
  const dotIdx = lowerName.lastIndexOf(".");
  const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : "";

  if (mime === "video/mp4" || mime === "video/webm" || VIDEO_EXTS.has(ext)) {
    return "video";
  }
  if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
    return "image";
  }
  return "unsupported";
}

/**
 * Compute the HTML `<input accept>` string based on admin image/video upload permissions.
 */
export function computeUnifiedUploadAccept(
  allowImageUploads: boolean,
  allowVideoUploads: boolean
): string {
  if (allowImageUploads && allowVideoUploads) {
    return "image/*,.mp4,.webm,video/mp4,video/webm";
  }
  if (allowImageUploads) {
    return "image/*";
  }
  if (allowVideoUploads) {
    return ".mp4,.webm,video/mp4,video/webm";
  }
  return "";
}

/**
 * Process a batch of image and/or MP4/WebM files through separate image and video upload callbacks,
 * preserving state for any files that succeeded before an error occurs.
 */
export async function uploadUnifiedMediaBatch<T>({
  files,
  allowImageUploads,
  allowVideoUploads,
  label,
  uploadImage,
  uploadVideo,
  onSuccess,
  onError,
}: {
  files: File[];
  allowImageUploads: boolean;
  allowVideoUploads: boolean;
  label?: string;
  uploadImage: (file: File, singleLabel?: string) => Promise<T>;
  uploadVideo: (file: File, singleLabel?: string) => Promise<T>;
  onSuccess: (latest: T) => void;
  onError: (msg: string) => void;
}): Promise<boolean> {
  const singleLabel = files.length === 1 && label?.trim() ? label.trim() : undefined;
  let latest: T | null = null;
  try {
    for (const file of files) {
      const kind = classifyMediaUploadFile(file);
      if (kind === "video") {
        if (!allowVideoUploads) {
          throw new Error("Video uploads are currently disabled by the server administrator.");
        }
        latest = await uploadVideo(file, singleLabel);
      } else if (kind === "image") {
        if (!allowImageUploads) {
          throw new Error("Image uploads are currently disabled by the server administrator.");
        }
        latest = await uploadImage(file, singleLabel);
      } else {
        throw new Error(
          `Unsupported file "${file.name}". Please upload an image or MP4/WebM video.`
        );
      }
    }
    if (latest !== null) {
      onSuccess(latest);
    }
    return latest !== null;
  } catch (err: any) {
    if (latest !== null) {
      onSuccess(latest);
    }
    onError(err?.message || "Failed to upload media.");
    return false;
  }
}

/**
 * Build a unified confirmation message for deleting a still image (cascade video + campaign impact).
 */
export function buildImageDeleteConfirmMessage({
  itemLabel,
  isPublic = false,
  campaignsUsing = 0,
  hasLinkedVideo = false,
  linkedWorldCount = 0,
}: {
  itemLabel: string;
  isPublic?: boolean;
  campaignsUsing?: number;
  hasLinkedVideo?: boolean;
  linkedWorldCount?: number;
}): string {
  const lines = isPublic
    ? [
        `Remove shared default image "${itemLabel}"?`,
        "This detaches the default asset without affecting storage quota or other users.",
      ]
    : [
        `Delete "${itemLabel}" permanently?`,
        "This immediately deletes the image from disk to free storage quota.",
      ];

  if (hasLinkedVideo && !isPublic) {
    lines.push(
      "WARNING: This image has a linked video. Deleting the image will also permanently delete its linked video."
    );
  }
  if (linkedWorldCount > 0) {
    lines.push(
      `It is currently linked to ${linkedWorldCount} location/container(s) in this world.`
    );
  }
  if (campaignsUsing > 0 && !isPublic) {
    lines.push(
      `WARNING: ${campaignsUsing} active campaign(s) currently reference this asset and will immediately lose access to it.`
    );
  } else if (campaignsUsing > 0 && isPublic) {
    lines.push(
      `${campaignsUsing} active campaign(s) will keep using this built-in image in their timelines.`
    );
  }
  return lines.join("\n\n");
}

export interface UnifiedMediaUploadButtonProps {
  uploading: boolean;
  disabled?: boolean;
  allowImageUploads: boolean;
  allowVideoUploads: boolean;
  maxVideoUploadMb: number;
  btnClassName?: string;
  onBeforePick?: () => boolean;
  onUploadFiles: (files: File[]) => Promise<void> | void;
}

/**
 * Unified "Upload Media" button accepting both images and MP4/WebM videos, dynamically respecting admin category locks.
 */
export const UnifiedMediaUploadButton: React.FC<
  UnifiedMediaUploadButtonProps
> = ({
  uploading,
  disabled = false,
  allowImageUploads,
  allowVideoUploads,
  maxVideoUploadMb,
  btnClassName = "btn btn-sm",
  onBeforePick,
  onUploadFiles,
}) => {
  const bothDisabled = !allowImageUploads && !allowVideoUploads;
  const isBlocked = disabled || bothDisabled;
  const acceptAttr = computeUnifiedUploadAccept(
    allowImageUploads,
    allowVideoUploads
  );

  const tooltip = bothDisabled
    ? "Image and video uploads are currently disabled by the server administrator."
    : !allowVideoUploads
    ? "Upload image(s) (video uploads are currently disabled by the server administrator)"
    : !allowImageUploads
    ? `Upload video(s): MP4 / WebM · Max ${maxVideoUploadMb} MB (image uploads are currently disabled by the server administrator)`
    : `Upload images or videos (MP4 / WebM · Max ${maxVideoUploadMb} MB)`;

  return (
    <label
      className={`${btnClassName} ${uploading || isBlocked ? "disabled" : ""}`}
      style={{
        cursor: isBlocked ? "not-allowed" : uploading ? "wait" : "pointer",
        whiteSpace: "nowrap",
        opacity: isBlocked ? 0.55 : 1,
      }}
      title={tooltip}
      onClick={(e) => {
        if (uploading || isBlocked) {
          e.preventDefault();
          return;
        }
        if (onBeforePick && !onBeforePick()) {
          e.preventDefault();
        }
      }}
    >
      {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
      <span>{uploading ? "Uploading..." : "Upload Media"}</span>
      <input
        type="file"
        accept={acceptAttr}
        multiple
        disabled={uploading || isBlocked}
        style={{ display: "none" }}
        onChange={async (e) => {
          const fileList = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (fileList.length === 0 || isBlocked) return;
          await onUploadFiles(fileList);
        }}
      />
    </label>
  );
};

export interface MediaUploadFormatHintProps {
  allowImageUploads: boolean;
  allowVideoUploads: boolean;
  maxVideoUploadMb: number;
  extraNote?: string;
}

/**
 * Full-width status & format hint displayed beneath the unified upload bar.
 */
export const MediaUploadFormatHint: React.FC<MediaUploadFormatHintProps> = ({
  allowImageUploads,
  allowVideoUploads,
  maxVideoUploadMb,
  extraNote,
}) => {
  if (!allowImageUploads && !allowVideoUploads) {
    return (
      <div style={{ width: "100%", fontSize: "0.73rem", color: "#fcd34d" }}>
        Image and video uploads are currently disabled by the server administrator.
      </div>
    );
  }
  if (!allowVideoUploads) {
    return (
      <div style={{ width: "100%", fontSize: "0.72rem", color: "#fcd34d" }}>
        Images only · Video uploads are currently disabled by the server administrator.
      </div>
    );
  }
  if (!allowImageUploads) {
    return (
      <div style={{ width: "100%", fontSize: "0.72rem", color: "#fcd34d" }}>
        MP4 / WebM · Max {maxVideoUploadMb} MB · Image uploads are currently disabled by the server administrator.
      </div>
    );
  }
  return (
    <div style={{ width: "100%", fontSize: "0.72rem", color: "var(--text-muted)" }}>
      Images or Video (MP4 / WebM · Max {maxVideoUploadMb} MB · Videos extract 1st frame automatically).
      {extraNote ? ` ${extraNote}` : ""}
    </div>
  );
};

export interface CardMediaActionStripProps {
  itemLabel: string;
  isPublic?: boolean;
  hasVideo: boolean;
  busy?: boolean;
  allowVideoUploads: boolean;
  maxVideoUploadMb: number;
  leadingSlot?: React.ReactNode;
  onBeforePickVideo?: () => boolean;
  onAttachOrReplaceVideo: (file: File) => Promise<void> | void;
  onRemoveVideo: () => Promise<void> | void;
  onDeleteImage: () => Promise<void> | void;
}

/**
 * Compact per-card footer controls: optional leading slot + [Upload/Replace Video] [Remove Video] [Delete Photo].
 */
export const CardMediaActionStrip: React.FC<CardMediaActionStripProps> = ({
  itemLabel,
  isPublic = false,
  hasVideo,
  busy = false,
  allowVideoUploads,
  maxVideoUploadMb,
  leadingSlot,
  onBeforePickVideo,
  onAttachOrReplaceVideo,
  onRemoveVideo,
  onDeleteImage,
}) => {
  const videoBlocked = busy || !allowVideoUploads;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        marginTop: "auto",
      }}
    >
      {leadingSlot}

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginLeft: "auto",
        }}
      >
        {!isPublic && (
          <label
            className={`btn btn-sm ${videoBlocked ? "disabled" : ""}`}
            style={{
              padding: "3px 6px",
              cursor: !allowVideoUploads
                ? "not-allowed"
                : busy
                ? "wait"
                : "pointer",
              opacity: allowVideoUploads ? 1 : 0.5,
              color: hasVideo ? "var(--accent-amber)" : "var(--text-secondary)",
              borderColor: hasVideo
                ? "rgba(245, 158, 11, 0.35)"
                : undefined,
            }}
            aria-label={hasVideo ? "Replace linked video" : "Upload linked video"}
            title={
              !allowVideoUploads
                ? "Video uploads are currently disabled by the server administrator."
                : hasVideo
                ? `Replace linked video (MP4 / WebM · Max ${maxVideoUploadMb} MB)`
                : `Upload linked video (MP4 / WebM · Max ${maxVideoUploadMb} MB)`
            }
            onClick={(e) => {
              if (videoBlocked) {
                e.preventDefault();
                return;
              }
              if (onBeforePickVideo && !onBeforePickVideo()) {
                e.preventDefault();
              }
            }}
          >
            {hasVideo ? <RefreshCw size={12} /> : <Video size={12} />}
            <input
              type="file"
              accept=".mp4,.webm,video/mp4,video/webm"
              disabled={videoBlocked}
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || videoBlocked) return;
                if (hasVideo) {
                  const ok = window.confirm(
                    `Photo "${itemLabel}" already has a linked video.\n\nUploading a new video will permanently replace and delete the previous video across all campaigns. Continue?`
                  );
                  if (!ok) return;
                }
                await onAttachOrReplaceVideo(file);
              }}
            />
          </label>
        )}

        {!isPublic && hasVideo && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            style={{
              padding: "3px 6px",
              color: "var(--text-secondary)",
            }}
            onClick={() => void onRemoveVideo()}
            aria-label="Remove linked video"
            title="Remove linked video (keeps still image)"
          >
            <VideoOff size={12} />
          </button>
        )}

        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy}
          style={{ padding: "3px 6px" }}
          onClick={() => void onDeleteImage()}
          aria-label="Delete photo permanently"
          title={
            isPublic
              ? "Remove shared image from this item"
              : hasVideo
              ? "Delete photo and linked video permanently"
              : "Delete photo permanently"
          }
        >
          {busy ? (
            <Loader2 size={11} className="spin-slow" />
          ) : (
            <Trash2 size={12} />
          )}
        </button>
      </div>
    </div>
  );
};
