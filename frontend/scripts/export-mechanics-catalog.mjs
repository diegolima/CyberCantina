#!/usr/bin/env node
/**
 * Export the canonical frontend Game Mechanics catalog into a lean, deterministic
 * backend JSON artifact (`backend/app/reference/game_mechanics_catalog.json`).
 *
 * Usage:
 *   node scripts/export-mechanics-catalog.mjs          # write JSON
 *   node scripts/export-mechanics-catalog.mjs --check  # verify CI sync without writing
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const CATALOG_TS_PATH = path.join(
  FRONTEND_DIR,
  "src",
  "components",
  "world",
  "mechanics",
  "mechanicsCatalog.ts"
);
const OUTPUT_JSON_PATH = path.join(
  REPO_ROOT,
  "backend",
  "app",
  "reference",
  "game_mechanics_catalog.json"
);

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

async function loadCanonicalCatalog() {
  const buildResult = await esbuild.build({
    entryPoints: [CATALOG_TS_PATH],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  const outputFile = buildResult.outputFiles?.[0];
  if (!outputFile) {
    throw new Error("esbuild produced no output for mechanicsCatalog.ts");
  }
  const encoded = Buffer.from(outputFile.text, "utf8").toString("base64");
  const mod = await import(`data:text/javascript;base64,${encoded}`);
  if (
    !Array.isArray(mod.MECHANICS_SUBCATEGORIES) ||
    !Array.isArray(mod.MECHANICS_ARTICLES)
  ) {
    throw new Error(
      "mechanicsCatalog.ts must export MECHANICS_SUBCATEGORIES and MECHANICS_ARTICLES"
    );
  }
  return {
    subcategories: mod.MECHANICS_SUBCATEGORIES,
    articles: mod.MECHANICS_ARTICLES,
  };
}

function serializeCatalog({ subcategories, articles }) {
  const payload = {
    schema_version: 1,
    subcategories: subcategories.map((sub) => ({
      id: sub.id,
      label: sub.label,
      short_label: sub.shortLabel,
      description: sub.description,
    })),
    articles: articles.map((art) => ({
      id: art.id,
      subcategory_id: art.subcategoryId,
      title: art.title,
      short_title: art.shortTitle ?? null,
      keywords: [...art.keywords],
      in_one_line: art.inOneLine,
      scales: (art.scales ?? []).map((row) => ({
        label: row.label,
        range_or_tag: row.rangeOrTag,
        meaning: row.meaning,
      })),
      how_it_changes: [...art.howItChanges],
      effect_on_play: [...art.effectOnPlay],
      under_the_hood: art.underTheHood
        ? {
            title: art.underTheHood.title ?? null,
            summary: art.underTheHood.summary,
            items: art.underTheHood.items.map((item) => ({
              label: item.label,
              value: item.value,
              detail: item.detail ?? null,
            })),
          }
        : null,
      related_topic_ids: [...art.relatedTopicIds],
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const catalog = await loadCanonicalCatalog();
  const rendered = serializeCatalog(catalog);

  if (checkOnly) {
    if (!fs.existsSync(OUTPUT_JSON_PATH)) {
      console.error(
        `Missing backend mechanics catalog at ${OUTPUT_JSON_PATH}.\nRun: npm --prefix frontend run mechanics:export`
      );
      process.exit(1);
    }
    const existing = fs.readFileSync(OUTPUT_JSON_PATH, "utf8");
    if (existing !== rendered) {
      console.error(
        `${path.relative(REPO_ROOT, OUTPUT_JSON_PATH)} is out of sync with mechanicsCatalog.ts.\nRun: npm --prefix frontend run mechanics:export`
      );
      process.exit(1);
    }
    console.log(
      `mechanics:check OK (${catalog.subcategories.length} subcategories, ${catalog.articles.length} articles)`
    );
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON_PATH, rendered, "utf8");
  console.log(
    `Exported ${catalog.subcategories.length} subcategories and ${catalog.articles.length} articles to ${path.relative(REPO_ROOT, OUTPUT_JSON_PATH)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
