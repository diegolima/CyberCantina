#!/usr/bin/env node
/**
 * CyberCantina CSS Integrity & Hygiene Audit
 *
 * Recursively parses frontend/src/styles.css (following relative @import statements)
 * via PostCSS and cross-references class usage and inline CSS custom properties
 * against production TS/TSX/HTML files via the TypeScript compiler API.
 *
 * Fails (exit code 1) on:
 *   1. Undefined @keyframes referenced by animation / animation-name
 *   2. Undefined var(--*) without a fallback (neither declared in CSS nor injected in TSX)
 *   3. Orphan CSS classes absent from production TS/TSX/HTML string tokens or dynamic prefixes
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const ENTRY_CSS = path.join(SRC_DIR, "styles.css");
const INDEX_HTML = path.join(FRONTEND_DIR, "index.html");

const require = createRequire(import.meta.url);
const postcss = require("postcss");
const ts = require("typescript");

const CSS_ANIM_KEYWORDS = new Set([
  "none",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "infinite",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
  "initial",
  "inherit",
  "unset",
  "revert",
]);

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Recursively load ENTRY_CSS and all relative @import targets in cascade order.
 */
function loadCssGraph(entryPath, visited = new Set(), out = []) {
  const resolved = path.resolve(entryPath);
  if (visited.has(resolved)) return out;
  visited.add(resolved);

  const text = fs.readFileSync(resolved, "utf8");
  const root = postcss.parse(text, { from: resolved });
  const relPath = path.relative(FRONTEND_DIR, resolved);

  // Follow @import statements first (preserving CSS cascade order)
  root.walkAtRules("import", (atRule) => {
    const match = atRule.params.match(/^(?:url\(\s*)?["']([^"']+)["'](?:\s*\))?/);
    if (!match) return;
    const spec = match[1];
    if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith("//")) return;
    const nextPath = path.resolve(path.dirname(resolved), spec);
    if (!fs.existsSync(nextPath)) {
      throw new Error(`Broken @import "${spec}" in ${relPath}:${atRule.source.start.line}`);
    }
    loadCssGraph(nextPath, visited, out);
  });

  out.push({
    filePath: resolved,
    relPath,
    lineCount: text.split("\n").length,
    root,
  });
  return out;
}

function addTokensFromText(text, targetSet) {
  for (const tok of text.split(/[\s,;:()]+/)) {
    const clean = tok.trim();
    if (clean && /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(clean)) {
      targetSet.add(clean);
    }
  }
}

function collectProdTokens() {
  const allStringTokens = new Set();
  const dynamicPrefixes = new Set();
  const dynamicSuffixes = new Set();
  const inlineDefinedVars = new Set();

  const prodFiles = walkFiles(SRC_DIR).filter(
    (f) => /\.(tsx?|jsx?)$/.test(f) && !f.includes("__tests__") && !/\.test\.[jt]sx?$/.test(f),
  );

  for (const file of prodFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'](--[a-zA-Z0-9_-]+)["']/g)) {
      inlineDefinedVars.add(m[1]);
    }
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        addTokensFromText(node.text, allStringTokens);
      } else if (ts.isTemplateExpression(node)) {
        addTokensFromText(node.head.text, allStringTokens);
        const mHead = node.head.text.match(/([a-zA-Z0-9_-]+-)$/);
        if (mHead) dynamicPrefixes.add(mHead[1]);
        for (const span of node.templateSpans) {
          addTokensFromText(span.literal.text, allStringTokens);
          const mPre = span.literal.text.match(/([a-zA-Z0-9_-]+-)$/);
          if (mPre) dynamicPrefixes.add(mPre[1]);
          const mSuf = span.literal.text.match(/^(-[a-zA-Z0-9_-]+)/);
          if (mSuf) dynamicSuffixes.add(mSuf[1]);
        }
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        if (ts.isStringLiteral(node.left)) {
          const m = node.left.text.match(/([a-zA-Z0-9_-]+-)$/);
          if (m) dynamicPrefixes.add(m[1]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (fs.existsSync(INDEX_HTML)) {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      addTokensFromText(m[1], allStringTokens);
    }
  }

  return { allStringTokens, dynamicPrefixes, dynamicSuffixes, inlineDefinedVars };
}

/**
 * Extract var(--name) usages and detect whether each usage includes a fallback.
 */
function parseVarUsages(value) {
  const results = [];
  let idx = 0;
  while ((idx = value.indexOf("var(", idx)) !== -1) {
    let depth = 1;
    let i = idx + 4;
    while (i < value.length && depth > 0) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      i++;
    }
    const inner = value.slice(idx + 4, i - 1).trim();
    const commaIdx = inner.indexOf(",");
    const name = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
    if (/^--[a-zA-Z0-9_-]+$/.test(name)) {
      results.push({ name, hasFallback: commaIdx !== -1 });
    }
    idx = idx + 4;
  }
  return results;
}

function main() {
  const cssFiles = loadCssGraph(ENTRY_CSS);
  const { allStringTokens, dynamicPrefixes, dynamicSuffixes, inlineDefinedVars } = collectProdTokens();

  const definedKeyframes = new Set();
  const animationRefs = [];
  const definedVars = new Set();
  const varRefs = [];
  const classDefs = new Map(); // cls -> [{ file, line, selector }]
  const mediaQueries = new Set();

  let totalLines = 0;
  let totalRules = 0;
  let importantCount = 0;
  let rawColorCount = 0;

  for (const { relPath, lineCount, root } of cssFiles) {
    totalLines += lineCount;

    root.walkAtRules((at) => {
      if (at.name === "keyframes" || at.name === "-webkit-keyframes") {
        definedKeyframes.add(at.params.trim());
      } else if (at.name === "media") {
        mediaQueries.add(at.params.trim().replace(/\s+/g, " "));
      }
    });

    root.walkRules((rule) => {
      if (rule.parent && rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) {
        return;
      }
      totalRules++;
      const line = rule.source.start.line;
      const isRootRule = rule.selector.includes(":root");

      for (const rawSel of rule.selectors || [rule.selector]) {
        const normSel = rawSel.trim().replace(/\s+/g, " ");
        const stripped = normSel.replace(/\[[^\]]*\]/g, "");
        for (const m of stripped.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
          const cls = m[1];
          if (!classDefs.has(cls)) classDefs.set(cls, []);
          classDefs.get(cls).push({ file: relPath, line, selector: normSel });
        }
      }

      rule.each((child) => {
        if (child.type !== "decl") return;
        const declLine = child.source.start.line;
        if (child.important) importantCount++;

        if (child.prop.startsWith("--")) {
          definedVars.add(child.prop);
        }

        for (const v of parseVarUsages(child.value)) {
          varRefs.push({ ...v, file: relPath, line: declLine, selector: rule.selector.replace(/\s+/g, " ") });
        }

        if (child.prop === "animation" || child.prop === "animation-name") {
          const cleaned = child.value
            .replace(/cubic-bezier\([^)]+\)/g, "")
            .replace(/steps\([^)]+\)/g, "");
          for (const tok of cleaned.split(/[\s,]+/).filter(Boolean)) {
            if (!CSS_ANIM_KEYWORDS.has(tok) && !/^[0-9.]+(m?s)?$/.test(tok)) {
              animationRefs.push({ name: tok, file: relPath, line: declLine, selector: rule.selector.replace(/\s+/g, " ") });
            }
          }
        }

        if (!isRootRule) {
          const rawMatches = child.value.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}\b)/g);
          if (rawMatches) rawColorCount += rawMatches.length;
        }
      });
    });
  }

  const undefinedKeyframes = animationRefs.filter((ref) => !definedKeyframes.has(ref.name));
  const unguardedUndefinedVars = varRefs.filter(
    (ref) => !ref.hasFallback && !definedVars.has(ref.name) && !inlineDefinedVars.has(ref.name),
  );

  const orphanClasses = [];
  for (const [cls, refs] of classDefs.entries()) {
    if (allStringTokens.has(cls)) continue;
    const matchesPrefix = [...dynamicPrefixes].some((p) => cls.startsWith(p));
    const matchesSuffix = [...dynamicSuffixes].some((s) => cls.endsWith(s));
    if (!matchesPrefix && !matchesSuffix) {
      orphanClasses.push({ cls, refs });
    }
  }

  const CANONICAL_MEDIA = new Set([
    "(max-width: 620px)",
    "(max-width: 820px)",
    "(max-width: 1100px)",
    "(min-width: 821px) and (max-width: 1100px)",
    "(prefers-reduced-motion: reduce)",
  ]);
  const nonCanonicalMedia = [...mediaQueries].filter((q) => !CANONICAL_MEDIA.has(q));

  console.log(
    `[css:audit] files=${cssFiles.length} lines=${totalLines} rules=${totalRules} classes=${classDefs.size} rawColors=${rawColorCount} !important=${importantCount} mediaQueries=${mediaQueries.size}`,
  );
  if (nonCanonicalMedia.length > 0) {
    console.warn(`[css:audit] WARN: non-canonical @media queries: ${nonCanonicalMedia.join(", ")}`);
  }

  let failed = false;

  if (undefinedKeyframes.length > 0) {
    failed = true;
    console.error(`\n[css:audit] ERROR: ${undefinedKeyframes.length} undefined @keyframes reference(s):`);
    for (const u of undefinedKeyframes) {
      console.error(`  - ${u.file}:${u.line} (${u.selector}) -> @keyframes "${u.name}" not found`);
    }
  }

  if (unguardedUndefinedVars.length > 0) {
    failed = true;
    console.error(`\n[css:audit] ERROR: ${unguardedUndefinedVars.length} undefined CSS variable(s) without fallback:`);
    for (const u of unguardedUndefinedVars) {
      console.error(`  - ${u.file}:${u.line} (${u.selector}) -> var(${u.name}) not defined`);
    }
  }

  if (orphanClasses.length > 0) {
    failed = true;
    console.error(`\n[css:audit] ERROR: ${orphanClasses.length} orphan CSS class(es) not referenced in production code:`);
    for (const o of orphanClasses) {
      const loc = o.refs.map((r) => `${r.file}:${r.line}`).join(", ");
      console.error(`  - .${o.cls} (${loc})`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log("[css:audit] OK — 0 undefined @keyframes, 0 unguarded undefined vars, 0 orphan classes.");
}

main();
