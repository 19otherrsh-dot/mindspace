import { API_BASE_URL } from './client';

/**
 * A minimal Server-Sent Events client built on XMLHttpRequest.
 *
 * React Native's `fetch` does not expose a readable `response.body`, so the
 * standard `getReader()` pattern silently returns nothing on device. XHR's
 * `onprogress` gives us the accumulated text as it arrives, which is enough to
 * parse frames incrementally — and it behaves the same on web, so the chat
 * screen has one code path rather than two.
 */

export interface SseHandlers {
  onEvent: (event: string, data: unknown) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface SseConnection {
  abort: () => void;
}

export function openSse(
  path: string,
  body: unknown,
  token: string | null,
  handlers: SseHandlers,
): SseConnection {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE_URL}${path}`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  // How much of responseText has already been parsed. XHR hands back the
  // whole accumulated body each time, not just the new bytes.
  let consumed = 0;
  let closed = false;

  const drain = () => {
    const text = xhr.responseText;
    if (text.length <= consumed) return;

    const fresh = text.slice(consumed);
    // Only consume up to the last complete frame; a partial tail stays in the
    // buffer until the rest of it arrives.
    const lastBreak = fresh.lastIndexOf('\n\n');
    if (lastBreak === -1) return;

    const complete = fresh.slice(0, lastBreak);
    consumed += lastBreak + 2;

    for (const frame of complete.split('\n\n')) {
      if (!frame.trim()) continue;

      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }

      if (dataLines.length === 0) continue;

      try {
        handlers.onEvent(eventName, JSON.parse(dataLines.join('\n')));
      } catch {
        // A frame we cannot parse is not worth tearing the stream down for.
      }
    }
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  };

  xhr.onprogress = drain;

  xhr.onload = () => {
    drain();
    if (xhr.status >= 400) {
      handlers.onError(
        xhr.status === 429
          ? 'You have sent a lot of messages. Give it a minute.'
          : 'The companion could not answer. Please try again.',
      );
    }
    finish();
  };

  xhr.onerror = () => {
    handlers.onError('Could not reach Mindspace. Check your connection.');
    finish();
  };

  xhr.ontimeout = () => {
    handlers.onError('The companion took too long to answer.');
    finish();
  };

  // A long reply can legitimately take a while; only give up well past that.
  xhr.timeout = 120_000;
  xhr.send(JSON.stringify(body));

  return {
    abort: () => {
      if (closed) return;
      closed = true;
      xhr.abort();
      handlers.onClose();
    },
  };
}
