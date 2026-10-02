export type TextChunk = { ordinal: number; page: number; body: string };
export function chunkPages(pages: string[]): TextChunk[] {
  const result: TextChunk[] = [];
  pages.forEach((page, index) => {
    const text = page.replaceAll(String.fromCharCode(0), "").trim();
    for (let offset = 0; offset < text.length; offset += 2100) {
      result.push({ ordinal: result.length, page: index + 1, body: text.slice(offset, offset + 2400) });
      if (result.length > 500) throw new Error("Document exceeds the indexing text limit.");
      if (offset + 2400 >= text.length) break;
    }
  });
  return result;
}
