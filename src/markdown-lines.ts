import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

function lineStyles(view: EditorView) {
  const styles = new Map<number, Set<string>>();
  const { doc } = view.state;
  const add = (from: number, to: number, style: string) => {
    for (
      let line = doc.lineAt(from).number;
      line <= doc.lineAt(Math.max(from, to - 1)).number;
      line++
    ) {
      const item = doc.line(line);
      if (
        !view.visibleRanges.some(
          (range) => item.from <= range.to && item.to >= range.from,
        )
      )
        continue;
      if (!styles.has(item.from)) styles.set(item.from, new Set());
      styles.get(item.from)!.add(style);
    }
  };
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name === "ListItem") add(node.from, node.to, "cm-list-line");
        if (node.name === "FencedCode" || node.name === "CodeBlock")
          add(node.from, node.to, "cm-code-line");
      },
    });
  }
  return Decoration.set(
    [...styles]
      .sort(([a], [b]) => a - b)
      .map(([from, classes]) =>
        Decoration.line({ class: [...classes].join(" ") }).range(from),
      ),
  );
}

export const markdownLines = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = lineStyles(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged)
        this.decorations = lineStyles(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
