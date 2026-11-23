import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("07 - Mobile Spatial Topology Map UX & Touch Ergonomics", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("opens expanded campaign map full-screen, pans via pointer drag, supports docked peek bar + details sheet, and hides desktop clutter", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.goto("/");

    // Open right inspector overlay drawer and launch Expand Map
    await page.getByRole("button", { name: "Show World & Mind Inspector" }).click();
    const expandMapBtn = page.getByRole("button", { name: /Expand Map/i });
    await expect(expandMapBtn).toBeVisible();
    await expandMapBtn.click();

    // 1. Verify full-screen portaled modal with zero horizontal overflow
    const modalPanel = page.locator(".map-fullscreen-modal-panel");
    await expect(modalPanel).toBeVisible();
    const panelBox = await modalPanel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeGreaterThanOrEqual(388);
    expect(panelBox!.height).toBeGreaterThanOrEqual(840);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);

    // 2. Verify desktop clutter is hidden while mobile controls + floating Center icon are visible
    await expect(page.locator(".map-canvas-zoom-pill")).toBeHidden();
    await expect(page.locator(".map-legend-desktop")).toBeHidden();
    await expect(page.locator(".map-palette-bar")).toBeHidden();

    const centerBtn = page.getByRole("button", {
      name: "Center on Selected / Active Location",
    });
    const legendBtn = page.getByRole("button", { name: "Toggle map legend" });
    const closeBtn = page.getByRole("button", { name: "Close Map" });
    await expect(centerBtn).toBeVisible();
    await expect(legendBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // 3. Verify docked Selection Peek Bar appears without overlapping Center icon, and expands to sheet
    const peekBar = page.locator(".map-mobile-peek-bar");
    await expect(peekBar).toBeVisible();
    const peekBox = await peekBar.boundingBox();
    const centerBox = await centerBtn.boundingBox();
    expect(peekBox).not.toBeNull();
    expect(centerBox).not.toBeNull();
    expect(centerBox!.y + centerBox!.height).toBeLessThanOrEqual(peekBox!.y + 2);

    await peekBar.getByRole("button", { name: "Open details" }).click();
    const detailsSheet = page.getByRole("dialog", {
      name: "Map Element Details Sheet",
    });
    await expect(detailsSheet).toBeVisible();
    const sheetBox = await detailsSheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.x).toBeGreaterThanOrEqual(0);
    expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(392);

    // Close details sheet back to peek bar
    await detailsSheet.getByRole("button", { name: "Close details" }).click();
    await expect(detailsSheet).toBeHidden();

    // 4. Pan the SVG canvas via pointer drag and verify transform updates
    const svg = modalPanel.locator(".map-canvas-wrap > svg").first();
    const viewportG = svg.locator("> g").first();
    const beforeTransform = await viewportG.getAttribute("transform");
    const svgBox = await svg.boundingBox();
    expect(svgBox).not.toBeNull();

    const startX = svgBox!.x + svgBox!.width * 0.5;
    const startY = svgBox!.y + svgBox!.height * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 90, startY + 60, { steps: 6 });
    await page.mouse.up();

    const afterPanTransform = await viewportG.getAttribute("transform");
    expect(afterPanTransform).not.toEqual(beforeTransform);

    // 5. Tap Center icon and verify transform recenters
    await centerBtn.click();
    const afterCenterTransform = await viewportG.getAttribute("transform");
    expect(afterCenterTransform).not.toEqual(afterPanTransform);

    // 6. Toggle mobile legend popover
    await legendBtn.click();
    const legendPopover = page.getByRole("dialog", { name: "Map Legend" });
    await expect(legendPopover).toBeVisible();
    await expect(legendPopover).toContainText("Drag to pan");
    await legendPopover.getByRole("button", { name: "Close map legend" }).click();
    await expect(legendPopover).toBeHidden();

    // 7. Close expanded map modal
    await closeBtn.click();
    await expect(modalPanel).toBeHidden();

    mock.assertNoPageErrors();
  });
});
