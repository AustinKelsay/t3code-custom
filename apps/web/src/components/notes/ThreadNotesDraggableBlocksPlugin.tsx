import { DraggableBlockPlugin_EXPERIMENTAL } from "@lexical/react/LexicalDraggableBlockPlugin";
import { GripVerticalIcon } from "lucide-react";
import { useRef } from "react";

const DRAGGABLE_MENU_CLASS_NAME = "thread-notes-draggable-block-menu";

function isOnMenu(element: HTMLElement): boolean {
  return element.closest(`.${DRAGGABLE_MENU_CLASS_NAME}`) !== null;
}

export function ThreadNotesDraggableBlocksPlugin(props: { anchorElem: HTMLElement }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={props.anchorElem}
      isOnMenu={isOnMenu}
      menuComponent={
        <div
          ref={menuRef}
          className={`${DRAGGABLE_MENU_CLASS_NAME} pointer-events-auto rounded-md border border-border/80 bg-background/95 p-1 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground`}
        >
          <GripVerticalIcon className="size-4 cursor-grab active:cursor-grabbing" />
        </div>
      }
      menuRef={menuRef}
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none h-1 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_50%,transparent),0_0_18px_color-mix(in_oklab,var(--color-primary)_22%,transparent)]"
        />
      }
      targetLineRef={targetLineRef}
    />
  );
}
