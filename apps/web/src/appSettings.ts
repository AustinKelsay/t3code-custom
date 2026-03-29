import { useCallback, useEffect, useMemo } from "react";
import { Option, Schema } from "effect";
import {
  ClientSettingsSchema,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  DEFAULT_UNIFIED_SETTINGS,
  DEFAULT_VOICE_INSTRUCTIONS,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  TrimmedNonEmptyString,
  UiScale,
  VoicePlaybackRate,
  VoiceSilenceDuration,
  type ProviderStartOptions,
  type ProviderKind,
  type UnifiedSettings,
  type ModelSelection,
  type UiScale as UiScaleType,
} from "@t3tools/contracts";
import {
  inferProviderForModel,
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { getLocalStorageItem } from "./hooks/useLocalStorage";
import { useIsMobile } from "./hooks/useMediaQuery";
import { EnvMode } from "./components/BranchToolbar.logic";
import { CLIENT_SETTINGS_STORAGE_KEY, useSettings, useUpdateSettings } from "./hooks/useSettings";
import { normalizeRealtimeVoiceName } from "./voice/realtimeVoice";

export {
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  DEFAULT_VOICE_INSTRUCTIONS,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  type UiScaleType as UiScale,
  type VoicePlaybackRate,
  type VoiceSilenceDuration,
};

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const DEFAULT_VOICE_PLAYBACK_RATE_VALUE = 1.5;
export const DEFAULT_VOICE_SILENCE_DURATION_MS = 3000;
type CustomModelSettingsKey = "customCodexModels" | "customClaudeModels";
export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  settingsKey: CustomModelSettingsKey;
  defaultSettingsKey: CustomModelSettingsKey;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
};

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

export const AppSettingsSchema = Schema.Struct({
  claudeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  confirmThreadArchive: Schema.Boolean.pipe(withDefaults(() => true)),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),
  diffWordWrap: Schema.Boolean.pipe(withDefaults(() => false)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  voiceEnabled: Schema.Boolean.pipe(withDefaults(() => true)),
  voiceInputEnabled: Schema.Boolean.pipe(withDefaults(() => true)),
  voiceWakePhraseEnabled: Schema.Boolean.pipe(withDefaults(() => false)),
  voiceLiveRepliesEnabled: Schema.Boolean.pipe(withDefaults(() => false)),
  voiceAutoSpeakReplies: Schema.Boolean.pipe(withDefaults(() => true)),
  voiceHighlightSpokenSentence: Schema.Boolean.pipe(withDefaults(() => true)),
  voiceModel: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  voiceName: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  voiceInputDeviceId: Schema.String.check(Schema.isMaxLength(512)).pipe(withDefaults(() => "")),
  voicePlaybackRate: VoicePlaybackRate.pipe(withDefaults(() => "1.5" as const)),
  voiceSilenceDuration: VoiceSilenceDuration.pipe(withDefaults(() => "3.0" as const)),
  voiceInstructions: Schema.String.check(Schema.isMaxLength(2048)).pipe(
    withDefaults(() => DEFAULT_VOICE_INSTRUCTIONS),
  ),
  timestampFormat: TimestampFormat.pipe(withDefaults(() => DEFAULT_TIMESTAMP_FORMAT)),
  uiScale: Schema.Literals(["small", "medium", "large", "xl", "xxl"]).pipe(
    withDefaults(() => "medium" as const),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customClaudeModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

function getDefaultAppSettings(options?: { isMobile?: boolean }): AppSettings {
  const defaults = flattenUnifiedSettings(DEFAULT_UNIFIED_SETTINGS);
  if (!options?.isMobile) {
    return defaults;
  }

  return {
    ...defaults,
    voiceInputEnabled: false,
    voiceWakePhraseEnabled: false,
  };
}

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    settingsKey: "customCodexModels",
    defaultSettingsKey: "customCodexModels",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    settingsKey: "customClaudeModels",
    defaultSettingsKey: "customClaudeModels",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
};
export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

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

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    voiceName: normalizeRealtimeVoiceName(settings.voiceName) ?? "",
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeAgent"),
  };
}

function flattenUnifiedSettings(settings: UnifiedSettings): AppSettings {
  return normalizeAppSettings({
    claudeBinaryPath:
      settings.providers.claudeAgent.binaryPath ===
      DEFAULT_SERVER_SETTINGS.providers.claudeAgent.binaryPath
        ? ""
        : settings.providers.claudeAgent.binaryPath,
    codexBinaryPath:
      settings.providers.codex.binaryPath === DEFAULT_SERVER_SETTINGS.providers.codex.binaryPath
        ? ""
        : settings.providers.codex.binaryPath,
    codexHomePath: settings.providers.codex.homePath,
    defaultThreadEnvMode: settings.defaultThreadEnvMode,
    confirmThreadArchive: settings.confirmThreadArchive,
    confirmThreadDelete: settings.confirmThreadDelete,
    diffWordWrap: settings.diffWordWrap,
    enableAssistantStreaming: settings.enableAssistantStreaming,
    sidebarProjectSortOrder: settings.sidebarProjectSortOrder,
    sidebarThreadSortOrder: settings.sidebarThreadSortOrder,
    voiceEnabled: settings.voiceEnabled,
    voiceInputEnabled: settings.voiceInputEnabled,
    voiceWakePhraseEnabled: settings.voiceWakePhraseEnabled,
    voiceLiveRepliesEnabled: settings.voiceLiveRepliesEnabled,
    voiceAutoSpeakReplies: settings.voiceAutoSpeakReplies,
    voiceHighlightSpokenSentence: settings.voiceHighlightSpokenSentence,
    voiceModel: settings.voiceModel,
    voiceName: settings.voiceName,
    voiceInputDeviceId: settings.voiceInputDeviceId,
    voicePlaybackRate: settings.voicePlaybackRate,
    voiceSilenceDuration: settings.voiceSilenceDuration,
    voiceInstructions: settings.voiceInstructions,
    timestampFormat: settings.timestampFormat,
    uiScale: settings.uiScale,
    customCodexModels: settings.providers.codex.customModels,
    customClaudeModels: settings.providers.claudeAgent.customModels,
    textGenerationModel: settings.textGenerationModelSelection.model,
  });
}

function toUnifiedPatch(patch: Partial<AppSettings>): Partial<UnifiedSettings> {
  const next: Record<string, unknown> = {};

  if (patch.claudeBinaryPath !== undefined) {
    next.providers = {
      ...(next.providers as Record<string, unknown> | undefined),
      claudeAgent: {
        ...((next.providers as Record<string, any> | undefined)?.claudeAgent as
          | Record<string, unknown>
          | undefined),
        binaryPath: patch.claudeBinaryPath,
      },
    };
  }

  if (patch.codexBinaryPath !== undefined || patch.codexHomePath !== undefined) {
    next.providers = {
      ...(next.providers as Record<string, unknown> | undefined),
      codex: {
        ...((next.providers as Record<string, any> | undefined)?.codex as
          | Record<string, unknown>
          | undefined),
        ...(patch.codexBinaryPath !== undefined ? { binaryPath: patch.codexBinaryPath } : {}),
        ...(patch.codexHomePath !== undefined ? { homePath: patch.codexHomePath } : {}),
      },
    };
  }

  if (patch.customCodexModels !== undefined || patch.customClaudeModels !== undefined) {
    next.providers = {
      ...(next.providers as Record<string, unknown> | undefined),
      ...(patch.customCodexModels !== undefined
        ? {
            codex: {
              ...((next.providers as Record<string, any> | undefined)?.codex as
                | Record<string, unknown>
                | undefined),
              customModels: patch.customCodexModels,
            },
          }
        : {}),
      ...(patch.customClaudeModels !== undefined
        ? {
            claudeAgent: {
              ...((next.providers as Record<string, any> | undefined)?.claudeAgent as
                | Record<string, unknown>
                | undefined),
              customModels: patch.customClaudeModels,
            },
          }
        : {}),
    };
  }

  if (patch.textGenerationModel !== undefined) {
    const trimmed = patch.textGenerationModel?.trim();
    if (trimmed) {
      next.textGenerationModelSelection = {
        provider: inferProviderForModel(trimmed, "codex"),
        model: trimmed,
      } satisfies ModelSelection;
    }
  }

  const passthroughKeys = [
    "defaultThreadEnvMode",
    "confirmThreadArchive",
    "confirmThreadDelete",
    "diffWordWrap",
    "enableAssistantStreaming",
    "sidebarProjectSortOrder",
    "sidebarThreadSortOrder",
    "voiceEnabled",
    "voiceInputEnabled",
    "voiceWakePhraseEnabled",
    "voiceLiveRepliesEnabled",
    "voiceAutoSpeakReplies",
    "voiceHighlightSpokenSentence",
    "voiceModel",
    "voiceName",
    "voiceInputDeviceId",
    "voicePlaybackRate",
    "voiceSilenceDuration",
    "voiceInstructions",
    "timestampFormat",
    "uiScale",
  ] as const satisfies ReadonlyArray<keyof AppSettings & keyof UnifiedSettings>;

  for (const key of passthroughKeys) {
    if (patch[key] !== undefined) {
      next[key] = patch[key];
    }
  }

  return next as Partial<UnifiedSettings>;
}

export function getCustomModelsForProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return settings[PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey];
}

export function getDefaultCustomModelsForProvider(
  defaults: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return defaults[PROVIDER_CUSTOM_MODEL_CONFIG[provider].defaultSettingsKey];
}

export function patchCustomModels(
  provider: ProviderKind,
  models: string[],
): Partial<Pick<AppSettings, CustomModelSettingsKey>> {
  return {
    [PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey]: models,
  };
}

export function getCustomModelsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, readonly string[]> {
  return {
    codex: getCustomModelsForProvider(settings, "codex"),
    claudeAgent: getCustomModelsForProvider(settings, "claudeAgent"),
  };
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
): string {
  const customModelsForProvider = customModels[provider];
  const options = getAppModelOptions(provider, customModelsForProvider, selectedModel);
  return resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider);
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions("codex", customModelsByProvider.codex),
    claudeAgent: getAppModelOptions("claudeAgent", customModelsByProvider.claudeAgent),
  };
}

export function getGitTextGenerationModelOptions(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): ReadonlyArray<{ slug: string; name: string }> {
  const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);
  return [...modelOptionsByProvider.codex, ...modelOptionsByProvider.claudeAgent];
}

export function resolveVoicePlaybackRateValue(value: string | null | undefined): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_VOICE_PLAYBACK_RATE_VALUE;
  }
  return parsedValue;
}

export function resolveVoiceSilenceDurationMs(value: string | null | undefined): number {
  const parsedValue = Math.round(Number(value) * 1000);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_VOICE_SILENCE_DURATION_MS;
  }
  return parsedValue;
}

export function getProviderStartOptions(
  settings: Pick<AppSettings, "claudeBinaryPath" | "codexBinaryPath" | "codexHomePath">,
): ProviderStartOptions | undefined {
  const providerOptions: ProviderStartOptions = {
    ...(settings.codexBinaryPath || settings.codexHomePath
      ? {
          codex: {
            ...(settings.codexBinaryPath ? { binaryPath: settings.codexBinaryPath } : {}),
            ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
          },
        }
      : {}),
    ...(settings.claudeBinaryPath
      ? {
          claudeAgent: {
            binaryPath: settings.claudeBinaryPath,
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

export function useAppSettings() {
  const isMobile = useIsMobile();
  const platformDefaults = useMemo(() => getDefaultAppSettings({ isMobile }), [isMobile]);
  const settings = useSettings(flattenUnifiedSettings);
  const { updateSettings: updateUnifiedSettings } = useUpdateSettings();

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      updateUnifiedSettings(toUnifiedPatch(normalizeAppSettings({ ...settings, ...patch })));
    },
    [settings, updateUnifiedSettings],
  );

  const resetSettings = useCallback(() => {
    updateUnifiedSettings(toUnifiedPatch(platformDefaults));
  }, [platformDefaults, updateUnifiedSettings]);

  const persistedClientSettings = getLocalStorageItem(
    CLIENT_SETTINGS_STORAGE_KEY,
    ClientSettingsSchema,
  );
  useEffect(() => {
    if (persistedClientSettings !== null || !isMobile) {
      return;
    }
    updateUnifiedSettings({
      voiceInputEnabled: false,
      voiceWakePhraseEnabled: false,
    });
  }, [isMobile, persistedClientSettings, updateUnifiedSettings]);

  const defaults =
    persistedClientSettings !== null || !isMobile
      ? platformDefaults
      : {
          ...platformDefaults,
          voiceInputEnabled: false,
          voiceWakePhraseEnabled: false,
        };

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults,
  } as const;
}
