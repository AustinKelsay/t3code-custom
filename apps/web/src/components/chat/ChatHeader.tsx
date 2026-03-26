import {
  type ResolvedKeybindingsConfig,
  type ExecutionTargetId,
  type ProjectScript,
  type ThreadId,
  type VoiceSessionPhase,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, TerminalSquare } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { ThreadPageHeader } from "./ThreadPageHeader";
import { VoiceStatusBadge } from "./VoiceStatusBadge";

interface ChatHeaderProps {
  activeProjectColor: string | null;
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  diffToggleShortcutLabel: string | null;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  gitCwd: string | null;
  targetId: ExecutionTargetId;
  diffOpen: boolean;
  voicePhase: VoiceSessionPhase;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onReorderProjectScripts: (nextScripts: ProjectScript[]) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeProjectColor,
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  diffToggleShortcutLabel,
  terminalOpen,
  terminalToggleShortcutLabel,
  gitCwd,
  targetId,
  diffOpen,
  voicePhase,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onReorderProjectScripts,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  return (
    <ThreadPageHeader
      activeProjectColor={activeProjectColor}
      activeProjectName={activeProjectName}
      activeTab="chat"
      activeThreadId={activeThreadId}
      activeThreadTitle={activeThreadTitle}
      gitCwd={gitCwd}
      isGitRepo={isGitRepo}
      openInCwd={openInCwd}
      targetId={targetId}
    >
      <VoiceStatusBadge phase={voicePhase} />
      {activeProjectScripts && (
        <div className="hidden sm:block">
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
            onReorderScripts={onReorderProjectScripts}
          />
        </div>
      )}
      {activeProjectName && (
        <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} targetId={targetId} />
      )}
      {activeProjectName && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle project terminal"
                variant="outline"
                size="xs"
              >
                <TerminalSquare className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {terminalToggleShortcutLabel
              ? `Toggle project terminal (${terminalToggleShortcutLabel})`
              : "Toggle project terminal"}
          </TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="shrink-0"
              pressed={diffOpen}
              onPressedChange={onToggleDiff}
              aria-label="Toggle diff panel"
              variant="outline"
              size="xs"
              disabled={!isGitRepo}
            >
              <DiffIcon className="size-3" />
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">
          {!isGitRepo
            ? "Diff panel is unavailable because this project is not a git repository."
            : diffToggleShortcutLabel
              ? `Toggle diff panel (${diffToggleShortcutLabel})`
              : "Toggle diff panel"}
        </TooltipPopup>
      </Tooltip>
    </ThreadPageHeader>
  );
});
