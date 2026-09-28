import { expect, test } from "vitest";
import MarkdownIt from "markdown-it";
import { readingStats } from "../src/reading";

const markdown = new MarkdownIt();

test("reading statistics ignore fenced code", () => {
  const prose = "The writer explains a clear idea. The reader follows it easily. ".repeat(3);
  const withoutCode = readingStats(markdown, prose);
  const withCode = readingStats(
    markdown,
    `${prose}\n\n\`\`\`javascript\nconst unreadable = complexFunction(argument);\n\`\`\``,
  );
  expect(withCode).toEqual(withoutCode);
  expect(withCode.grade).not.toBeNull();
});

test("reading grade rises when sentences use longer words", () => {
  const simple = "The dog ran to the park. The cat sat on the mat. ".repeat(4);
  const complex = "The educational institution considered an extraordinary possibility. The administrative organization discussed the psychological implications. ".repeat(4);
  expect(readingStats(markdown, complex).grade!).toBeGreaterThan(
    readingStats(markdown, simple).grade!,
  );
});
