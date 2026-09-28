import MarkdownIt from "markdown-it";
// @ts-expect-error The plugin does not publish TypeScript declarations.
import footnote from "markdown-it-footnote";
// @ts-expect-error The plugin does not publish TypeScript declarations.
import taskLists from "markdown-it-task-lists";
import { readingStats } from "./reading";
const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
  .use(footnote)
  .use(taskLists);
md.renderer.rules.softbreak = () =>
  '<br class="graf-break"><span class="graf-space" aria-hidden="true"></span>';
self.onmessage = ({
  data,
}: {
  data: { kind: "preview" | "stats"; text: string; version: number };
}) => {
  if (data.kind === "stats")
    self.postMessage({
      kind: "stats",
      version: data.version,
      ...readingStats(md, data.text),
    });
  else
    self.postMessage({
      kind: "preview",
      version: data.version,
      html: md.render(data.text),
    });
};
