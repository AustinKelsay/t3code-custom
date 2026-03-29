import { memo, useCallback, useEffect, useState } from "react";
import type { ProjectId } from "@t3tools/contracts";
import { readNativeApi } from "../nativeApi";
import { newCommandId } from "../lib/utils";
import { ColorPickerPopover, COLOR_PICKER_PRESETS } from "./ColorPickerPopover";

/**
 * Preset project colors – visually distinct, work in both light and dark mode.
 */
export const PROJECT_COLOR_PRESETS = COLOR_PICKER_PRESETS;

interface ProjectColorPickerProps {
  projectId: ProjectId;
  /** Current color (hex) or null if no color set */
  currentColor: string | null;
}

async function updateProjectColor(projectId: ProjectId, color: string | null) {
  const api = readNativeApi();
  if (!api) {
    console.error("[ProjectColorPicker] No native API available");
    return;
  }
  try {
    console.log("[ProjectColorPicker] Dispatching color update", { projectId, color });
    const result = await api.orchestration.dispatchCommand({
      type: "project.meta.update",
      commandId: newCommandId(),
      projectId,
      color,
    });
    console.log("[ProjectColorPicker] Color update result", result);
  } catch (error) {
    console.error("[ProjectColorPicker] Failed to update color", error);
  }
}

export const ProjectColorPicker = memo(function ProjectColorPicker({
  projectId,
  currentColor,
}: ProjectColorPickerProps) {
  const [optimisticColor, setOptimisticColor] = useState<string | null>(currentColor);
  const resolvedColor = optimisticColor ?? currentColor;

  useEffect(() => {
    setOptimisticColor(currentColor);
  }, [currentColor]);

  const handleChange = useCallback(
    (color: string | null) => {
      setOptimisticColor(color);
      void updateProjectColor(projectId, color);
    },
    [projectId],
  );

  return (
    <ColorPickerPopover
      ariaLabel="Set project color"
      currentColor={resolvedColor}
      title="Set project color"
      onChange={handleChange}
    />
  );
});
