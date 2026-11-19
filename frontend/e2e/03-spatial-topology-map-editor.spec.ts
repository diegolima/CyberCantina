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
      page.getByText(/Reassign Starting Location before deleting this location/i)
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

    // 3. Double-click the "5m" edge distance badge to open the screen-space HTML inline editor overlay
    const badge5m = page
      .locator('g[data-layer="edge-badges"] > g', { hasText: "5m" })
      .first();
    await expect(badge5m).toBeVisible();
    await badge5m.dblclick();

    const inlineOverlay = page.locator('[data-layer="inline-edge-editor"]');
    await expect(inlineOverlay).toBeVisible();

    const minutesInput = inlineOverlay.getByLabel("Travel minutes", {
      exact: true,
    });
    await expect(minutesInput).toBeFocused();
    await expect(minutesInput).toHaveValue("5");

    // Click "+1m" stepper button (onMouseDown preventDefault keeps overlay alive)
    await inlineOverlay.getByLabel("Increase travel minutes").click();
    await expect(minutesInput).toHaveValue("6");

    // Type "12" and press Enter to commit
    await minutesInput.fill("12");
    await minutesInput.press("Enter");
    await expect(inlineOverlay).toBeHidden();

    // Verify badge updated to "12m" and Undo stack recorded 1 snapshot
    const badge12m = page
      .locator('g[data-layer="edge-badges"] > g', { hasText: "12m" })
      .first();
    await expect(badge12m).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Undo \(1\)/i })
    ).toBeVisible();

    // 4. Hover the "12m" distance badge in editor mode and click the top-right "X" quick-delete button
    await badge12m.hover();
    const quickDeleteBtn = page.locator("[data-edge-quick-delete]").first();
    await expect(quickDeleteBtn).toBeVisible();
    await quickDeleteBtn.click();

    // Edge is removed immediately without a confirmation modal; Undo count becomes 2
    await expect(badge12m).toBeHidden();
    const undoBtn = page.getByRole("button", { name: /Undo \(2\)/i });
    await expect(undoBtn).toBeVisible();

    // 5. Click Undo to restore the deleted edge in a single snapshot
    await undoBtn.click();
    await expect(badge12m).toBeVisible();
    await expect(page.getByText("Reverted last map action.")).toBeVisible();

    mock.assertNoPageErrors();
  });
});
