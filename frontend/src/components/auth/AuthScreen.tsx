import React, { useState } from "react";
import { AlertTriangle, Fingerprint, KeyRound, Lock } from "lucide-react";
import { api } from "../../api";
import { AuthSessionResponse } from "../../types";

export interface AuthScreenProps {
  singleUserMode: boolean;
  onAuthenticated: (res: AuthSessionResponse) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  singleUserMode,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }

    if (mode === "register") {
      if (!password) {
        setError("Password is required.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const res = await api.login({
          username: username.trim(),
          password,
        });
        onAuthenticated(res);
      } else {
        const res = await api.register({
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          password,
        });
        onAuthenticated(res);
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.loginWithPasskey(username.trim() || undefined);
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || "Passkey sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-stage-backdrop">
      <div className="modal-panel" style={{ maxWidth: 440, width: "100%" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={18} color="var(--accent-amber)" />
            {mode === "login"
              ? "Sign In to CyberCantina"
              : "Create CyberCantina Account"}
          </span>
        </div>

        <div className="modal-body" style={{ gap: 14 }}>
          {!singleUserMode && (
            <div className="Inspector-tabs" style={{ marginBottom: 4 }}>
              <button
                type="button"
                className={`tab-btn ${mode === "login" ? "active" : ""}`}
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`tab-btn ${mode === "register" ? "active" : ""}`}
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                Create Account
              </button>
            </div>
          )}

          {error && (
            <div className="auth-alert auth-alert-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handlePasswordSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username..."
                autoFocus
                required
              />
            </div>

            {mode === "register" && (
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How your name appears in the studio..."
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
              />
            </div>

            {mode === "register" && (
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

            <button
              type="submit"
              className="btn btn-amber"
              style={{ width: "100%", marginTop: 4 }}
              disabled={busy}
            >
              <KeyRound size={15} />
              <span>
                {busy
                  ? "Authenticating..."
                  : mode === "login"
                  ? "Sign In with Password"
                  : "Create Account"}
              </span>
            </button>
          </form>

          {mode === "login" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "2px 0",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--border-subtle)",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  or
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--border-subtle)",
                  }}
                />
              </div>

              <button
                type="button"
                className="btn btn-cyan"
                style={{ width: "100%" }}
                onClick={handlePasskeyLogin}
                disabled={busy}
              >
                <Fingerprint size={16} />
                <span>Sign In with Passkey</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
