import { describe, expect, it } from "vitest";
import { normalizeGmMarkdownInput } from "../gmMarkdown";

describe("normalizeGmMarkdownInput", () => {
  it("converts inline HTML emphasis tags case-insensitively and preserves CommonMark flanking", () => {
    expect(normalizeGmMarkdownInput("<i>whisper</i> and <EM>tone</EM>")).toBe(
      "*whisper* and *tone*"
    );
    expect(normalizeGmMarkdownInput("<b>Warning:</b> <STRONG>Stop</STRONG>")).toBe(
      "**Warning:** **Stop**"
    );
    expect(normalizeGmMarkdownInput("<b> Warning: </b> next")).toBe(
      " **Warning:**  next"
    );
    expect(normalizeGmMarkdownInput("<b>first</b> <i> second </i>")).toBe(
      "**first**  *second* "
    );
  });

  it("drops empty emphasis pairs without emitting horizontal rules", () => {
    expect(normalizeGmMarkdownInput("Before<b></b>After")).toBe("BeforeAfter");
    expect(normalizeGmMarkdownInput("Before<i> </i>After")).toBe("Before After");
    expect(normalizeGmMarkdownInput("<strong>\t</strong>")).toBe("\t");
  });

  it("normalizes <br> variants to single newlines without doubling adjacent newlines", () => {
    expect(normalizeGmMarkdownInput("Line 1<br>Line 2<br/>Line 3<BR />Line 4")).toBe(
      "Line 1\nLine 2\nLine 3\nLine 4"
    );
    expect(normalizeGmMarkdownInput("Line 1<br>\nLine 2")).toBe("Line 1\nLine 2");
    expect(normalizeGmMarkdownInput("Line 1<br/>\r\nLine 2")).toBe("Line 1\nLine 2");
  });

  it("converts <br> inside GFM table rows into inline separators instead of breaking rows", () => {
    const input = [
      "| Stat | Effect |",
      "| :--- | :--- |",
      "| Composure | Shields PAD<br>Decays 12h |",
      "| Trust | Slow drift<br/>Max +1.0 |",
    ].join("\n");

    expect(normalizeGmMarkdownInput(input)).toBe(
      [
        "| Stat | Effect |",
        "| :--- | :--- |",
        "| Composure | Shields PAD · Decays 12h |",
        "| Trust | Slow drift · Max +1.0 |",
      ].join("\n")
    );
  });

  it("leaves inline code spans and fenced code blocks untouched (including unclosed streaming fences)", () => {
    const inline = "Use `<b>raw</b>` and `` `<i>nested</i>` `` instead of <b>bold</b>.";
    expect(normalizeGmMarkdownInput(inline)).toBe(
      "Use `<b>raw</b>` and `` `<i>nested</i>` `` instead of **bold**."
    );

    const fenced = [
      "Outside <i>tag</i>",
      "```html",
      "<b>keep literal</b>",
      "<br/>",
      "```",
      "~~~md",
      "<em>also literal</em>",
      "~~~",
      "After <strong>tag</strong>",
    ].join("\n");
    expect(normalizeGmMarkdownInput(fenced)).toBe(
      [
        "Outside *tag*",
        "```html",
        "<b>keep literal</b>",
        "<br/>",
        "```",
        "~~~md",
        "<em>also literal</em>",
        "~~~",
        "After **tag**",
      ].join("\n")
    );

    const streamingFence = "Intro <b>bold</b>\n```ts\nconst x = '<i>unclosed</i>';";
    expect(normalizeGmMarkdownInput(streamingFence)).toBe(
      "Intro **bold**\n```ts\nconst x = '<i>unclosed</i>';"
    );
  });

  it("preserves comparison operators and arbitrary XML/HTML tags intact", () => {
    const raw = "Age < 30 and x > 5 inside <world> <cognition> <script>alert(1)</script>";
    expect(normalizeGmMarkdownInput(raw)).toBe(raw);
  });
});
