import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, historyField, undo, redo } from "@codemirror/commands";
import {
  findingsField,
  changesFlaggedText,
  setFindings,
  acknowledge,
  protectFindings,
} from "../src/findings";
import { passes, spansFor, makeRequest, readAnswers } from "../src/passes";
const extensions = [history(), findingsField, protectFindings];
function flagged() {
  let state = EditorState.create({ doc: "A very useful piece.", extensions });
  return state.update({
    effects: setFindings.of([
      {
        id: "a",
        from: 2,
        to: 6,
        text: "very",
        passId: "filler",
        explanation: "Padding",
        probability: 0.95,
      },
    ]),
  }).state;
}
describe("Protected findings", () => {
  it("blocks typing inside a highlighted word", () => {
    const s = flagged();
    expect(
      s.update({ changes: { from: 3, insert: "x" } }).state.doc.toString(),
    ).toBe(s.doc.toString());
  });
  it("blocks deletion across a highlighted word", () => {
    const s = flagged();
    expect(
      s.update({ changes: { from: 0, to: 10 } }).state.doc.toString(),
    ).toBe(s.doc.toString());
  });
  it("blocks replacing the entire document", () => {
    const s = flagged();
    expect(
      s
        .update({
          changes: { from: 0, to: s.doc.length, insert: "replacement" },
        })
        .state.doc.toString(),
    ).toBe(s.doc.toString());
  });
  it("maps highlights after edits before them", () => {
    const s = flagged().update({
      changes: { from: 0, insert: "Hello " },
    }).state;
    expect(s.field(findingsField)[0].from).toBe(8);
  });
  it("allows insertion at the start of a highlight", () => {
    const s = flagged().update({
      changes: { from: 2, insert: "quite " },
    }).state;
    const f = s.field(findingsField)[0];
    expect(s.doc.sliceString(f.from, f.to)).toBe("very");
  });
  it("allows insertion at the end of a highlight", () => {
    const s = flagged().update({ changes: { from: 6, insert: " much" } }).state;
    const f = s.field(findingsField)[0];
    expect(s.doc.sliceString(f.from, f.to)).toBe("very");
  });
  it("allows editing after acknowledgement", () => {
    const s = flagged()
      .update({ effects: acknowledge.of(["a"]) })
      .state.update({ changes: { from: 2, to: 7 } }).state;
    expect(s.doc.toString()).toBe("A useful piece.");
  });
});
describe("Durable history", () => {
  it("restores undo after serializing a draft", () => {
    let state = EditorState.create({ doc: "First", extensions }).update({
      changes: { from: 5, insert: " draft" },
    }).state;
    state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(state.toJSON({ history: historyField }))),
      { extensions },
      { history: historyField },
    );
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("First");
  });
  it("restores redo after serializing a draft", () => {
    let state = EditorState.create({ doc: "First", extensions }).update({
      changes: { from: 5, insert: " draft" },
    }).state;
    undo({ state, dispatch: (tr) => (state = tr.state) });
    state = EditorState.fromJSON(
      JSON.parse(JSON.stringify(state.toJSON({ history: historyField }))),
      { extensions },
      { history: historyField },
    );
    redo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("First draft");
  });
  it("blocks undo that would delete a finding", () => {
    let state = EditorState.create({ doc: "A ", extensions }).update({
      changes: { from: 2, insert: "very useful" },
    }).state;
    state = state.update({
      effects: setFindings.of([
        {
          id: "a",
          from: 2,
          to: 6,
          text: "very",
          passId: "filler",
          explanation: "Padding",
          probability: 0.95,
        },
      ]),
    }).state;
    undo({
      state,
      dispatch: (tr) => {
        if (!changesFlaggedText(tr)) state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe("A very useful");
  });
});
describe("Jev judgments", () => {
  it("preserves exact word positions with emoji", () => {
    const text = "🌿 A very very useful café.";
    for (const s of spansFor(text, "word"))
      expect(text.slice(s.from, s.to)).toBe(s.text);
  });
  it("provides the full document for each batch", () => {
    const text = "The beginning. The ending.";
    expect(
      makeRequest(text, spansFor(text, "word").slice(0, 1), passes[0]).state
        .document,
    ).toBe(text);
  });
  it("flags only judgments above the threshold", () => {
    const spans = spansFor("very useful", "word");
    expect(
      readAnswers(
        { s0: { noul: 0.95 }, s1: { noul: 0.1 } },
        spans,
        passes[0],
      ).map((f) => f.text),
    ).toEqual(["very"]);
  });
  it("rejects missing judgments", () =>
    expect(() =>
      readAnswers({}, spansFor("word", "word"), passes[0]),
    ).toThrow());
  it("rejects invalid probabilities", () =>
    expect(() =>
      readAnswers({ s0: { noul: 2 } }, spansFor("word", "word"), passes[0]),
    ).toThrow());
});

describe("Long pieces", () => {
  it("keeps every word at its original position across excerpts", () => {
    const text = "🌿 A word and another word.\n".repeat(400);
    const spans = spansFor(text, "word");
    expect(spans).toHaveLength(2000);
    for (const s of spans) expect(text.slice(s.from, s.to)).toBe(s.text);
  });
  it("includes nearby text around the reviewed excerpt", () => {
    const text = "A familiar thought.\n".repeat(1000);
    const spans = spansFor(text, "word").slice(2000, 2048);
    const request = makeRequest(text, spans, passes[0]);
    expect(request.state.document.length).toBeLessThanOrEqual(6000);
    expect(request.state.documentOffset).toBeLessThan(spans[0].from);
    expect(
      request.state.documentOffset + request.state.document.length,
    ).toBeGreaterThan(spans.at(-1)!.to);
  });
});

describe("Code block labels", () => {
  for (const unit of ["word", "sentence"] as const) {
    for (const opening of [
      "```typescript",
      "~~~python title=example",
      "> ```javascript",
      "- ```rust",
    ]) {
      it(`excludes ${opening} from ${unit} judgments`, () => {
        const text = `Before the code\n${opening}\nexample()\n\`\`\`\nAfter the code.`;
        const from = text.indexOf(opening);
        const to = from + opening.length;
        const spans = spansFor(text, unit);
        expect(spans.some((span) => span.from < to && span.to > from)).toBe(
          false,
        );
        for (const span of spans)
          expect(text.slice(span.from, span.to)).toBe(span.text);
        expect(spans.some((span) => span.text.includes("Before"))).toBe(true);
      });
    }
  }
  it("keeps a language name in ordinary prose", () => {
    expect(
      spansFor("I write TypeScript.", "word").map((s) => s.text),
    ).toContain("TypeScript");
  });
  it("excludes a label in an unfinished code block", () => {
    expect(spansFor("```typescript", "word")).toEqual([]);
  });
  it("preserves offsets after Windows line endings", () => {
    const text = "Before.\r\n```typescript\r\ncode\r\n```\r\nAfter.";
    const spans = spansFor(text, "sentence");
    expect(spans.some((s) => s.text.includes("typescript"))).toBe(false);
    for (const span of spans)
      expect(text.slice(span.from, span.to)).toBe(span.text);
  });
});
