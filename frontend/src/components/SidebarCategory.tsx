import React, { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Plus,
  Search,
} from "lucide-react";
import { useOptionalLocalRelay } from "../providers/LocalRelayContext";

const PAGE_SIZE = 5;

export interface SidebarCategoryProps<T> {
  title: string;
  icon: React.ReactNode;
  items: T[];
  searchPlaceholder: string;
  filterFn: (item: T, query: string) => boolean;
  renderItem: (item: T) => React.ReactNode;
  onNewClick?: () => void;
  newButtonTitle?: string;
  defaultExpanded?: boolean;
}

export function SidebarCategory<T>({
  title,
  icon,
  items,
  searchPlaceholder,
  filterFn,
  renderItem,
  onNewClick,
  newButtonTitle,
  defaultExpanded = false,
}: SidebarCategoryProps<T>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => filterFn(item, normalizedQuery))
    : items;

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedItems = filteredItems.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0);
  };

  return (
    <div className="sidebar-section">
      <div
        className="sidebar-category-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="sidebar-category-title">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          <span>
            {title} ({items.length})
          </span>
        </div>

        {onNewClick && (
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.68rem" }}
            onClick={(e) => {
              e.stopPropagation();
              onNewClick();
            }}
            title={newButtonTitle}
          >
            <Plus size={11} /> New
          </button>
        )}
      </div>

      {expanded && (
        <div className="sidebar-category-body">
          <div className="sidebar-search-wrap">
            <Search size={13} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </div>

          <div className="campaign-list">
            {pagedItems.length > 0 ? (
              pagedItems.map((item) => renderItem(item))
            ) : (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  padding: "6px 4px",
                  textAlign: "center",
                }}
              >
                No matching entries
              </div>
            )}
          </div>

          {filteredItems.length > PAGE_SIZE && (
            <div className="sidebar-pager">
              <span>
                {safePage * PAGE_SIZE + 1}–
                {Math.min((safePage + 1) * PAGE_SIZE, filteredItems.length)} of{" "}
                {filteredItems.length}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", fontSize: "0.68rem" }}
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", fontSize: "0.68rem" }}
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const RelaySidebarBadge: React.FC = () => {
  const relay = useOptionalLocalRelay();
  if (!relay || !relay.hasBrowserProviders) return null;
  const connected = relay.wsState === "connected";
  return (
    <div
      className={`relay-status-pill ${connected ? "connected" : "offline"}`}
      title={
        relay.webgpuLoadedModel
          ? `Browser relay ${relay.wsState} · WebGPU loaded: ${relay.webgpuLoadedModel}`
          : `Browser inference relay: ${relay.wsState}`
      }
    >
      <Cpu size={13} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {relay.webgpuLoadedModel
          ? `GPU: ${relay.webgpuLoadedModel.split("-q4")[0]}`
          : connected
          ? "Browser Relay Ready"
          : `Relay ${relay.wsState}…`}
      </span>
      {relay.webgpuLoadedModel && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: "1px 5px", fontSize: "0.66rem" }}
          onClick={() => void relay.unloadWebGpu()}
          title="Unload WebGPU model from browser VRAM"
        >
          Unload
        </button>
      )}
    </div>
  );
};
