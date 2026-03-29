import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ClientSettings,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  ModelSelection,
  type ServerConfig,
  ServerSettings,
  type ServerSettingsPatch,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  ThreadEnvMode,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { deepMerge } from "@t3tools/shared/Struct";
import { Predicate, Schema, Struct } from "effect";
import { type DeepMutable } from "effect/Types";
import { inferProviderForModel, normalizeModelSlug } from "@t3tools/shared/model";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useLocalStorage } from "./useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
export const LEGACY_APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));
const MAX_CUSTOM_MODEL_COUNT = 32;
const MAX_CUSTOM_MODEL_LENGTH = 256;
const BUILT_IN_CODEX_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
]);
const BUILT_IN_CLAUDE_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);

function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: "codex" | "claudeAgent",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = provider === "codex" ? BUILT_IN_CODEX_MODELS : BUILT_IN_CLAUDE_MODELS;

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function splitPatch(patch: Partial<UnifiedSettings>): {
  serverPatch: ServerSettingsPatch;
  clientPatch: Partial<ClientSettings>;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as Partial<ClientSettings>,
  };
}

export function useSettings<T = UnifiedSettings>(selector?: (settings: UnifiedSettings) => T): T {
  const { data: serverConfig } = useQuery(serverConfigQueryOptions());
  const [clientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const merged = useMemo<UnifiedSettings>(
    () => ({
      ...(serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS),
      ...clientSettings,
    }),
    [clientSettings, serverConfig?.settings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const [, setClientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<UnifiedSettings>) => {
      const { serverPatch, clientPatch } = splitPatch(patch);

      if (Object.keys(serverPatch).length > 0) {
        queryClient.setQueryData<ServerConfig>(serverQueryKeys.config(), (old) => {
          if (!old) return old;
          return {
            ...old,
            settings: deepMerge(old.settings, serverPatch),
          };
        });
        void ensureNativeApi().server.updateSettings(serverPatch);
      }

      if (Object.keys(clientPatch).length > 0) {
        setClientSettings((prev) => ({ ...prev, ...clientPatch }));
      }
    },
    [queryClient, setClientSettings],
  );

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_UNIFIED_SETTINGS);
  }, [updateSettings]);

  return {
    updateSettings,
    resetSettings,
  };
}

export function buildLegacyServerSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): DeepMutable<ServerSettingsPatch> {
  const patch: DeepMutable<ServerSettingsPatch> = {};

  if (Predicate.isBoolean(legacySettings.enableAssistantStreaming)) {
    patch.enableAssistantStreaming = legacySettings.enableAssistantStreaming;
  }

  if (Schema.is(ThreadEnvMode)(legacySettings.defaultThreadEnvMode)) {
    patch.defaultThreadEnvMode = legacySettings.defaultThreadEnvMode;
  }

  if (Schema.is(ModelSelection)(legacySettings.textGenerationModelSelection)) {
    const selection = legacySettings.textGenerationModelSelection;
    patch.textGenerationModelSelection =
      selection.provider === "claudeAgent"
        ? {
            provider: "claudeAgent",
            model: selection.model,
          }
        : {
            provider: "codex",
            model: selection.model,
          };
  } else if (Predicate.isString(legacySettings.textGenerationModel)) {
    const trimmed = legacySettings.textGenerationModel.trim();
    if (trimmed.length > 0) {
      patch.textGenerationModelSelection = {
        provider: inferProviderForModel(trimmed, "codex"),
        model: trimmed,
      };
    }
  }

  if (typeof legacySettings.codexBinaryPath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.binaryPath = legacySettings.codexBinaryPath;
  }

  if (typeof legacySettings.codexHomePath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.homePath = legacySettings.codexHomePath;
  }

  if (Array.isArray(legacySettings.customCodexModels)) {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.customModels = normalizeCustomModelSlugs(
      legacySettings.customCodexModels,
      "codex",
    );
  }

  if (Predicate.isString(legacySettings.claudeBinaryPath)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.binaryPath = legacySettings.claudeBinaryPath;
  }

  if (Array.isArray(legacySettings.customClaudeModels)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.customModels = normalizeCustomModelSlugs(
      legacySettings.customClaudeModels,
      "claudeAgent",
    );
  }

  return patch;
}

export function buildLegacyClientSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): Partial<DeepMutable<ClientSettings>> {
  const patch: Partial<DeepMutable<ClientSettings>> = {};

  if (Predicate.isBoolean(legacySettings.confirmThreadArchive)) {
    patch.confirmThreadArchive = legacySettings.confirmThreadArchive;
  }

  if (Predicate.isBoolean(legacySettings.confirmThreadDelete)) {
    patch.confirmThreadDelete = legacySettings.confirmThreadDelete;
  }

  if (Predicate.isBoolean(legacySettings.diffWordWrap)) {
    patch.diffWordWrap = legacySettings.diffWordWrap;
  }

  if (Schema.is(SidebarProjectSortOrder)(legacySettings.sidebarProjectSortOrder)) {
    patch.sidebarProjectSortOrder = legacySettings.sidebarProjectSortOrder;
  }

  if (Schema.is(SidebarThreadSortOrder)(legacySettings.sidebarThreadSortOrder)) {
    patch.sidebarThreadSortOrder = legacySettings.sidebarThreadSortOrder;
  }

  if (Schema.is(TimestampFormat)(legacySettings.timestampFormat)) {
    patch.timestampFormat = legacySettings.timestampFormat;
  }

  if (Predicate.isString(legacySettings.uiScale)) {
    patch.uiScale = legacySettings.uiScale as ClientSettings["uiScale"];
  }

  if (Predicate.isBoolean(legacySettings.voiceEnabled)) {
    patch.voiceEnabled = legacySettings.voiceEnabled;
  }
  if (Predicate.isBoolean(legacySettings.voiceInputEnabled)) {
    patch.voiceInputEnabled = legacySettings.voiceInputEnabled;
  }
  if (Predicate.isBoolean(legacySettings.voiceWakePhraseEnabled)) {
    patch.voiceWakePhraseEnabled = legacySettings.voiceWakePhraseEnabled;
  }
  if (Predicate.isBoolean(legacySettings.voiceLiveRepliesEnabled)) {
    patch.voiceLiveRepliesEnabled = legacySettings.voiceLiveRepliesEnabled;
  }
  if (Predicate.isBoolean(legacySettings.voiceAutoSpeakReplies)) {
    patch.voiceAutoSpeakReplies = legacySettings.voiceAutoSpeakReplies;
  }
  if (Predicate.isBoolean(legacySettings.voiceHighlightSpokenSentence)) {
    patch.voiceHighlightSpokenSentence = legacySettings.voiceHighlightSpokenSentence;
  }
  if (Predicate.isString(legacySettings.voiceModel)) {
    patch.voiceModel = legacySettings.voiceModel;
  }
  if (Predicate.isString(legacySettings.voiceName)) {
    patch.voiceName = legacySettings.voiceName;
  }
  if (Predicate.isString(legacySettings.voiceInputDeviceId)) {
    patch.voiceInputDeviceId = legacySettings.voiceInputDeviceId;
  }
  if (Predicate.isString(legacySettings.voicePlaybackRate)) {
    patch.voicePlaybackRate =
      legacySettings.voicePlaybackRate as ClientSettings["voicePlaybackRate"];
  }
  if (Predicate.isString(legacySettings.voiceSilenceDuration)) {
    patch.voiceSilenceDuration =
      legacySettings.voiceSilenceDuration as ClientSettings["voiceSilenceDuration"];
  }
  if (Predicate.isString(legacySettings.voiceInstructions)) {
    patch.voiceInstructions = legacySettings.voiceInstructions;
  }

  return patch;
}

export function migrateLocalSettingsToServer(): void {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY);
  if (!raw) return;

  try {
    const old = JSON.parse(raw);
    if (!Predicate.isObject(old)) return;

    const serverPatch = buildLegacyServerSettingsMigrationPatch(old);
    if (Object.keys(serverPatch).length > 0) {
      void ensureNativeApi().server.updateSettings(serverPatch);
    }

    const clientPatch = buildLegacyClientSettingsMigrationPatch(old);
    if (Object.keys(clientPatch).length > 0) {
      const existing = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
      const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
      localStorage.setItem(
        CLIENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...current, ...clientPatch }),
      );
    }
  } catch (error) {
    console.error("[MIGRATION] Error migrating local settings:", error);
  } finally {
    localStorage.removeItem(LEGACY_APP_SETTINGS_STORAGE_KEY);
  }
}
