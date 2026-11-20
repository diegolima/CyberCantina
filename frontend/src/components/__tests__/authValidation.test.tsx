import React from "react";
import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../auth/AuthScreen";
import { InitialSetupScreen } from "../auth/InitialSetupScreen";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  validateDisplayName,
  validateNewPassword,
  validateUsername,
} from "../auth/authValidation";

describe("authValidation & auth screen constraints (FR-5)", () => {
  it("validates username boundaries and allowed characters", () => {
    expect(validateUsername("u1")).toBeNull();
    expect(validateUsername("A.player_01-x")).toBeNull();
    expect(validateUsername("a".repeat(MAX_USERNAME_LENGTH))).toBeNull();

    expect(validateUsername("")).not.toBeNull();
    expect(validateUsername("a")).not.toBeNull();
    expect(validateUsername("a".repeat(MAX_USERNAME_LENGTH + 1))).not.toBeNull();
    expect(validateUsername("-leading")).not.toBeNull();
    expect(validateUsername("bad name")).not.toBeNull();
    expect(validateUsername("user$")).not.toBeNull();
  });

  it("validates display name length and control-character constraints", () => {
    expect(validateDisplayName("N")).toBeNull();
    expect(validateDisplayName("N".repeat(MAX_DISPLAY_NAME_LENGTH))).toBeNull();

    expect(validateDisplayName("   ")).not.toBeNull();
    expect(validateDisplayName("N".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).not.toBeNull();
    expect(validateDisplayName("Line\nBreak")).not.toBeNull();
    expect(validateDisplayName("Null\u0000Byte")).not.toBeNull();
  });

  it("validates password bounds including optional blank mode", () => {
    expect(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(validateNewPassword("a".repeat(MAX_PASSWORD_LENGTH))).toBeNull();

    expect(validateNewPassword("")).not.toBeNull();
    expect(validateNewPassword("", { allowBlank: true })).toBeNull();
    expect(validateNewPassword("short7!")).not.toBeNull();
    expect(validateNewPassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).not.toBeNull();
    expect(validateNewPassword("pass\u0000word1")).not.toBeNull();
  });

  it("renders length bounds and validation hints on AuthScreen and InitialSetupScreen", () => {
    const authHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AuthScreen, {
        singleUserMode: false,
        allowSelfRegistration: true,
        onAuthenticated: vi.fn(),
      })
    );
    expect(authHtml).toContain('maxLength="64"');
    expect(authHtml).toContain(`maxLength="${MAX_PASSWORD_LENGTH}"`);

    const setupHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(InitialSetupScreen, {
        onComplete: vi.fn(),
      })
    );
    expect(setupHtml).toContain(`minLength="${MIN_USERNAME_LENGTH}"`);
    expect(setupHtml).toContain(`maxLength="${MAX_USERNAME_LENGTH}"`);
    expect(setupHtml).toContain(`maxLength="${MAX_DISPLAY_NAME_LENGTH}"`);
    expect(setupHtml).toContain(`maxLength="${MAX_PASSWORD_LENGTH}"`);
    expect(setupHtml).toContain(`${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} chars`);
  });
});
