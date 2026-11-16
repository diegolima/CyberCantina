import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminModelsTab } from "../auth/AdminModelsTab";
import { ProviderCard } from "../providers/ProviderCard";
import { ProviderEditor } from "../providers/ProviderEditor";
import { ProvidersProvider } from "../providers/ProvidersContext";
import type { AppSettings, LLMProvider } from "../../types";

const BASE_SETTINGS: AppSettings = {
  db_path: "./cybercantina.db",
  actor_profile: {
    provider_id: null,
    model: "test-actor",
    temperature: 0.7,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  clerk_profile: {
    provider_id: null,
    model: "test-clerk",
    temperature: 0.3,
    max_tokens: 1024,
    timeout_seconds: 60,
  },
  embedding_profile: {
    mode: "local_hash",
    model: "hash",
    dimensions: 384,
  },
  memory_config: {
    working_memory_turns: 8,
    episodic_chunk_size: 4,
    rag_top_k: 5,
  },
  allow_offline_fallback: false,
  allow_user_model_overrides: true,
  allow_user_providers: true,
  provider_credential_store: "prefer_browser",
  delegate_cognition_to_clerk: false,
  allow_self_registration: true,
};

const USER_BROWSER_OR: LLMProvider = {
  id: "prov_u_or",
  name: "My OpenRouter",
  type: "openrouter",
  scope: "user",
  owner_id: "u1",
  color: "cyan",
  is_enabled: true,
  base_url: "https://openrouter.ai/api/v1",
  has_bearer_token: false,
  credential_storage: "browser",
  usable: true,
  unusable_reason: null,
  cached_models: [],
  last_probed_at: null,
  last_error_code: null,
  version: 1,
  created_at: "2026-11-16T00:00:00Z",
  updated_at: "2026-11-16T00:00:00Z",
};

describe("Browser credential store UI", () => {
  it("renders all 4 Provider Credential Store modes in AdminModelsTab", () => {
    const html = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <AdminModelsTab
          appSettingsForm={BASE_SETTINGS}
          setAppSettingsForm={vi.fn()}
          savingSettings={false}
          modelsDeckInvalid={0}
          setModelsDeckInvalid={vi.fn()}
          staleEmbeddings={0}
          reindexing={false}
          handleReindex={vi.fn()}
          handleSaveSettings={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(html).toContain("Provider Credential Store");
    expect(html).toContain('value="server_only"');
    expect(html).toContain('value="prefer_server"');
    expect(html).toContain('value="prefer_browser"');
    expect(html).toContain('value="browser_only"');
  });

  it("renders Store in Browser only checkbox per policy on user scope and hides on system scope", () => {
    const preferBrowserCreate = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderEditor
          mode="create"
          scope="user"
          credentialStoreMode="prefer_browser"
          onDone={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(preferBrowserCreate).toContain("Store in Browser only");
    expect(preferBrowserCreate).toMatch(/<input type="checkbox" checked=""\/><span>Store in Browser only/);

    const serverOnlyCreate = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderEditor
          mode="create"
          scope="user"
          credentialStoreMode="server_only"
          onDone={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(serverOnlyCreate).toContain("disabled by administrator: server storage only");
    expect(serverOnlyCreate).toMatch(/<input type="checkbox" disabled=""\/><span>Store in Browser only/);

    const browserOnlyCreate = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderEditor
          mode="create"
          scope="user"
          credentialStoreMode="browser_only"
          onDone={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(browserOnlyCreate).toContain("enforced by administrator");
    expect(browserOnlyCreate).toMatch(/<input type="checkbox" disabled="" checked=""\/><span>Store in Browser only/);

    const systemCreate = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderEditor
          mode="create"
          scope="system"
          credentialStoreMode="browser_only"
          onDone={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(systemCreate).not.toContain("Store in Browser only");
  });

  it("renders Key missing in this browser and Browser Storage Disabled badges on ProviderCard", () => {
    const missingKeyHtml = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderCard
          provider={USER_BROWSER_OR}
          expanded={false}
          canEdit={true}
          credentialStoreMode="prefer_browser"
          onToggle={vi.fn()}
          onProbe={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(missingKeyHtml).toContain("Key missing in this browser");

    const pausedHtml = renderToStaticMarkup(
      <ProvidersProvider probeSystem={false}>
        <ProviderCard
          provider={{
            ...USER_BROWSER_OR,
            usable: false,
            unusable_reason: "browser_storage_disabled",
          }}
          expanded={false}
          canEdit={true}
          credentialStoreMode="server_only"
          onToggle={vi.fn()}
          onProbe={vi.fn()}
        />
      </ProvidersProvider>
    );
    expect(pausedHtml).toContain("Browser Storage Disabled");
  });
});
