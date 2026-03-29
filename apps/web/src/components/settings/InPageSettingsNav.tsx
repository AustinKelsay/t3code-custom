import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  ArchiveIcon,
  AudioLinesIcon,
  BotIcon,
  FolderGit2Icon,
  MonitorCogIcon,
  ShieldIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

export type InPageSettingsSectionId =
  | "appearance"
  | "remote-access"
  | "providers"
  | "models"
  | "threads"
  | "archived"
  | "responses"
  | "voice"
  | "advanced";

const NAV_ITEMS: ReadonlyArray<{
  id: InPageSettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "appearance", label: "Appearance", icon: MonitorCogIcon },
  { id: "remote-access", label: "Remote access", icon: WrenchIcon },
  { id: "providers", label: "Provider installs", icon: BotIcon },
  { id: "models", label: "Models", icon: SparklesIcon },
  { id: "threads", label: "Threads", icon: FolderGit2Icon },
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "responses", label: "Responses", icon: SparklesIcon },
  { id: "voice", label: "Voice", icon: AudioLinesIcon },
  { id: "advanced", label: "Advanced", icon: ShieldIcon },
] as const;

function scrollToSection(id: InPageSettingsSectionId) {
  const element = document.getElementById(id);
  if (!element) return;
  const scrollContainer = document.querySelector<HTMLElement>("[data-settings-scroll-container]");
  window.history.replaceState(null, "", `#${id}`);
  if (!scrollContainer) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = scrollContainer.scrollTop + (elementRect.top - containerRect.top) - 12;
  scrollContainer.scrollTo({
    top: Math.max(0, top),
    behavior: "smooth",
  });
}

export function InPageSettingsNav() {
  const [activeId, setActiveId] = useState<InPageSettingsSectionId>("appearance");

  useEffect(() => {
    const updateActiveId = () => {
      const hash = window.location.hash.slice(1);
      if (
        hash === "appearance" ||
        hash === "remote-access" ||
        hash === "providers" ||
        hash === "models" ||
        hash === "threads" ||
        hash === "archived" ||
        hash === "responses" ||
        hash === "voice" ||
        hash === "advanced"
      ) {
        setActiveId(hash);
      }
    };

    updateActiveId();
    window.addEventListener("hashchange", updateActiveId);
    return () => window.removeEventListener("hashchange", updateActiveId);
  }, []);

  return (
    <nav className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Sections
      </div>

      <div className="hidden lg:block">
        <div className="sticky top-3 overflow-hidden rounded-2xl border bg-card p-2 shadow-xs/5">
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-foreground",
                    isActive ? "bg-accent text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", isActive && "text-foreground")} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "border-border bg-accent text-foreground"
                    : "border-border/70 bg-background text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
