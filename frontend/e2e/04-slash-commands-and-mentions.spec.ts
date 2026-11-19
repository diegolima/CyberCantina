import { expect, test } from "@playwright/test";
import { installCantinaApiMock } from "./fixtures/cantinaApiMock";

test.describe("04 - Composer Slash Command Autocomplete, Inline Pills & @Mention Handoff", () => {
  test("triggers Stage-1 / autocomplete only on line 1, commits inline pills, hands off Stage-2 /party to @Mention picker, and performs atomic Backspace", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.goto("/");
    const textarea = page.locator(".composer-textarea");
    await expect(textarea).toBeVisible();

    // 1. Line-2 guard: typing "/" on line 2 must NOT open SlashCommandPicker
    await textarea.fill("Hello Kira\n/");
    await expect(page.locator(".slash-picker-popover")).toBeHidden();

    // 2. Typing "/" at index 0 on line 1 opens Stage-1 alphabetical SlashCommandPicker
    await textarea.fill("/");
    const slashPopover = page.locator(".slash-picker-popover");
    await expect(slashPopover).toBeVisible();
    await expect(slashPopover.locator(".mention-picker-title")).toHaveText(
      "Slash Commands"
    );

    const cmdLabels = await slashPopover
      .locator(".slash-picker-cmd")
      .allTextContents();
    expect(cmdLabels).toEqual([
      "/choice",
      "/event",
      "/help",
      "/look",
      "/narrate",
      "/party",
      "/wait",
    ]);

    // 3. Filter to "/party" and commit via Tab -> renders inline pill & opens Stage-2 subcommands
    await textarea.fill("/par");
    await expect(slashPopover.locator(".slash-picker-cmd")).toHaveText([
      "/party",
    ]);
    await textarea.press("Tab");

    const slashPill = page.locator('.composer-slash-pill[data-command="party"]');
    await expect(slashPill).toBeVisible();
    await expect(slashPill.locator(".composer-slash-pill-label")).toHaveText(
      "party"
    );
    await expect(textarea).toHaveValue("");

    // Stage-2 subcommand picker opens automatically for /party
    await expect(slashPopover).toBeVisible();
    await expect(slashPopover.locator(".mention-picker-title")).toHaveText(
      "/party Subcommands"
    );

    // Select "invite" subcommand
    await slashPopover
      .locator(".slash-picker-item", { hasText: "invite" })
      .dispatchEvent("mousedown");
    const subPill = slashPill.locator(".composer-slash-subpill");
    await expect(subPill).toHaveText("invite");

    // Verify 1-line parameter syntax hint strip is visible
    await expect(page.locator(".composer-slash-hint")).toBeVisible();

    // 4. Type "@" to hand off from slash command to CharacterMentionPicker in party_invite mode
    await textarea.fill("@Yul");
    const mentionPopover = page
      .locator(".mention-picker-popover")
      .filter({ hasNotText: "Slash Commands" });
    await expect(mentionPopover).toBeVisible();
    await expect(mentionPopover.locator(".mention-picker-title")).toHaveText(
      "Invite to Party"
    );

    await textarea.press("Tab");
    await expect(textarea).toHaveValue("@Yulia Halim ");
    await expect(slashPill).toBeVisible();
    await expect(subPill).toHaveText("invite");

    // 5. Move cursor to index 0 and press Backspace twice:
    // First Backspace removes only [invite] subcommand; second removes [party] pill; "@Yulia Halim " stays intact
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await textarea.press("Backspace");
    await expect(subPill).toBeHidden();
    await expect(slashPill).toBeVisible();
    await expect(textarea).toHaveValue("@Yulia Halim ");

    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, 0);
    });
    await textarea.press("Backspace");
    await expect(slashPill).toBeHidden();
    await expect(textarea).toHaveValue("@Yulia Halim ");

    mock.assertNoPageErrors();
  });

  test("hard-blocks unknown /commands with role=alert and opens ephemeral /help tray with click-to-insert", async ({
    page,
  }) => {
    const mock = await installCantinaApiMock(page, {
      authMode: "authenticated",
      startInCampaign: true,
    });

    await page.goto("/");
    const textarea = page.locator(".composer-textarea");
    await expect(textarea).toBeVisible();

    // 1. Type an unrecognized command "/halp" -> verify hard-block alert and disabled Send button
    await textarea.fill("/halp");
    const alertBanner = page.locator('.party-slash-warning[role="alert"]');
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner).toContainText(
      'Unknown command "/halp". Type /help to see available commands.'
    );

    const sendBtn = page.locator("form.composer-bar button[type='submit']");
    await expect(sendBtn).toBeDisabled();

    // Pressing Enter while hard-blocked must NOT fire POST /turns/stream
    await textarea.press("Enter");
    expect(
      mock.requests.filter((r) => r.pathname.endsWith("/turns/stream"))
    ).toHaveLength(0);

    // 2. Run "/help" -> opens SlashHelpTray above composer without creating a turn
    await textarea.fill("/help");
    await textarea.press("Enter");

    const helpTray = page.locator(".slash-help-tray");
    await expect(helpTray).toBeVisible();
    await expect(
      helpTray.getByText("Slash Commands & Composer Shortcuts")
    ).toBeVisible();
    expect(
      mock.requests.filter((r) => r.pathname.endsWith("/turns/stream"))
    ).toHaveLength(0);

    // 3. Click "/wait" in SlashHelpTray -> inserts [Clock] wait pill and closes tray
    await helpTray.locator(".slash-help-row", { hasText: "/wait" }).click();
    await expect(helpTray).toBeHidden();
    await expect(
      page.locator('.composer-slash-pill[data-command="wait"]')
    ).toBeVisible();

    mock.assertNoPageErrors();
  });
});
