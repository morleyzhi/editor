import type MarkdownIt from "markdown-it";

export type ReadingStats = {
  words: number;
  minutes: number;
  grade: number | null;
};

function syllables(word: string) {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length <= 3) return 1;
  let count = (letters.match(/[aeiouy]+/g) || []).length;
  if (/[^aeiouy]e$/.test(letters) && !/[^aeiouy]le$/.test(letters)) count--;
  return Math.max(1, count);
}

export function readingStats(markdown: MarkdownIt, text: string): ReadingStats {
  const prose = markdown
    .parse(text, {})
    .filter((token) => token.type === "inline")
    .flatMap((token) => token.children || [])
    .filter((token) => token.type === "text")
    .map((token) => token.content)
    .join(" ");
  const words = prose.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const sentences = (prose.match(/[.!?]+(?=\s|$)/g) || []).length;
  const grade =
    words.length >= 30 && sentences >= 2
      ? Math.max(
          0,
          Math.round(
            0.39 * (words.length / sentences) +
              11.8 *
                (words.reduce((total, word) => total + syllables(word), 0) /
                  words.length) -
              15.59,
          ),
        )
      : null;
  return {
    words: words.length,
    minutes: Math.max(1, Math.ceil(words.length / 225)),
    grade,
  };
}
