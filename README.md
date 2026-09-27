# Editor

A local writing app for blog posts and articles. You write the prose; Jev identifies passages to review.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. In **Settings**, enter a TypeSafe Jev API key. Select an editing pass, then click **Run this pass**.

For a production build:

```sh
npm run build
NODE_ENV=production npm start
```

The server listens on loopback. To use a different port, set `PORT` and `EDITOR_ORIGIN` to its exact origin. Keep one dedicated origin for the editor. For remote access, put the server behind an authenticated HTTPS reverse proxy and set `EDITOR_ORIGIN` to that HTTPS origin. HTTPS enables the session cookie’s Secure attribute.

## Writing

- Drafts, text undo/redo history, findings, and pass records save in IndexedDB on this browser and origin. Undo and redo survive reloads and switching drafts. Standard keyboard shortcuts work.
- A single writing tab holds a browser lock to prevent competing saves. Save errors are visible. Export Markdown to keep a separate copy; clearing browser site data removes local drafts.
- Write arbitrary Markdown source. Preview renders CommonMark, tables, strikethrough, task lists, footnotes, links, images, code blocks, and sanitized HTML. Executable HTML is stripped. Import and export `.md` files.
- CodeMirror renders only the visible part of long documents. Markdown parsing and pass preparation run in workers. Preview blocks use CSS content visibility. Saving and word counts are debounced.

## Editing passes

Twenty manually selected passes cover clarity, flow, grace, and principles from _The Elements of Style_. The catalog in `src/passes.ts` defines each question, explanation, and whether it evaluates words or sentences. These are independent interpretations inspired by Williams and Bizup’s _Style: Lessons in Clarity and Grace_ and Strunk and White, with pass selection informed by the [reference workshop](https://sockpuppet.org/blog/2026/09/17/how-to-write-with-an-llm/workshop.jpg).

Jev receives the text plus spans with exact UTF-16 offsets. Each span gets a typed yes/no judgment. Word checks have sentence and paragraph context; flow checks examine sentences with surrounding paragraphs. Documents up to 6,000 characters are sent in full. Longer pieces are reviewed through overlapping excerpts of up to 6,000 characters; every text span is covered, but distant sections are not evaluated together. Batches contain at most 48 questions and 2,000 characters of reviewed text. Extremely long unbroken sentences are split for review. This keeps requests within Jev’s [context limits](https://docs.typesafe.ai/models).

Findings appear at probabilities of 0.8 or higher. Explanations describe the pass’s criterion; Jev returns judgments, not generated explanations or replacement prose. Word passes highlight words, while sentence passes highlight the sentence that needs attention.

Hover, click, or keyboard-focus a highlight to review it. **Acknowledge** removes its flag without changing the text. Highlighted text cannot be changed by typing, deleting, pasting, or undo/redo until acknowledged. **Acknowledge visible** clears only findings in the writing viewport. All existing findings must be acknowledged before another pass runs. Edits cancel an in-progress pass so stale results never attach to changed text. Cancellation or a failed batch leaves the draft unchanged and reports the result.

## API key security

The key is held only in the local Node server’s memory, isolated by a random session token in an HttpOnly, SameSite=Strict cookie. It expires after 24 hours or a server restart. Settings never returns the key; it is not stored in localStorage, IndexedDB, logs, or files. **Forget key** removes it immediately.

All mutations require the configured Origin and JSON content type. Cross-origin requests are rejected, no CORS access is granted, and production pages use a restrictive Content Security Policy. Markdown HTML is sanitized before display. The server sends keys only to the fixed official endpoint `https://api.typesafe.ai/v1/systemone` and does not expose upstream error bodies. Other origins cannot read browser drafts or the key. As with any web app, code executing on the editor’s own origin must be trusted.

Jev receives article text only when a pass runs. No generated edits are applied.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

The browser tests start the development server when needed. Tests cover persistence, undo/redo, protected findings, visible acknowledgment, stale requests, Markdown sanitization, mobile navigation, long documents, and API origin/session isolation.
