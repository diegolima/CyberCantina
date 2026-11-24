import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("03 - Interactive SVG Map Topology Canvas (SpatialTopologyView)", () => {
  test("selects nodes, edits edge distance via screen-space HTML inline overlay, guards Delete in inputs, and supports hover X quick-delete + Undo", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Open Worlds catalog picker and inspect The Green Lie
    await page.locator(".home-card", { hasText: "Worlds" }).click();
    await expect(page.getByText("Select World")).toBeVisible();
    await page.getByRole("button", { name: "Inspect" }).first().click();

    // Switch to Map tab
    await page.locator(".modal-tab-btn", { hasText: "Map" }).click();
    await expect(
      page.getByText(/The Green Lie — Spatial Topology/i)
    ).toBeVisible();

    // Verify Main Floor and Ripperdoc Clinic nodes are rendered inside The Neon Rust container view
    const mainFloorNode = page.locator(
      'g[data-node-kind="location"][data-node-id="loc_main_floor"]'
    );
    const clinicNode = page.locator(
      'g[data-node-kind="location"][data-node-id="loc_clinic"]'
    );
    await expect(mainFloorNode).toBeVisible();
    await expect(clinicNode).toBeVisible();

    // 1. Attempt to delete Starting Location (Main Floor) via Delete key -> verify block notice
    await page.keyboard.press("Delete");
    await expect(
      page
        .locator(".map-canvas-wrap")
        .getByText(/Reassign Starting Location before deleting this location/i)
    ).toBeVisible();
    await expect(mainFloorNode).toBeVisible();

    // 2. Select Ripperdoc Clinic node and verify focus guard on Delete key when an input is focused
    await clinicNode.click();
    const drawerNameInput = page
      .locator('input[value="Ripperdoc Clinic"]')
      .first();
    await expect(drawerNameInput).toBeVisible();
    await drawerNameInput.focus();
    await page.keyboard.press("Delete");
    // Ripperdoc Clinic node must NOT be deleted when an input is focused
    await expect(clinicNode).toBeVisible();

    // 3. Shift-click "350m" badge to toggle walking-time preview ("~5 min"), Shift-click back, and double-click to edit
    const badge350m = page
      .locator('g[data-layer="edge-badges"] > g', { hasText: "350m" })
      .first();
    await expect(badge350m).toBeVisible();
    await badge350m.click({ modifiers: ["Shift"] });
    const badge5min = page
      .locator('g[data-layer="edge-badges"] > g[data-badge-mode="time"]', {
        hasText: "~5 min",
      })
      .first();
    await expect(badge5min).toBeVisible();
    await badge5min.click({ modifiers: ["Shift"] });
    await expect(badge350m).toBeVisible();
    await badge350m.dblclick();

    const inlineOverlay = page.locator('[data-layer="inline-edge-editor"]');
    await expect(inlineOverlay).toBeVisible();

    const distanceInput = inlineOverlay.getByLabel("Distance in meters", {
      exact: true,
    });
    await expect(distanceInput).toBeFocused();
    await expect(distanceInput).toHaveValue("350");

    // Click "+25m" adaptive stepper button (onMouseDown preventDefault keeps overlay alive)
    await inlineOverlay.getByLabel("Increase distance").click();
    await expect(distanceInput).toHaveValue("375");

    // Type "1.5km" shorthand (>240m uncapped) and press Enter to commit
    await distanceInput.fill("1.5km");
    await distanceInput.press("Enter");
    await expect(inlineOverlay).toBeHidden();

    // Verify badge updated to "1.5km" and Undo stack recorded 1 snapshot
    const badge15km = page
      .locator('g[data-layer="edge-badges"] > g', { hasText: "1.5km" })
      .first();
    await expect(badge15km).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Undo \(1\)/i })
    ).toBeVisible();

    // 4. Hover the "1.5km" distance badge in editor mode and click the top-right "X" quick-delete button
    await badge15km.hover();
    const quickDeleteBtn = page.locator("[data-edge-quick-delete]").first();
    await expect(quickDeleteBtn).toBeVisible();
    await quickDeleteBtn.click();

    // Edge is removed immediately without a confirmation modal; Undo count becomes 2
    await expect(badge15km).toBeHidden();
    const undoBtn = page.getByRole("button", { name: /Undo \(2\)/i });
    await expect(undoBtn).toBeVisible();

    // 5. Click Undo to restore the deleted edge in a single snapshot
    await undoBtn.click();
    await expect(badge15km).toBeVisible();
    await expect(page.getByText("Reverted last map action.")).toBeVisible();

    mock.assertNoPageErrors();
  });

  test("searches locations and containers across depths, requires Enter/click to jump, and opens containers from an inside viewpoint", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await page.locator(".home-card", { hasText: "Worlds" }).click();
    await page.getByRole("button", { name: "Inspect" }).first().click();
    await page.locator(".modal-tab-btn", { hasText: "Map" }).click();

    const mapTitle = page.getByText(/The Green Lie — Spatial Topology/i);
    await expect(mapTitle).toBeVisible();

    const searchInput = page.getByRole("combobox", {
      name: "Search locations and containers",
    });
    await expect(searchInput).toBeVisible();

    const mainFloorNode = page.locator(
      'g[data-node-kind="location"][data-node-id="loc_main_floor"]'
    );
    const tunnelsNode = page.locator(
      'g[data-node-kind="location"][data-node-id="loc_tunnels"]'
    );
    await expect(mainFloorNode).toBeVisible();

    // 1. Typing full location name shows dropdown match without auto-jumping prematurely
    await searchInput.fill("Cooling Tunnels");
    const tunnelsOption = page.locator('[data-map-search-option="loc_tunnels"]');
    await expect(tunnelsOption).toBeVisible();
    await expect(tunnelsOption).toContainText("Sector 9: The Drain");
    await expect(mainFloorNode).toBeVisible();

    // 2. Pressing Enter commits the match, switches container scope, selects Cooling Tunnels, and clears input
    await searchInput.press("Enter");
    await expect(searchInput).toHaveValue("");
    await expect(tunnelsOption).toBeHidden();
    await expect(tunnelsNode).toBeVisible();
    await expect(
      page.locator('input[value="Cooling Tunnels"]').first()
    ).toBeVisible();

    // 3. Searching and clicking a container adopts its "inside" viewpoint showing child locations
    await searchInput.fill("Neon");
    const neonOption = page.locator('[data-map-search-option="cont_neon_rust"]');
    await expect(neonOption).toBeVisible();
    await expect(neonOption).toContainText("L1");
    await neonOption.click();

    await expect(searchInput).toHaveValue("");
    await expect(mainFloorNode).toBeVisible();
    await expect(
      page.locator('g[data-node-kind="location"][data-node-id="loc_clinic"]')
    ).toBeVisible();

    // 4. Typing inside search guards Delete and Escape clears dropdown without closing modal
    await searchInput.fill("Main");
    await expect(
      page.locator('[data-map-search-option="loc_main_floor"]')
    ).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(mainFloorNode).toBeVisible();

    await searchInput.press("Escape");
    await expect(searchInput).toHaveValue("");
    await expect(
      page.locator('[data-map-search-option="loc_main_floor"]')
    ).toBeHidden();
    await expect(mapTitle).toBeVisible();

    mock.assertNoPageErrors();
  });
});
