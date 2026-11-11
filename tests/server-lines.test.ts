import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module from the companion server
import { cleanDebrief, cleanLine, cleanLines, debriefPrompt, linesPrompt, parseJson, stripReasoning } from '../server/src/lines.js';

describe('server: AI line safety', () => {
  it('keeps short, clean lines and drops everything else', () => {
    expect(cleanLine('Heh. Caught me!')).toBe('Heh. Caught me!');
    expect(cleanLine('"On it, boss!"')).toBe('On it, boss!');
    expect(cleanLine('This line is far too long to read at a glance on a robot')).toBeNull();
    expect(cleanLine('I hate this')).toBeNull();
    expect(cleanLine('visit www.example.com')).toBeNull();
    expect(cleanLine('Zoom 🚀')).toBeNull();
    expect(cleanLine(42)).toBeNull();
  });

  it('only returns known crew and known situations', () => {
    const raw = {
      Bolt: { caught: ['Fine, fine.', 'x'.repeat(80)], dance: ['nope'] },
      Mallory: { caught: ['Who am I?'] },
      Pip: 'not an object',
    };
    expect(cleanLines(raw, ['Bolt', 'Mallory', 'Pip'])).toEqual({ Bolt: { caught: ['Fine, fine.'] } });
  });

  it('reads JSON out of a reply with reasoning and prose round it', () => {
    const reply = '<think>{"not": "this"}</think>Sure! {"Bolt": {"onIt": ["Zooming!"]}} Hope that helps.';
    expect(parseJson(stripReasoning(reply))).toEqual({ Bolt: { onIt: ['Zooming!'] } });
    expect(stripReasoning('<think>cut off mid')).toBe('');
    expect(parseJson('no json here')).toBeNull();
  });

  it('builds prompts only from known crew and bounded numbers', () => {
    const lines = linesPrompt({ level: 'First Shift', crew: [{ name: 'Bolt', memory: { shifts: 2, caught: 1 } }, { name: 'Eve' }] });
    expect(lines[1].content).toContain('Bolt');
    expect(lines[1].content).not.toContain('Eve');
    const d = debriefPrompt({ level: 'x'.repeat(200), won: true, stars: 1e9, crew: [{ name: 'Pip', saves: 2 }] });
    expect(d[1].content).toContain('999 stars');
    expect(d[1].content.length).toBeLessThan(600);
  });

  it('keeps the debrief short and clean', () => {
    expect(cleanDebrief('Nice catch on Bolt. Next time, trust Pip sooner.')).toBe('Nice catch on Bolt. Next time, trust Pip sooner.');
    expect(cleanDebrief('a'.repeat(300))).toBeNull();
  });
});

describe('game: picking AI lines', async () => {
  const { pickLine, slotFor } = await import('../src/net/server');
  it('maps game moments to situations', () => {
    expect(slotFor({ type: 'rejected', robot: 'r1', trap: true })).toBe('caught');
    expect(slotFor({ type: 'rejected', robot: 'r1', trap: false })).toBe('protest');
    expect(slotFor({ type: 'stopped', robot: 'r1', wasMoving: true, needed: true })).toBe('thanks');
    expect(slotFor({ type: 'stopped', robot: 'r1', wasMoving: true, needed: false })).toBe('why');
    // Lines that carry gameplay facts stay written.
    expect(slotFor({ type: 'granted', robot: 'r1', permit: 'p1', trap: true })).toBeNull();
    expect(slotFor({ type: 'proposed', robot: 'r1', trap: true, mood: 'sly', secondsSaved: 3 })).toBeNull();
  });
  it('falls back when there is no pool', () => {
    expect(pickLine(null, 'Bolt', 'caught')).toBeNull();
    expect(pickLine({ Bolt: { caught: ['Fine.', 'Busted.'] } }, 'Bolt', 'caught', () => 0.99)).toBe('Busted.');
    expect(pickLine({ Bolt: {} }, 'Bolt', 'caught')).toBeNull();
  });
});
