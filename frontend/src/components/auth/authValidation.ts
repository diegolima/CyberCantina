/**
 * Shared client-side validation helpers mirroring backend auth schema bounds.
 */

export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 32;
export const USERNAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const MAX_DISPLAY_NAME_LENGTH = 64;
const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;

export function validateUsername(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned) {
    return "Username is required.";
  }
  if (
    cleaned.length < MIN_USERNAME_LENGTH ||
    cleaned.length > MAX_USERNAME_LENGTH ||
    !USERNAME_REGEX.test(cleaned)
  ) {
    return "Username must be 2–32 characters using letters, numbers, '.', '_', or '-' (starting with a letter or digit).";
  }
  return null;
}

export function validateDisplayName(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned) {
    return "Display name cannot be empty.";
  }
  if (cleaned.length > MAX_DISPLAY_NAME_LENGTH || CONTROL_CHAR_REGEX.test(cleaned)) {
    return "Display name must be 1–64 characters and cannot contain control characters.";
  }
  return null;
}

export function validateNewPassword(
  raw: string,
  options?: { allowBlank?: boolean }
): string | null {
  if (raw.includes("\u0000")) {
    return "Password cannot contain null bytes.";
  }
  if (raw === "" && options?.allowBlank) {
    return null;
  }
  if (raw.length < MIN_PASSWORD_LENGTH || raw.length > MAX_PASSWORD_LENGTH) {
    return `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
