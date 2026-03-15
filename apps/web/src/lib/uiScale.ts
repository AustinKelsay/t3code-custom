export const UI_SCALE_OPTIONS = ["small", "medium", "large", "xl", "xxl"] as const;

export type UiScale = (typeof UI_SCALE_OPTIONS)[number];

const DEFAULT_UI_SCALE: UiScale = "medium";
const UI_SCALE_INDEX_BY_VALUE: Record<UiScale, number> = {
  small: 0,
  medium: 1,
  large: 2,
  xl: 3,
  xxl: 4,
};

const ROOT_FONT_SIZE_PX_BY_UI_SCALE: Record<UiScale, number> = {
  small: 14,
  medium: 16,
  large: 18,
  xl: 20,
  xxl: 22,
};

const TERMINAL_FONT_SIZE_PX_BY_UI_SCALE: Record<UiScale, number> = {
  small: 11,
  medium: 12,
  large: 14,
  xl: 16,
  xxl: 18,
};

export function resolveUiScale(value: string | null | undefined): UiScale {
  return UI_SCALE_OPTIONS.includes(value as UiScale) ? (value as UiScale) : DEFAULT_UI_SCALE;
}

export function rootFontSizePxForUiScale(scale: UiScale): number {
  return ROOT_FONT_SIZE_PX_BY_UI_SCALE[scale];
}

export function terminalFontSizePxForUiScale(scale: UiScale): number {
  return TERMINAL_FONT_SIZE_PX_BY_UI_SCALE[scale];
}

export function shiftUiScale(scale: UiScale, offset: number): UiScale {
  const currentIndex = UI_SCALE_INDEX_BY_VALUE[scale];
  const nextIndex = Math.max(0, Math.min(UI_SCALE_OPTIONS.length - 1, currentIndex + offset));
  return UI_SCALE_OPTIONS[nextIndex] ?? DEFAULT_UI_SCALE;
}

export function toolCallFontSizeRemForUiScale(scale: UiScale): string {
  const currentRootFontSizePx = rootFontSizePxForUiScale(scale);
  const targetRootFontSizePx = rootFontSizePxForUiScale(shiftUiScale(scale, -1));
  return `${targetRootFontSizePx / currentRootFontSizePx}rem`;
}

export function toolCallMetaFontSizeRemForUiScale(scale: UiScale): string {
  const currentRootFontSizePx = rootFontSizePxForUiScale(scale);
  const targetRootFontSizePx = rootFontSizePxForUiScale(shiftUiScale(scale, -1));
  const metaFontSizePx = Math.max(11, targetRootFontSizePx - 2);
  return `${metaFontSizePx / currentRootFontSizePx}rem`;
}

export function readUiScaleFromDocument(): UiScale {
  return resolveUiScale(document.documentElement.dataset.uiScale);
}
