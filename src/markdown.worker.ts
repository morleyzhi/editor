import MarkdownIt from "markdown-it";
// @ts-expect-error The plugin does not publish TypeScript declarations.
import footnote from "markdown-it-footnote";
// @ts-expect-error The plugin does not publish TypeScript declarations.
import taskLists from "markdown-it-task-lists";
const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
  .use(footnote)
  .use(taskLists);
md.renderer.rules.softbreak = () =>
  '<br class="graf-break"><span class="graf-space" aria-hidden="true"></span>';
self.onmessage = ({ data }: { data: { text: string; version: number } }) =>
  self.postMessage({ version: data.version, html: md.render(data.text) });
