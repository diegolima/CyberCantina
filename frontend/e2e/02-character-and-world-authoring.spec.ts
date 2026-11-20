import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("02 - Character Inspector, TagChipsInput & World Codex Authoring", () => {
  test("preserves multi-word spaces in TagChipsInput, manages chips via Enter/comma/Backspace, adds inventory, and saves character", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
    });

    await page.goto("/");
    await expect(
      page.getByText("Control Deck", { exact: true })
    ).toBeVisible();

    // Open Characters catalog picker and inspect Kira Vance
    await page.locator(".home-card", { hasText: "Characters" }).click();
    await expect(page.getByText("Select Character")).toBeVisible();
    await page.getByRole("button", { name: "Inspect" }).first().click();

    // Verify CharacterInspectorModal opens on Base tab with stable sheet dimensions
    const charModal = page.locator(".modal-panel", { hasText: "Character Sheet" });
    await expect(charModal).toBeVisible();
    const initialCharBox = await charModal.boundingBox();
    expect(initialCharBox).toBeTruthy();
    await expect(page.getByText("Demographics & Identity")).toBeVisible();

    // Verify switching to sparse Memories tab preserves modal dimensions
    await page.getByRole("tab", { name: /Memories/i }).click();
    expect(await charModal.boundingBox()).toEqual(initialCharBox);
    await page.getByRole("tab", { name: /^Base$/i }).click();
    expect(await charModal.boundingBox()).toEqual(initialCharBox);

    // Populate multi-line Creator Notes, then verify clicking it does not shrink width/height
    // and clicking directly onto Initial Message below opens Initial Message cleanly.
    const creatorNotesGroup = charModal.locator(".field-group", {
      hasText: "Creator Notes (Built-in usage notes; viewable in User Notes)",
    });
    const initialMsgGroup = charModal.locator(".field-group", {
      hasText: "Initial Message (Turn 0 Opening Scene Prose)",
    });

    await creatorNotesGroup.locator(".editable-field-box").click();
    await creatorNotesGroup
      .locator("textarea")
      .fill(
        "Line 1: Keep Kira guarded during initial meet.\nLine 2: Emphasize encrypted courier jargon.\nLine 3: Reveal Sovereign cipher only on high trust.\nLine 4: Reference Booth 4 surveillance feeds.\nLine 5: Prefer terse replies under stress."
      );
    await creatorNotesGroup.locator("textarea").blur();

    const notesBoxBefore = await creatorNotesGroup
      .locator(".editable-field-box")
      .boundingBox();
    expect(notesBoxBefore).toBeTruthy();

    await creatorNotesGroup.locator(".editable-field-box").click();
    const notesTextareaAfter = await creatorNotesGroup
      .locator("textarea")
      .boundingBox();
    expect(notesTextareaAfter).toBeTruthy();
    expect(Math.abs(notesTextareaAfter!.width - notesBoxBefore!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(notesTextareaAfter!.height - notesBoxBefore!.height)).toBeLessThanOrEqual(2);

    // Click directly on Initial Message below while Creator Notes is open for editing
    await initialMsgGroup.locator(".editable-field-box").click();
    await expect(initialMsgGroup.locator("textarea")).toBeFocused();
    await initialMsgGroup.locator("textarea").press("Escape");

    // Locate Character Tags TagChipsInput on Base tab (has 2 existing tags: fixer, broker)
    const tagInput = page.locator(".tag-chips-inline-input").first();
    await expect(tagInput).toBeVisible();

    // Type a multi-word tag containing spaces and verify the space is NOT stripped mid-typing
    await tagInput.fill("cybernetic arm");
    await expect(tagInput).toHaveValue("cybernetic arm");

    // Commit chip with Enter
    await tagInput.press("Enter");
    await expect(tagInput).toHaveValue("");
    await expect(
      page.locator(".tag-chip-pill", { hasText: "cybernetic arm" })
    ).toBeVisible();

    // Commit a second chip with comma key
    await tagInput.fill("shadow broker");
    await tagInput.press(",");
    await expect(tagInput).toHaveValue("");
    await expect(
      page.locator(".tag-chip-pill", { hasText: "shadow broker" })
    ).toBeVisible();

    // Press Backspace on empty input to remove the last committed chip ("shadow broker")
    await tagInput.press("Backspace");
    await expect(
      page.locator(".tag-chip-pill", { hasText: "shadow broker" })
    ).toBeHidden();
    await expect(
      page.locator(".tag-chip-pill", { hasText: "cybernetic arm" })
    ).toBeVisible();

    // Switch to Inventory tab and add a new equipped item
    await page.getByRole("tab", { name: /Inventory/i }).click();
    expect(await charModal.boundingBox()).toEqual(initialCharBox);
    await expect(
      page.getByText(/Equipped Attire & Gear \(1\)/i)
    ).toBeVisible();
    await page.getByRole("button", { name: /Add Equipped/i }).click();
    await expect(
      page.getByText(/Equipped Attire & Gear \(2\)/i)
    ).toBeVisible();
    await expect(page.getByText("New equipped attire")).toBeVisible();

    // Save changes and verify outbound PUT /api/characters/char_kira payload
    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    await expect
      .poll(() =>
        mock.requests.find(
          (r) => r.method === "PUT" && r.pathname === "/api/characters/char_kira"
        )
      )
      .toBeTruthy();

    const putReq = mock.requests.find(
      (r) => r.method === "PUT" && r.pathname === "/api/characters/char_kira"
    );
    expect(putReq?.body.tags).toEqual(["fixer", "broker", "cybernetic arm"]);
    expect(putReq?.body.equipped).toHaveLength(2);

    mock.assertNoPageErrors();
  });

  test("searches and authors world lore entries and inspects locations inside WorldCodexTab", async ({
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

    // Verify WorldInspectorModal opens at wide 1120px sheet width and stays identical across tabs
    const worldModal = page.locator(".modal-panel", { hasText: "World Sheet" });
    await expect(worldModal).toBeVisible();
    const initialWorldBox = await worldModal.boundingBox();
    expect(initialWorldBox).toBeTruthy();
    expect(initialWorldBox?.width).toBe(1120);

    // Switch to Map and Codex tabs inside WorldInspectorModal and confirm zero resize
    await page.locator(".modal-tab-btn", { hasText: "Map" }).click();
    expect(await worldModal.boundingBox()).toEqual(initialWorldBox);
    await page.locator(".modal-tab-btn", { hasText: "Codex" }).click();
    expect(await worldModal.boundingBox()).toEqual(initialWorldBox);
    await expect(page.getByText(/World Codex \(2\)/i)).toBeVisible();

    // Global quick-search in Codex Hub transitions to 2-Pane Search Results
    const globalSearch = page.getByPlaceholder(
      "Search Codex titles, keywords, or content..."
    );
    await globalSearch.fill("Sovereign");
    await expect(page.getByText(/Search Results \(1\)/i)).toBeVisible();
    await expect(
      page.locator(".codex-list-row", { hasText: "The Sovereign Cipher" })
    ).toBeVisible();

    // Return to All Categories Hub
    await page.getByRole("button", { name: /All Categories/i }).click();
    await expect(page.getByText(/World Codex \(2\)/i)).toBeVisible();

    // Click "+ Add Entry" to create a new lore node, verify title auto-focuses, and populate fields
    await page.getByRole("button", { name: /Add Entry/i }).click();
    const titleInput = page.getByPlaceholder("Entry title...");
    await expect(titleInput).toBeFocused();
    await titleInput.fill("The Drain Syndicate");
    const keywordInput = page
      .locator(".codex-root")
      .getByPlaceholder("Add keyword & press Enter...");
    await keywordInput.click();
    await keywordInput.fill("syndicate");
    await keywordInput.press("Enter");
    await expect(
      page.locator(".codex-root .tag-chip-pill", { hasText: "syndicate" })
    ).toBeVisible();
    await page
      .getByPlaceholder(
        "Describe origins, significance, and impact on the world..."
      )
      .fill("Controls the water filtration sluices beneath Sector 9.");

    // Save world changes and verify PUT /api/worlds/world_green_lie payload includes the 3rd lore node
    await page.getByRole("button", { name: /Save Changes/i }).click();

    await expect
      .poll(() =>
        mock.requests.find(
          (r) =>
            r.method === "PUT" && r.pathname === "/api/worlds/world_green_lie"
        )
      )
      .toBeTruthy();

    const putWorldReq = mock.requests.find(
      (r) => r.method === "PUT" && r.pathname === "/api/worlds/world_green_lie"
    );
    expect(putWorldReq?.body.lore_nodes).toHaveLength(3);
    expect(
      putWorldReq?.body.lore_nodes.some(
        (l: any) =>
          l.title === "The Drain Syndicate" &&
          l.entity_tags.includes("syndicate")
      )
    ).toBe(true);

    mock.assertNoPageErrors();
  });
});
