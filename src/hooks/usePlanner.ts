import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { LINES } from '../constants';
import type { Bunker, LineId, Order, AppConfig } from '../types';
import { ev, normalizeEta, rt, swCount } from '../utils';

export type LineTimingSettings = {
  dayStart: string;
  firstOrderStart: string;
};

type GapDebugCandidate = {
  orderId: number;
  customer: string;
  neededMinutes: number;
  filledMinutes: number;
  volume: number;
  remainder: number;
  valid: boolean;
  reason: string;
};

type GapDebugEntry = {
  line: LineId;
  afterOrderId: number;
  beforeOrderId: number;
  gapMinutes: number;
  chosenOrderId: number | null;
  candidates: GapDebugCandidate[];
};

type UsePlannerOptions = {
  bunkers: Record<LineId, Bunker[]>;
  config: AppConfig;
  lineTiming: Record<LineId, LineTimingSettings>;
  effectiveFirstOrderStart: string;
  getOrderLoadReferenceTime: (order: Order) => string | null;
  getEffectivePriority: (order: Order) => 1 | 2 | 3;
  setGapDebug?: Dispatch<SetStateAction<GapDebugEntry[]>>;
};

const BAG_COOLDOWN_MINUTES = 90;

function parseLocalDate(value?: string | null): Date | null {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function timeStringToMinutes(value: string | null | undefined, fallback: number): number {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const [hh, mm] = raw.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return fallback;
  return hh * 60 + mm;
}

const isBagPkg = (order: Order | null) => order?.pkg?.toLowerCase() === 'bag';

export function usePlanner({
  bunkers,
  config,
  lineTiming,
  effectiveFirstOrderStart,
  getOrderLoadReferenceTime,
  getEffectivePriority,
  setGapDebug
}: UsePlannerOptions) {
  const [plannedOrderIdsByLine, setPlannedOrderIdsByLine] = useState<Record<LineId, number[]> | null>(() => {
    const saved = localStorage.getItem('kd_planned_order_ids_by_line');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (plannedOrderIdsByLine) {
      localStorage.setItem('kd_planned_order_ids_by_line', JSON.stringify(plannedOrderIdsByLine));
    }
  }, [plannedOrderIdsByLine]);

  const getTransitionMinutes = useCallback((lid: LineId, prevOrder: Order | null, nextOrder: Order, lineBunkersOverride?: Bunker[]) => {
    if (!prevOrder) return 0;
    const lineBunkers = lineBunkersOverride || bunkers[lid];
    const sw = swCount(prevOrder, nextOrder, lineBunkers);

    if (lid === 1) {
      const includedSwitches = 3;
      const extraSwitches = Math.max(0, sw - includedSwitches);
      return 15 + (extraSwitches * config[lid].wissel);
    }

    return config[lid].prep + (sw * config[lid].wissel);
  }, [bunkers, config]);

  const getScheduledStartsForLine = useCallback((list: Order[], lid: LineId): Date[] => {
    const starts: Date[] = [];
    const cfg = config[lid];
    const lineBunkers = bunkers[lid];
    const lineTimingCfg = lineTiming[lid];
    const baseDayStart = timeStringToMinutes(lineTimingCfg?.dayStart || '05:00', 5 * 60);
    const firstOrderStart = timeStringToMinutes(effectiveFirstOrderStart, baseDayStart + 15);
    const speed = LINES[lid].speed;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const anchorDay = parseLocalDate(list[0]?.date) || today;
    let current = 0;
    let nextAllowedBagProdStart: number | null = null;

    list.forEach((order, index) => {
      const prevOrder = index > 0 ? list[index - 1] : null;
      const transitionMinutes = getTransitionMinutes(lid, prevOrder, order, lineBunkers);
      const slot = rt(order, speed) + transitionMinutes;
      const orderDay = parseLocalDate(order.date) || anchorDay;
      const dayOffsetMinutes = Math.round((orderDay.getTime() - anchorDay.getTime()) / 86400000) * 1440;
      let startMinutes = current;
      const eta = getOrderLoadReferenceTime(order);
      const etaMinutes = eta ? dayOffsetMinutes + timeStringToMinutes(eta, baseDayStart) : null;
      if (index === 0) {
        startMinutes = dayOffsetMinutes + firstOrderStart;
      }

      startMinutes = Math.max(startMinutes, dayOffsetMinutes + firstOrderStart);

      if (isBagPkg(order) && nextAllowedBagProdStart !== null) {
        startMinutes = Math.max(startMinutes, nextAllowedBagProdStart - transitionMinutes);
      }

      if (etaMinutes !== null && index !== 0) {
        const windowStart = etaMinutes;
        const windowEnd = etaMinutes + (order.status === 'arrived' ? 30 : cfg.maxWait);
        const isFixedFirstOrder = getEffectivePriority(order) === 1 && eta === effectiveFirstOrderStart;
        const earliestPrepStart = windowStart - transitionMinutes;
        const latestPrepStart = windowEnd - transitionMinutes;
        if (isFixedFirstOrder) {
          startMinutes = Math.max(startMinutes, windowStart);
        } else if (earliestPrepStart > startMinutes) {
          startMinutes = earliestPrepStart;
        }
        startMinutes = Math.min(startMinutes, latestPrepStart);
      }

      startMinutes = Math.max(startMinutes, dayOffsetMinutes + firstOrderStart);

      const dt = new Date(anchorDay);
      dt.setHours(0, 0, 0, 0);
      dt.setMinutes(startMinutes);
      starts.push(dt);
      current = startMinutes + slot;

      if (isBagPkg(order)) {
        const bagEndMinutes = startMinutes + slot;
        nextAllowedBagProdStart = bagEndMinutes + BAG_COOLDOWN_MINUTES;
      }
    });

    return starts;
  }, [bunkers, config, lineTiming, effectiveFirstOrderStart, getTransitionMinutes, getOrderLoadReferenceTime]);

  const planRespectsLoadWindows = useCallback((lid: LineId, planToCheck: Order[]) => {
    const starts = getScheduledStartsForLine(planToCheck, lid);
    for (let index = 0; index < planToCheck.length; index++) {
      const order = planToCheck[index];
      const eta = getOrderLoadReferenceTime(order);
      if (!eta) continue;

      const prevOrder = index > 0 ? planToCheck[index - 1] : null;
      const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
      const prodStart = new Date(starts[index].getTime() + transitionMinutes * 60000);

      const etaMinutes = timeStringToMinutes(eta, 0);
      const latestAllowed = etaMinutes + (order.status === 'arrived' ? 30 : config[lid].maxWait);
      const actualMinutes = prodStart.getHours() * 60 + prodStart.getMinutes();
      const earliestAllowed = etaMinutes;

      if (actualMinutes < earliestAllowed) return false;
      if (actualMinutes > latestAllowed) return false;
    }
    return true;
  }, [config, getOrderLoadReferenceTime, getScheduledStartsForLine, getTransitionMinutes]);

  const [isGapFillPending, setIsGapFillPending] = useState(false);

  const fillSimpleSingleGapWithinLineLocal = useCallback((lid: LineId, initialPlan: Order[]) => {
    if (initialPlan.length < 3) return initialPlan;

    let workingPlan = [...initialPlan];
    let changed = true;
    let passes = 0;
    const maxPasses = 3;
    const debugEntries: GapDebugEntry[] = [];

    while (changed && passes < maxPasses) {
      changed = false;
      passes += 1;
      const timeline = (() => {
        const starts = getScheduledStartsForLine(workingPlan, lid);
        return workingPlan.map((order, index) => {
          const startTime = starts[index];
          const prevOrder = index > 0 ? workingPlan[index - 1] : null;
          const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
          const prodStart = new Date(startTime.getTime() + transitionMinutes * 60000);
          const endTime = new Date(prodStart.getTime() + rt(order, LINES[lid].speed) * 60000);
          return { order, startTime, prodStart, endTime };
        });
      })();

      for (let i = 0; i < timeline.length - 1 && !changed; i++) {
        const current = timeline[i];
        const next = timeline[i + 1];
        const nextEta = normalizeEta(next.order.eta);
        if (!nextEta) continue;

        const gapMinutes = Math.round((next.startTime.getTime() - current.endTime.getTime()) / 60000);
        if (gapMinutes < 15) continue;

        let bestIdx = -1;
        let bestRemainder = Number.POSITIVE_INFINITY;
        let bestPrio = Number.POSITIVE_INFINITY;
        let bestVolume = -1;
        let bestFilledMinutes = -1;
        let bestUtilization = -1;
        let fallbackIdx = -1;
        let fallbackFilledMinutes = -1;
        let fallbackVolume = -1;
        let fallbackRemainder = Number.POSITIVE_INFINITY;
        const candidateDebug: GapDebugCandidate[] = [];

        const evaluateGapCombination = (
          planState: Order[],
          afterIndex: number,
          targetOrderId: number,
          depthRemaining: number
        ): { fill: number; picks: number[]; volume: number; remainder: number } => {
          const starts = getScheduledStartsForLine(planState, lid);
          const targetIndex = planState.findIndex(order => order.id === targetOrderId);
          if (targetIndex <= afterIndex || targetIndex < 0) {
            return { fill: 0, picks: [], volume: 0, remainder: 0 };
          }

          const afterOrder = planState[afterIndex];
          const afterStart = starts[afterIndex];
          const prevOrder = afterIndex > 0 ? planState[afterIndex - 1] : null;
          const afterTransitionMinutes = getTransitionMinutes(lid, prevOrder, afterOrder);
          const afterProdStart = new Date(afterStart.getTime() + afterTransitionMinutes * 60000);
          const afterEnd = new Date(afterProdStart.getTime() + rt(afterOrder, LINES[lid].speed) * 60000);
          const targetStart = starts[targetIndex];
          const localGapMinutes = Math.round((targetStart.getTime() - afterEnd.getTime()) / 60000);

          if (localGapMinutes < 15 || depthRemaining <= 0) {
            return {
              fill: 0,
              picks: [],
              volume: 0,
              remainder: Math.max(localGapMinutes, 0)
            };
          }

          const lookahead =
            localGapMinutes >= 90 ? 22 :
            localGapMinutes >= 60 ? 16 :
            localGapMinutes >= 35 ? 10 :
            6;

          const candidateIndexes: number[] = [];
          for (let idx = afterIndex + 1; idx < planState.length && candidateIndexes.length < lookahead; idx++) {
            const candidate = planState[idx];
            if (candidate.id === targetOrderId) continue;
            if (candidate.status === 'running') continue;
            candidateIndexes.push(idx);
          }

          let bestCombo = {
            fill: 0,
            picks: [] as number[],
            volume: 0,
            remainder: localGapMinutes
          };

          for (const candidateIndex of candidateIndexes) {
            const candidate = planState[candidateIndex];
            if (candidate.pkg === 'bulk' && candidate.status !== 'arrived') continue;
            const neededMinutes = getTransitionMinutes(lid, afterOrder, candidate) + rt(candidate, LINES[lid].speed);
            if (neededMinutes > localGapMinutes) continue;

            const nextPlan = [...planState];
            const [picked] = nextPlan.splice(candidateIndex, 1);
            nextPlan.splice(afterIndex + 1, 0, picked);
            if (!planRespectsLoadWindows(lid, nextPlan)) continue;

            const recursive = evaluateGapCombination(nextPlan, afterIndex + 1, targetOrderId, depthRemaining - 1);
            const totalFill = neededMinutes + recursive.fill;
            const totalVolume = ev(candidate) + recursive.volume;
            const totalPicks = [candidate.id, ...recursive.picks];
            const totalRemainder = recursive.remainder;

            if (
              totalFill > bestCombo.fill ||
              (totalFill === bestCombo.fill && (
                totalVolume > bestCombo.volume ||
                (totalVolume === bestCombo.volume && totalRemainder < bestCombo.remainder)
              ))
            ) {
              bestCombo = {
                fill: totalFill,
                picks: totalPicks,
                volume: totalVolume,
                remainder: totalRemainder
              };
            }
          }

          return bestCombo;
        };

        const firstLookahead =
          gapMinutes >= 90 ? 24 :
          gapMinutes >= 60 ? 18 :
          12;
        const candidateLimit = Math.min(workingPlan.length, i + 2 + firstLookahead);
        for (let j = i + 2; j < candidateLimit; j++) {
          const candidate = workingPlan[j];
          if (candidate.status === 'running') continue;
          if (candidate.pkg === 'bulk' && candidate.status !== 'arrived') continue;

          const neededMinutes = getTransitionMinutes(lid, current.order, candidate) + rt(candidate, LINES[lid].speed);

          if (neededMinutes <= gapMinutes) {
            const nextPlan = [...workingPlan];
            const [picked] = nextPlan.splice(j, 1);
            nextPlan.splice(i + 1, 0, picked);

            const valid = planRespectsLoadWindows(lid, nextPlan);
            if (valid) {
              const remainder = gapMinutes - neededMinutes;
              const effPrio = getEffectivePriority(candidate);
              const volume = ev(candidate);
              const firstFillUtilization = gapMinutes > 0 ? neededMinutes / gapMinutes : 0;
              const tooSmallFirstFill = gapMinutes >= 60 && firstFillUtilization < 0.45;
              const combo = evaluateGapCombination(nextPlan, i + 1, next.order.id, gapMinutes >= 90 ? 3 : 2);
              const filledMinutes = neededMinutes + combo.fill;

              candidateDebug.push({
                orderId: candidate.id,
                customer: candidate.customer,
                neededMinutes,
                filledMinutes,
                volume,
                remainder,
                valid: !tooSmallFirstFill,
                reason: tooSmallFirstFill ? 'eerste vulling te klein voor groot gat' : `prio ${effPrio}`
              });

              const utilization = gapMinutes > 0 ? filledMinutes / gapMinutes : 0;
              const minUtilization = gapMinutes >= 45 ? 0.6 : 0;

              if (
                filledMinutes > fallbackFilledMinutes ||
                (filledMinutes === fallbackFilledMinutes && (
                  volume > fallbackVolume ||
                  (volume === fallbackVolume && remainder < fallbackRemainder)
                ))
              ) {
                fallbackIdx = j;
                fallbackFilledMinutes = filledMinutes;
                fallbackVolume = volume;
                fallbackRemainder = remainder;
              }

              if (tooSmallFirstFill) continue;

              if (
                utilization >= minUtilization && (
                  utilization > bestUtilization + 0.0001 ||
                  (Math.abs(utilization - bestUtilization) <= 0.0001 && (
                    filledMinutes > bestFilledMinutes ||
                    (filledMinutes === bestFilledMinutes && (
                      effPrio < bestPrio ||
                      (effPrio === bestPrio && (
                        volume > bestVolume ||
                        (volume === bestVolume && remainder < bestRemainder)
                      ))
                    ))
                  ))
                )
              ) {
                bestUtilization = utilization;
                bestPrio = effPrio;
                bestFilledMinutes = filledMinutes;
                bestVolume = volume;
                bestRemainder = remainder;
                bestIdx = j;
              }
            } else {
              candidateDebug.push({
                orderId: candidate.id,
                customer: candidate.customer,
                neededMinutes,
                filledMinutes: neededMinutes,
                volume: ev(candidate),
                remainder: gapMinutes - neededMinutes,
                valid: false,
                reason: 'vensterconflict'
              });
            }
          } else {
            candidateDebug.push({
              orderId: candidate.id,
              customer: candidate.customer,
              neededMinutes,
              filledMinutes: neededMinutes,
              volume: ev(candidate),
              remainder: gapMinutes - neededMinutes,
              valid: false,
              reason: 'past niet in gat'
            });
          }
        }

        if (bestIdx < 0 && fallbackIdx >= 0) {
          bestIdx = fallbackIdx;
        }

        debugEntries.push({
          line: lid,
          afterOrderId: current.order.id,
          beforeOrderId: next.order.id,
          gapMinutes,
          chosenOrderId: bestIdx >= 0 ? workingPlan[bestIdx].id : null,
          candidates: candidateDebug.slice(0, 5)
        });

        if (bestIdx >= 0) {
          const nextPlan = [...workingPlan];
          const [picked] = nextPlan.splice(bestIdx, 1);
          nextPlan.splice(i + 1, 0, picked);
          if (planRespectsLoadWindows(lid, nextPlan)) {
            workingPlan = nextPlan;
            changed = true;
          }
        }
      }
    }

    if (debugEntries.length > 0 && setGapDebug) {
      setGapDebug(prev => [...prev.filter(entry => entry.line !== lid), ...debugEntries]);
    }

    return workingPlan;
  }, [getEffectivePriority, getScheduledStartsForLine, getTransitionMinutes, planRespectsLoadWindows, setGapDebug]);

  const fillSimpleSingleGapWithinLine = useCallback(async (lid: LineId, initialPlan: Order[]) => {
    if (typeof Worker === 'undefined') {
      return fillSimpleSingleGapWithinLineLocal(lid, initialPlan);
    }

    const worker = new Worker(new URL('../workers/planningWorker.ts', import.meta.url), { type: 'module' });
    const requestId = `${Date.now()}-${Math.random()}`;
    const orderLoadReferenceTimes = Object.fromEntries(
      initialPlan.map(order => [order.id, getOrderLoadReferenceTime(order)])
    );
    const orderEffectivePriorities = Object.fromEntries(
      initialPlan.map(order => [order.id, getEffectivePriority(order)])
    );

    setIsGapFillPending(true);

    try {
      const result = await new Promise<{ plan: Order[]; debugEntries: GapDebugEntry[] }>((resolve, reject) => {
        const handleMessage = (event: MessageEvent<any>) => {
          const data = event.data;
          if (!data || data.id !== requestId) return;
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          if (data.ok) {
            resolve({
              plan: data.plan || initialPlan,
              debugEntries: data.debugEntries || []
            });
            return;
          }
          reject(new Error(data.error || 'Planning worker failed'));
        };

        const handleError = (event: ErrorEvent) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          reject(event.error || new Error(event.message || 'Planning worker failed'));
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);
        worker.postMessage({
          id: requestId,
          type: 'fillSimpleSingleGapWithinLine',
          payload: {
            lid,
            initialPlan,
            bunkers,
            config,
            lineTiming,
            effectiveFirstOrderStart,
            orderLoadReferenceTimes,
            orderEffectivePriorities
          }
        });
      });

      if (result.debugEntries.length > 0 && setGapDebug) {
        setGapDebug(prev => [...prev.filter(entry => entry.line !== lid), ...result.debugEntries]);
      }

      return result.plan;
    } catch {
      return fillSimpleSingleGapWithinLineLocal(lid, initialPlan);
    } finally {
      worker.terminate();
      setIsGapFillPending(false);
    }
  }, [
    bunkers,
    config,
    effectiveFirstOrderStart,
    fillSimpleSingleGapWithinLineLocal,
    getEffectivePriority,
    getOrderLoadReferenceTime,
    lineTiming,
    setGapDebug
  ]);

  return {
    plannedOrderIdsByLine,
    setPlannedOrderIdsByLine,
    getScheduledStartsForLine,
    getTransitionMinutes,
    fillSimpleSingleGapWithinLine,
    isGapFillPending
  };
}
