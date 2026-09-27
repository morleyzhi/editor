import type { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";

class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

function lineStyles(view: EditorView) {
  const styles = new Map<number, Set<string>>();
  const bullets: Range<Decoration>[] = [];
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
        if (node.name === "BulletList" || node.name === "OrderedList") {
          const firstLine = doc.lineAt(node.from);
          const lastLine = doc.lineAt(Math.max(node.from, node.to - 1));
          add(lastLine.from, lastLine.to, "cm-list-end");
          for (const number of [firstLine.number - 1, lastLine.number + 1]) {
            if (number < 1 || number > doc.lines) continue;
            const line = doc.line(number);
            if (line.text === "") add(line.from, line.to, "cm-list-gap");
          }
        }
        if (node.name === "ListItem") {
          add(node.from, node.to, "cm-list-line");
          const line = doc.lineAt(node.from);
          const marker = /^(\s*)[-*](?=\s)/.exec(line.text);
          if (marker && line.from + marker[1].length >= node.from) {
            const from = line.from + marker[1].length;
            bullets.push(
              Decoration.replace({ widget: new BulletWidget() }).range(
                from,
                from + 1,
              ),
            );
          }
        }
        if (node.name === "FencedCode" || node.name === "CodeBlock")
          add(node.from, node.to, "cm-code-line");
      },
    });
  }
  return Decoration.set(
    [
      ...[...styles]
        .sort(([a], [b]) => a - b)
        .map(([from, classes]) =>
          Decoration.line({ class: [...classes].join(" ") }).range(from),
        ),
      ...bullets,
    ],
    true,
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
