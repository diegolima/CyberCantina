import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LocationContainer, LocationEdge, LocationNode } from "../../../types";
import { MapConsistencyPanel } from "../MapConsistencyPanel";
import { MapDetailsDrawer } from "../MapDetailsDrawer";
import { MapLinkInspectorSection } from "../MapLinkInspectorSection";
import { analyzeSpatialConsistency } from "../spatialConsistency";
import {
  applyAdjustmentsToEdges,
  sanitizeSnapshotAnchors,
} from "../useTopologyMutations";

const mkCont = (
  id: string,
  name: string,
  depth: 1 | 2 | 3 | 4 = 1
): LocationContainer => ({
  id,
  world_id: "w1",
  parent_container_id: null,
  depth,
  name,
  description: "",
  environmental_tags: [],
});

const mkLoc = (
  id: string,
  name: string,
  container_id: string | null = null,
  extra: Partial<LocationNode> = {}
): LocationNode => ({
  id,
  world_id: "w1",
  container_id,
  name,
  summary: "",
  description: "",
  environmental_tags: [],
  is_starting_location: false,
  ...extra,
});

const mkEdge = (
  id: string,
  from_location_id: string,
  to_location_id: string,
  compass_direction: "N" | "S" | "E" | "W",
  distance_meters: number,
  extra: Partial<LocationEdge> = {}
): LocationEdge => ({
  id,
  world_id: "w1",
  from_location_id,
  to_location_id,
  direction_label: `Go to ${to_location_id}`,
  compass_direction,
  distance_meters,
  speed_modifier: 1,
  travel_mode: null,
  obstacles: [],
  is_blocked: false,
  is_secret: false,
  distance_mode: "flexible",
  is_vertical: false,
  ...extra,
});

describe("Spatial consistency UI components and helpers", () => {
  it("renders Distance Rule, Vertical Transition, and inline suggestion in MapLinkInspectorSection", () => {
    const t1l = mkLoc("t1l", "Tunnel 1-L", "sewers");
    const t1m = mkLoc("t1m", "Tunnel 1-M", "sewers");
    const primary = mkEdge("e_f", "t1l", "t1m", "E", 140, {
      distance_mode: "flexible",
      is_vertical: true,
    });
    const reciprocal = mkEdge("e_r", "t1m", "t1l", "W", 140, {
      distance_mode: "flexible",
      is_vertical: true,
    });

    const html = ReactDOMServer.renderToStaticMarkup(
      <MapLinkInspectorSection
        mode="editor"
        allLocations={[t1l, t1m]}
        allEdges={[primary, reciprocal]}
        selectedEdgePair={{
          pairKey: "t1l|t1m",
          primary,
          reciprocal,
        }}
        onClose={() => {}}
        consistencyDiagnostic={{
          pairKey: "t1l|t1m",
          primaryEdgeId: "e_f",
          reciprocalEdgeId: "e_r",
          fromLocationId: "t1l",
          toLocationId: "t1m",
          fromName: "Tunnel 1-L",
          toName: "Tunnel 1-M",
          kind: "distance_mismatch",
          severity: "warning",
          currentMeters: 140,
          suggestedMeters: 1500,
          longitudinalErrorMeters: 1360,
          lateralErrorMeters: 0,
          message: "Tunnel 1-L ↔ Tunnel 1-M expects ~1500m from external anchors.",
          scopeContainerId: "sewers",
        }}
        reconciliationAdjustment={{
          edgeId: "e_f",
          reciprocalEdgeId: "e_r",
          fromLocationId: "t1l",
          toLocationId: "t1m",
          fromName: "Tunnel 1-L",
          toName: "Tunnel 1-M",
          currentMeters: 140,
          proposedMeters: 1500,
          deltaMeters: 1360,
          scopeContainerId: "sewers",
        }}
      />
    );

    expect(html).toContain("Distance Rule");
    expect(html).toContain("Flexible");
    expect(html).toContain("Locked");
    expect(html).toContain("Non-Euclidean");
    expect(html).toContain("Vertical Transition");
    expect(html).toContain("Apply 1.5km");
    expect(html).toContain("Mark Non-Euclidean");

    const htmlPrecise = ReactDOMServer.renderToStaticMarkup(
      <MapLinkInspectorSection
        mode="editor"
        allLocations={[t1l, t1m]}
        allEdges={[primary, reciprocal]}
        selectedEdgePair={{
          pairKey: "t1l|t1m",
          primary: { ...primary, distance_meters: 1000 },
          reciprocal: { ...reciprocal, distance_meters: 1000 },
        }}
        onClose={() => {}}
        consistencyDiagnostic={{
          pairKey: "t1l|t1m",
          primaryEdgeId: "e_f",
          reciprocalEdgeId: "e_r",
          fromLocationId: "t1l",
          toLocationId: "t1m",
          fromName: "Tunnel 1-L",
          toName: "Tunnel 1-M",
          kind: "distance_mismatch",
          severity: "warning",
          currentMeters: 1000,
          suggestedMeters: 1118,
          longitudinalErrorMeters: 118,
          lateralErrorMeters: 0,
          message: "Tunnel 1-L ↔ Tunnel 1-M is 1000m, but anchors/loop geometry imply ~1118m.",
          scopeContainerId: "sewers",
        }}
        reconciliationAdjustment={{
          edgeId: "e_f",
          reciprocalEdgeId: "e_r",
          fromLocationId: "t1l",
          toLocationId: "t1m",
          fromName: "Tunnel 1-L",
          toName: "Tunnel 1-M",
          currentMeters: 1000,
          proposedMeters: 1118,
          deltaMeters: 118,
          scopeContainerId: "sewers",
        }}
      />
    );
    expect(htmlPrecise).toContain("Apply 1118m");
  });

  it("renders External Spatial Anchor picker only for containerized L0 locations in MapDetailsDrawer", () => {
    const cNeon = mkCont("c_neon", "The Neon Rust");
    const cSewers = mkCont("c_sewers", "Sewers");
    const sump = mkLoc("sump", "The Sump-Well", cNeon.id, {
      is_starting_location: true,
    });
    const sewerEnt = mkLoc("sewer_ent", "Sewer Entrance", cSewers.id, {
      anchor_location_id: sump.id,
    });
    const chop = mkLoc("chop", "The Chop-Cathedral", null);
    const hatchF = mkEdge("h_f", sump.id, sewerEnt.id, "S", 25, {
      is_vertical: true,
      distance_mode: "locked",
    });
    const hatchR = mkEdge("h_r", sewerEnt.id, sump.id, "N", 25, {
      is_vertical: true,
      distance_mode: "locked",
    });
    const containers = [cNeon, cSewers];
    const allLocations = [sump, sewerEnt, chop];
    const report = analyzeSpatialConsistency({
      scopeContainerId: cSewers.id,
      containers,
      locations: allLocations,
      edges: [hatchF, hatchR],
    });

    const htmlContainerized = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={sewerEnt}
        selectedContainer={null}
        containers={containers}
        allLocations={allLocations}
        allEdges={[hatchF, hatchR]}
        dynamicPortalIds={new Set([sewerEnt.id])}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "L1", 2: "L2", 3: "L3", 4: "L4" }}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
        consistencyReport={report}
      />
    );
    expect(htmlContainerized).toContain("External Spatial Anchor");
    expect(htmlContainerized).toContain("The Sump-Well");
    expect(htmlContainerized).toContain("Pinned to");

    const htmlRoot = ReactDOMServer.renderToStaticMarkup(
      <MapDetailsDrawer
        mode="editor"
        selectedLocation={chop}
        selectedContainer={null}
        containers={containers}
        allLocations={allLocations}
        allEdges={[hatchF, hatchR]}
        dynamicPortalIds={new Set()}
        externalPortals={[]}
        containerStats={null}
        depthLabels={{ 1: "L1", 2: "L2", 3: "L3", 4: "L4" }}
        onClose={() => {}}
        onPatchLocation={() => {}}
        onPatchContainer={() => {}}
        onResetCoordinates={() => {}}
        onDrillIntoContainer={() => {}}
        consistencyReport={report}
      />
    );
    expect(htmlRoot).not.toContain('data-testid="location-anchor-picker"');
  });

  it("renders MapConsistencyPanel empty and issue states with Reconciliation CTA", () => {
    const emptyReport = {
      scopeContainerId: null,
      diagnostics: [],
      diagnosticsByEdgeId: {},
      anchorResolutions: {},
      proposedAdjustments: [],
      proposedByEdgeId: {},
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
    const emptySummary = {
      byScope: [{ containerId: null, label: "Root", report: emptyReport }],
      allDiagnostics: [],
      allProposedAdjustments: [],
      totalErrors: 0,
      totalWarnings: 0,
      totalInfos: 0,
    };
    const htmlOk = ReactDOMServer.renderToStaticMarkup(
      <MapConsistencyPanel
        isOpen
        currentContainerId={null}
        currentReport={emptyReport}
        worldSummary={emptySummary}
        isMutatingLocked={false}
        isPreviewingReconcile={false}
        autoSyncEnabled={false}
        onToggleAutoSync={() => {}}
        onStartReconcilePreview={() => {}}
        onApplySingleAdjustment={() => {}}
        onMarkNonEuclidean={() => {}}
        onJumpToDiagnostic={() => {}}
        onClose={() => {}}
      />
    );
    expect(htmlOk).toContain("All spatial distances are consistent.");
    expect(htmlOk).toContain("Auto-Sync Unlocked Links");
    expect(htmlOk).not.toContain("Preview Reconciliation");

    const adj = {
      edgeId: "e1",
      reciprocalEdgeId: "e1r",
      fromLocationId: "t1l",
      toLocationId: "t1m",
      fromName: "Tunnel 1-L",
      toName: "Tunnel 1-M",
      currentMeters: 140,
      proposedMeters: 1500,
      deltaMeters: 1360,
      scopeContainerId: "sewers",
    };
    const issueReport = {
      scopeContainerId: "sewers",
      diagnostics: [
        {
          pairKey: "t1l|t1m",
          primaryEdgeId: "e1",
          reciprocalEdgeId: "e1r",
          fromLocationId: "t1l",
          toLocationId: "t1m",
          fromName: "Tunnel 1-L",
          toName: "Tunnel 1-M",
          kind: "distance_mismatch" as const,
          severity: "warning" as const,
          currentMeters: 140,
          suggestedMeters: 1500,
          longitudinalErrorMeters: 1360,
          lateralErrorMeters: 0,
          message: "Tunnel 1-L ↔ Tunnel 1-M is 140m, expected ~1500m.",
          scopeContainerId: "sewers",
        },
      ],
      diagnosticsByEdgeId: {},
      anchorResolutions: {},
      proposedAdjustments: [adj],
      proposedByEdgeId: { e1: adj },
      errorCount: 0,
      warningCount: 1,
      infoCount: 0,
    };
    const htmlIssues = ReactDOMServer.renderToStaticMarkup(
      <MapConsistencyPanel
        isOpen
        currentContainerId="sewers"
        currentReport={issueReport}
        worldSummary={{
          byScope: [{ containerId: "sewers", label: "Sewers", report: issueReport }],
          allDiagnostics: issueReport.diagnostics,
          allProposedAdjustments: issueReport.proposedAdjustments,
          totalErrors: 0,
          totalWarnings: 1,
          totalInfos: 0,
        }}
        isMutatingLocked={false}
        isPreviewingReconcile={false}
        autoSyncEnabled={false}
        onToggleAutoSync={() => {}}
        onStartReconcilePreview={() => {}}
        onApplySingleAdjustment={() => {}}
        onMarkNonEuclidean={() => {}}
        onJumpToDiagnostic={() => {}}
        onClose={() => {}}
      />
    );
    expect(htmlIssues).toContain("Preview Reconciliation (1)");
    expect(htmlIssues).toContain("Use 1.5km");
    expect(htmlIssues).toContain("Portal");
  });

  it("sanitizes invalid anchors and applies reconciliation adjustments to both edge directions", () => {
    const cNeon = mkCont("c_neon", "The Neon Rust");
    const cSewers = mkCont("c_sewers", "Sewers");
    const sump = mkLoc("sump", "The Sump-Well", cNeon.id);
    const validLoc = mkLoc("ent", "Sewer Entrance", cSewers.id, {
      anchor_location_id: sump.id,
    });
    const sameContLoc = mkLoc("t1l", "Tunnel 1-L", cSewers.id, {
      anchor_location_id: validLoc.id,
    });
    const danglingLoc = mkLoc("t1m", "Tunnel 1-M", cSewers.id, {
      anchor_location_id: "missing_id",
    });

    const sanitized = sanitizeSnapshotAnchors(
      [cNeon, cSewers],
      [sump, validLoc, sameContLoc, danglingLoc]
    );
    expect(sanitized.find((l) => l.id === "ent")?.anchor_location_id).toBe(sump.id);
    expect(sanitized.find((l) => l.id === "t1l")?.anchor_location_id).toBeNull();
    expect(sanitized.find((l) => l.id === "t1m")?.anchor_location_id).toBeNull();

    const edges = [
      mkEdge("e1", "t1l", "t1m", "E", 140),
      mkEdge("e1r", "t1m", "t1l", "W", 140),
      mkEdge("e2", "ent", "t1l", "N", 1000),
    ];
    const { edges: adjusted, adjustedPairs } = applyAdjustmentsToEdges(edges, [
      {
        edgeId: "e1",
        reciprocalEdgeId: "e1r",
        fromLocationId: "t1l",
        toLocationId: "t1m",
        fromName: "Tunnel 1-L",
        toName: "Tunnel 1-M",
        currentMeters: 140,
        proposedMeters: 1500,
        deltaMeters: 1360,
        scopeContainerId: cSewers.id,
      },
    ]);
    expect(adjustedPairs).toBe(1);
    expect(adjusted.find((e) => e.id === "e1")?.distance_meters).toBe(1500);
    expect(adjusted.find((e) => e.id === "e1r")?.distance_meters).toBe(1500);
    expect(adjusted.find((e) => e.id === "e2")?.distance_meters).toBe(1000);
    // Keep vi referenced to satisfy unused-import lint if needed
    expect(typeof vi.fn).toBe("function");
  });
});
