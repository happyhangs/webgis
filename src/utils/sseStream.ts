/**
 * Generic SSE stream reader.
 * Reads a Response body line-by-line, parses "data: " prefixed JSON,
 * and calls onData for each event.
 */
export async function readSSEStream(
  response: Response,
  onData: (json: Record<string, any>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.startsWith('data: ')) {
        try { onData(JSON.parse(line.slice(6))); } catch {}
      }
      lineEnd = buffer.indexOf('\n');
    }
  }
}
