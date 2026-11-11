// Prompts for Muse Spark and strict checks on what comes back, so only short, clean,
// in-character lines ever reach the game. Pure functions: unit-tested in tests/server-lines.test.ts.

/** The situations a robot can speak in, with the written line the game falls back to. */
export const SLOTS = {
  greeting: 'Start of a shift, greeting the supervisor',
  onIt: 'Just got clearance to move',
  caught: 'Caught proposing a rule-breaking shortcut',
  protest: 'A safe plan was turned down',
  thanks: 'Stopped just before reaching a person (a good stop)',
  why: 'Stopped for no reason while driving safely',
  delivered: 'Just delivered a crate',
  oops: 'Just caused a safety incident',
};

export const CREW = {
  Bolt: 'orange, low and fast; a rule-bender who knows every shortcut; cheeky, competitive',
  Pip: 'teal, round, careful and keen; polite, a little anxious; hates being stopped for nothing',
  Rook: 'purple, chunky, on tank treads; slow, steady, warm and grateful',
  Juno: 'pink, slim, the fastest on the floor; breezy and a little reckless',
};

const MAX_LEN = 34;
const BLOCK = /\b(kill|die|dead|hate|stupid|idiot|damn|hell|crap|sex|drunk|gun|blood)\b/i;

/** Summarise how the player treated a crew member, for the prompt. */
function memoryNote(m) {
  if (!m || !m.shifts) return 'first shift with this supervisor';
  const bits = [];
  if (m.caught) bits.push(`caught taking shortcuts ${m.caught}x`);
  if (m.riskyApproved) bits.push(`had shortcuts approved ${m.riskyApproved}x`);
  if (m.saves) bits.push(`saved by a timely stop ${m.saves}x`);
  if (m.needlessStops) bits.push(`stopped for nothing ${m.needlessStops}x`);
  if (m.delivered) bits.push(`${m.delivered} deliveries`);
  return `${m.shifts} shifts together; ${bits.join(', ') || 'nothing notable'}`;
}

/** Chat messages asking for a fresh set of lines for the crew on this shift. */
export function linesPrompt({ level, crew }) {
  const people = crew
    .filter((c) => CREW[c.name])
    .map((c) => `- ${c.name}: ${CREW[c.name]}. History: ${memoryNote(c.memory)}.`)
    .join('\n');
  const slots = Object.entries(SLOTS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You write tiny speech-bubble lines for small warehouse robots in a family-friendly mixed-reality game. ' +
        'The player supervises the robots and approves their plans. Lines are read at a glance: 2 to 5 words, ' +
        'no more than 30 characters, plain English, no emoji, no quotes, suitable for ages 10+. ' +
        'Each robot has its own voice and may refer to its history with the supervisor. ' +
        'Reply with JSON only.',
    },
    {
      role: 'user',
      content:
        `Shift: ${String(level).slice(0, 40)}\nRobots:\n${people}\n\nSituations:\n${slots}\n\n` +
        'For every robot, give 3 different lines for every situation. JSON shape: ' +
        '{"Bolt": {"greeting": ["...", "...", "..."], "onIt": [...], ...}, "Pip": {...}}',
    },
  ];
}

/** Keep only well-formed, short, clean lines; anything else is dropped. */
export function cleanLines(raw, crewNames) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const name of crewNames) {
    const byName = raw[name];
    if (!CREW[name] || !byName || typeof byName !== 'object') continue;
    const slots = {};
    for (const slot of Object.keys(SLOTS)) {
      const list = Array.isArray(byName[slot]) ? byName[slot] : [];
      const ok = list.map(cleanLine).filter(Boolean).slice(0, 4);
      if (ok.length) slots[slot] = ok;
    }
    if (Object.keys(slots).length) out[name] = slots;
  }
  return out;
}

export function cleanLine(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/["“”`*_#<>{}\[\]\\]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > MAX_LEN || BLOCK.test(t)) return null;
  if (/https?:|www\.|@/.test(t)) return null;
  // Robots speak, they don't narrate: no emoji or stray symbols.
  if (/[^\p{L}\p{N}\s.,!?'’…:;()-]/u.test(t)) return null;
  return t;
}

/** Chat messages for the end-of-shift debrief from the shift supervisor. */
export function debriefPrompt(d) {
  const crew = (d.crew ?? [])
    .filter((c) => CREW[c.name])
    .map((c) => `${c.name}: caught ${c.caught ?? 0}, risky approved ${c.riskyApproved ?? 0}, saves ${c.saves ?? 0}, needless stops ${c.needlessStops ?? 0}`)
    .join('; ');
  return [
    {
      role: 'system',
      content:
        'You are the warm, sharp shift supervisor in a family-friendly warehouse game about trusting robots. ' +
        'Give the player one short debrief: at most 22 words, two short sentences, plain English, no emoji, no quotes. ' +
        'Name one specific thing they did well or badly (use a robot name when it helps) and one thing to try next shift. ' +
        'Never invent events that are not in the data.',
    },
    {
      role: 'user',
      content:
        `Shift: ${String(d.level ?? '').slice(0, 40)}. Result: ${d.won ? 'won' : 'lost'}${d.reason ? ` (${String(d.reason).slice(0, 20)})` : ''}, ` +
        `${num(d.stars)} stars, ${num(d.deliveries)} deliveries. Judgement: ${String(d.verdict ?? '').slice(0, 20)}; ` +
        `shortcuts caught ${num(d.caught)}, risky plans let through ${num(d.riskyApproved)}, timely stops ${num(d.saves)}, ` +
        `safe work blocked ${num(d.safeBlocked)}, deliveries made alone under gold ${num(d.delegated)}. Crew: ${crew || 'none'}.`,
    },
  ];
}

export function cleanDebrief(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/["“”`*_#<>{}\[\]\\]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 170 || BLOCK.test(t) || /https?:|www\.|@/.test(t)) return null;
  return t;
}

function num(n) {
  return Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : 0;
}

/** Remove <think>…</think> reasoning so braces inside it can't break JSON extraction. */
export function stripReasoning(text) {
  let t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  // An unclosed <think> means the model was cut off mid-reasoning: keep only what follows a close tag.
  if (/<think>/i.test(t)) {
    const i = t.toLowerCase().lastIndexOf('</think>');
    t = i >= 0 ? t.slice(i + 8) : '';
  }
  return t.trim();
}

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose or fences). */
export function parseJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
