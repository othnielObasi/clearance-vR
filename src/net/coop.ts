import { SERVER_URL } from './server';
import type { CoopMsg } from './snapshot';

export type Role = 'host' | 'guest';

/** What the relay itself tells us (as opposed to messages from the other player). */
type RelayMsg =
  | { t: 'room'; code: string }
  | { t: 'joined'; code: string }
  | { t: 'peer'; joined: boolean; host?: boolean }
  | { t: 'error'; reason: 'busy' | 'full' | 'no-room' };

/**
 * A two-player co-op connection through the companion server's relay.
 * The host opens a room and gets a code; the guest joins with it.
 */
export class CoopLink {
  code = '';
  /** Is the other player connected right now? */
  partner = false;
  onMessage?: (m: CoopMsg) => void;
  /** Partner joined or left, or the connection closed. */
  onChange?: () => void;
  closed = false;

  private constructor(
    readonly role: Role,
    private ws: WebSocket,
  ) {}

  /** Open a room (host) or join one by code (guest). Rejects with a readable reason. */
  static open(role: Role, code = ''): Promise<CoopLink> {
    return new Promise((resolve, reject) => {
      if (!SERVER_URL) return reject(new Error('Co-op needs the online server, which is not set up for this build.'));
      const url = `${SERVER_URL.replace(/^http/, 'ws')}/relay?role=${role}${role === 'guest' ? `&code=${encodeURIComponent(code.toUpperCase())}` : ''}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return reject(new Error('Could not reach the co-op server.'));
      }
      const link = new CoopLink(role, ws);
      let settled = false;
      const timer = setTimeout(() => fail('The co-op server did not answer.'), 8000);
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        reject(new Error(why));
      };
      ws.onmessage = (ev) => {
        let m: RelayMsg | CoopMsg;
        try {
          m = JSON.parse(String(ev.data)) as RelayMsg | CoopMsg;
        } catch {
          return;
        }
        switch (m.t) {
          case 'room':
          case 'joined':
            link.code = m.code;
            link.partner = m.t === 'joined';
            settled = true;
            clearTimeout(timer);
            resolve(link);
            return;
          case 'error':
            return fail(m.reason === 'no-room' ? 'No room with that code.' : m.reason === 'full' ? 'That room already has two players.' : 'The co-op server is busy. Try again soon.');
          case 'peer':
            link.partner = m.joined;
            link.onChange?.();
            return;
          default:
            link.onMessage?.(m);
        }
      };
      ws.onerror = () => fail('Could not reach the co-op server.');
      ws.onclose = () => {
        link.closed = true;
        link.partner = false;
        if (!settled) fail('The co-op connection closed.');
        else link.onChange?.();
      };
    });
  }

  send(m: CoopMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}
