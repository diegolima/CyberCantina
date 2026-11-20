import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AppSettings,
  CharacterRecord,
  PersonaRecord,
  WorldRecord,
} from "../../types";
import {
  collectExportableVideos,
  computeImportMediaToggleState,
  computePurgeToggleState,
} from "../../utils/importExportLogic";
import { AdminServerConfigTab } from "../auth/AdminServerConfigTab";
import { ExportBundleModal } from "../ExportBundleModal";
import { ImportPreviewModal } from "../ImportPreviewModal";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import {
  CardMediaActionStrip,
  buildImageDeleteConfirmMessage,
  classifyMediaUploadFile,
  computeUnifiedUploadAccept,
} from "../shared/VideoUploadControls";
import { CodexCharacterDetail } from "../world/CodexCharacterDetail";
import { WorldMediaTab } from "../world/WorldMediaTab";

const BASE_SETTINGS: AppSettings = {
  db_path: "./cybercantina.db",
  actor_profile: {
    provider_id: null,
    model: "test-actor",
    temperature: 0.7,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  clerk_profile: {
    provider_id: null,
    model: "test-clerk",
    temperature: 0.3,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  embedding_profile: {
    mode: "local_hash",
    model: "hash",
    dimensions: 384,
  },
  memory_config: {
    working_memory_turns: 8,
    episodic_chunk_size: 4,
    rag_top_k: 5,
  },
  allow_offline_fallback: true,
  allow_user_model_overrides: false,
  delegate_cognition_to_clerk: false,
  allow_self_registration: true,
  inactive_user_purge_days: 14,
  user_media_quota_mb: 5,
  allow_image_uploads: true,
  allow_video_uploads: true,
  max_video_upload_mb: 15,
  chloromancer_interval_minutes: 60,
};

function makeWorldWithVideo(): WorldRecord {
  return {
    id: "world_vid",
    name: "Kestrel Docks",
    global_rules: {
      genre: "Noir",
      tone: "Rainy",
      setting_overview: "Harbor.",
      tech_or_magic_rules: "Steam.",
      starting_timestamp: "2026-01-01 18:00",
    },
    created_at: "2026-01-01T00:00:00Z",
    media: [
      {
        id: "wmed_1",
        media_type: "image",
        url: "/api/media/assets/wmed_1",
        label: "Signal Tower",
        mime_type: "image/webp",
        byte_size: 4096,
        sort_order: 0,
        is_public: false,
        video_asset_id: "vid_world_1",
        video_url: "/api/media/assets/vid_world_1",
        video_mime_type: "video/mp4",
        video_byte_size: 512000,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    containers: [],
    locations: [],
    edges: [],
    lore_nodes: [],
  };
}

function makeCharacterWithVideo(): CharacterRecord {
  return {
    id: "char_vid",
    world_id: "world_vid",
    name: "Kira Lin",
    tagline: "Signalman",
    core_persona: "Focused.",
    baseline_psyche: {
      mood_label: "Calm",
      valence: 0.1,
      arousal: 0.4,
      core_drive: "Relay signals",
      core_fear: "Blackout",
      default_want: "Monitor harbor",
      default_plan: "Check beacon",
    },
    portraits: {},
    gallery: [
      {
        id: "img_c1",
        url: "/api/media/assets/img_c1",
        caption: "Tower Watch",
        created_at: "2026-01-01T00:00:00Z",
        is_public: false,
        video_asset_id: "vid_char_1",
        video_url: "/api/media/assets/vid_char_1",
        video_mime_type: "video/webm",
        video_byte_size: 256000,
      },
    ],
    equipped: [],
    inventory: [],
    voice_anchors: [],
    memory_shards: [],
    tags: [],
    creator: "",
    creator_notes: "",
    created_at: "2026-01-01T00:00:00Z",
    version: 1,
  } as unknown as CharacterRecord;
}

function makePersonaWithVideo(): PersonaRecord {
  return {
    id: "persona_vid",
    owner_id: "user_1",
    name: "Captain Sol",
    tagline: "Pilot",
    species: "Human",
    age: "34",
    age_is_secret: false,
    sex: "",
    pronouns: "",
    persona_bio: "",
    tags: [],
    build_and_height: "",
    distinctive_features: [],
    physical_appearance: "",
    equipped: [],
    inventory: [],
    lore_entries: [],
    portrait_url: null,
    gallery: [
      {
        id: "img_p1",
        url: "/api/media/assets/img_p1",
        caption: "Flight Deck",
        created_at: "2026-01-01T00:00:00Z",
        is_public: false,
        video_asset_id: "vid_persona_1",
        video_url: "/api/media/assets/vid_persona_1",
        video_mime_type: "video/mp4",
        video_byte_size: 128000,
      },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("Image-linked video logic helpers & UI components", () => {
  it("couples Import media parent/Images/Videos checkboxes properly", () => {
    // Checking Videos automatically checks Images
    expect(
      computeImportMediaToggleState(
        { importImages: false, importVideos: false },
        "videos",
        true
      )
    ).toEqual({ importImages: true, importVideos: true });

    // Unchecking Images automatically unchecks Videos
    expect(
      computeImportMediaToggleState(
        { importImages: true, importVideos: true },
        "images",
        false
      )
    ).toEqual({ importImages: false, importVideos: false });

    // Parent toggle sets/clears both
    expect(
      computeImportMediaToggleState(
        { importImages: false, importVideos: false },
        "parent",
        true
      )
    ).toEqual({ importImages: true, importVideos: true });
    expect(
      computeImportMediaToggleState(
        { importImages: true, importVideos: true },
        "parent",
        false
      )
    ).toEqual({ importImages: false, importVideos: false });
  });

  it("couples Admin Purge Images -> auto-checked & locked Videos", () => {
    const afterImages = computePurgeToggleState(
      { purgeImages: false, purgeVideos: false },
      "images",
      true
    );
    expect(afterImages).toEqual({ purgeImages: true, purgeVideos: true });

    // Cannot uncheck Videos while Images is checked
    expect(computePurgeToggleState(afterImages, "videos", false)).toEqual({
      purgeImages: true,
      purgeVideos: true,
    });

    // Unchecking Images unlocks toggling Videos off
    const withoutImages = computePurgeToggleState(afterImages, "images", false);
    expect(computePurgeToggleState(withoutImages, "videos", false)).toEqual({
      purgeImages: false,
      purgeVideos: false,
    });
  });

  it("collects exportable videos across selected worlds, characters, and personas respecting includeWorldMedia", () => {
    const w = makeWorldWithVideo();
    const c = makeCharacterWithVideo();
    const p = makePersonaWithVideo();

    const allWithWorld = collectExportableVideos(
      [w],
      [c],
      [p],
      new Set([w.id]),
      new Set([c.id]),
      new Set([p.id]),
      true
    );
    expect(allWithWorld.map((v) => v.videoAssetId)).toEqual([
      "vid_world_1",
      "vid_char_1",
      "vid_persona_1",
    ]);

    const withoutWorldMedia = collectExportableVideos(
      [w],
      [c],
      [p],
      new Set([w.id]),
      new Set([c.id]),
      new Set([p.id]),
      false
    );
    expect(withoutWorldMedia.map((v) => v.videoAssetId)).toEqual([
      "vid_char_1",
      "vid_persona_1",
    ]);
  });

  it("builds delete confirmation warning mentioning linked video cascade & campaign breakage", () => {
    const msg = buildImageDeleteConfirmMessage({
      itemLabel: "Signal Tower",
      isPublic: false,
      campaignsUsing: 2,
      hasLinkedVideo: true,
      linkedWorldCount: 1,
    });
    expect(msg).toContain("also permanently delete its linked video");
    expect(msg).toContain("2 active campaign(s)");
  });

  it("renders ImageLightboxModal with still image underlay, muted non-looping video, and bottom Replay/Mute controls", () => {
    const playingHtml = renderToStaticMarkup(
      <ImageLightboxModal
        url="/api/media/assets/img_1"
        videoUrl="/api/media/assets/vid_1"
        videoMimeType="video/mp4"
        autoPlayVideo={true}
        label="Signal Tower"
        onClose={vi.fn()}
      />
    );
    expect(playingHtml).toContain("/api/media/assets/img_1");
    expect(playingHtml).toContain("<video");
    expect(playingHtml).toContain("/api/media/assets/vid_1");
    expect(playingHtml).toContain("muted");
    expect(playingHtml).not.toContain(" loop");
    expect(playingHtml).toContain("opacity:0;transition:opacity 450ms ease-in-out");
    expect(playingHtml).not.toContain("Replay video");
    expect(playingHtml).toContain("Unmute video");

    const idleHtml = renderToStaticMarkup(
      <ImageLightboxModal
        url="/api/media/assets/img_1"
        videoUrl="/api/media/assets/vid_1"
        videoMimeType="video/mp4"
        autoPlayVideo={false}
        label="Signal Tower"
        onClose={vi.fn()}
      />
    );
    expect(idleHtml).toContain("Play video");
  });

  it("renders ExportBundleModal with Include videos unchecked by default", () => {
    const html = renderToStaticMarkup(
      <ExportBundleModal
        worlds={[makeWorldWithVideo()]}
        characters={[makeCharacterWithVideo()]}
        personas={[makePersonaWithVideo()]}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Include videos");
    expect(html).not.toContain("Included Videos");
  });

  it("renders ImportPreviewModal cleanly", () => {
    const html = renderToStaticMarkup(
      <ImportPreviewModal
        onClose={vi.fn()}
        onImportSuccess={vi.fn()}
      />
    );
    expect(html).toContain("Import Package or Character Card");
  });

  it("renders AdminServerConfigTab upload governance toggles, max video MB, and Purge Non-Built-In Media card", () => {
    const html = renderToStaticMarkup(
      <AdminServerConfigTab
        appSettingsForm={BASE_SETTINGS}
        setAppSettingsForm={vi.fn()}
        savingSettings={false}
        handleSaveSettings={vi.fn()}
        setStatusMsg={vi.fn()}
        setErrorMsg={vi.fn()}
      />
    );
    expect(html).toContain("Allow image uploads for non-admin users");
    expect(html).toContain("Allow video uploads for non-admin users");
    expect(html).toContain("Max Video Upload Size (MB)");
    expect(html).toContain("Purge Non-Built-In Media");
  });

  it("renders Character Photo Album and Video badge in CodexCharacterDetail", () => {
    const html = renderToStaticMarkup(
      <CodexCharacterDetail
        kind="character"
        characterEntry={{
          record: makeCharacterWithVideo(),
          state: undefined,
          isPrimary: true,
        }}
        loreNodes={[]}
        onJumpToLore={vi.fn()}
      />
    );
    expect(html).toContain("Photo Album (1)");
    expect(html).toContain("Tower Watch");
    expect(html).toContain("video linked");
  });

  it("classifies image vs video files and narrows accept filters by upload policy", () => {
    expect(classifyMediaUploadFile({ name: "scene.mp4", type: "video/mp4" })).toBe("video");
    expect(classifyMediaUploadFile({ name: "loop.WEBM", type: "" })).toBe("video");
    expect(classifyMediaUploadFile({ name: "portrait.png", type: "image/png" })).toBe("image");
    expect(classifyMediaUploadFile({ name: "notes.txt", type: "text/plain" })).toBe("unsupported");

    expect(computeUnifiedUploadAccept(true, true)).toContain("image/*,.mp4,.webm");
    expect(computeUnifiedUploadAccept(true, false)).toBe("image/*");
    expect(computeUnifiedUploadAccept(false, true)).toBe(".mp4,.webm,video/mp4,video/webm");
    expect(computeUnifiedUploadAccept(false, false)).toBe("");
  });

  it("renders unified Upload Media button, category restrictions, and ordered per-card video action icons", () => {
    const w = makeWorldWithVideo();
    const restrictedHtml = renderToStaticMarkup(
      <WorldMediaTab
        isActive={true}
        mode="inspector"
        worldId={w.id}
        media={w.media ?? []}
        containers={w.containers ?? []}
        locations={w.locations ?? []}
        isDirty={false}
        appSettings={{
          ...BASE_SETTINGS,
          allow_image_uploads: false,
          allow_video_uploads: false,
          max_video_upload_mb: 25,
        }}
        isAdmin={false}
        onWorldMutated={vi.fn()}
      />
    );
    expect(restrictedHtml).toContain("Upload Media");
    expect(restrictedHtml).toContain(
      "Image and video uploads are currently disabled by the server administrator."
    );
    expect(restrictedHtml).toContain('aria-label="Replace linked video"');
    expect(restrictedHtml).toContain('aria-label="Remove linked video"');
    expect(restrictedHtml).toContain('aria-label="Delete photo permanently"');

    // Ordered [Replace] -> [Remove] -> [Delete] on linked-video card
    const replaceIdx = restrictedHtml.indexOf('aria-label="Replace linked video"');
    const removeIdx = restrictedHtml.indexOf('aria-label="Remove linked video"');
    const deleteIdx = restrictedHtml.indexOf('aria-label="Delete photo permanently"');
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(replaceIdx);
    expect(deleteIdx).toBeGreaterThan(removeIdx);

    const openHtml = renderToStaticMarkup(
      <WorldMediaTab
        isActive={true}
        mode="inspector"
        worldId={w.id}
        media={w.media ?? []}
        containers={w.containers ?? []}
        locations={w.locations ?? []}
        isDirty={false}
        appSettings={{ ...BASE_SETTINGS, max_video_upload_mb: 25 }}
        isAdmin={false}
        onWorldMutated={vi.fn()}
      />
    );
    expect(openHtml).toContain("MP4 / WebM · Max 25 MB");

    // Still-only card shows Upload linked video (no Remove icon); public card omits video icons
    const stillOnlyStrip = renderToStaticMarkup(
      <CardMediaActionStrip
        itemLabel="Still Photo"
        hasVideo={false}
        allowVideoUploads={true}
        maxVideoUploadMb={15}
        onAttachOrReplaceVideo={vi.fn()}
        onRemoveVideo={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );
    expect(stillOnlyStrip).toContain('aria-label="Upload linked video"');
    expect(stillOnlyStrip).not.toContain('aria-label="Replace linked video"');
    expect(stillOnlyStrip).not.toContain('aria-label="Remove linked video"');

    const publicStrip = renderToStaticMarkup(
      <CardMediaActionStrip
        itemLabel="Built-in Showcase"
        isPublic={true}
        hasVideo={false}
        allowVideoUploads={true}
        maxVideoUploadMb={15}
        onAttachOrReplaceVideo={vi.fn()}
        onRemoveVideo={vi.fn()}
        onDeleteImage={vi.fn()}
      />
    );
    expect(publicStrip).not.toContain('aria-label="Upload linked video"');
    expect(publicStrip).toContain('aria-label="Delete photo permanently"');
  });
});
