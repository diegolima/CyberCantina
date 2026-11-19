import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("01 - Auth Gate, Admin Banners, Home Catalog & Browser Credential Vault", () => {
  test("validates login form, renders & dismisses admin banners, and signs in to Control Deck", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "login_required",
    });

    await page.goto("/");

    // Verify login screen & login-scoped admin message banner
    await expect(page.getByText("Sign In to CyberCantina")).toBeVisible();
    await expect(page.getByText("Grid Maintenance Notice")).toBeVisible();
    await expect(
      page.getByText("Sub-grid relay 9 is running on backup power tonight.")
    ).toBeVisible();

    // Empty username submit triggers client validation alert
    await page.locator("form button[type='submit']").click();
    await expect(page.locator("#auth-form-error")).toContainText(
      "Username is required."
    );

    // Fill username + password and toggle password reveal button
    const usernameInput = page.locator("#auth-username");
    const passwordInput = page.locator("#auth-password");
    await usernameInput.fill("runner");
    await passwordInput.fill("cyber-secret");
    await expect(passwordInput).toHaveAttribute("type", "password");

    const revealBtn = page.getByRole("button", { name: /Show password/i });
    await revealBtn.click();
    await expect(passwordInput).toHaveAttribute("type", "text");

    // Submit login form and verify transition to HomeScreen ("Control Deck")
    await page.locator("form button[type='submit']").click();
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Deck Runner")).toBeVisible();

    // Verify home-scoped admin announcement banner and dismiss it
    const homeBanner = page.getByText("Welcome to CyberCantina v0.22");
    await expect(homeBanner).toBeVisible();
    await page
      .locator(".home-admin-msg-stack")
      .getByRole("button", { name: /Dismiss/i })
      .click();
    await expect(homeBanner).toBeHidden();

    mock.assertNoPageErrors();
  });

  test("filters Home catalog pickers and launches a new campaign via NewCampaignModal", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Open Characters catalog picker from HomeScreen card
    await page.locator(".home-card", { hasText: "Characters" }).click();
    await expect(page.getByText("Select Character")).toBeVisible();
    await expect(page.getByText("Kira Vance")).toBeVisible();
    await expect(page.getByText("Yulia Halim")).toBeVisible();

    // Filter characters by search input
    const searchInput = page.getByPlaceholder("Search characters...");
    await searchInput.fill("Yulia");
    await expect(page.getByText("Yulia Halim")).toBeVisible();
    await expect(page.getByText("Kira Vance")).toBeHidden();

    // Close picker
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Select Character")).toBeHidden();

    // Launch New Campaign wizard from Campaigns card "+ New Campaign" shelf
    await page
      .locator(".home-card", { hasText: "Campaigns" })
      .getByText("New Campaign")
      .click();

    const campModal = page.locator(".modal-panel").first();
    await expect(campModal).toBeVisible();

    // Step 1 -> Step 2 (Characters) -> Step 3 (Focus & Preview)
    await campModal.getByRole("button", { name: /Next/i }).click();
    await expect(campModal.getByText("Kira Vance")).toBeVisible();
    await campModal.getByRole("button", { name: /Next/i }).click();

    // Step 3: toggle Character Greeting focus and expand Opening Scene Preview
    await campModal.getByText("Character Greeting").click();
    await campModal.getByText("Opening Scene Preview (Turn 0)").click();
    await expect(
      campModal.getByText(/You're three minutes late/i)
    ).toBeVisible();

    // Launch Campaign and verify navigation into active campaign ChatStage
    await campModal.getByRole("button", { name: /Launch Campaign/i }).click();
    await expect(page.locator(".composer-textarea")).toBeVisible();

    const createReq = mock.requests.find(
      (r) => r.method === "POST" && r.pathname === "/api/campaigns"
    );
    expect(createReq).toBeTruthy();
    expect(createReq?.body.start_focus).toBe("character");

    mock.assertNoPageErrors();
  });

  test("stores user provider API key in browser credential vault without sending plaintext to server", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Open Profile Modal -> Preferences -> Providers
    await page.locator(".home-nav-profile-chip").click();
    const profileModal = page.locator(".modal-panel", {
      hasText: "User Profile & Preferences",
    });
    await expect(profileModal).toBeVisible();

    await profileModal.getByRole("button", { name: /Preferences/i }).click();
    await profileModal.getByRole("button", { name: /Providers/i }).click();

    // Click "+ Add Provider"
    await profileModal.getByRole("button", { name: /Add Provider/i }).click();

    // Select OpenRouter (Cloud API)
    await profileModal
      .getByRole("button", { name: /OpenRouter \(Cloud API\)/i })
      .click();

    // Verify "Store in Browser only" is checked by default under prefer_browser policy
    const browserCheckbox = profileModal
      .locator("label", { hasText: "Store in Browser only" })
      .locator("input[type='checkbox']");
    await expect(browserCheckbox).toBeChecked();

    // Enter API key and save provider
    await profileModal
      .getByPlaceholder("sk-or-v1-...")
      .fill("sk-or-v1-e2e-browser-vault-key");
    await profileModal
      .locator(".provider-editor")
      .getByRole("button", { name: /Add provider/i })
      .click();
    await expect(profileModal.locator(".provider-editor")).toBeHidden();

    // Assert POST /api/providers had credential_storage="browser" and did NOT transmit bearer_token
    const postProv = mock.requests.find(
      (r) => r.method === "POST" && r.pathname === "/api/providers"
    );
    expect(postProv).toBeTruthy();
    expect(postProv?.body.credential_storage).toBe("browser");
    expect(postProv?.body.settings?.bearer_token).toBeNull();

    // Verify key is persisted in browser localStorage under cantina_provider_cred:<userId>:<providerId>
    const storedCred = await page.evaluate(() =>
      window.localStorage.getItem("cantina_provider_cred:user_1:prov_user_2")
    );
    expect(storedCred).toBe("sk-or-v1-e2e-browser-vault-key");

    mock.assertNoPageErrors();
  });
});
