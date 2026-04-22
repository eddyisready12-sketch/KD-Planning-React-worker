import type { Bunker, LineId } from '../types';
import type { CalibrationMaterial } from '../services/sheetService';
import type { SharedBunkerMaterialRow } from '../services/supabaseService';

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeSharedCalibrationIntoBunkers(
  baseBunkers: Record<LineId, Bunker[]>,
  sharedCalibrationRows: SharedBunkerMaterialRow[]
): { bunkers: Record<LineId, Bunker[]>; materials: CalibrationMaterial[] } {
  const calibrationByBunker = new Map<string, SharedBunkerMaterialRow[]>();
  sharedCalibrationRows.forEach(row => {
    const lid = Number(row.line_id || 0);
    const bunkerCode = String(row.bunker_code || '');
    const materialName = String(row.material_name || '').trim();
    if (![1, 2, 3].includes(lid) || !bunkerCode || !materialName) return;
    const key = `${lid}|${bunkerCode}`;
    const list = calibrationByBunker.get(key) || [];
    list.push(row);
    calibrationByBunker.set(key, list);
  });

  const materialsMap = new Map<string, CalibrationMaterial>();
  const nextBunkers: Record<LineId, Bunker[]> = { 1: [], 2: [], 3: [] };

  ([1, 2, 3] as LineId[]).forEach(lid => {
    nextBunkers[lid] = (baseBunkers[lid] || []).map(bunker => {
      const rows = calibrationByBunker.get(`${lid}|${bunker.c}`) || [];
      if (rows.length === 0) return bunker;

      const nextMaterialData = { ...(bunker.materialData || {}) };
      const nextMs = new Set<string>(bunker.ms || []);

      rows.forEach(row => {
        const materialName = String(row.material_name || '').trim();
        const materialCode = row.material_code ? String(row.material_code) : null;
        const calibrationValue = toOptionalNumber(row.calibration_value);

        nextMs.add(materialName);
        nextMaterialData[materialName] = {
          code: materialCode,
          calibrationValue
        };

        const existing = materialsMap.get(materialName);
        if (!existing || (calibrationValue !== null && existing.calibrationValue === null)) {
          materialsMap.set(materialName, {
            name: materialName,
            code: materialCode,
            calibrationValue
          });
        }
      });

      return {
        ...bunker,
        ms: Array.from(nextMs),
        materialData: nextMaterialData
      };
    });
  });

  return {
    bunkers: nextBunkers,
    materials: Array.from(materialsMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'nl-NL'))
  };
}
