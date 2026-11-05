/** The recurring robot crew. Each has a fixed colour and a personality that shows in what it says. */
export const CREW = {
  Bolt: { color: 0, personality: 'rule-bender' },
  Pip: { color: 1, personality: 'careful' },
  Rook: { color: 2, personality: 'steady' },
  Juno: { color: 3, personality: 'speedy' },
} as const;

export type CrewName = keyof typeof CREW;
const ORDER: CrewName[] = ['Pip', 'Rook', 'Bolt', 'Juno'];

export function isCrewName(n: string | undefined): n is CrewName {
  return !!n && n in CREW;
}

/** Name for a robot: its own, or a stable default by position. */
export function crewNameFor(def: { name?: string }, index: number): CrewName {
  return isCrewName(def.name) ? def.name : ORDER[index % ORDER.length]!;
}

/** What each crew member remembers about how you treated them (saved between sessions). */
export interface CrewMemory {
  caught: number;
  riskyApproved: number;
  needlessStops: number;
  saves: number;
  delivered: number;
  shifts: number;
}

export const emptyMemory = (): CrewMemory => ({ caught: 0, riskyApproved: 0, needlessStops: 0, saves: 0, delivered: 0, shifts: 0 });
