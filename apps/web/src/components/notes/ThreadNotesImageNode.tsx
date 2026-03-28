import type { ReactElement } from "react";

import type { LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { $applyNodeReplacement, DecoratorNode as BaseDecoratorNode } from "lexical";
import { ThreadNotesImageComponent } from "./ThreadNotesImageComponent";

type SerializedThreadNotesImageNode = Spread<
  {
    altText: string;
    height?: number;
    src: string;
    type: "thread-notes-image";
    version: 1;
    width?: number;
  },
  SerializedLexicalNode
>;

export class ThreadNotesImageNode extends BaseDecoratorNode<ReactElement> {
  __altText: string;
  __height: "inherit" | number;
  __src: string;
  __width: "inherit" | number;

  static override getType(): string {
    return "thread-notes-image";
  }

  static override clone(node: ThreadNotesImageNode): ThreadNotesImageNode {
    return new ThreadNotesImageNode(
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedThreadNotesImageNode): ThreadNotesImageNode {
    return $createThreadNotesImageNode(
      serializedNode.src,
      serializedNode.altText,
      serializedNode.width ?? "inherit",
      serializedNode.height ?? "inherit",
    );
  }

  constructor(
    src: string,
    altText: string,
    width?: "inherit" | number,
    height?: "inherit" | number,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width ?? "inherit";
    this.__height = height ?? "inherit";
  }

  override exportJSON(): SerializedThreadNotesImageNode {
    return {
      ...super.exportJSON(),
      altText: this.__altText,
      ...(typeof this.__height === "number" ? { height: this.__height } : {}),
      src: this.__src,
      type: "thread-notes-image",
      version: 1,
      ...(typeof this.__width === "number" ? { width: this.__width } : {}),
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "thread-notes-image";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return this.__altText;
  }

  override isInline(): false {
    return false;
  }

  setWidthAndHeight(width: "inherit" | number, height: "inherit" | number) {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  override decorate(): ReactElement {
    return (
      <ThreadNotesImageComponent
        altText={this.__altText}
        className="block h-auto max-h-[32rem] max-w-full rounded-xl border bg-muted/20 object-contain shadow-sm"
        draggable
        dragWrapperClassName="relative my-4 inline-block max-w-full cursor-grab active:cursor-grabbing"
        height={this.__height}
        inline={false}
        nodeKey={this.__key}
        onResizeEnd={(width, height) => {
          const nextWidth = Number.isFinite(width) ? Math.round(width) : "inherit";
          const nextHeight = Number.isFinite(height) ? Math.round(height) : "inherit";
          this.setWidthAndHeight(nextWidth, nextHeight);
        }}
        src={this.__src}
        width={this.__width}
      />
    );
  }
}

export function $createThreadNotesImageNode(
  src: string,
  altText: string,
  width?: "inherit" | number,
  height?: "inherit" | number,
): ThreadNotesImageNode {
  return $applyNodeReplacement(new ThreadNotesImageNode(src, altText, width, height));
}

export function $isThreadNotesImageNode(
  node: LexicalNode | null | undefined,
): node is ThreadNotesImageNode {
  return node instanceof ThreadNotesImageNode;
}
