# Security Policy

## Supported Versions

CyberCantina is currently in **active public alpha**. Security fixes are applied to the `main` branch and published via the `:alpha` Docker images (`diegolima/cybercantina-backend:alpha` and `diegolima/cybercantina-frontend:alpha`). Older commits and prior alpha snapshots are not supported.

| Version / Branch | Supported |
| --- | --- |
| `main` / latest `:alpha` images | :white_check_mark: |
| Older commits / tags | :x: |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report vulnerabilities privately through **GitHub Private Vulnerability Reporting**:

👉 **[Submit a private security advisory](https://github.com/diegolima/CyberCantina/security/advisories/new)**

### What to Include
To help us triage and fix the issue quickly, please include:
- A clear description of the vulnerability and its security impact
- Deployment mode (Docker Compose vs. source build; Single-User Local Mode vs. Multi-User Mode)
- Step-by-step reproduction instructions or a minimal proof-of-concept
- Affected file paths, endpoints, commit SHA, or Docker image digest (if known)
- Any suggested remediation or workaround

### Response & Disclosure Timeline
We treat security reports seriously and aim to follow this timeline on a best-effort basis:
- **Acknowledgment:** Within 5 business days
- **Initial triage & assessment:** Within 14 days
- **Coordinated disclosure:** After a fix is merged to `main` and updated `:alpha` images are published

---

## Scope & Threat Model

For full details on CyberCantina's security architecture, see the **[Authentication, Multi-User & Security](https://github.com/diegolima/CyberCantina/wiki/Authentication-Multi-User-and-Security)** wiki page.

### In Scope
- Authentication, session handling (`cantina_session`), Argon2id, or WebAuthn passkey bypasses
- Multi-user tenant isolation bypasses (accessing or modifying another user's worlds, characters, personas, campaigns, or providers)
- SSRF or outbound URL policy bypasses (`app/security/url_policy.py`) for unprivileged users
- WebSocket relay (`/api/local-relay/ws`) origin or session bypasses
- Path traversal, arbitrary file read/write, or unsafe archive handling during `.zcc` / character card imports or exports
- Cross-Site Scripting (XSS) or HTML injection in rendered prose, character/world fields, or admin announcements
- Leakage of server-encrypted provider secrets or administrative configuration to non-admin users

### Out of Scope / Expected Behavior
The following are documented design behaviors rather than security vulnerabilities:
- **Single-User Local Mode:** Leaving the initial admin password blank intentionally disables login gates for local single-user play.
- **Administrator Privileges:** Admin users are intentionally permitted to configure loopback/private-LAN provider URLs (e.g., local Ollama/vLLM servers) and manage system settings.
- **Browser-Stored BYOP Credentials:** When `Store in Browser only` is used for personal API keys, secrets are stored in `localStorage` by design and are accessible to same-origin scripts or malicious browser extensions.
- **LLM Output & Prompt Behavior:** Roleplay model outputs, hallucinations, or in-character prompt manipulation that do not cross a system security boundary (such as XSS, SSRF, RCE, or cross-tenant data access).
- **Self-Inflicted Resource Usage:** Slowness or compute exhaustion from running large prompts or models against your own local or configured LLM provider.
- **Public Deployment Hardening:** Running CyberCantina without TLS or a reverse proxy on an untrusted public network.

---

## Testing Guidelines & Safe Harbor

- **Test only against your own local or self-hosted instance** (e.g., local `docker compose` or source checkout). Do **not** scan, probe, or attempt exploits against hosted alpha servers or third-party CyberCantina instances.
- Avoid automated high-volume scanning or destructive testing.
- Good-faith security research following this policy and coordinated disclosure guidelines is welcome and appreciated.
