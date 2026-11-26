import React, { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { normalizeGmMarkdownInput } from "../../utils/gmMarkdown";

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const BLOCK_ALL_URLS = () => "";

const GM_MARKDOWN_COMPONENTS: Components = {
  a: ({ children }) => <>{children}</>,
  img: ({ alt }) => (
    <span className="gm-md-img-fallback">
      {alt ? `[Image: ${alt}]` : "[Image]"}
    </span>
  ),
  table: ({ children }) => (
    <div className="gm-md-table-wrap">
      <table className="gm-md-table">{children}</table>
    </div>
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={Boolean(checked)} disabled readOnly />
    ) : null,
};

export interface GmMarkdownProps {
  /** Raw Markdown (or local-model mixed Markdown/inline-HTML) content from Neuromancer. */
  content: string;
}

/**
 * Security-hardened, streaming-friendly Markdown renderer exclusively for GM Talk assistant replies.
 * Renders pure React elements without HTML passthrough, clickable links, or external images.
 */
export const GmMarkdown: React.FC<GmMarkdownProps> = React.memo(({ content }) => {
  const normalized = useMemo(() => normalizeGmMarkdownInput(content), [content]);

  return (
    <div className="gm-markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={GM_MARKDOWN_COMPONENTS}
        urlTransform={BLOCK_ALL_URLS}
      >
        {normalized}
      </Markdown>
    </div>
  );
});

GmMarkdown.displayName = "GmMarkdown";
