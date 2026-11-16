import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Fingerprint,
  Info,
  KeyRound,
  Lock,
  LogIn,
  UserPlus,
} from "lucide-react";
import { api } from "../../api";
import { AuthSessionResponse, PublicAdminMessage } from "../../types";
import { AdminMessageBannerList } from "../shared/AdminMessageBannerList";
import { PasswordField } from "./PasswordField";

export interface AuthScreenProps {
  singleUserMode: boolean;
  allowSelfRegistration?: boolean;
  loginMessages?: PublicAdminMessage[];
  onAuthenticated: (res: AuthSessionResponse) => void;
}

type InvalidAuthField = "username" | "password" | "confirmPassword" | null;

export const AuthScreen: React.FC<AuthScreenProps> = ({
  singleUserMode,
  allowSelfRegistration = true,
  loginMessages = [],
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidAuthField>(null);

  const showModeTabs = !singleUserMode && allowSelfRegistration;

  useEffect(() => {
    if (!allowSelfRegistration && mode === "register") {
      setMode("login");
      setInvalidField(null);
    }
  }, [allowSelfRegistration, mode]);

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setError(null);
    setInvalidField(null);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInvalidField(null);

    if (!username.trim()) {
      setError("Username is required.");
      setInvalidField("username");
      return;
    }

    if (mode === "register") {
      if (!password) {
        setError("Password is required.");
        setInvalidField("password");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        setInvalidField("confirmPassword");
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
    setInvalidField(null);
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
      <div className="auth-stage-stack">
        {!singleUserMode && loginMessages.length > 0 && (
          <AdminMessageBannerList messages={loginMessages} surface="login" />
        )}
        <div className="modal-panel" style={{ maxWidth: 440, width: "100%" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={18} color="var(--accent-amber)" />
            {mode === "login"
              ? "Sign In to CyberCantina"
              : "Create CyberCantina Account"}
          </span>
        </div>

        {showModeTabs && (
          <div
            className="modal-tabs"
            role="tablist"
            aria-label="Authentication mode"
          >
            <button
              id="auth-tab-login"
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              aria-controls="auth-mode-panel"
              className={`modal-tab-btn ${mode === "login" ? "active" : ""}`}
              disabled={busy}
              onClick={() => switchMode("login")}
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
            <button
              id="auth-tab-register"
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              aria-controls="auth-mode-panel"
              className={`modal-tab-btn ${mode === "register" ? "active" : ""}`}
              disabled={busy}
              onClick={() => switchMode("register")}
            >
              <UserPlus size={14} />
              <span>Create Account</span>
            </button>
          </div>
        )}

        <div
          id="auth-mode-panel"
          className="modal-body"
          role={showModeTabs ? "tabpanel" : undefined}
          aria-labelledby={
            showModeTabs
              ? mode === "login"
                ? "auth-tab-login"
                : "auth-tab-register"
              : undefined
          }
          style={{ gap: 14 }}
        >
          {!singleUserMode && !allowSelfRegistration && (
            <div className="auth-alert auth-alert-info">
              <Info size={15} style={{ flexShrink: 0 }} />
              <span>
                Self-registration is currently disabled. Sign in with an account
                created by the server administrator.
              </span>
            </div>
          )}

          {error && (
            <div
              id="auth-form-error"
              className="auth-alert auth-alert-error"
              role="alert"
              aria-live="assertive"
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handlePasswordSubmit}
            noValidate
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="field-group">
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
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
                placeholder="Enter your username..."
                autoComplete="username"
                disabled={busy}
                autoFocus
                required
                aria-invalid={invalidField === "username" || undefined}
                aria-describedby={
                  invalidField === "username" && error
                    ? "auth-form-error"
                    : undefined
                }
              />
            </div>

            {mode === "register" && (
              <div className="field-group">
                <label htmlFor="auth-display-name">Display Name</label>
                <input
                  id="auth-display-name"
                  type="text"
                  className="field-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How your name appears in the studio..."
                  autoComplete="name"
                  disabled={busy}
                />
              </div>
            )}

            <PasswordField
              id="auth-password"
              label="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (invalidField === "password") {
                  setInvalidField(null);
                  setError(null);
                }
              }}
              placeholder="Enter password..."
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={busy}
              required={mode === "register"}
              invalid={invalidField === "password"}
              describedBy="auth-form-error"
              resetKey={mode}
            />

            {mode === "register" && (
              <PasswordField
                id="auth-confirm-password"
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
                disabled={busy}
                required
                invalid={invalidField === "confirmPassword"}
                describedBy="auth-form-error"
                resetKey={mode}
              />
            )}

            <button
              type="submit"
              className="btn btn-amber"
              style={{ width: "100%", marginTop: 4 }}
              disabled={busy}
              aria-busy={busy}
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
              <div className="auth-divider">
                <span>or</span>
              </div>

              <button
                type="button"
                className="btn btn-cyan"
                style={{ width: "100%" }}
                onClick={handlePasskeyLogin}
                disabled={busy}
                aria-busy={busy}
              >
                <Fingerprint size={16} />
                <span>Sign In with Passkey</span>
              </button>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
