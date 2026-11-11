import type { LevelDef } from '../core/types';
import { validateLevel } from './validate';
import L01 from './L01.json';
import L02 from './L02.json';
import L03 from './L03.json';
import L04 from './L04.json';
import L05 from './L05.json';
import L06 from './L06.json';
import L07 from './L07.json';

export const LEVELS: LevelDef[] = [L01, L02, L03, L04, L05, L06, L07].map((l) => validateLevel(l as unknown as LevelDef));

export { validateLevel };
