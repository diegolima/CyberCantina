import React, { useState } from "react";
import { AlertTriangle, Shield } from "lucide-react";
import { api } from "../../api";
import { AuthSessionResponse } from "../../types";

export interface InitialSetupScreenProps {
  onComplete: (res: AuthSessionResponse) => void;
}

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

  const handleSubmit = async (
    e: React.FormEvent,
    confirmBlank: boolean = false
  ) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Please enter an administrator username.");
      return;
    }

    if (password && password !== confirmPassword) {
      setError("Passwords do not match.");
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
            <div className="auth-alert auth-alert-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Admin Username</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Administrator"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Admin Password{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                (Leave blank for local single-user mode)
              </span>
            </label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (e.target.value) setShowBlankWarning(false);
              }}
              placeholder="Enter a strong password or leave blank..."
            />
          </div>

          {password && (
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password..."
              />
            </div>
          )}

          {showBlankWarning && !password && (
            <div className="auth-warning-box">
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
