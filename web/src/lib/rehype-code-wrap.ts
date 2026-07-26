import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

const COPY_ICON: Element = {
  type: "element",
  tagName: "svg",
  properties: {
    viewBox: "0 0 24 24",
    width: "13",
    height: "13",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ariaHidden: "true",
  },
  children: [
    {
      type: "element",
      tagName: "rect",
      properties: { x: "9", y: "9", width: "12", height: "12", rx: "2" },
      children: [],
    },
    {
      type: "element",
      tagName: "path",
      properties: { d: "M5 15V5a2 2 0 0 1 2-2h10" },
      children: [],
    },
  ],
};

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
      COPY_ICON,
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
