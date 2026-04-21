import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { INITIAL_BUNKERS } from '../constants';
import type { Bunker, LineId, Melding, Order } from '../types';
import type { CalibrationMaterial } from '../services/sheetService';
import type { SharedBunkerMaterialRow } from '../services/supabaseService';
import { fetchBunkerMaterialsFromSupabase, fetchBunkerStateFromSupabase, isSupabaseConfigured, writeSingleBunkerToSupabase } from '../services/supabaseService';
import { FRACTION_MIX_MATERIAL_CODE, FRACTION_MIX_MATERIAL_NAME } from '../utils';

type UseBunkersOptions = {
  orders: Order[];
  calibrationMaterials: CalibrationMaterial[];
  setCalibrationMaterials: Dispatch<SetStateAction<CalibrationMaterial[]>>;
  setNotifications: Dispatch<SetStateAction<Melding[]>>;
};

function mergeSharedCalibrationIntoBunkers(
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
        const calibrationValue =
          row.calibration_value === null || row.calibration_value === undefined
            ? null
            : Number(row.calibration_value);

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

export function useBunkers({
  orders,
  calibrationMaterials,
  setCalibrationMaterials,
  setNotifications
}: UseBunkersOptions) {
  const [bunkers, setBunkers] = useState<Record<LineId, Bunker[]>>(INITIAL_BUNKERS);
  const bunkerRefreshInFlight = useRef(false);

  const refreshBunkersFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    if (bunkerRefreshInFlight.current) return;
    bunkerRefreshInFlight.current = true;
    try {
      const sharedRows = await fetchBunkerStateFromSupabase();
      const sharedCalibrationRows = await fetchBunkerMaterialsFromSupabase();
      let mergedCalibration: ReturnType<typeof mergeSharedCalibrationIntoBunkers> | null = null;
      setBunkers(prev => {
        const next = { ...prev };
        ([1, 2, 3] as LineId[]).forEach(lid => {
          next[lid] = (next[lid] || []).map(bunker => {
            const sharedState = sharedRows.find(row =>
              Number(row.line_id || 0) === Number(lid) &&
              String(row.bunker_code || '') === bunker.c
            );
            if (!sharedState) return bunker;
            return {
              ...bunker,
              m: sharedState.current_material ?? sharedState.material_name ?? bunker.m ?? null,
              mc: sharedState.current_material_code ?? sharedState.material_code ?? bunker.mc ?? null,
              fx: sharedState.fixed ?? sharedState.is_fixed ?? bunker.fx ?? false,
              mustEmpty: sharedState.must_empty ?? bunker.mustEmpty,
              leegNaOrder: sharedState.empty_after_order ?? bunker.leegNaOrder ?? null
            };
          });
        });
        mergedCalibration = mergeSharedCalibrationIntoBunkers(next, sharedCalibrationRows);
        return mergedCalibration.bunkers;
      });
      if (mergedCalibration && mergedCalibration.materials.length > 0) {
        setCalibrationMaterials(mergedCalibration.materials);
      }
    } catch {
      // keep current local state if supabase refresh fails
    } finally {
      bunkerRefreshInFlight.current = false;
    }
  }, [setCalibrationMaterials]);

  const handleBunkerUpdate = useCallback(async (lid: LineId, bunkerCode: string, newMaterial: string | null) => {
    const lineBunkers = [...(bunkers[lid] || [])];
    const idx = lineBunkers.findIndex(bunker => bunker.c === bunkerCode);
    if (idx === -1) return;

    const bunker = lineBunkers[idx];
    const isFractionMix = newMaterial === FRACTION_MIX_MATERIAL_NAME;
    const calMat = isFractionMix ? null : calibrationMaterials.find(material => material.name === newMaterial);
    const specificData = newMaterial && !isFractionMix ? bunker.materialData?.[newMaterial] : null;

    lineBunkers[idx] = {
      ...bunker,
      m: newMaterial,
      mc: isFractionMix
        ? FRACTION_MIX_MATERIAL_CODE
        : specificData?.code || calMat?.code || orders.flatMap(order => order.components).find(component => component.name === newMaterial)?.code || null,
      calibrationValue: isFractionMix
        ? null
        : specificData?.calibrationValue ?? calMat?.calibrationValue ?? bunker.calibrationValue
    };

    const nextBunkers: Record<LineId, Bunker[]> = { ...bunkers, [lid]: lineBunkers };
    setBunkers(nextBunkers);

    if (isSupabaseConfigured()) {
      try {
        await writeSingleBunkerToSupabase(lid, lineBunkers[idx]);
        await refreshBunkersFromSupabase();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Bunkerstatus sync mislukt';
        setNotifications(prev => [{
          id: Date.now(),
          type: 'fout',
          icon: 'ERR',
          titel: 'Bunkerstatus sync mislukt',
          tekst: errorMsg,
          lijn: lid,
          orderNum: null,
          tijd: new Date(),
          gelezen: false
        }, ...prev]);
      }
    }
  }, [bunkers, calibrationMaterials, orders, refreshBunkersFromSupabase, setNotifications]);

  return {
    bunkers,
    setBunkers,
    refreshBunkersFromSupabase,
    handleBunkerUpdate
  };
}
