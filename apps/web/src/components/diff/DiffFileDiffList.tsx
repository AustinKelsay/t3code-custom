import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import type { MouseEvent, ReactNode } from "react";

import { type DiffRenderMode } from "./DiffPanelHeader";
import { type FileDiffMetadata } from "@pierre/diffs/react";
import {
  buildFileDiffRenderKey,
  DIFF_PANEL_UNSAFE_CSS,
  resolveFileDiffPath,
} from "./diffRendering";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { cn } from "../../lib/utils";

type DiffThemeType = "light" | "dark";

function DiffFileDiffEntry(props: {
  diffRenderMode: DiffRenderMode;
  fileDiff: FileDiffMetadata;
  onClickCapture?: (event: MouseEvent<HTMLDivElement>) => void;
  renderKeyPrefix: string;
  resolvedTheme: DiffThemeType;
}) {
  const filePath = resolveFileDiffPath(props.fileDiff);
  const fileKey = buildFileDiffRenderKey(props.fileDiff);
  const themedFileKey = `${props.renderKeyPrefix}:${fileKey}:${props.resolvedTheme}`;

  return (
    <div
      key={themedFileKey}
      data-diff-file-path={filePath}
      className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
      onClickCapture={props.onClickCapture}
    >
      <FileDiff
        fileDiff={props.fileDiff}
        options={{
          diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
          lineDiffType: "none",
          theme: resolveDiffThemeName(props.resolvedTheme),
          themeType: props.resolvedTheme,
          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
        }}
      />
    </div>
  );
}

function DiffRenderCanvas(props: {
  children: ReactNode;
  className?: string;
  diffRenderMode: DiffRenderMode;
}) {
  return (
    <div
      className={
        props.className ??
        cn("diff-render-canvas min-w-full", props.diffRenderMode === "split" ? "w-full" : "w-max")
      }
      data-diff-render-mode={props.diffRenderMode}
    >
      {props.children}
    </div>
  );
}

export function DiffFileDiffList(props: {
  className: string;
  diffRenderMode: DiffRenderMode;
  fileDiffs: readonly FileDiffMetadata[];
  onFileClickCapture: (filePath: string) => (event: MouseEvent<HTMLDivElement>) => void;
  renderKeyPrefix: string;
  resolvedTheme: DiffThemeType;
  virtualized: boolean;
}) {
  if (!props.virtualized) {
    return (
      <div
        className={cn(
          props.className,
          props.diffRenderMode === "split" && "overflow-x-hidden overflow-y-auto",
        )}
        data-diff-render-mode={props.diffRenderMode}
      >
        <DiffRenderCanvas diffRenderMode={props.diffRenderMode}>
          {props.fileDiffs.map((fileDiff) => {
            const filePath = resolveFileDiffPath(fileDiff);
            return (
              <DiffFileDiffEntry
                key={`${props.renderKeyPrefix}:${buildFileDiffRenderKey(fileDiff)}:${props.resolvedTheme}`}
                diffRenderMode={props.diffRenderMode}
                fileDiff={fileDiff}
                onClickCapture={props.onFileClickCapture(filePath)}
                renderKeyPrefix={props.renderKeyPrefix}
                resolvedTheme={props.resolvedTheme}
              />
            );
          })}
        </DiffRenderCanvas>
      </div>
    );
  }

  return (
    <Virtualizer
      key={`${props.renderKeyPrefix}:virtualizer`}
      className={cn(
        props.className,
        props.diffRenderMode === "split" && "overflow-x-hidden overflow-y-auto",
      )}
      data-diff-render-mode={props.diffRenderMode}
      config={{
        overscrollSize: 600,
        intersectionObserverMargin: 1200,
      }}
    >
      <DiffRenderCanvas
        className={cn(
          "diff-render-canvas min-w-full",
          props.diffRenderMode === "split" ? "w-full" : "w-max",
        )}
        diffRenderMode={props.diffRenderMode}
      >
        {props.fileDiffs.map((fileDiff) => {
          const filePath = resolveFileDiffPath(fileDiff);
          return (
            <DiffFileDiffEntry
              key={`${props.renderKeyPrefix}:${buildFileDiffRenderKey(fileDiff)}:${props.resolvedTheme}`}
              diffRenderMode={props.diffRenderMode}
              fileDiff={fileDiff}
              onClickCapture={props.onFileClickCapture(filePath)}
              renderKeyPrefix={props.renderKeyPrefix}
              resolvedTheme={props.resolvedTheme}
            />
          );
        })}
      </DiffRenderCanvas>
    </Virtualizer>
  );
}
