import { LineId, LineConfig, AppConfig, Bunker } from './types';

export const LINES: Record<LineId, LineConfig> = {
  1: { name: 'Menglijn 1', full: 'Menglijn 1', speed: 3.2, prep: 15, empty: 4, color: '#1a7f4b' },
  2: { name: 'Menglijn 2', full: 'Menglijn 2', speed: 2.8, prep: 12, empty: 4, color: '#2563eb' },
  3: { name: 'Menglijn 3', full: 'Menglijn 3', speed: 2.5, prep: 18, empty: 4, color: '#9333ea' }
};

export const DEFAULT_CFG: Record<LineId, AppConfig> = {
  1: { prep: 15, empty: 4, wissel: 10, maxWait: 30 },
  2: { prep: 12, empty: 4, wissel: 8, maxWait: 30 },
  3: { prep: 18, empty: 4, wissel: 10, maxWait: 30 }
};

export const INITIAL_BUNKERS: Record<LineId, Bunker[]> = {
  1: [
    { c: 'DB01', ms: ['Compost Middel 0-10mm', 'Fractie 0'], m: 'Compost Middel 0-10mm', fx: false, me: false },
    { c: 'DB02', ms: ['Houtvezel Middel', 'Houtvezel Fijn Duiven'], m: 'Houtvezel Middel', fx: false, me: false },
    { c: 'DB03', ms: ['Kokosvezelmix', 'Kokoscrush'], m: 'Kokosvezelmix', fx: false, me: true },
    { c: 'DB04', ms: ['Gecomposteerde Bark'], m: 'Gecomposteerde Bark', fx: false, me: false },
    { c: 'DB05', ms: ['Litouwse Freesturf Middel', 'Freesturf Fijn'], m: 'Litouwse Freesturf Middel', fx: false, me: false },
    { c: 'DB06', ms: ['Litouwse Tuinturf Vezelig'], m: 'Litouwse Tuinturf Vezelig', fx: true, me: false },
    { c: 'DB07', ms: ['T13', 'Bark 5-8mm', 'Kokosgruis Gebufferd', 'Kokoscrush'], m: null, fx: false, me: false },
    { c: 'DB08', ms: ['T13', 'Fractie 2', 'Fractie 1', 'FT/TT Vezelmix', 'Kokoscrush'], m: 'T13', fx: false, me: true },
    { c: 'DB09', ms: ['Fractie 2', 'Fractie 1', 'Ierse Fractie 1', 'Bark 5-8mm'], m: 'Fractie 2', fx: false, me: true },
    { c: 'DB10', ms: ['FT/TT Vezelmix'], m: 'FT/TT Vezelmix', fx: true, me: false },
    { c: 'DB11', ms: ['Klei Florisol Rubra 0-3mm', 'Klei 1-4mm'], m: 'Klei 1-4mm', fx: false, me: true, shared: [1, 3] },
    { c: 'DB12', ms: ['Klei Florisol Rubra 0-3mm', 'Klei granulaat EDR', 'Klei 1-4mm'], m: 'Klei Florisol Rubra 0-3mm', fx: false, me: false, shared: [1, 3] },
    { c: 'DB13', ms: ['T13', 'Ierse Freesturf Middel', 'Ierse Coarse', 'Fractie 0'], m: 'Ierse Freesturf Middel', fx: false, me: false, shared: [1, 3] },
    { c: 'SO40', ms: ['Perliet Grof'], m: 'Perliet Grof', fx: true, me: false },
    { c: 'SO41', ms: ['Perliet Fijn'], m: 'Perliet Fijn', fx: true, me: false },
    { c: 'SO42', ms: ['Perliet Grof'], m: 'Perliet Grof', fx: true, me: false },
  ],
  2: [
    { c: 'DB01', ms: ['Litouwse Freesturf Middel', 'Freesturf Fijn'], m: 'Litouwse Freesturf Middel', fx: false, me: false },
    { c: 'DB02', ms: ['Fractie 0', 'T13'], m: 'Fractie 0', fx: false, me: false },
    { c: 'DB03', ms: ['Houtvezel Fijn Duiven', 'Kokosvezelmix'], m: 'Kokosvezelmix', fx: false, me: true },
    { c: 'DB04', ms: ['Litouwse Tuinturf Vezelig'], m: 'Litouwse Tuinturf Vezelig', fx: false, me: false },
    { c: 'DB05', ms: ['T13', 'Bark 5-8mm', 'Kokosgruis Gebufferd', 'Fractie 1'], m: 'Fractie 1', fx: false, me: false },
    { c: 'DB06', ms: ['T13', 'Fractie 2', 'Kokosgruis Gebufferd'], m: 'Fractie 2', fx: false, me: false },
    { c: 'DB07', ms: ['Klei 1-4mm', 'Klei Florisol Rubra 0-3mm', 'Klei granulaat EDR'], m: 'Klei 1-4mm', fx: false, me: false },
    { c: 'DB08', ms: ['Houtvezel Middel', 'Fractie 1', 'Ierse Fractie 1'], m: 'Houtvezel Middel', fx: false, me: false },
    { c: 'DB09', ms: ['Zand'], m: null, fx: false, me: false },
    { c: 'SO40', ms: ['Perliet Grof'], m: 'Perliet Grof', fx: true, me: false },
    { c: 'SO41', ms: ['Perliet Fijn'], m: 'Perliet Fijn', fx: true, me: false },
    { c: 'SO42', ms: ['Perliet Grof'], m: 'Perliet Grof', fx: true, me: false },
  ],
  3: [
    { c: 'DB01', ms: [], m: null, fx: false, me: false },
    { c: 'DB02', ms: [], m: null, fx: false, me: false },
    { c: 'DB03', ms: ['Kokosgruis Gebufferd'], m: 'Kokosgruis Gebufferd', fx: false, me: false },
    { c: 'DB04', ms: ['Kokosgruis Gewassen'], m: 'Kokosgruis Gewassen', fx: false, me: false },
    { c: 'DB05', ms: [], m: null, fx: false, me: false },
    { c: 'DB11', ms: ['Klei Florisol Rubra 0-3mm', 'Klei 1-4mm'], m: null, fx: false, me: false, shared: [1, 3] },
    { c: 'DB12', ms: ['Klei Florisol Rubra 0-3mm', 'Klei granulaat EDR', 'Klei 1-4mm'], m: null, fx: false, me: false, shared: [1, 3] },
    { c: 'DB13', ms: ['T13', 'Ierse Freesturf Middel', 'Ierse Coarse', 'Fractie 0'], m: null, fx: false, me: false, shared: [1, 3] },
  ]
};
