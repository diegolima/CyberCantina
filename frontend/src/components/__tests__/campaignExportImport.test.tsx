import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExportCampaignModal } from "../ExportCampaignModal";
import { ExportBundleModal } from "../ExportBundleModal";
import { ImportPreviewModal } from "../ImportPreviewModal";
import { HomeEntityPickerModal } from "../HomeEntityPickerModal";
import {
  shouldShowEntityConflictControls,
  validateExportPassword,
} from "../../utils/importExportLogic";
import type { CampaignRecord, ImportInspectResponse } from "../../types";

describe("v0.30.0 Campaign Export/Import & .zcc Encryption", () => {
  it("validates export passwords accurately", () => {
    expect(validateExportPassword(false, "", "")).toBeNull();
    expect(validateExportPassword(true, "", "")).toContain("Enter a password");
    expect(validateExportPassword(true, "secret", "mismatch")).toBe(
      "Passwords do not match."
    );
    expect(validateExportPassword(true, "a".repeat(257), "a".repeat(257))).toContain(
      "256 characters"
    );
    expect(validateExportPassword(true, "strong-pass", "strong-pass")).toBeNull();
  });

  it("hides entity conflict selectors for campaign-private imports until standalone is enabled", () => {
    expect(shouldShowEntityConflictControls(false, false)).toBe(true);
    expect(shouldShowEntityConflictControls(true, false)).toBe(false);
    expect(shouldShowEntityConflictControls(true, true)).toBe(true);
  });

  it("renders ExportCampaignModal with Full/Active timeline scope, strip comments unchecked, and password toggle", () => {
    const camp: CampaignRecord = {
      id: "camp_1",
      name: "Midnight Drop",
      world_id: "world_1",
      character_id: "char_1",
      world_name: "Neon Docklands",
      character_name: "Vex Mercer",
      created_at: "2026-11-22T20:00:00Z",
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <ExportCampaignModal campaign={camp} onClose={vi.fn()} />
    );
    expect(html).toContain("Export Running Campaign (.zcc)");
    expect(html).toContain("Midnight Drop");
    expect(html).toContain("Full timelines");
    expect(html).toContain("Currently active timeline only");
    expect(html).toContain("Strip player-added bookmark comments");
    expect(html).toContain("Password-protect .zcc archive");
  });

  it("renders ExportBundleModal with optional password protection toggle", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <ExportBundleModal
        characters={[]}
        worlds={[]}
        personas={[]}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Password-protect .zcc archive");
  });

  it("renders ImportPreviewModal locked password prompt when requires_password is true", () => {
    const lockedInspect: ImportInspectResponse = {
      is_native: true,
      format_type: "zcc",
      staged_token: "stg_locked123",
      requires_password: true,
      characters: [],
      worlds: [],
      personas: [],
      campaigns: [],
      conflicts: [],
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <ImportPreviewModal
        initialInspectResult={lockedInspect}
        onClose={vi.fn()}
        onImportSuccess={vi.fn()}
      />
    );
    expect(html).toContain("Password-Protected Archive");
    expect(html).toContain("Unlock Archive");
    expect(html).not.toContain("Confirm Import");
  });

  it("renders ImportPreviewModal campaign summary with standalone toggle unchecked and conflicts hidden by default", () => {
    const campInspect: ImportInspectResponse = {
      is_native: true,
      format_type: "zcc",
      staged_token: "stg_camp123",
      requires_password: false,
      characters: [{ id: "c1", name: "Vex Mercer", category: "character" }],
      worlds: [{ id: "w1", name: "Neon Docklands", category: "world" }],
      personas: [{ id: "p1", name: "Courier Kai", category: "persona" }],
      campaigns: [
        {
          id: "camp_1",
          name: "Midnight Drop",
          tagline: "Neon Docklands • Vex Mercer",
          category: "campaign",
          extra_info: {
            timeline_scope: "full",
            turns_count: 12,
            summaries_count: 2,
            bookmarks_count: 3,
          },
        },
      ],
      conflicts: [
        {
          category: "world",
          incoming_id: "w1",
          name: "Neon Docklands",
          existing_id: "w_existing",
        },
      ],
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <ImportPreviewModal
        initialInspectResult={campInspect}
        onClose={vi.fn()}
        onImportSuccess={vi.fn()}
      />
    );
    expect(html).toContain("Running Campaign (1)");
    expect(html).toContain("Midnight Drop");
    expect(html).toContain("Import base world, characters &amp; persona as standalone library items");
    expect(html).not.toContain("Name Collisions Detected");
  });

  it("renders campaign world_name & character_name fallbacks in HomeEntityPickerModal for pending_deletion assets", () => {
    const camp: CampaignRecord = {
      id: "camp_priv",
      name: "Imported Run",
      world_id: "world_deleted",
      character_id: "char_deleted",
      world_name: "Neon Docklands",
      character_name: "Vex Mercer",
      created_at: "2026-11-22T20:00:00Z",
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      <HomeEntityPickerModal
        category="campaigns"
        personas={[]}
        characters={[]}
        worlds={[]}
        campaigns={[camp]}
        onClose={vi.fn()}
        onSelectCampaign={vi.fn()}
        onSelectCharacter={vi.fn()}
        onSelectWorld={vi.fn()}
        onSelectPersona={vi.fn()}
        onNewClick={vi.fn()}
        onExportCampaign={vi.fn()}
      />
    );
    expect(html).toContain("Imported Run");
    expect(html).toContain("Vex Mercer");
    expect(html).toContain("Neon Docklands");
    expect(html).toContain("Export campaign Imported Run (.zcc)");
  });
});
