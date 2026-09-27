import { spansFor, batchSpans } from "./passes";
self.onmessage = ({
  data,
}: {
  data: { text: string; unit: "word" | "sentence" };
}) => self.postMessage(batchSpans(spansFor(data.text, data.unit)));
