import type { Element, Root } from "hast";
import { Check, Copy, type IconNode } from "lucide";
import { visit } from "unist-util-visit";

function icon(node: IconNode, className: string, strokeWidth: string): Element {
  return {
    type: "element",
    tagName: "svg",
    properties: {
      className: [className],
      viewBox: "0 0 24 24",
      width: "13",
      height: "13",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ariaHidden: "true",
    },
    children: node.map(([tagName, properties]) => ({
      type: "element",
      tagName,
      properties,
      children: [],
    })),
  };
}

function copyButton(): Element {
  return {
    type: "element",
    tagName: "button",
    properties: {
      type: "button",
      className: ["copy-button"],
      "data-copy": "idle",
      "aria-label": "Copy code",
    },
    children: [
      icon(Copy, "copy-icon-idle", "2"),
      icon(Check, "copy-icon-done", "2.4"),
      {
        type: "element",
        tagName: "span",
        properties: {},
        children: [{ type: "text", value: "Copy" }],
      },
    ],
  };
}

function isWrappable(node: Element): boolean {
  const classes = (node.properties?.className ?? []) as string[];
  if (node.tagName === "pre") return true;
  return node.tagName === "div" && classes.includes("terminal-block");
}

export function rehypeCodeWrap() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (index === undefined || !parent || parent.type === "element") {
        if (!parent || index === undefined) return;
      }
      if (!isWrappable(node)) return;
      const parentClasses = ((parent as Element).properties?.className ?? []) as string[];
      if (Array.isArray(parentClasses) && parentClasses.includes("code-wrap")) return;

      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["code-wrap"] },
        children: [node, copyButton()],
      };
      return "skip";
    });
  };
}
