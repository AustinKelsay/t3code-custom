import type { ReactElement } from "react";

import type { LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { $applyNodeReplacement, DecoratorNode as BaseDecoratorNode } from "lexical";

import { ThreadNotesImageComponent } from "./ThreadNotesImageComponent";

type SerializedThreadNotesInlineImageNode = Spread<
  {
    altText: string;
    src: string;
    type: "thread-notes-inline-image";
    version: 1;
  },
  SerializedLexicalNode
>;

export class ThreadNotesInlineImageNode extends BaseDecoratorNode<ReactElement> {
  __altText: string;
  __src: string;

  static override getType(): string {
    return "thread-notes-inline-image";
  }

  static override clone(node: ThreadNotesInlineImageNode): ThreadNotesInlineImageNode {
    return new ThreadNotesInlineImageNode(node.__src, node.__altText, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedThreadNotesInlineImageNode,
  ): ThreadNotesInlineImageNode {
    return $createThreadNotesInlineImageNode(serializedNode.src, serializedNode.altText);
  }

  constructor(src: string, altText: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
  }

  override exportJSON(): SerializedThreadNotesInlineImageNode {
    return {
      ...super.exportJSON(),
      altText: this.__altText,
      src: this.__src,
      type: "thread-notes-inline-image",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "thread-notes-inline-image";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return this.__altText;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): ReactElement {
    return (
      <ThreadNotesImageComponent
        altText={this.__altText}
        className="inline-block h-auto max-h-[32rem] max-w-full rounded-md border bg-muted/20 object-contain align-middle shadow-sm"
        draggable={false}
        dragWrapperClassName="mx-1 inline-flex align-middle"
        inline
        nodeKey={this.__key}
        src={this.__src}
      />
    );
  }
}

export function $createThreadNotesInlineImageNode(
  src: string,
  altText: string,
): ThreadNotesInlineImageNode {
  return $applyNodeReplacement(new ThreadNotesInlineImageNode(src, altText));
}

export function $isThreadNotesInlineImageNode(
  node: LexicalNode | null | undefined,
): node is ThreadNotesInlineImageNode {
  return node instanceof ThreadNotesInlineImageNode;
}
