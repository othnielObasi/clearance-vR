import { describe, expect, it } from 'vitest';
import { crewNameFor, emptyMemory } from '../src/core/crew';
import { fieldNote, greetingLine } from '../src/game/voice';
import { LEVELS } from '../src/levels';

describe('crew', () => {
  it('every campaign robot is a named crew member, and shortcut-takers are Bolt or Juno', () => {
    for (const l of LEVELS)
      l.robots.forEach((r, i) => {
        const name = crewNameFor(r, i);
        expect(['Bolt', 'Pip', 'Rook', 'Juno']).toContain(name);
        if (r.traits?.shortcutBias) expect(['Bolt', 'Juno']).toContain(name);
      });
  });

  it('greetings reflect how you treated them', () => {
    expect(greetingLine('Bolt', emptyMemory())).toBe('I know all the shortcuts.');
    expect(greetingLine('Bolt', { ...emptyMemory(), caught: 1, shifts: 1 })).toBe("Bet you can't catch me twice.");
    expect(greetingLine('Bolt', { ...emptyMemory(), riskyApproved: 2, caught: 1, shifts: 2 })).toBe('You let me through last time…');
    expect(greetingLine('Pip', { ...emptyMemory(), needlessStops: 1, shifts: 1 })).toBe("Please don't stop me for nothing.");
    expect(greetingLine('Rook', { ...emptyMemory(), saves: 1, shifts: 1 })).toBe('Thanks for looking out.');
  });

  it('every level and mode has a field note', () => {
    for (const id of [...LEVELS.map((l) => l.id), 'OVERTIME', 'DAILY']) expect(fieldNote(id)).toMatch(/^Field note: /);
  });
});
