import {
  StateEffect,
  StateField,
  EditorState,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  closeHoverTooltips,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import type { Finding } from "./passes";
export const setFindings = StateEffect.define<Finding[]>();
export const acknowledge = StateEffect.define<string[]>();
const openFinding = StateEffect.define<string | null>();
export const findingsField = StateField.define<Finding[]>({
  create: () => [],
  update(findings, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFindings)) findings = effect.value;
      if (effect.is(acknowledge))
        findings = findings.filter((f) => !effect.value.includes(f.id));
    }
    return tr.docChanged
      ? findings.map((f) => ({
          ...f,
          from: tr.changes.mapPos(f.from, 1),
          to: tr.changes.mapPos(f.to, -1),
        }))
      : findings;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (findings) =>
      Decoration.set(
        findings.map((f) =>
          Decoration.mark({
            class: "finding",
            attributes: {
              "data-finding": f.id,
              "aria-label": f.explanation,
              tabindex: "0",
              role: "button",
            },
          }).range(f.from, f.to),
        ),
        true,
      ),
    ),
});
function tooltip(f: Finding): Tooltip {
  return {
    pos: f.from,
    end: f.to,
    above: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "finding-tooltip";
      const title = document.createElement("strong");
      title.textContent = "A closer look";
      const text = document.createElement("p");
      text.textContent = f.explanation;
      const confidence = document.createElement("small");
      confidence.textContent = `${Math.round(f.probability * 100)}% Jev probability · Acknowledge to edit`;
      const button = document.createElement("button");
      button.textContent = "Acknowledge";
      button.className = "primary";
      button.onclick = () => {
        view.dispatch({
          effects: [acknowledge.of([f.id]), openFinding.of(null), closeHoverTooltips],
        });
        view.focus();
      };
      dom.append(title, text, confidence, button);
      return { dom };
    },
  };
}
const clickedTooltip = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(openFinding)) value = effect.value;
    return value && tr.state.field(findingsField).some((f) => f.id === value)
      ? value
      : null;
  },
  provide: (field) =>
    showTooltip.compute([field, findingsField], (state) => {
      const f = state
        .field(findingsField)
        .find((f) => f.id === state.field(field));
      return f ? tooltip(f) : null;
    }),
});
export function changesFlaggedText(tr: Transaction) {
  const findings = tr.startState.field(findingsField, false) || [];
  if (!tr.docChanged || !findings.length) return false;
  let blocked = false;
  tr.changes.iterChangedRanges((from, to) => {
    if (
      findings.some((f) =>
        from === to ? from > f.from && from < f.to : from < f.to && to > f.from,
      )
    )
      blocked = true;
  });
  return blocked;
}
export const protectFindings = EditorState.changeFilter.of(
  (tr) => !changesFlaggedText(tr),
);
export const findingExtensions = [
  findingsField,
  clickedTooltip,
  protectFindings,
  hoverTooltip(
    (view, pos) => {
      const f = view.state
        .field(findingsField)
        .find((f) => pos >= f.from && pos < f.to);
      return f ? tooltip(f) : null;
    },
    { hideOnChange: true, hoverTime: 200 },
  ),
  EditorView.domEventHandlers({
    dblclick(event, view) {
      const caret = document.caretPositionFromPoint?.(
        event.clientX,
        event.clientY,
      );
      const range = caret
        ? null
        : document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = caret?.offsetNode || range?.startContainer;
      const offset = caret?.offset ?? range?.startOffset;
      const pos =
        node && offset !== undefined && view.dom.contains(node)
          ? view.posAtDOM(node, offset)
          : view.posAtCoords({ x: event.clientX, y: event.clientY });
      const word = pos === null ? null : view.state.wordAt(pos);
      if (!word) return false;
      event.preventDefault();
      view.dispatch({ selection: { anchor: word.from, head: word.to } });
      view.focus();
      return true;
    },
    click(event, view) {
      if (event.detail > 1) return false;
      const el = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-finding]",
      );
      const finding = el?.dataset.finding || null;
      if (finding !== view.state.field(clickedTooltip))
        view.dispatch({ effects: openFinding.of(finding) });
      return false;
    },
    keydown(event, view) {
      const el = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-finding]",
      );
      if (el && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        view.dispatch({ effects: openFinding.of(el.dataset.finding!) });
        requestAnimationFrame(() =>
          view.dom
            .querySelector<HTMLButtonElement>(".finding-tooltip button")
            ?.focus(),
        );
        return true;
      }
      if (event.key === "Escape")
        view.dispatch({ effects: openFinding.of(null) });
      return false;
    },
  }),
];
export function visibleFindings(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return view.state.field(findingsField).filter(
    (f) =>
      view.visibleRanges.some((r) => f.from < r.to && f.to > r.from) &&
      (() => {
        const start = view.coordsAtPos(Math.max(f.from, view.viewport.from));
        const end = view.coordsAtPos(Math.min(f.to, view.viewport.to));
        return (
          !!start &&
          !!end &&
          end.bottom > Math.max(0, rect.top) &&
          start.top < Math.min(window.innerHeight, rect.bottom)
        );
      })(),
  );
}
export function removeFlags(view: EditorView, ids: string[]) {
  view.dispatch({
    effects: [acknowledge.of(ids), closeHoverTooltips],
    annotations: Transaction.addToHistory.of(false),
  });
}
