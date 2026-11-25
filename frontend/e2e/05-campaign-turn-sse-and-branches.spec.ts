import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("05 - Live Campaign SSE Turn Streaming, Cognition, Arrival Cards & Branch Swipes", () => {
  test("renders Turn 0 arrival card, switches sibling branch swipes (v1/v2), and stashes/restores composer draft during Turn Edit", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.goto("/");
    const textarea = page.locator(".composer-textarea");
    await expect(textarea).toBeVisible();

    // 1. Verify Turn 0 StandaloneArrivalCard ("Scene Opening") is rendered and expandable
    const arrivalCard = page.locator(".arrival-turn-card").first();
    await expect(arrivalCard).toBeVisible();
    await expect(arrivalCard).toContainText("Scene Opening");
    await arrivalCard.locator(".arrival-turn-header-toggle").click();
    await expect(
      arrivalCard.getByText(
        /Subterranean dive cantina frequented by splicers and couriers/i
      )
    ).toBeVisible();

    // 2. Verify Turn #1 has segmented swipe switcher (v1/2) and switch to v2 via comparison popover
    await expect(
      page.getByText(/Clean checksum\. You might actually survive the night/i)
    ).toBeVisible();
    const swipeTrigger = page.locator(".turn-swipe-trigger-btn");
    await expect(swipeTrigger).toBeVisible();
    await expect(swipeTrigger).toContainText("v1/2");
    await swipeTrigger.click();

    const swipePopover = page.locator(".turn-swipe-popover");
    await expect(swipePopover).toBeVisible();
    const v2Option = swipePopover.getByRole("option", { name: /v2/i });
    await expect(v2Option).toBeVisible();
    await v2Option.click();

    await expect(swipeTrigger).toContainText("v2/2");

    await expect(
      page.getByText(/Half now, half when the tunnel hatch opens/i)
    ).toBeVisible();
    expect(
      mock.requests.some(
        (r) =>
          r.method === "POST" &&
          r.pathname === "/api/campaigns/camp_1/checkout" &&
          r.body?.turn_id === "turn_1_alt"
      )
    ).toBe(true);

    // 3. Type an unsent draft in the composer, enter Edit mode on Turn #1, and cancel via Escape
    await textarea.fill("Draft action before editing");
    await page.getByRole("button", { name: /^Edit$/i }).click();

    // Composer now holds the edited turn's user_message
    await expect(textarea).toHaveValue(
      "I keep the chip in my pocket and ask for payment first."
    );

    // Press Escape to cancel editing and verify the stashed draft is restored
    await textarea.press("Escape");
    await expect(textarea).toHaveValue("Draft action before editing");

    mock.assertNoPageErrors();
  });

  test("streams a new turn over SSE, renders Turn #2 prose, and expands collapsible character cognition", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.goto("/");
    const textarea = page.locator(".composer-textarea");
    await expect(textarea).toBeVisible();

    // Submit a new player turn
    await textarea.fill("Tell me about the Cooling Tunnels.");
    await textarea.press("Enter");

    // Verify SSE stream endpoint was called and Turn #2 prose renders
    await expect(
      page.getByText(/Watch the third pressure valve—it vents scalding steam/i)
    ).toBeVisible();
    await expect(
      page.locator(".turn-feed").getByText("Turn #2")
    ).toBeVisible();
    await expect(
      page.locator(".stage-clock-cluster .stage-turn-btn")
    ).toContainText("Turn #2");

    const streamReq = mock.requests.find(
      (r) =>
        r.method === "POST" &&
        r.pathname === "/api/campaigns/camp_1/turns/stream"
    );
    expect(streamReq).toBeTruthy();
    expect(streamReq?.body.user_message).toBe(
      "Tell me about the Cooling Tunnels."
    );

    // Expand/collapse Kira Vance's Inner Cognition drawer on Turn #2 (default-expanded on desktop)
    const lastCognitionHeader = page.locator(".cognition-header").last();
    await expect(lastCognitionHeader).toContainText(
      "Kira Vance Inner Cognition"
    );

    const cognitionWant = page.getByText(
      /Offer the tunnel route if they agree to split the cipher payout/i
    );
    const cognitionPlan = page.getByText(
      /Project the tunnel schematics onto the holo-table/i
    );
    await expect(cognitionWant).toBeVisible();
    await expect(cognitionPlan).toBeVisible();

    await lastCognitionHeader.click();
    await expect(cognitionWant).not.toBeVisible();
    await expect(cognitionPlan).not.toBeVisible();

    await lastCognitionHeader.click();
    await expect(cognitionWant).toBeVisible();
    await expect(cognitionPlan).toBeVisible();

    mock.assertNoPageErrors();
  });
});
