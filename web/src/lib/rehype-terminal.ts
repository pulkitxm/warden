import type { Element, Root, Text } from "hast";
import { visit } from "unist-util-visit";
import { classifyTerminal } from "./terminal";

function textOf(node: Element): string {
  return node.children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");
}

export function rehypeTerminal() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || index === undefined || !parent) return;
      const code = node.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "code",
      );
      if (!code) return;
      const classes = (code.properties?.className ?? []) as string[];
      const isTerminal =
        classes.includes("language-term") ||
        classes.includes("language-text") ||
        classes.includes("language-console") ||
        classes.includes("language-shell-session");
      if (!isTerminal) return;

      const lines = classifyTerminal(textOf(code));
      const rendered: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["terminal-block"] },
        children: [
          {
            type: "element",
            tagName: "pre",
            properties: { className: ["terminal"] },
            children: [
              {
                type: "element",
                tagName: "code",
                properties: {},
                children: lines.map((tokens) => ({
                  type: "element" as const,
                  tagName: "span",
                  properties: { className: ["line"] },
                  children: [
                    ...tokens.map((token) => ({
                      type: "element" as const,
                      tagName: "span",
                      properties: token.cls ? { className: [token.cls] } : {},
                      children: [{ type: "text" as const, value: token.text }],
                    })),
                    { type: "text" as const, value: "\n" },
                  ],
                })),
              },
            ],
          },
        ],
      };

      parent.children[index] = rendered;
    });
  };
}
