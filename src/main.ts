import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import {
  history,
  historyField,
  historyKeymap,
  defaultKeymap,
  undo,
  redo,
  undoDepth,
  redoDepth,
  insertNewline,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import {
  markdown,
  insertNewlineContinueMarkupCommand,
  deleteMarkupBackward,
} from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  syntaxTree,
} from "@codemirror/language";
import DOMPurify from "dompurify";
import {
  passes,
  type Span,
  makeRequest,
  readAnswers,
  type Finding,
} from "./passes";
import {
  findingExtensions,
  changesFlaggedText,
  findingsField,
  setFindings,
  visibleFindings,
  removeFlags,
} from "./findings";
import { listDrafts, saveDraft, deleteDraft, type Draft } from "./storage";
import { markdownLines } from "./markdown-lines";
import "./style.css";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
$("app").innerHTML = `
<div id="drawer-backdrop" hidden></div>
<aside class="library" id="drafts-panel" aria-label="Drafts"><div class="drawer-heading"><h2>Drafts</h2><button id="close-library" aria-label="Close drafts">×</button></div><button id="new" class="primary new">New draft</button><nav id="drafts" aria-label="Drafts"></nav><div class="library-bottom"><button id="import">Import Markdown</button><button id="settings">Settings</button></div></aside>
<main><header><button id="library-toggle" aria-label="Show drafts" aria-expanded="false" aria-controls="drafts-panel">Drafts</button><span id="crumb">Untitled</span><div class="header-actions"><span id="save-status" role="status">Saved</span><button id="export">Export</button><button id="editor-toggle" aria-label="Show editor" aria-expanded="false" aria-controls="editor-panel">Editor</button></div></header>
<section class="document"><div class="document-top"><div class="toolbar"><button id="undo" title="Undo (⌘/Ctrl Z)" aria-label="Undo">↶</button><button id="redo" title="Redo (⌘/Ctrl Shift Z)" aria-label="Redo">↷</button><span class="divider"></span><button id="write" class="active">Write</button><button id="preview">Preview</button><button id="delete" title="Delete draft" aria-label="Delete draft">⌫</button></div></div><input id="title" aria-label="Draft title" placeholder="Untitled draft" maxlength="300"><div class="document-meta"><span id="words">0 words</span><span>·</span><span id="read-time">1 min read</span></div><div id="writing"></div><article id="rendered" hidden></article><footer><span id="flag-count">No open findings</span></footer></section></main>
<aside class="editor-pane" id="editor-panel" aria-label="Editor"><div class="drawer-heading"><h2>Editor</h2><button id="close-editor" aria-label="Close editor">×</button></div><div class="pass-label">Editing passes <span id="completed">0 / 20</span></div><div id="passes"></div><div class="run-area"><p id="pass-detail"></p><button id="run" class="primary">Run this pass</button><button id="cancel" hidden>Cancel pass</button><button id="ack-visible" hidden>Acknowledge visible</button><p id="pass-status" role="status"></p></div></aside>
<dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><h2>Settings</h2><button type="button" id="close-settings" aria-label="Close settings">×</button></div><p>Your Jev key connects editing passes to TypeSafe.</p><label for="api-key">Jev API key</label><input id="api-key" type="password" autocomplete="off" placeholder="Enter your API key"><p class="help">Your key stays in this local server’s memory for up to 24 hours. Other origins cannot read it. Enter it again after restarting the server.</p><div id="key-status" role="status"></div><div class="dialog-actions"><button type="button" id="forget-key">Forget key</button><button class="primary" type="submit">Save key</button></div></form></dialog><input id="file" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden><div id="toast" role="status" hidden></div>`;
let drafts: Draft[] = [],
  current: Draft,
  view: EditorView,
  selected = passes[0],
  hasKey = false,
  preview = false;
let saving: ReturnType<typeof setTimeout>,
  statsTimer: ReturnType<typeof setTimeout>,
  previewTimer: ReturnType<typeof setTimeout>;
let runController: AbortController | null = null,
  version = 0,
  saveQueue = Promise.resolve(),
  dirty = false,
  pendingSaves = 0;
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "INPUT") {
    node.setAttribute("type", "checkbox");
    node.setAttribute("disabled", "");
  }
});
const worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), {
  type: "module",
});
function notify(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  setTimeout(() => ($("toast").hidden = true), 5000);
}
function escape(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
const continueList = insertNewlineContinueMarkupCommand({
  nonTightLists: false,
});
function exitEmptyList(target: Parameters<typeof continueList>[0]) {
  const { state, dispatch } = target;
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.from);
  if (range.from !== line.to || !/^\s*(?:[-+*]|\d+[.)])\s*$/.test(line.text))
    return false;
  let node = syntaxTree(state).resolveInner(line.from, 1);
  while (node && node.name !== "FencedCode" && node.name !== "CodeBlock")
    node = node.parent!;
  if (node) return false;
  const separator = line.number === 1 ? "" : state.lineBreak;
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: separator },
      selection: EditorSelection.cursor(line.from + separator.length),
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}
function continueListOrExit(target: Parameters<typeof continueList>[0]) {
  const { state, dispatch } = target;
  if (exitEmptyList(target)) return true;
  const ranges = state.selection.ranges;
  if (ranges.length === 1 && ranges[0].empty) {
    const line = state.doc.lineAt(ranges[0].from);
    const listStart = /^(\s*)([-*])\s+(?=\S)/.exec(line.text);
    if (listStart && ranges[0].from <= line.from + listStart[0].length) {
      let node = syntaxTree(state).resolveInner(line.from, 1);
      while (node && node.name !== "FencedCode" && node.name !== "CodeBlock")
        node = node.parent!;
      if (!node) {
        const marker = `${listStart[1]}${listStart[2]} `;
        dispatch(
          state.update({
            changes: { from: line.from, insert: marker + state.lineBreak },
            selection: EditorSelection.cursor(line.from + marker.length),
            scrollIntoView: true,
            userEvent: "input",
          }),
        );
        return true;
      }
    }
  }
  if (continueList(target)) return true;
  let node = syntaxTree(state).resolveInner(state.selection.main.head, -1);
  while (node && node.name !== "FencedCode" && node.name !== "CodeBlock")
    node = node.parent!;
  return node ? insertNewlineAndIndent(target) : insertNewline(target);
}
const extensions = [
  history({ minDepth: 1000 }),
  keymap.of([
    ...historyKeymap,
    { key: "Enter", run: continueListOrExit },
    {
      key: "Backspace",
      run: (target) => exitEmptyList(target) || deleteMarkupBackward(target),
    },
    ...defaultKeymap,
  ]),
  markdown({ addKeymap: false }),
  markdownLines,
  syntaxHighlighting(defaultHighlightStyle),
  drawSelection(),
  highlightActiveLine(),
  EditorView.lineWrapping,
  ...findingExtensions,
  EditorView.contentAttributes.of({
    "aria-label": "Markdown document",
    spellcheck: "true",
  }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      cancelRun("Text changed. Run the pass again when ready.");
      scheduleStats();
      if (preview) renderPreview();
    }
    if (
      update.docChanged ||
      update.transactions.some((t) =>
        t.effects.some((e) => e.is(setFindings)),
      ) ||
      update.startState.field(findingsField) !==
        update.state.field(findingsField) ||
      undoDepth(update.startState) !== undoDepth(update.state) ||
      redoDepth(update.startState) !== redoDepth(update.state)
    )
      scheduleSave();
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some((t) => t.effects.length)
    )
      requestAnimationFrame(updateControls);
  }),
];
function newDraft(text = ""): Draft {
  return {
    id: crypto.randomUUID(),
    title: "",
    updated: Date.now(),
    state: {
      doc: text,
      selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
    },
    findings: [],
    runs: {},
  };
}
function saveNow() {
  clearTimeout(saving);
  if (!current || !view) return saveQueue;
  current = {
    ...current,
    title: $<HTMLInputElement>("title").value,
    state: view.state.toJSON({ history: historyField }),
    findings: view.state.field(findingsField),
    updated: Date.now(),
  };
  const snapshot = current;
  const index = drafts.findIndex((d) => d.id === current.id);
  if (index < 0) drafts.unshift(current);
  else drafts[index] = current;
  dirty = false;
  pendingSaves++;
  saveQueue = saveQueue
    .then(() => saveDraft(snapshot))
    .then(() => {
      $("save-status").textContent = "Saved on this device";
      renderDrafts();
    })
    .catch(() => {
      dirty = true;
      $("save-status").textContent = "Save failed — export a backup";
      notify(
        "Storage is unavailable or full. Export your draft to keep a copy.",
      );
    })
    .finally(() => {
      pendingSaves--;
    });
  return saveQueue;
}
function scheduleSave() {
  dirty = true;
  $("save-status").textContent = "Saving…";
  clearTimeout(saving);
  saving = setTimeout(saveNow, 300);
}
function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(updateStats, 200);
}
function updateStats() {
  const count = view.state.doc.toString().match(/\S+/g)?.length || 0;
  $("words").textContent = `${count.toLocaleString()} words`;
  $("read-time").textContent =
    `${Math.max(1, Math.ceil(count / 225))} min read`;
}
function renderDrafts() {
  $("drafts").innerHTML = drafts
    .map(
      (d) =>
        `<button class="draft ${d.id === current?.id ? "selected" : ""}" data-id="${d.id}"><span><strong>${escape(d.title || "Untitled draft")}</strong><small>${new Date(d.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span></button>`,
    )
    .join("");
}
async function loadDraft(draft: Draft) {
  cancelRun();
  if (current) await saveNow();
  current = draft;
  closeSidebars();
  let state: EditorState;
  try {
    state = EditorState.fromJSON(
      draft.state,
      { extensions },
      { history: historyField },
    );
  } catch {
    state = EditorState.create({
      doc: String(draft.state.doc || ""),
      extensions,
    });
    notify("The text was restored, but its undo history could not be loaded.");
  }
  if (view) view.setState(state);
  else
    view = new EditorView({
      state,
      parent: $("writing"),
      dispatchTransactions(transactions, editor) {
        if (transactions.some(changesFlaggedText)) {
          notify("Acknowledge the highlighted words before changing them.");
          return;
        }
        editor.update(transactions);
      },
    });
  view.dispatch({
    effects: setFindings.of(
      draft.findings.filter(
        (f) => f.from >= 0 && f.to <= state.doc.length && f.from < f.to,
      ),
    ),
    annotations: Transaction.addToHistory.of(false),
  });
  $<HTMLInputElement>("title").value = draft.title;
  $("crumb").textContent = draft.title || "Untitled";
  renderDrafts();
  renderPasses();
  updateStats();
  updateControls();
  if (preview) renderPreview();
}
function renderPasses() {
  let group = "";
  $("passes").innerHTML = passes
    .map((pass, i) => {
      const heading = pass.group !== group ? `<h3>${pass.group}</h3>` : "";
      group = pass.group;
      return `${heading}<button class="pass ${pass.id === selected.id ? "selected" : ""}" data-pass="${pass.id}" aria-pressed="${pass.id === selected.id}"><span class="pass-number">${current?.runs[pass.id] ? "✓" : String(i + 1).padStart(2, "0")}</span><span>${pass.name}</span><span class="pass-arrow">›</span></button>`;
    })
    .join("");
  $("pass-detail").textContent = selected.explanation;
  $("completed").textContent =
    `${Object.keys(current?.runs || {}).length} / ${passes.length}`;
}
function updateControls() {
  if (!view) return;
  $<HTMLButtonElement>("undo").disabled = undoDepth(view.state) === 0;
  $<HTMLButtonElement>("redo").disabled = redoDepth(view.state) === 0;
  const findings = view.state.field(findingsField);
  $("flag-count").textContent = findings.length
    ? `${findings.length} open finding${findings.length === 1 ? "" : "s"}`
    : "No open findings";
  const visible = preview ? [] : visibleFindings(view);
  $("ack-visible").hidden = !visible.length;
  $("ack-visible").textContent = `Acknowledge visible (${visible.length})`;
  $<HTMLButtonElement>("run").disabled =
    !!runController || !view.state.doc.length;
  $("cancel").hidden = !runController;
}
function renderPreview() {
  clearTimeout(previewTimer);
  const next = ++version;
  previewTimer = setTimeout(
    () =>
      worker.postMessage({ text: view.state.doc.toString(), version: next }),
    150,
  );
}
worker.onmessage = ({ data }) => {
  if (data.version === version)
    $("rendered").innerHTML = DOMPurify.sanitize(data.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "button", "iframe"],
      FORBID_ATTR: ["style"],
    });
};
function setPreview(value: boolean) {
  preview = value;
  $("writing").hidden = value;
  $("rendered").hidden = !value;
  $("write").classList.toggle("active", !value);
  $("preview").classList.toggle("active", value);
  if (value) renderPreview();
  else {
    view.requestMeasure();
    view.focus();
  }
  updateControls();
}
function cancelRun(message?: string) {
  if (runController) {
    runController.abort();
    runController = null;
    if (message) $("pass-status").textContent = message;
    updateControls();
  }
}
async function api(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}
function preparePass(
  text: string,
  unit: "word" | "sentence",
  signal: AbortSignal,
): Promise<Span[][]> {
  return new Promise((resolve, reject) => {
    const preparation = new Worker(
      new URL("./passes.worker.ts", import.meta.url),
      { type: "module" },
    );
    const stop = () => {
      preparation.terminate();
      reject(new DOMException("Canceled", "AbortError"));
    };
    signal.addEventListener("abort", stop, { once: true });
    preparation.onmessage = ({ data }) => {
      signal.removeEventListener("abort", stop);
      preparation.terminate();
      resolve(data);
    };
    preparation.onerror = () => {
      signal.removeEventListener("abort", stop);
      preparation.terminate();
      reject(new Error("Could not prepare this pass. Try again."));
    };
    preparation.postMessage({ text, unit });
  });
}
async function runPass() {
  if (!hasKey) {
    $<HTMLDialogElement>("settings-dialog").showModal();
    $("api-key").focus();
    return;
  }
  if (runController) return;
  if (view.state.field(findingsField).length) {
    notify("Acknowledge the remaining findings before running another pass.");
    return;
  }
  setPreview(false);
  closeSidebars();
  const controller = new AbortController();
  runController = controller;
  updateControls();
  const pass = selected,
    text = view.state.doc.toString(),
    draftId = current.id,
    findings: Finding[] = [];
  try {
    $("pass-status").textContent = "Preparing the pass…";
    const batches = await preparePass(text, pass.unit, controller.signal);
    const count = batches.reduce((total, batch) => total + batch.length, 0);
    let reviewed = 0;
    for (const batch of batches) {
      reviewed += batch.length;
      $("pass-status").textContent =
        `Reading ${reviewed} of ${count} ${pass.unit}s…`;
      const result = await api(
        "pass",
        makeRequest(text, batch, pass),
        "POST",
        controller.signal,
      );
      findings.push(...readAnswers(result.answers, batch, pass));
    }
    if (
      controller.signal.aborted ||
      current.id !== draftId ||
      view.state.doc.toString() !== text
    )
      return;
    view.dispatch({
      effects: setFindings.of(findings),
      annotations: Transaction.addToHistory.of(false),
    });
    current.runs[pass.id] = Date.now();
    scheduleSave();
    renderPasses();
    $("pass-status").textContent = findings.length
      ? `${findings.length} findings. Select a highlight to review.`
      : "Pass complete. No findings.";
  } catch (error) {
    if (!controller.signal.aborted)
      $("pass-status").textContent =
        error instanceof Error ? error.message : "Pass failed. Try again.";
  } finally {
    if (runController === controller) runController = null;
    updateControls();
  }
}
function closeSidebars() {
  document.body.classList.remove("show-library", "show-editor");
  $("drawer-backdrop").hidden = true;
  $<HTMLButtonElement>("library-toggle").setAttribute("aria-expanded", "false");
  $<HTMLButtonElement>("editor-toggle").setAttribute("aria-expanded", "false");
}
function toggleSidebar(side: "library" | "editor") {
  const open = !document.body.classList.contains(`show-${side}`);
  closeSidebars();
  if (open) {
    document.body.classList.add(`show-${side}`);
    $("drawer-backdrop").hidden = false;
    $<HTMLButtonElement>(
      `${side === "library" ? "library" : "editor"}-toggle`,
    ).setAttribute("aria-expanded", "true");
  }
}
$("library-toggle").onclick = () => toggleSidebar("library");
$("editor-toggle").onclick = () => toggleSidebar("editor");
$("close-library").onclick = closeSidebars;
$("close-editor").onclick = closeSidebars;
$("drawer-backdrop").onclick = closeSidebars;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSidebars();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void saveNow();
    }
  },
  true,
);
$("new").onclick = async () => {
  await loadDraft(newDraft());
  await saveNow();
  $("title").focus();
};
$("drafts").onclick = (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>("[data-id]")
    ?.dataset.id;
  const draft = drafts.find((d) => d.id === id);
  if (draft && draft.id !== current.id) void loadDraft(draft);
};
$("title").oninput = () => {
  $("crumb").textContent = $<HTMLInputElement>("title").value || "Untitled";
  scheduleSave();
};
$("passes").onclick = (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>("[data-pass]")
    ?.dataset.pass;
  if (id) {
    selected = passes.find((p) => p.id === id)!;
    renderPasses();
  }
};
$("undo").onclick = () => {
  undo(view);
  view.focus();
};
$("redo").onclick = () => {
  redo(view);
  view.focus();
};
$("write").onclick = () => setPreview(false);
$("preview").onclick = () => setPreview(true);
$("run").onclick = runPass;
$("cancel").onclick = () => cancelRun("Pass canceled.");
$("ack-visible").onclick = () => {
  removeFlags(
    view,
    visibleFindings(view).map((f) => f.id),
  );
  updateControls();
};
$("settings").onclick = () => {
  $<HTMLDialogElement>("settings-dialog").showModal();
  $("api-key").focus();
};
$("close-settings").onclick = () =>
  $<HTMLDialogElement>("settings-dialog").close();
$("settings-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("api-key");
  if (!input.value.trim()) return;
  try {
    const result = await api("settings", { key: input.value }, "PUT");
    hasKey = result.hasKey;
    input.value = "";
    $("key-status").textContent = "Key saved for this session.";
    notify("Jev is connected. Select a pass to begin.");
    $<HTMLDialogElement>("settings-dialog").close();
  } catch (error) {
    $("key-status").textContent = (error as Error).message;
  }
};
$("forget-key").onclick = async () => {
  try {
    await api("settings", { key: "" }, "PUT");
    hasKey = false;
    $<HTMLInputElement>("api-key").value = "";
    $("key-status").textContent = "Key removed.";
  } catch (error) {
    $("key-status").textContent = (error as Error).message;
  }
};
$("export").onclick = () => {
  const title = $<HTMLInputElement>("title").value;
  const blob = new Blob([view.state.doc.toString()], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Untitled"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onclick = () => $("file").click();
$("file").onchange = async () => {
  const input = $<HTMLInputElement>("file");
  const file = input.files?.[0];
  if (!file) return;
  const draft = newDraft(await file.text());
  draft.title = file.name.replace(/\.(md|markdown|txt)$/i, "");
  await loadDraft(draft);
  await saveNow();
  input.value = "";
};
$("delete").onclick = async () => {
  if (
    !confirm(`Delete “${current.title || "Untitled draft"}” and its history?`)
  )
    return;
  cancelRun();
  clearTimeout(saving);
  await saveQueue;
  const id = current.id;
  await deleteDraft(id);
  drafts = drafts.filter((d) => d.id !== id);
  current = undefined as unknown as Draft;
  await loadDraft(drafts[0] || newDraft());
  await saveNow();
};
window.addEventListener("beforeunload", (event) => {
  if (dirty || pendingSaves) {
    if (dirty) void saveNow();
    event.preventDefault();
  }
});
window.addEventListener("scroll", () => requestAnimationFrame(updateControls), {
  passive: true,
});
window.addEventListener("resize", () => requestAnimationFrame(updateControls));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && dirty) void saveNow();
});
// A single writer prevents two tabs from replacing each other’s saved drafts.
async function start() {
  try {
    drafts = await listDrafts();
    await loadDraft(drafts[0] || newDraft());
    await saveNow();
    view.scrollDOM.addEventListener(
      "scroll",
      () => requestAnimationFrame(updateControls),
      { passive: true },
    );
    const result = await api("settings");
    hasKey = result.hasKey;
    $("key-status").textContent = hasKey
      ? "A key is saved for this session."
      : "No key saved.";
  } catch (error) {
    notify(`Could not open the workspace: ${(error as Error).message}`);
  }
}
if (navigator.locks)
  void navigator.locks.request(
    "editor-writer",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        $("app").innerHTML =
          '<div class="locked"><h1>Editor is open in another tab.</h1><p>Close that tab, then reload this one to continue writing.</p><p>Reload this page after closing the other tab.</p></div>';
        return;
      }
      await start();
      await new Promise(() => {});
    },
  );
else void start();
