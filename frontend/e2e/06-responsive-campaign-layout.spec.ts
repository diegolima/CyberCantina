import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("06 - Responsive 3-Pane Campaign Layout & Mobile Drawers", () => {
  test("renders 3-pane desktop layout (1440x900), toggles sidebar rail, and opens/closes Party & Notes modals", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const leftSidebar = page.locator("#app-sidebar-aside");
    const chatStage = page.locator("main.chat-stage");
    const rightInspector = page.locator("#live-inspector-aside");

    await expect(leftSidebar).toBeVisible();
    await expect(chatStage).toBeVisible();
    await expect(rightInspector).toBeVisible();

    // 1. Collapse left sidebar to icon rail and expand it back
    await page
      .getByRole("button", { name: "Collapse sidebar to icon rail" })
      .click();
    await expect(leftSidebar).toHaveClass(/sidebar--rail/);

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(leftSidebar).not.toHaveClass(/sidebar--rail/);

    // 2. Open PartyManagementModal from sidebar and close it
    await leftSidebar
      .locator("button", { hasText: "Party" })
      .click();
    const partyDialog = page.getByRole("dialog", { name: "Party Management" });
    await expect(partyDialog).toBeVisible();
    await partyDialog
      .getByRole("button", { name: "Close Party Management" })
      .click();
    await expect(partyDialog).toBeHidden();

    // 3. Open Player Notes flyout from sidebar, verify starred note renders, and close with Escape
    await leftSidebar.locator(".sidebar-notes-btn").click();
    const noteCard = page.getByText("Sector 9 Drop Codes");
    await expect(noteCard).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(noteCard).toBeHidden();

    mock.assertNoPageErrors();
  });

  test("collapses sidebars on mobile viewport (390x844) and toggles slide-over navigation & inspector drawers", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const leftSidebar = page.locator("#app-sidebar-aside");
    const rightInspector = page.locator("#live-inspector-aside");

    // On mobile viewport, both sidebars start hidden
    await expect(leftSidebar).toHaveAttribute("aria-hidden", "true");
    await expect(rightInspector).toHaveAttribute("aria-hidden", "true");

    // 1. Open left navigation sidebar drawer via mobile topbar button
    const openNavBtn = page.getByRole("button", {
      name: "Open navigation sidebar",
    });
    await expect(openNavBtn).toBeVisible();
    await openNavBtn.click();

    await expect(leftSidebar).toHaveClass(/sidebar--overlay/);
    await expect(leftSidebar).not.toHaveAttribute("aria-hidden", "true");

    // Dismiss left overlay drawer with Escape
    await page.keyboard.press("Escape");
    await expect(leftSidebar).toHaveAttribute("aria-hidden", "true");

    // 2. Open right World & Mind Inspector drawer via mobile topbar button
    const openInspectorBtn = page.getByRole("button", {
      name: "Show World & Mind Inspector",
    });
    await expect(openInspectorBtn).toBeVisible();
    await openInspectorBtn.click();

    await expect(rightInspector).toHaveClass(/inspector--overlay/);
    await expect(rightInspector).not.toHaveAttribute("aria-hidden", "true");

    // Dismiss right overlay drawer with Escape
    await page.keyboard.press("Escape");
    await expect(rightInspector).toHaveAttribute("aria-hidden", "true");

    mock.assertNoPageErrors();
  });
});
