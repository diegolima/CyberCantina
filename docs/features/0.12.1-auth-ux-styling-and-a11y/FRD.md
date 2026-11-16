---
feature: auth-ux-styling-and-a11y
target_version: 0.12.1
document_type: frd
status: completed
last_updated: 2026-11-16
---

# Feature Requirements Document (FRD)
## Authentication & Setup UI Styling Harmonization, Global Form Primitives & Accessibility

**Status:** Completed  
**Target Version:** CyberCantina v0.12.1  
**Scope:**
- Shared CSS Design Tokens & Form/Tab Primitives (`frontend/src/styles.css`)
- Authentication & Initial Setup Screens (`frontend/src/components/auth/AuthScreen.tsx`, `frontend/src/components/auth/InitialSetupScreen.tsx`, `frontend/src/components/auth/PasswordField.tsx`)
- Sibling Auth/Admin/Profile/Provider Forms Fixed via Bundled Global Form Primitives (`frontend/src/components/auth/{ProfileModal,ProfileAccountTab,ProfilePreferencesTab,AdminUsersTab,AdminServerConfigTab}.tsx`, `frontend/src/components/providers/ProviderEditor.tsx`, `frontend/src/components/models/{ModelPicker,IntegerField,NumericSliderField}.tsx`)
- Automated Tests (`frontend/src/components/__tests__/serverConfigAndAuth.test.tsx`) & Architecture Docs (`docs/architecture/`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
An audit of CyberCantina's authentication and initial setup flows revealed that several interactive controls on [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) and [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx) render with unstyled browser-default chrome instead of CyberCantina's dark studio theme:

1. **Unstyled Mode-Switch Tab Buttons ("Sign In" / "Create Account"):**  
   [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L101-L122) wraps the login/registration switcher in `.Inspector-tabs` and `.tab-btn`. Neither class exists anywhere in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css), leaving both mode buttons as unstyled native `<button>` elements rather than CyberCantina's `.modal-tabs` / `.modal-tab-btn` pattern.
2. **Unstyled Text & Password Inputs:**  
   Both [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L152-L200) and [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx#L93-L147) use `.form-group`, `.form-label`, and `.form-input`. In [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L4142-L4162), `.form-label` and `.form-input` are scoped exclusively under `.model-card-flyout`, and `.form-group` is undefined globally. As a result, inputs fall back to native browser styling and labels lose vertical stacking.
3. **Broader Orphaned Form Classes Across Sibling Screens:**  
   The same undefined global classes (`.form-group`, `.form-label`, `.form-input`, `.form-select`, and `.grid-2`) are also used in [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx), [`ProfileAccountTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileAccountTab.tsx), [`ProfilePreferencesTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfilePreferencesTab.tsx), [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx), [`AdminServerConfigTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminServerConfigTab.tsx), [`ProviderEditor.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/providers/ProviderEditor.tsx), [`ModelPicker.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/ModelPicker.tsx), and [`IntegerField.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/models/IntegerField.tsx) when rendered outside `.model-card-flyout`.
4. **Missing Focus, Accessibility & Auth UX Ergonomics:**  
   - CyberCantina's existing `.field-input` / `.field-textarea` / `.field-select` rules ([`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L2143-L2157)) lack `:focus` / `:focus-visible`, disabled/read-only, and `font-family: inherit` declarations.
   - Auth and setup form controls lack `htmlFor`/`id` label associations, `autoComplete` hints for password managers, `role="tablist"`/`role="tab"` semantics, `role="alert"` live-region error announcements, `aria-invalid` error binding, and password visibility toggles.

> **Clarification on Existing Buttons:** Primary submit and secondary action buttons in [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L202-L263) (`Sign In with Password`, `Create Account`, `Sign In with Passkey`) and [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx#L184-L225) already use `.btn`, `.btn-amber`, and `.btn-cyan`; only the mode-switch tab buttons and form fields are unstyled.

### 1.2 Proposed Solution
1. **Harmonize `AuthScreen` & `InitialSetupScreen` with CyberCantina's Modal System:**
   - Replace `.Inspector-tabs` / `.tab-btn` in [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) with `.modal-tabs` / `.modal-tab-btn` placed directly between `.modal-header` and `.modal-body` (matching `ProfileModal`, `AdminModal`, and Inspector modals).
   - Migrate auth/setup form fields to CyberCantina's canonical `.field-group` / `<label>` / `.field-input` classes while **bundling global `.form-group`, `.form-label`, `.form-input`, `.form-select`, and `.grid-2` rules** in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) so all sibling Auth/Profile/Admin/Provider/Model screens are fixed in the same pass without regressions.
2. **Harden Shared Control States & Typography in `styles.css`:**
   - Add `:focus`, `:focus-visible`, `:disabled`, `[readonly]`, `::placeholder`, `width: 100%`, and `font-family: inherit` rules to `.field-input` / `.field-textarea` / `.field-select` / `.form-input` and `:focus-visible` rings to `.btn` and `.modal-tab-btn`.
   - Extract inline styles in [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) into `.auth-alert-info` and `.auth-divider`.
3. **Add Accessibility & Auth UX Improvements:**
   - Bind every `<label>` to its `<input>` via `htmlFor` + `id`, add standard `autoComplete` attributes, wire ARIA tab/tabpanel and `role="alert"` semantics, bind `aria-invalid` on failed client validation, and add an accessible Show/Hide password toggle on password fields.

---

## 2. Scope, Boundaries & Core Invariants

1. **Design System Convergence (Zero Parallel Button/Input Systems):**
   - Authentication and setup screens must reuse CyberCantina's existing palette tokens (`--bg-deep`, `--bg-panel`, `--bg-card`, `--border-subtle`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-amber`, `--accent-cyan`, `--accent-rose`) and existing `.modal-panel`, `.modal-header`, `.modal-tabs`, `.modal-tab-btn`, `.modal-body`, `.field-group`, `.field-input`, and `.btn` classes.
2. **Non-Regression of Scoped Overrides & Inline Flex Rows:**
   - Adding global `.form-group`, `.form-label`, `.form-input`, `.form-select`, and `.grid-2` rules in [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css) must preserve existing scoped overrides in `.model-card-flyout` ([`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L4142-L4162)) and `.nsf-number` ([`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L3686-L3704)). Specifically, global rules must be placed in the shared form section (before `.nsf-number` and `.model-card-flyout`) so specificity and source order keep flyout cards and numeric slider fields unchanged.
   - Sibling inline-action flex rows that pair `<input className="form-input">` with a submit `<button className="btn btn-amber">` ([`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx#L241-L256) and [`AdminUsersTab.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminUsersTab.tsx#L660-L678)) must keep `flexShrink: 0` on the action button so `width: 100%; min-width: 0;` on `.form-input` never compresses button labels.
3. **Auth Flow & Test Contract Preservation:**
   - No changes to authentication API payloads, backend endpoints, passkey ceremonies, or blank-password single-user setup rules.
   - Preserve exact user-facing labels/strings asserted by existing tests (notably `"Create Account"` and `"Self-registration is currently disabled"` in [`serverConfigAndAuth.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/serverConfigAndAuth.test.tsx#L77-L96)).
4. **Vitest Node-Only Test Compatibility:**
   - Because CyberCantina runs Vitest without `jsdom` or `@testing-library/react`, any new UI assertions must work cleanly with `ReactDOMServer.renderToStaticMarkup` and pure logic helpers.

---

## 3. Functional Requirements & Edge Cases

### FR-1: Harmonize `AuthScreen` Mode Switcher (`Sign In` / `Create Account`)
**Requirement:** Replace the unstyled `.Inspector-tabs` / `.tab-btn` switcher in [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L100-L123) with CyberCantina's canonical `.modal-tabs` and `.modal-tab-btn` pattern.

- **Layout Placement:**
  - When `!singleUserMode && allowSelfRegistration`, render `<div className="modal-tabs" role="tablist" aria-label="Authentication mode">` directly between `.modal-header` and `.modal-body` (matching [`ProfileModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/ProfileModal.tsx#L134-L168) and [`AdminModal.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AdminModal.tsx#L221-L270)).
  - Use `.modal-tab-btn` with `active` class on the selected mode (`login` or `register`).
  - Include concise Lucide icons (`LogIn` / `UserPlus` or `KeyRound` / `UserPlus`, size `14`) inside `.modal-tab-btn` consistent with other modal tabs, keeping `"Sign In"` and `"Create Account"` as exact visible labels.
- **Tab Semantics & State Reset:**
  - Each tab button sets `type="button"`, `role="tab"`, `id`, `aria-selected={mode === ...}`, and `aria-controls="auth-mode-panel"`.
  - Wrap `.modal-body` content (or form container) with `id="auth-mode-panel"`, `role="tabpanel"`, and `aria-labelledby` pointing to the active tab when tabs are visible.
  - Switching tabs clears `error` and field-level validation flags (`fieldErrors`) and resets `showPassword` / `showConfirmPassword` to `false` so typed passwords are never accidentally revealed when switching modes.
- **Self-Registration Disabled State:**
  - When `!singleUserMode && !allowSelfRegistration`, omit `.modal-tabs` completely and render the disabled-registration notice inside `.modal-body` using `.auth-alert.auth-alert-info` (replacing the inline-styled `div` at [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx#L125-L139)).

---

### FR-2: Standardize Form Fields & Global Shared Primitives (`styles.css` + Auth Screens)
**Requirement:** Ensure every text, password, number, and select control on auth, setup, and sibling modal screens uses CyberCantina's dark input styling with visible focus, disabled, and error states.

- **Auth & Setup Screens (`AuthScreen.tsx`, `InitialSetupScreen.tsx`):**
  - Replace `.form-group` / `.form-label` / `.form-input` with `.field-group` / `<label>` / `.field-input`.
- **Canonical Shared Field & Grid Styles (`frontend/src/styles.css`):**
  - Upgrade `.field-input`, `.field-textarea`, and `.field-select` (around line 2143) to include:
    - `width: 100%;`
    - `min-width: 0;`
    - `font-family: inherit;`
    - `transition: border-color 0.15s ease, box-shadow 0.15s ease;`
  - Add `.field-input::placeholder`, `.field-textarea::placeholder`, `.form-input::placeholder` (`color: var(--text-muted);`).
  - Add `:focus` and `:focus-visible` states on `.field-input`, `.field-textarea`, `.field-select`, `.form-input`, `.form-select`:
    - `outline: none;`
    - `border-color: var(--accent-amber);`
    - `box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.18);`
  - Add `[aria-invalid="true"]` / `.invalid` error state (`border-color: var(--accent-rose);` and rose focus ring `rgba(244, 63, 94, 0.22)`).
  - Add `:disabled` and `[readonly]` states (`opacity: 0.65; cursor: not-allowed;`).
  - Define global `.form-group`, `.form-label`, `.form-input`, `.form-select`, and `.grid-2` alongside `.field-group` / `.field-input` in `styles.css` (using the same `--bg-deep`, `--border-subtle`, `--text-primary`, focus, and error rules, with `.grid-2` collapsing to 1 column at `@media (max-width: 560px)`), so all sibling components (`ProfileModal`, `ProfileAccountTab`, `ProfilePreferencesTab`, `AdminUsersTab`, `AdminServerConfigTab`, `ProviderEditor`, `ModelPicker`, `IntegerField`) render consistently without requiring mass edits in unrelated tabs.
  - Ensure `.btn`, `.modal-tab-btn`, and password visibility toggle buttons include explicit `:focus-visible` rings (`outline: 2px solid var(--accent-amber); outline-offset: 2px;`, with `--accent-cyan` override on `.btn-cyan` / `.modal-tabs-cyan`), and set `font-family: inherit` on `.btn`.
- **Auth Alert & Divider Classes (`styles.css`):**
  - Add `.auth-alert-info` (cyan border/tint matching `rgba(6, 182, 212, ...)` and `--text-secondary` / `#bae6fd`) alongside `.auth-alert-error` and `.auth-alert-success`.
  - Add `.auth-divider` for the `"or"` separator between password sign-in and passkey sign-in in `AuthScreen.tsx`.

---

### FR-3: Form Accessibility, Password-Manager Ergonomics & Validation UX
**Requirement:** Upgrade keyboard navigation, screen-reader announcements, label associations, and password entry ergonomics across [`AuthScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/AuthScreen.tsx) and [`InitialSetupScreen.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/InitialSetupScreen.tsx).

- **Programmatic Label Binding:**
  - Every `<label>` must declare `htmlFor` matching its input's unique `id`:
    - `AuthScreen`: `auth-username`, `auth-display-name`, `auth-password`, `auth-confirm-password`.
    - `InitialSetupScreen`: `setup-username`, `setup-display-name`, `setup-password`, `setup-confirm-password`.
- **Password Manager & Browser `autoComplete` Hints:**
  - `AuthScreen`:
    - Username: `autoComplete="username"`
    - Display Name (register): `autoComplete="name"`
    - Password: `autoComplete={mode === "login" ? "current-password" : "new-password"}`
    - Confirm Password (register): `autoComplete="new-password"`
  - `InitialSetupScreen`:
    - Admin Username: `autoComplete="username"`
    - Display Name: `autoComplete="name"`
    - Admin Password & Confirm Password: `autoComplete="new-password"`
- **Show / Hide Password Toggle (`PasswordField.tsx`):**
  - Extract a shared [`PasswordField`](file:///home/diegolima/Git/cybercantina/frontend/src/components/auth/PasswordField.tsx) component rendered inside `.field-input-wrap` for password and confirm-password inputs in both `AuthScreen` and `InitialSetupScreen` (using `Eye` / `EyeOff` from `lucide-react`).
  - Reset `visible` back to `false` via `resetKey` when switching `AuthScreen` modes (`login` <-> `register`) so partially typed passwords do not carry over visibly.
  - Button requirements:
    - `type="button"` (never submits the form).
    - `aria-label={visible ? ... : ...}` (e.g., `"Hide password"` / `"Show password"`) and `aria-pressed={visible}`.
    - Uses subtle icon-button styling (`background: transparent`, `--text-muted` -> `--text-primary` on hover, `:focus-visible` ring), with right padding on `.field-input-with-toggle` (`padding-right: 36px`) so text never collides with the icon.
    - Disabled when the form is `busy` / `submitting`.
- **Accessible Validation & Live Error Feedback:**
  - Wrap error banners (`.auth-alert-error`) with `role="alert"` and `aria-live="assertive"`.
  - Add `noValidate` on `<form>` or consistent client validation so missing/mismatched fields render inside CyberCantina's `.auth-alert-error` banner instead of inconsistent native browser popovers, and set `aria-invalid="true"` + `aria-describedby="auth-form-error"` (or `setup-form-error`) on offending inputs.
  - Clear the error banner and `aria-invalid` state as soon as the user edits the offending field.
  - In `InitialSetupScreen.tsx`, when `showBlankWarning` appears, keep focus management clean (e.g., warning box uses `role="region"` / `aria-label="Blank password confirmation"` and Cancel/Confirm buttons retain clear primary/secondary contrast).

---

### FR-4: Viewport Resilience & Button Hierarchy
**Requirement:** Ensure auth and setup modals remain usable on small screens, zoomed viewports, and narrow windows.

- **Scroll-Safe Backdrop:**
  - `.auth-stage-backdrop` currently sits over `body { overflow: hidden; }` ([`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L26-L31) and [`styles.css`](file:///home/diegolima/Git/cybercantina/frontend/src/styles.css#L2207-L2216)). Add `overflow-y: auto;` on `.auth-stage-backdrop` and preserve `.modal-panel` flex scrolling so tall forms (e.g., `Create Account` or `InitialSetupScreen` with blank-password warning on short viewports / 150%+ browser zoom) never trap or clip submit buttons off-screen.
- **Disabled / Busy Button Feedback:**
  - During `busy` / `submitting`, disable inputs/toggles alongside submit/passkey buttons and set `aria-busy={busy}` on the active action button so assistive technology announces pending submission.

---

## 4. Verification & Acceptance Criteria

### 4.1 Automated Verification
- **Frontend Tests ([`serverConfigAndAuth.test.tsx`](file:///home/diegolima/Git/cybercantina/frontend/src/components/__tests__/serverConfigAndAuth.test.tsx)):**
  - Verify `AuthScreen` renders `.modal-tabs` / `.modal-tab-btn` (and **no** `.Inspector-tabs` / `.tab-btn` or `.form-input` / `.form-group` / `.form-label` classes).
  - Verify `AuthScreen` renders `.field-group` and `.field-input` with `htmlFor`/`id` bindings, `autoComplete` attributes, `role="tablist"`/`role="tab"`, and password visibility toggle buttons (`aria-pressed`).
  - Verify `AuthScreen` still hides `"Create Account"` and renders `.auth-alert-info` when `allowSelfRegistration` is `false`.
  - Verify `InitialSetupScreen` renders `.field-group` / `.field-input`, `htmlFor`/`id` bindings, `autoComplete` hints, and password visibility toggle controls.
- **Required Workspace Checks:**
  - `npm --prefix frontend run arch:check`
  - `npm --prefix frontend run build`
  - `npm --prefix frontend test`
  - `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check` (required because `PasswordField.tsx` adds a module under `frontend/src/components/auth/`)

### 4.2 Manual Visual & Keyboard Verification Checklist
1. Open the Login / Create Account screen (`AuthScreen`) in Chromium/Firefox and verify:
   - `"Sign In"` and `"Create Account"` tabs match `ProfileModal` / `AdminModal` tab styling with amber active highlight.
   - All inputs match dark `--bg-deep` background, `--border-subtle` borders, and `--accent-amber` focus rings.
   - Tabbing across tabs, username, password, Show/Hide toggle, submit button, and Passkey button shows clear `:focus-visible` outlines.
   - Submitting invalid input displays `.auth-alert-error` and highlights invalid fields without browser-default light inputs or native popups.
2. Open Initial Admin Setup (`InitialSetupScreen`) and verify input styling, password confirmation reveal, blank-password warning card, and small-viewport scrolling (`<= 640px` height).
3. Spot-check `ProfileModal`, `AdminUsersTab`, `AdminServerConfigTab`, `ProviderEditor`, and `ModelDeck` flyouts to confirm global `.form-input` / `.grid-2` styles fix sibling forms without altering `.model-card-flyout` or `.nsf-number` layout.
