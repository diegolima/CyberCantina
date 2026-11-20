import React, { useState } from "react";
import { AlertTriangle, Shield } from "lucide-react";
import { api } from "../../api";
import { AuthSessionResponse } from "../../types";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  validateDisplayName,
  validateNewPassword,
  validateUsername,
} from "./authValidation";
import { PasswordField } from "./PasswordField";

export interface InitialSetupScreenProps {
  onComplete: (res: AuthSessionResponse) => void;
}

type InvalidSetupField = "username" | "confirmPassword" | null;

export const InitialSetupScreen: React.FC<InitialSetupScreenProps> = ({
  onComplete,
}) => {
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("Administrator");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showBlankWarning, setShowBlankWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidSetupField>(null);

  const handleSubmit = async (
    e: React.FormEvent,
    confirmBlank: boolean = false
  ) => {
    e.preventDefault();
    setError(null);
    setInvalidField(null);

    const usernameErr = validateUsername(username);
    if (usernameErr) {
      setError(usernameErr);
      setInvalidField("username");
      return;
    }

    if (displayName.trim()) {
      const displayErr = validateDisplayName(displayName);
      if (displayErr) {
        setError(displayErr);
        return;
      }
    }

    if (password) {
      const pwdErr = validateNewPassword(password);
      if (pwdErr) {
        setError(pwdErr);
        setInvalidField("confirmPassword");
        return;
      }
    }

    if (password && password !== confirmPassword) {
      setError("Passwords do not match.");
      setInvalidField("confirmPassword");
      return;
    }

    if (!password && !confirmBlank) {
      setShowBlankWarning(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.initialSetup({
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        password,
        confirm_blank_password: confirmBlank,
      });
      onComplete(res);
    } catch (err: any) {
      setError(err?.message || "Failed to initialize administrator account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-stage-backdrop">
      <div className="modal-panel" style={{ maxWidth: 480, width: "100%" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={18} color="var(--accent-amber)" />
            Welcome to CyberCantina — Initial Admin Setup
          </span>
        </div>

        <form
          className="modal-body"
          onSubmit={(e) => handleSubmit(e, false)}
          noValidate
          style={{ gap: 14 }}
        >
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Configure the primary administrator account for this CyberCantina
            instance. For local single-user setups, you may leave the password
            blank.
          </p>

          {error && (
            <div
              id="setup-form-error"
              className="auth-alert auth-alert-error"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div className="field-group">
            <label htmlFor="setup-username">Admin Username</label>
            <input
              id="setup-username"
              type="text"
              className="field-input"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (invalidField === "username") {
                  setInvalidField(null);
                  setError(null);
                }
              }}
              placeholder="admin"
              autoComplete="username"
              minLength={MIN_USERNAME_LENGTH}
              maxLength={MAX_USERNAME_LENGTH}
              disabled={submitting}
              autoFocus
              required
              aria-invalid={invalidField === "username" || undefined}
              aria-describedby={
                invalidField === "username" && error
                  ? "setup-form-error"
                  : undefined
              }
            />
          </div>

          <div className="field-group">
            <label htmlFor="setup-display-name">Display Name</label>
            <input
              id="setup-display-name"
              type="text"
              className="field-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Administrator"
              autoComplete="name"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              disabled={submitting}
            />
          </div>

          <PasswordField
            id="setup-password"
            label="Admin Password"
            labelHint={`(${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} chars, or leave blank for single-user mode)`}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (e.target.value) setShowBlankWarning(false);
              if (invalidField === "confirmPassword") {
                setInvalidField(null);
                setError(null);
              }
            }}
            placeholder="Enter a strong password or leave blank..."
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            disabled={submitting}
          />

          {password && (
            <PasswordField
              id="setup-confirm-password"
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (invalidField === "confirmPassword") {
                  setInvalidField(null);
                  setError(null);
                }
              }}
              placeholder="Confirm password..."
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              disabled={submitting}
              invalid={invalidField === "confirmPassword"}
              describedBy="setup-form-error"
            />
          )}

          {showBlankWarning && !password && (
            <div
              className="auth-warning-box"
              role="region"
              aria-label="Blank password confirmation"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  color: "var(--accent-amber)",
                  marginBottom: 6,
                }}
              >
                <AlertTriangle size={16} />
                <span>Disable Multi-User Support?</span>
              </div>
              <p
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.45,
                  marginBottom: 10,
                }}
              >
                Leaving the admin user&apos;s password blank will{" "}
                <strong>disable multi-user support</strong> and automatically log
                you into this account on subsequent accesses. You can set a
                password later in your Profile to enable multi-user mode.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowBlankWarning(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={(e) => handleSubmit(e, true)}
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting
                    ? "Initializing..."
                    : "Confirm Blank Password (Single-User)"}
                </button>
              </div>
            </div>
          )}

          {!showBlankWarning && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 6,
              }}
            >
              <button
                type="submit"
                className="btn btn-amber"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting
                  ? "Saving..."
                  : password
                  ? "Create Admin Account (Multi-User)"
                  : "Continue with Blank Password"}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
