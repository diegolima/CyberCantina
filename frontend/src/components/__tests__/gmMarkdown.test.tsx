import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GmMarkdown } from "../chat/GmMarkdown";

describe("GmMarkdown", () => {
  it("renders headings, emphasis, strikethrough, nested lists, task lists, blockquotes, hr, code, and GFM tables", () => {
    const md = [
      "# Turn Recap",
      "## Scene Notes",
      "### Subheading",
      "#### Minor Heading",
      "",
      "Text with **bold**, *italic*, and ~~crossed out~~.",
      "",
      "- Top bullet",
      "  - Nested bullet",
      "1. First step",
      "   1. Substep",
      "",
      "- [x] Verified clue",
      "- [ ] Open lead",
      "",
      "> Quoted GM observation",
      "",
      "---",
      "",
      "Use `/choice` inline.",
      "",
      "```json",
      '{"roll": 18, "tier": "Clean Success"}',
      "```",
      "",
      "| System | Half-Life |",
      "| :--- | :--- |",
      "| Mood | 4h |",
    ].join("\n");

    const html = renderToStaticMarkup(<GmMarkdown content={md} />);
    expect(html).toContain("<h1>Turn Recap</h1>");
    expect(html).toContain("<h2>Scene Notes</h2>");
    expect(html).toContain("<h3>Subheading</h3>");
    expect(html).toContain("<h4>Minor Heading</h4>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>crossed out</del>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("Nested bullet");
    expect(html).toContain("Substep");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr/>");
    expect(html).toContain("<code>/choice</code>");
    expect(html).toContain('<pre><code class="language-json">');
    expect(html).toContain('<div class="gm-md-table-wrap"><table class="gm-md-table">');
    expect(html).toContain('<th style="text-align:left">System</th>');
    expect(html).toContain('<td style="text-align:left">4h</td>');
  });

  it("preserves snake_case intraword underscores literally without creating italics", () => {
    const html = renderToStaticMarkup(
      <GmMarkdown content="Check unlock_lore, care_state, and propose_world_lore_entry." />
    );
    expect(html).toContain("unlock_lore");
    expect(html).toContain("care_state");
    expect(html).toContain("propose_world_lore_entry");
    expect(html).not.toContain("<em>");
  });

  it("preserves single newlines as line breaks via remark-breaks", () => {
    const html = renderToStaticMarkup(
      <GmMarkdown content={"**Location:** Rooftop\n**Status:** Alert"} />
    );
    expect(html).toContain("<strong>Location:</strong> Rooftop<br/>");
    expect(html).toContain("<strong>Status:</strong> Alert");
  });

  it("renders build_offline_gm_reply output cleanly without stray asterisks", () => {
    const offlineReply = [
      "**Neuromancer (Spoiler-Safe Mode)**",
      "",
      "- **Current Location:** Neon Rust Floor",
      "- **Active Branch Turns:** 4",
      "- **Pinned References:** none",
      "- **Retrieved Lore:** none",
      "",
      "Offline fallback response to: _Where is Kira?_",
    ].join("\n");

    const html = renderToStaticMarkup(<GmMarkdown content={offlineReply} />);
    expect(html).toContain("<strong>Neuromancer (Spoiler-Safe Mode)</strong>");
    expect(html).toContain("<li><strong>Current Location:</strong> Neon Rust Floor</li>");
    expect(html).toContain("<em>Where is Kira?</em>");
    expect(html).not.toContain("*<strong>");
  });

  it("escapes raw HTML, disables images, and strips clickable links (including autolinks)", () => {
    const unsafe = [
      'Compare Age < 30 inside <world> and <script>alert("xss")</script>.',
      "",
      "<world>",
      "Block HTML text",
      "</world>",
      "",
      "![Map Preview](https://evil.example/pixel.png)",
      "",
      "[Click Link](https://example.com) and [Bad JS](javascript:alert(1))",
      "",
      "Bare URL https://example.com/path and email ops@cantina.local",
    ].join("\n");

    const html = renderToStaticMarkup(<GmMarkdown content={unsafe} />);
    expect(html).toContain("&lt;world&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Block HTML text");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain('<span class="gm-md-img-fallback">[Image: Map Preview]</span>');
    expect(html).not.toContain("<a ");
    expect(html).toContain("Click Link");
    expect(html).toContain("Bad JS");
    expect(html).toContain("https://example.com/path");
    expect(html).toContain("ops@cantina.local");
  });

  it("normalizes stray inline HTML emphasis and <br> outside code while keeping code literal", () => {
    const html = renderToStaticMarkup(
      <GmMarkdown
        content={
          "<b>Important</b> and <i>subtle</i>.<br>Next line. Keep `<b>literal</b>`.\n\n| Col | Note |\n| --- | --- |\n| A | First<br>Second |"
        }
      />
    );
    expect(html).toContain("<strong>Important</strong>");
    expect(html).toContain("<em>subtle</em>");
    expect(html).toContain("<br/>\nNext line.");
    expect(html).toContain("<code>&lt;b&gt;literal&lt;/b&gt;</code>");
    expect(html).toContain("<td>First · Second</td>");
  });

  it("handles unclosed streaming Markdown tokens cleanly without throwing", () => {
    const partial = [
      "### Partial Recap",
      "**Unclosed bold",
      "",
      "```ts",
      "const pending = true;",
      "",
      "| Col A | Col B |",
    ].join("\n");

    const html = renderToStaticMarkup(<GmMarkdown content={partial} />);
    expect(html).toContain("<h3>Partial Recap</h3>");
    expect(html).toContain("**Unclosed bold");
    expect(html).toContain("const pending = true;");
  });
});
