import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Cpu,
} from "lucide-react";
import type { MechanicsTopicId } from "../../../types";
import type { MechanicsArticle } from "./mechanicsCatalog";
import {
  getAdjacentMechanicsTopics,
  getMechanicsArticle,
  getMechanicsSubcategoryMeta,
} from "./mechanicsHelpers";

export interface CodexMechanicsDetailProps {
  article: MechanicsArticle;
  onSelectTopic: (topicId: MechanicsTopicId) => void;
  initialUnderTheHoodOpen?: boolean;
}

export const CodexMechanicsDetail: React.FC<CodexMechanicsDetailProps> = ({
  article,
  onSelectTopic,
  initialUnderTheHoodOpen = false,
}) => {
  const [underTheHoodOpen, setUnderTheHoodOpen] = useState(
    Boolean(initialUnderTheHoodOpen)
  );

  useEffect(() => {
    setUnderTheHoodOpen(Boolean(initialUnderTheHoodOpen));
  }, [article.id, initialUnderTheHoodOpen]);

  const subcategory = getMechanicsSubcategoryMeta(article.subcategoryId);
  const { prev: prevArticle, next: nextArticle } = getAdjacentMechanicsTopics(
    article.id
  );

  return (
    <div className="codex-detail-stack">
      {/* Header Card + In One Line */}
      <div className="codex-detail-header">
        <div style={{ minWidth: 0, width: "100%" }}>
          <div className="codex-breadcrumb-trail">
            Game Mechanics › {subcategory.label}
          </div>
          <div className="codex-detail-title-row">
            <Compass size={15} color="var(--accent-cyan)" />
            <h3 className="codex-detail-title">{article.title}</h3>
          </div>
          <div className="codex-badge-row">
            <span className={`codex-mechanics-pill codex-mechanics-pill--${subcategory.accent}`}>
              {subcategory.shortLabel}
            </span>
            <span className="badge codex-badge--muted">Reference Guide</span>
          </div>
          <p className="codex-mechanics-lead">{article.inOneLine}</p>
        </div>
      </div>

      {/* Metrics, Modes & Scales */}
      {article.scales && article.scales.length > 0 && (
        <div className="codex-section-card">
          <div className="codex-section-label">Metrics, Modes &amp; Scales</div>
          <div className="codex-mechanics-scale-list">
            {article.scales.map((row) => {
              const accent = row.accent ?? "cyan";
              return (
                <div key={row.label} className="codex-mechanics-scale-row">
                  <div className="codex-mechanics-scale-head">
                    <strong>{row.label}</strong>
                    <span
                      className={`codex-mechanics-pill codex-mechanics-pill--${accent}`}
                    >
                      {row.rangeOrTag}
                    </span>
                  </div>
                  <div className="codex-mechanics-scale-desc">{row.meaning}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How It Changes */}
      <div className="codex-section-card">
        <div className="codex-section-label">How It Changes</div>
        <ul className="codex-bullet-list">
          {article.howItChanges.map((item, idx) => (
            <li key={`${article.id}-change-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Effect on Play */}
      <div className="codex-section-card">
        <div className="codex-section-label">Effect on Play</div>
        <ul className="codex-bullet-list">
          {article.effectOnPlay.map((item, idx) => (
            <li key={`${article.id}-effect-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      {/* Optional Collapsible Under the Hood Drawer */}
      {article.underTheHood && (
        <div>
          <button
            type="button"
            className={`btn btn-sm codex-mechanics-hood-toggle ${
              underTheHoodOpen ? "btn-amber" : ""
            }`}
            aria-expanded={underTheHoodOpen}
            onClick={() => setUnderTheHoodOpen((prev) => !prev)}
          >
            <Cpu size={12} />
            <span>{article.underTheHood.title || "Under the Hood"}</span>
            {underTheHoodOpen ? (
              <ChevronUp size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>

          {underTheHoodOpen && (
            <div className="codex-bio-drawer" style={{ marginTop: 8 }}>
              <div className="codex-section-label">Under the Hood</div>
              <p className="codex-prose-text" style={{ marginBottom: 8 }}>
                {article.underTheHood.summary}
              </p>
              <div className="codex-mechanics-hood-grid">
                {article.underTheHood.items.map((item) => (
                  <div key={item.label} className="codex-mechanics-hood-item">
                    <div className="codex-sub-label">{item.label}</div>
                    <div className="codex-kv-line">
                      <strong>{item.value}</strong>
                    </div>
                    {item.detail && (
                      <div className="codex-mechanics-scale-desc">
                        {item.detail}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Related Topics Cross-Links */}
      {article.relatedTopicIds.length > 0 && (
        <div className="codex-section-card">
          <div className="codex-section-label">Related Topics</div>
          <div className="codex-mechanics-related-list">
            {article.relatedTopicIds.map((relId) => {
              const target = getMechanicsArticle(relId);
              if (!target) return null;
              return (
                <button
                  key={relId}
                  type="button"
                  className="codex-mechanics-related-chip"
                  onClick={() => onSelectTopic(relId)}
                >
                  <span>{target.shortTitle ?? target.title}</span>
                  <ArrowUpRight size={11} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Previous / Next Guide Pager */}
      {(prevArticle || nextArticle) && (
        <div className="codex-mechanics-pager">
          {prevArticle ? (
            <button
              type="button"
              className="btn btn-sm codex-mechanics-pager-btn"
              onClick={() => onSelectTopic(prevArticle.id)}
            >
              <ChevronLeft size={13} aria-hidden="true" />
              <span className="codex-mechanics-pager-text">
                <span className="codex-mechanics-pager-dir">Previous</span>
                <strong>{prevArticle.shortTitle ?? prevArticle.title}</strong>
              </span>
            </button>
          ) : (
            <span />
          )}
          {nextArticle && (
            <button
              type="button"
              className="btn btn-sm codex-mechanics-pager-btn codex-mechanics-pager-btn--next"
              onClick={() => onSelectTopic(nextArticle.id)}
            >
              <span className="codex-mechanics-pager-text">
                <span className="codex-mechanics-pager-dir">Next</span>
                <strong>{nextArticle.shortTitle ?? nextArticle.title}</strong>
              </span>
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
