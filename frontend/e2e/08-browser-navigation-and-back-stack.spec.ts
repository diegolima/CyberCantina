import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("08 - Browser Navigation & Overlay Back-Stack", () => {
  test("Workflow 1: launching a campaign updates URL to /campaigns/:id and Back/Forward navigates between Home and Campaign", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Open Campaigns picker and select existing camp_1
    await page.locator(".home-card", { hasText: "Campaigns" }).click();
    await expect(page.getByText("Select Campaign")).toBeVisible();
    await page.getByText("Operation Glass Horizon").click();

    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);
    await expect(page.locator(".composer-textarea")).toBeVisible();

    // Browser Back returns to CyberCantina Home (/) instead of leaving the app
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Browser Forward returns to /campaigns/camp_1
    await page.goForward();
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);
    await expect(page.locator(".composer-textarea")).toBeVisible();

    // In-app "Close Campaign" navigates to / via pushState
    await page.getByRole("button", { name: "Close Campaign" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    mock.assertNoPageErrors();
  });

  test("Workflow 2: Back dismisses Character sheet opened via Home -> Characters without exiting app, and Forward never resurrects closed modals", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Home -> Characters picker -> Character sheet
    await page.locator(".home-card", { hasText: "Characters" }).click();
    await expect(page.getByText("Select Character")).toBeVisible();
    await page.getByText("Kira Vance").click();

    const sheetPanel = page.locator(".modal-panel", { hasText: "Kira Vance" });
    await expect(sheetPanel).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // First Back dismisses CharacterInspectorModal and keeps user on CyberCantina Home
    await page.goBack();
    await expect(sheetPanel).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Forward after closing modal must NOT resurrect the closed modal
    await page.goForward();
    await expect(sheetPanel).toBeHidden();
    await expect(page.getByText("Select Character")).toBeHidden();

    // Also verify X close + Forward hygiene on HomeEntityPickerModal
    await page.locator(".home-card", { hasText: "Worlds" }).click();
    await expect(page.getByText("Select World")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Select World")).toBeHidden();

    await page.goForward();
    await expect(page.getByText("Select World")).toBeHidden();

    mock.assertNoPageErrors();
  });

  test("unwinds stacked overlays LIFO on mobile campaign view (drawer -> fullscreen map -> Back -> Back -> stay in campaign)", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);

    const rightInspector = page.locator("#live-inspector-aside");
    await expect(rightInspector).toHaveAttribute("aria-hidden", "true");

    // 1. Open right World & Mind Inspector overlay drawer
    await page.getByRole("button", { name: "Show World & Mind Inspector" }).click();
    await expect(rightInspector).not.toHaveAttribute("aria-hidden", "true");

    // 2. Open Full Spatial Topology modal on top of the mobile drawer
    await rightInspector
      .getByRole("button", { name: /Full Map|Expand/i })
      .first()
      .click();
    const fullMapModal = page.locator(".map-fullscreen-modal-panel");
    await expect(fullMapModal).toBeVisible();

    // First Back closes fullscreen map while drawer remains open
    await page.goBack();
    await expect(fullMapModal).toBeHidden();
    await expect(rightInspector).not.toHaveAttribute("aria-hidden", "true");
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);

    // Second Back closes mobile drawer while staying inside /campaigns/camp_1
    await page.goBack();
    await expect(rightInspector).toHaveAttribute("aria-hidden", "true");
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);
    await expect(page.locator(".composer-textarea")).toBeVisible();

    mock.assertNoPageErrors();
  });

  test("guards dirty CharacterInspectorModal edits on Back (Stay preserves edits, Discard closes)", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await page.locator(".home-card", { hasText: "Characters" }).click();
    await page.getByText("Kira Vance").click();

    const sheetPanel = page.locator(".modal-panel", { hasText: "Kira Vance" });
    await expect(sheetPanel).toBeVisible();

    // Mark dirty via Home World Association select
    await sheetPanel.locator("select").first().selectOption("");

    // Back triggers NavigationGuardModal
    await page.goBack();
    const guardDialog = page.locator(".nav-guard-panel");
    await expect(guardDialog).toBeVisible();
    await expect(guardDialog).toContainText("Discard unsaved character changes?");

    // Stay keeps modal open
    await guardDialog.getByRole("button", { name: "Stay" }).click();
    await expect(guardDialog).toBeHidden();
    await expect(sheetPanel).toBeVisible();

    // Back again + Discard closes modal cleanly
    await page.goBack();
    await expect(guardDialog).toBeVisible();
    await guardDialog.getByRole("button", { name: "Discard" }).click();
    await expect(guardDialog).toBeHidden();
    await expect(sheetPanel).toBeHidden();
    await expect(page).toHaveURL(/\/$/);

    mock.assertNoPageErrors();
  });

  test("guards Back navigation when an active turn is streaming (isStreaming)", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    // Hold the SSE stream open long enough to trigger Back mid-stream
    let streamEntered!: () => void;
    const streamEnteredPromise = new Promise<void>((resolve) => {
      streamEntered = resolve;
    });
    await page.route("**/api/campaigns/camp_1/turns/stream", async (route) => {
      streamEntered();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: done\ndata: {}\n\n",
      });
    });

    await page.goto("/");
    await page.locator(".home-card", { hasText: "Campaigns" }).click();
    await page.getByText("Operation Glass Horizon").click();
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);

    const textarea = page.locator(".composer-textarea");
    await textarea.fill("Check the perimeter.");
    await textarea.press("Enter");
    await streamEnteredPromise;

    // Trigger Back while streaming
    await page.goBack();
    const guardDialog = page.locator(".nav-guard-panel");
    await expect(guardDialog).toBeVisible();
    await expect(guardDialog).toContainText("Leave active campaign?");

    // Confirm Leave Campaign -> returns to Home /
    await guardDialog.getByRole("button", { name: "Leave Campaign" }).click();
    await expect(guardDialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    mock.assertNoPageErrors();
  });

  test("preserves /campaigns/:id deep-link across login and falls back to / on missing campaign", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "login_required",
    });

    await page.goto("/campaigns/camp_1");
    await expect(page.getByText("Sign In to CyberCantina")).toBeVisible();
    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);

    await page.locator("#auth-username").fill("runner");
    await page.locator("#auth-password").fill("cyber-secret");
    await page.locator("form button[type='submit']").click();

    await expect(page).toHaveURL(/\/campaigns\/camp_1$/);
    await expect(page.locator(".composer-textarea")).toBeVisible();

    // Invalid campaign deep-link falls back to / with non-blocking notice
    await page.goto("/campaigns/nonexistent_camp");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".home-route-notice")).toBeVisible();

    mock.assertNoPageErrors();
  });
});
