import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { type MouseEvent, type ReactNode, useRef } from "react";

import { type DiffRenderMode } from "./DiffPanelHeader";
import { type FileDiffMetadata } from "@pierre/diffs/react";
import {
  buildFileDiffRenderKey,
  DIFF_PANEL_UNSAFE_CSS,
  resolveFileDiffPath,
} from "./diffRendering";
import { useMobileStackedDiffPan } from "./useMobileStackedDiffPan";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { cn } from "../../lib/utils";

type DiffThemeType = "light" | "dark";

function DiffFileDiffEntry(props: {
  diffRenderMode: DiffRenderMode;
  diffWordWrap: boolean;
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
      data-diff-render-mode={props.diffRenderMode}
      className={cn(
        "diff-render-file mb-2 rounded-md first:mt-2 last:mb-0",
        props.diffRenderMode === "split" || props.diffWordWrap ? "w-full" : "min-w-full w-max",
      )}
      onClickCapture={props.onClickCapture}
    >
      <FileDiff
        className="diff-render-host"
        fileDiff={props.fileDiff}
        options={{
          diffStyle: props.diffRenderMode === "split" ? "split" : "unified",
          lineDiffType: "none",
          overflow: props.diffWordWrap ? "wrap" : "scroll",
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
  diffWordWrap: boolean;
}) {
  return (
    <div
      className={
        props.className ??
        cn(
          "diff-render-canvas min-w-full",
          props.diffRenderMode === "split" || props.diffWordWrap ? "w-full" : "w-max",
        )
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
  diffWordWrap: boolean;
  fileDiffs: readonly FileDiffMetadata[];
  onFileClickCapture: (filePath: string) => (event: MouseEvent<HTMLDivElement>) => void;
  renderKeyPrefix: string;
  resolvedTheme: DiffThemeType;
  virtualized: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useMobileStackedDiffPan(rootRef, props.diffRenderMode === "stacked");

  return (
    <div ref={rootRef} className="h-full min-h-0">
      {!props.virtualized ? (
        <div
          className={cn(
            props.className,
            (props.diffRenderMode === "split" || props.diffWordWrap) &&
              "overflow-x-hidden overflow-y-auto",
          )}
          data-diff-render-mode={props.diffRenderMode}
        >
          <DiffRenderCanvas diffRenderMode={props.diffRenderMode} diffWordWrap={props.diffWordWrap}>
            {props.fileDiffs.map((fileDiff) => {
              const filePath = resolveFileDiffPath(fileDiff);
              return (
                <DiffFileDiffEntry
                  key={`${props.renderKeyPrefix}:${buildFileDiffRenderKey(fileDiff)}:${props.resolvedTheme}`}
                  diffRenderMode={props.diffRenderMode}
                  diffWordWrap={props.diffWordWrap}
                  fileDiff={fileDiff}
                  onClickCapture={props.onFileClickCapture(filePath)}
                  renderKeyPrefix={props.renderKeyPrefix}
                  resolvedTheme={props.resolvedTheme}
                />
              );
            })}
          </DiffRenderCanvas>
        </div>
      ) : (
        <Virtualizer
          key={`${props.renderKeyPrefix}:virtualizer`}
          className={cn(
            props.className,
            (props.diffRenderMode === "split" || props.diffWordWrap) &&
              "overflow-x-hidden overflow-y-auto",
          )}
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          <DiffRenderCanvas
            className={cn(
              "diff-render-canvas min-w-full",
              props.diffRenderMode === "split" || props.diffWordWrap ? "w-full" : "w-max",
            )}
            diffRenderMode={props.diffRenderMode}
            diffWordWrap={props.diffWordWrap}
          >
            {props.fileDiffs.map((fileDiff) => {
              const filePath = resolveFileDiffPath(fileDiff);
              return (
                <DiffFileDiffEntry
                  key={`${props.renderKeyPrefix}:${buildFileDiffRenderKey(fileDiff)}:${props.resolvedTheme}`}
                  diffRenderMode={props.diffRenderMode}
                  diffWordWrap={props.diffWordWrap}
                  fileDiff={fileDiff}
                  onClickCapture={props.onFileClickCapture(filePath)}
                  renderKeyPrefix={props.renderKeyPrefix}
                  resolvedTheme={props.resolvedTheme}
                />
              );
            })}
          </DiffRenderCanvas>
        </Virtualizer>
      )}
    </div>
  );
}
