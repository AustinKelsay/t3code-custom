import type { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, MenuIcon } from "lucide-react";
import { memo, useCallback } from "react";
import {
  buildThreadTabParams,
  getThreadTabLabel,
  getThreadTabRoute,
  THREAD_SESSION_TABS,
  type ThreadSessionTab,
} from "../../threadTabs";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { cn } from "~/lib/utils";
import type { Icon } from "../Icons";

interface ThreadHeaderMenuAction {
  icon?: Icon;
  id: string;
  label: string;
  onSelect: () => void;
}

interface ThreadHeaderTabsProps {
  activeTab: ThreadSessionTab;
  extraActions?: ReadonlyArray<ThreadHeaderMenuAction>;
  mode: "inline" | "menu";
  threadId: ThreadId;
}

export const ThreadHeaderTabs = memo(function ThreadHeaderTabs({
  activeTab,
  extraActions = [],
  mode,
  threadId,
}: ThreadHeaderTabsProps) {
  const navigate = useNavigate();
  const navigateToTab = useCallback(
    (tab: ThreadSessionTab) => {
      if (tab === activeTab) {
        return;
      }
      void navigate({
        to: getThreadTabRoute(tab),
        params: buildThreadTabParams(threadId),
      });
    },
    [activeTab, navigate, threadId],
  );

  if (mode === "menu") {
    return (
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={`Switch thread page. Current page: ${getThreadTabLabel(activeTab)}.`}
              size="icon-xs"
              variant="outline"
            />
          }
        >
          <MenuIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {THREAD_SESSION_TABS.map((tab) => (
            <MenuItem key={tab.value} onClick={() => navigateToTab(tab.value)}>
              {tab.value === activeTab ? (
                <CheckIcon className="size-4" />
              ) : (
                <span className="size-4" />
              )}
              {tab.label}
            </MenuItem>
          ))}
          {extraActions.length > 0 && <MenuSeparator />}
          {extraActions.map((action) => {
            const Icon = action.icon;
            return (
              <MenuItem key={action.id} onClick={action.onSelect}>
                {Icon ? <Icon className="size-4" /> : <span className="size-4" />}
                {action.label}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
    );
  }

  return (
    <div
      aria-label="Thread page tabs"
      className="inline-flex items-center rounded-lg bg-muted/45 p-1"
      role="tablist"
    >
      {THREAD_SESSION_TABS.map((tab) => (
        <Button
          key={tab.value}
          aria-label={tab.label}
          aria-selected={tab.value === activeTab}
          className={cn(
            "rounded-md border-transparent px-3 text-sm shadow-none",
            tab.value === activeTab
              ? "bg-background text-foreground shadow-xs/5"
              : "bg-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
          role="tab"
          size="xs"
          variant="ghost"
          onClick={() => navigateToTab(tab.value)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
});
