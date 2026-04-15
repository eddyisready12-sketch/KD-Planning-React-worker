import { Order, LineId, AppConfig, Bunker, OrderComponent } from './types';
import { LINES, DEFAULT_CFG } from './constants';

export function ev(o: Order): number {
  const pkg = normalizePkg(o.pkg);
  return (pkg === 'bale' || pkg === 'packaged') ? o.vol * 1.03 : o.vol;
}

export function rt(o: Order, speed: number): number {
  return ev(o) / speed;
}

export function sl(o: Order, extraSw: number, hasPrevOrder: boolean, cfg: AppConfig, speed: number): number {
  const sw = extraSw || 0;
  const emptyMinutes = hasPrevOrder && sw === 0 ? 0 : cfg.empty;
  return cfg.prep + rt(o, speed) + emptyMinutes + (sw * cfg.wissel);
}

export function fmt(t: Date): string {
  return t.toTimeString().slice(0, 5);
}

export function normalizeEta(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const numeric = Number(raw.replace(',', '.'));
  if (!isNaN(numeric) && numeric > 0 && numeric < 1) {
    const totalMinutes = Math.round(numeric * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Handle Google Sheets GViz Date format: Date(1899,11,30,5,15,0)
  const dateMatch = raw.match(/Date\(\d+,\d+,\d+,(\d+),(\d+)(?:,\d+)?\)/i);
  if (dateMatch) {
    const hh = String(parseInt(dateMatch[1], 10)).padStart(2, '0');
    const mm = String(parseInt(dateMatch[2], 10)).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const timeMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    const hh = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
    const mm = String(parseInt(timeMatch[2], 10)).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 4) return digits.slice(0, 2) + ':' + digits.slice(2, 4);
  return raw;
}

export function normalizePkg(value: string | number | null | undefined): 'bulk' | 'bag' | 'bale' | 'packaged' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'bulk';
  if (raw === 'm3' || raw === 'bulk') return 'bulk';
  if (raw === 'bal' || raw === 'bale') return 'bale';
  if (raw === 'bag') return 'bag';
  if (raw === 'packaged' || raw === 'pakket' || raw === 'verpakt') return 'packaged';
  return 'bulk';
}

export function etaToMins(eta: string | number | null | undefined): number | null {
  const raw = String(eta ?? '').trim();
  if (!raw) return null;
  const p = raw.split(':');
  if (p.length !== 2) return null;
  return parseInt(p[0]) * 60 + parseInt(p[1]) - (5 * 60);
}

export function baseScheduleDate(): Date {
  const t = new Date();
  t.setHours(5, 0, 0, 0);
  return t;
}

export function parseNumber(val: string | number | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const clean = String(val).trim();
  if (clean.includes(',') && clean.includes('.')) {
    return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
  }
  if (clean.includes(',')) {
    return parseFloat(clean.replace(',', '.'));
  }
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

export function getLoadStartWindow(order: Order, cfg: AppConfig) {
  if (!normalizeEta(order.eta)) return null;
  const etaMins = etaToMins(order.eta);
  if (etaMins === null) return null;
  // Fixed start check (05:15)
  if (order.prio === 1 && normalizeEta(order.eta) === '05:15') return { start: etaMins, end: etaMins };
  return { start: etaMins, end: etaMins + cfg.maxWait + 10 }; // 10 is grace min
}

export function materialsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  const aa = normalize(a);
  const bb = normalize(b);
  return aa === bb || aa.includes(bb) || bb.includes(aa);
}

export function normalizeMaterialCode(code: string | null | undefined): string {
  return String(code || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^0+(?=\d)/, '');
}

export function materialCodesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = normalizeMaterialCode(a);
  const bb = normalizeMaterialCode(b);
  if (!aa || !bb) return aa === bb;
  return aa === bb;
}

function normalizeMaterialNameKey(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

let runtimeMaterialOverridePairs: Array<{ requestedCode: string; existingCode: string }> = [];

const MIXABLE_MATERIAL_CODE_GROUPS = [
  ['6000001100', '6000001200']
];

const MIXABLE_MATERIAL_NAME_GROUPS = [
  ['fractie1', 'fractie2']
];

export const FRACTION_MIX_MATERIAL_NAME = 'Fractie 1 + Fractie 2';
export const FRACTION_MIX_MATERIAL_CODE = '6000001100+6000001200';

function normalizeMaterialCodeTokens(code: string | null | undefined): string[] {
  return String(code || '')
    .split(/[^0-9]+/g)
    .map(part => normalizeMaterialCode(part))
    .filter(Boolean);
}

function materialMatchesMixGroup(
  name: string | null | undefined,
  code: string | null | undefined,
  codeGroup: string[],
  nameGroup: string[]
): boolean {
  const codeTokens = normalizeMaterialCodeTokens(code);
  if (codeTokens.some(token => codeGroup.includes(token))) return true;

  const nameKey = normalizeMaterialNameKey(name);
  if (nameGroup.includes(nameKey)) return true;
  return nameGroup.every(part => nameKey.includes(part));
}

export function isFractieMixMaterial(name: string | null | undefined, code: string | null | undefined): boolean {
  return materialMatchesMixGroup(name, code, MIXABLE_MATERIAL_CODE_GROUPS[0], MIXABLE_MATERIAL_NAME_GROUPS[0]) &&
    MIXABLE_MATERIAL_NAME_GROUPS[0].every(part => normalizeMaterialNameKey(name).includes(part) || normalizeMaterialCodeTokens(code).length > 1);
}

export function materialsMixCompatible(
  existingName: string | null | undefined,
  existingCode: string | null | undefined,
  requestedName: string | null | undefined,
  requestedCode: string | null | undefined
): boolean {
  if (materialsEquivalent(existingName, requestedName)) return false;
  if (materialCodesEquivalent(existingCode, requestedCode)) return false;

  return MIXABLE_MATERIAL_CODE_GROUPS.some((codeGroup, index) => {
    const nameGroup = MIXABLE_MATERIAL_NAME_GROUPS[index] || [];
    return materialMatchesMixGroup(existingName, existingCode, codeGroup, nameGroup) &&
      materialMatchesMixGroup(requestedName, requestedCode, codeGroup, nameGroup);
  });
}

export function setRuntimeMaterialOverrides(pairs: Array<{ requestedCode: string; existingCode: string }>) {
  runtimeMaterialOverridePairs = pairs
    .map(pair => ({
      requestedCode: normalizeMaterialCode(pair.requestedCode),
      existingCode: normalizeMaterialCode(pair.existingCode)
    }))
    .filter(pair => !!pair.requestedCode && !!pair.existingCode);
}

export function canUseExistingMaterialForRequested(
  existingName: string | null | undefined,
  existingCode: string | null | undefined,
  requestedName: string | null | undefined,
  requestedCode: string | null | undefined
): boolean {
  if (materialsEquivalent(existingName, requestedName)) return true;
  if (materialCodesEquivalent(existingCode, requestedCode)) return true;
  if (materialsMixCompatible(existingName, existingCode, requestedName, requestedCode)) return true;

  const existingCodeKey = normalizeMaterialCode(existingCode);
  const requestedCodeKey = normalizeMaterialCode(requestedCode);
  return runtimeMaterialOverridePairs.some(
    pair => pair.requestedCode === requestedCodeKey && pair.existingCode === existingCodeKey
  );
}

export function hasProlineCleaningTrigger(order: Pick<Order, 'customer' | 'recipe' | 'productName' | 'yZeile' | 'note'> | null | undefined): boolean {
  if (!order) return false;
  const haystack = [
    order.customer,
    order.recipe,
    order.productName,
    order.yZeile,
    order.note
  ]
    .filter(Boolean)
    .join(' ');
  return /\bpro\s*-?\s*line\b|\bproline\b/i.test(haystack);
}

export function swCount(a: Order | null, b: Order, bunkers: Bunker[]): number {
  if (!b) return 0;
  
  const prevMats = a ? new Set(a.components.map(c => c.name.toLowerCase())) : new Set<string>();
  const prevCodes = a ? new Set(a.components.map(c => c.code)) : new Set<string>();

  const currentBunkerMats = new Set<string>();
  const currentBunkerCodes = new Set<string>();
  bunkers.forEach(bnk => {
    if (bnk.m) currentBunkerMats.add(bnk.m.toLowerCase());
    if (bnk.mc) currentBunkerCodes.add(bnk.mc);
  });

  let sw = 0;
  const processed = new Set<string>();

  b.components.forEach(c => {
    const unit = (c.unit || '').toUpperCase();
    const isInCalibration = bunkers.some(bnk => 
      (bnk.ms && bnk.ms.some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code))) ||
      (bnk.materialData && Object.entries(bnk.materialData).some(([mName, mData]) => canUseExistingMaterialForRequested(mName, mData.code, c.name, c.code)))
    );
    const isBulk = unit === 'M3' || unit === 'PERC' || unit === '' || isInCalibration;
    if (!isBulk) return;

    const key = `${c.name}|${c.code}`;
    if (processed.has(key)) return;
    processed.add(key);

    const isCurrentlyAvailable = prevMats.has(c.name.toLowerCase()) || 
                                 (c.code && prevCodes.has(c.code)) ||
                                 currentBunkerMats.has(c.name.toLowerCase()) || 
                                 (c.code && currentBunkerCodes.has(c.code)) ||
                                 Array.from(prevMats).some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code)) ||
                                 Array.from(currentBunkerMats).some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code));

    if (!isCurrentlyAvailable) {
      sw++;
    }
  });
  return sw;
}

export function getSwitchMaterials(a: Order | null, b: Order, bunkers: Bunker[]): string[] {
  if (!b) return [];
  
  const prevMats = a ? new Set(a.components.map(c => c.name.toLowerCase())) : new Set<string>();
  const prevCodes = a ? new Set(a.components.map(c => c.code)) : new Set<string>();

  const currentBunkerMats = new Set<string>();
  const currentBunkerCodes = new Set<string>();
  bunkers.forEach(bnk => {
    if (bnk.m) currentBunkerMats.add(bnk.m.toLowerCase());
    if (bnk.mc) currentBunkerCodes.add(bnk.mc);
  });

  const toLoad: string[] = [];
  const processed = new Set<string>();

  b.components.forEach(c => {
    const unit = (c.unit || '').toUpperCase();
    const isInCalibration = bunkers.some(bnk => 
      (bnk.ms && bnk.ms.some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code))) ||
      (bnk.materialData && Object.entries(bnk.materialData).some(([mName, mData]) => canUseExistingMaterialForRequested(mName, mData.code, c.name, c.code)))
    );
    const isBulk = unit === 'M3' || unit === 'PERC' || unit === '' || isInCalibration;
    if (!isBulk) return;

    const key = `${c.name}|${c.code}`;
    if (processed.has(key)) return;
    processed.add(key);

    const isCurrentlyAvailable = prevMats.has(c.name.toLowerCase()) || 
                                 (c.code && prevCodes.has(c.code)) ||
                                 currentBunkerMats.has(c.name.toLowerCase()) || 
                                 (c.code && currentBunkerCodes.has(c.code)) ||
                                 Array.from(prevMats).some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code)) ||
                                 Array.from(currentBunkerMats).some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code));

    if (!isCurrentlyAvailable) {
      toLoad.push(c.name);
    }
  });
  return toLoad;
}

export function applyOrderStartConstraints(startMinutes: number, order: Order, lid: LineId, slotMinutes: number, cfg: AppConfig): number {
  let adjustedStart = startMinutes;
  
  const window = getLoadStartWindow(order, cfg);
  if (window) {
    const isFirstPlannedOrder = adjustedStart === 0;
    if (isFirstPlannedOrder && window.start > 0) {
      adjustedStart = Math.max(adjustedStart, window.start - Math.max(0, cfg.prep || 0));
    } else if (window.start > adjustedStart) {
      adjustedStart = window.start;
    }
  }
  return adjustedStart;
}

export function getScheduledStarts(list: Order[], lid: LineId, cfg: AppConfig, bunkers: Bunker[]): Date[] {
  const starts: Date[] = [];
  let current = 0;
  const speed = LINES[lid].speed;

  for (let j = 0; j < list.length; j++) {
    const o = list[j];
    const sw = j > 0 ? swCount(list[j - 1], o, bunkers) : 0;
    const slot = sl(o, sw, j > 0, cfg, speed);
    let startMinutes = applyOrderStartConstraints(current, o, lid, slot, cfg);
    const dt = baseScheduleDate();
    dt.setMinutes(dt.getMinutes() + startMinutes);
    starts.push(dt);
    current = startMinutes + slot;
  }
  return starts;
}
