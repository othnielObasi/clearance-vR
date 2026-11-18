/** Peers may send gameplay packets, never impersonate relay control messages. */
export function relayPacketAllowed(role, data) {
  try {
    const msg = JSON.parse(data);
    const allowed = role === 'host' ? ['start', 'snap', 'hands'] : role === 'guest' ? ['act', 'walls', 'hands'] : [];
    return !!msg && typeof msg === 'object' && !Array.isArray(msg) && allowed.includes(msg.t);
  } catch {
    return false;
  }
}
