import React from "react";
import { RefreshCw, X } from "lucide-react";
import { getUpdateBannerCopy } from "../../utils/pwa";

export interface PwaUpdateBannerProps {
  visible: boolean;
  isStreaming?: boolean;
  isUpdating?: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

export const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  visible,
  isStreaming = false,
  isUpdating = false,
  onReload,
  onDismiss,
}) => {
  if (!visible) return null;

  const copy = getUpdateBannerCopy(isStreaming, isUpdating);

  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <div className="pwa-update-banner-icon" aria-hidden="true">
        <RefreshCw size={16} className={isUpdating ? "spin" : undefined} />
      </div>
      <div className="pwa-update-banner-copy">
        <div className="pwa-update-banner-title">{copy.title}</div>
        <div className="pwa-update-banner-detail">{copy.detail}</div>
      </div>
      <div className="pwa-update-banner-actions">
        <button
          type="button"
          className="btn btn-amber btn-sm"
          disabled={isUpdating}
          onClick={onReload}
        >
          {copy.reloadLabel}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={isUpdating}
          onClick={onDismiss}
          aria-label="Dismiss update notification"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
