import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  LineId, Order, Bunker, Melding, Storing, AppConfig, Truck, PlannerTrigger, OrderComponent 
} from './types';
import { useRef } from 'react';
import { 
  LINES, DEFAULT_CFG, INITIAL_BUNKERS 
} from './constants';
import {
  fmt, ev, rt, sl, normalizeEta, normalizePkg, materialsEquivalent, materialCodesEquivalent, canUseExistingMaterialForRequested, swCount, getSwitchMaterials, etaToMins, hasProlineCleaningTrigger, setRuntimeMaterialOverrides
} from './utils';
import { fetchOrdersFromSheet, fetchBunkersFromSheet, importOrdersFromCsvFile, CalibrationMaterial } from './services/sheetService';
import { acquirePlannerRecalcLockInSupabase, deleteAllOrdersFromSupabase, fetchBunkerMaterialsFromSupabase, fetchBunkerStateFromSupabase, fetchDriversFromSupabase, fetchIssuesFromSupabase, fetchOrdersFromSupabase, fetchPlannedOrderIdsFromSupabase, fetchPlannerRecalcLockFromSupabase, fetchPlannerTriggersFromSupabase, isSupabaseConfigured, releasePlannerRecalcLockInSupabase, resolveIssueInSupabase, setDriverActiveInSupabase, upsertDriverInSupabase, writeBunkerMaterialsToSupabase, writeBunkersToSupabase, writeDriverListToSupabase, writeIssueToSupabase, writeOrdersToSupabase, writePlannedOrderIdsToSupabase, writeSingleBunkerToSupabase, type PlannerRecalcLockState, type SharedBunkerMaterialRow, type SharedDriver } from './services/supabaseService';
import { supabase } from './services/supabaseClient';
import { 
  LayoutDashboard, ClipboardList, Database, Settings, Bell, 
  Truck as TruckIcon, CheckCircle2, Play, X, ChevronUp, ChevronDown,
  Wrench, AlertTriangle, Check, Clock, Pencil, RefreshCw, Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type LineTimingSettings = {
  dayStart: string;
  firstOrderStart: string;
};

type ScheduledLineEntry = {
  order: Order;
  startTime: Date;
  prodStart: Date;
  endTime: Date;
  swMats: string[];
  sw: number;
  duration: number;
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

const isBunkerExactMatchForComponent = (bunker: Bunker | null | undefined, component: OrderComponent) => {
  if (!bunker) return false;
  return !!(
    (bunker.m && (bunker.m === component.name || materialsEquivalent(bunker.m, component.name))) ||
    (bunker.mc && materialCodesEquivalent(bunker.mc, component.code))
  );
};

type GapDebugEntry = {
  line: LineId;
  afterOrderId: number;
  beforeOrderId: number;
  gapMinutes: number;
  chosenOrderId: number | null;
  candidates: GapDebugCandidate[];
};

type DriverFormState = {
  name: string;
  company: string;
  truckPlate: string;
  trailerPlate: string;
  vehicleHeightM: string;
  steeringAxles: string;
  maxWeightKg: string;
  notes: string;
};

const FIXED_FIRST_ORDER_START = '05:15';
const EMPTY_DRIVER_FORM: DriverFormState = {
  name: '',
  company: '',
  truckPlate: '',
  trailerPlate: '',
  vehicleHeightM: '',
  steeringAxles: '',
  maxWeightKg: '',
  notes: ''
};

const DEFAULT_PLANNER_TRIGGERS: PlannerTrigger[] = [
  { key: 'priority_1_bale', label: 'Prioriteit verpakking BAL', description: '`BAL` krijgt standaard prio 1.', active: true, fieldName: 'pkg', matchValue: 'bale', actionName: 'priority_1', targetLine: 'all' },
  { key: 'priority_1_bag', label: 'Prioriteit verpakking BAG', description: '`BAG` krijgt standaard prio 1.', active: true, fieldName: 'pkg', matchValue: 'bag', actionName: 'priority_1', targetLine: 'all' },
  { key: 'bulk_requires_load_time', label: 'Laadtijd bulk', description: '`BULK` zonder laadtijd wordt niet direct gepland. Met `gearriveerd + laadtijd` kan bulk naar prio 1 gaan.', active: true, fieldName: 'pkg', matchValue: 'bulk', actionName: 'bulk_requires_load_time', targetLine: 'all' },
  { key: 'first_order_start_0515', label: 'Dagstart lijn', description: 'Voorbereiding loopt standaard van `05:00` tot `05:15`. De eerste order start vanaf `05:15`.', active: true, fieldName: 'planner', matchValue: 'first_order', actionName: 'first_order_start_0515', targetLine: 'all' },
  { key: 'material_override_0006141_over_0006142', label: 'Materiaalregel', description: '`Kokosgruis Gebufferd (0006141)` mag over `Kokosgruis gewassen (0006142)` zonder extra blokkade.', active: true, fieldName: 'material_override', matchValue: '0006141>0006142', actionName: 'allow_over_existing', targetLine: 'all' }
];

function getOrderRefLabel(order: Pick<Order, 'num' | 'productionOrder'>): string {
  return order.productionOrder
    ? `PO ${order.productionOrder} - Order ${order.num}`
    : `Order ${order.num}`;
}

function getPkgLabel(order: Pick<Order, 'pkg'>): string {
  const pkg = normalizePkg(order.pkg);
  return pkg === 'bulk' ? 'BULK / M3' : pkg === 'bag' ? 'BAG' : pkg === 'bale' ? 'BAL' : 'PKG';
}

function getPkgBadgeClass(order: Pick<Order, 'pkg'>): string {
  const pkg = normalizePkg(order.pkg);
  if (pkg === 'bulk') return 'bg-blue-50 text-blue-600';
  if (pkg === 'bag') return 'bg-purple-100 text-purple-800';
  if (pkg === 'bale') return 'bg-orange-50 text-orange-600';
  return 'bg-gray-100 text-gray-600';
}

function getOrderVolumeFactor(order: Pick<Order, 'vol' | 'pkg'>): number {
  return order.vol > 0 ? (ev(order as Order) / order.vol) : 1;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value?: string | null): Date | null {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function getRunningOrderStart(order: Pick<Order, 'status' | 'startedAt'>): Date | null {
  if (order.status !== 'running' || !order.startedAt) return null;
  const parsed = new Date(order.startedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOrderLoadReferenceDateTime(
  order: Pick<Order, 'status' | 'arrivedTime' | 'eta'>,
  baseDate: Date
): Date | null {
  const loadTime = normalizeEta(order.status === 'arrived' ? (order.arrivedTime || order.eta) : order.eta);
  const loadMinutes = etaToMins(loadTime);
  if (loadMinutes === null) return null;
  const result = new Date(baseDate);
  const clockMinutes = loadMinutes + (5 * 60);
  result.setHours(Math.floor(clockMinutes / 60), clockMinutes % 60, 0, 0);
  return result;
}

function getHeldLoadDateTime(
  order: Pick<Order, 'status' | 'holdLoadTime' | 'arrivedTime' | 'eta'>,
  baseDate: Date
): Date | null {
  if (order.status !== 'arrived' || !order.holdLoadTime) return null;
  return getOrderLoadReferenceDateTime(order, baseDate);
}

function formatPlannerDateHeading(date: Date): string {
  return date.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit'
  });
}

function formatPlannerDateChip(date: Date): string {
  return date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  });
}

function formatPlannerDateLong(date: Date): string {
  return date.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function minutesToTimeString(totalMinutes: number): string {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatOperatorDateTimeRange(start: Date, end: Date, currentTime: Date): string {
  const startDate = formatLocalDate(start);
  const endDate = formatLocalDate(end);
  const today = formatLocalDate(currentTime);

  if (startDate === today && endDate === today) {
    return `${fmt(start)} - ${fmt(end)}`;
  }

  if (startDate === endDate) {
    return `${formatPlannerDateChip(start)} ${fmt(start)} - ${fmt(end)}`;
  }

  return `${formatPlannerDateChip(start)} ${fmt(start)} - ${formatPlannerDateChip(end)} ${fmt(end)}`;
}

function getPlanningDateRange(anchor: Date, visibleDates: Date[] = []): Date[] {
  const base = new Date(anchor);
  base.setHours(0, 0, 0, 0);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);

  const defaultEnd = new Date(monday);
  defaultEnd.setDate(monday.getDate() + 13);

  const latestVisibleDate = visibleDates.reduce<Date | null>((latest, date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return !latest || normalized > latest ? normalized : latest;
  }, null);

  const endDate = new Date(defaultEnd);
  if (latestVisibleDate && latestVisibleDate > endDate) {
    const latestDay = latestVisibleDate.getDay();
    const diffToSunday = latestDay === 0 ? 0 : 7 - latestDay;
    endDate.setTime(latestVisibleDate.getTime());
    endDate.setDate(latestVisibleDate.getDate() + diffToSunday);
  }

  const dayCount = Math.max(1, Math.round((endDate.getTime() - monday.getTime()) / 86400000) + 1);
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    date.setHours(0, 0, 0, 0);
    return date;
  });
}

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
        const calibrationValue = row.calibration_value === null || row.calibration_value === undefined
          ? null
          : parseNumber(row.calibration_value);

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

export default function App() {
  const [view, setView] = useState<'operator' | 'planner' | 'bunkers' | 'settings' | 'notifications'>('operator');
  const [plannerTab, setPlannerTab] = useState<'schema' | 'dagrooster' | 'wachtrij' | 'chauffeurs' | 'vrachtwagens' | 'voltooid'>('schema');
  const [selectedLine, setSelectedLine] = useState<LineId>(() => {
    const saved = localStorage.getItem('kd_selected_line');
    return saved ? (parseInt(saved, 10) as LineId) : 1;
  });
  const [selectedOrderForDetail, setSelectedOrderForDetail] = useState<Order | null>(null);
  const [plannerLineFilter, setPlannerLineFilter] = useState<number>(0); // 0 = Alle lijnen
  const [plannerSearch, setPlannerSearch] = useState('');
  const [plannerSort, setPlannerSort] = useState('default');
  const [plannerSelectedDate, setPlannerSelectedDate] = useState<string>(() => formatLocalDate(new Date()));
  const [chauffeurTypeFilter, setChauffeurTypeFilter] = useState<'all' | 'bulk' | 'packed'>('all');
  const [chauffeurActionFilter, setChauffeurActionFilter] = useState<'all' | 'unassigned' | 'conflicts'>('all');
  const [chauffeurSearch, setChauffeurSearch] = useState('');
  const [plannedOrderIdsByLine, setPlannedOrderIdsByLine] = useState<Record<LineId, number[]> | null>(() => {
    const saved = localStorage.getItem('kd_planned_order_ids_by_line');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [plannerRecalcLock, setPlannerRecalcLock] = useState<PlannerRecalcLockState | null>(null);
  const [gapDebug, setGapDebug] = useState<GapDebugEntry[]>([]);
  const [selectedDriverName, setSelectedDriverName] = useState<string>('');
  const [draggedDriverName, setDraggedDriverName] = useState<string>('');
  const [draggedDayRosterOrderId, setDraggedDayRosterOrderId] = useState<number | null>(null);
  const [sharedDriverNames, setSharedDriverNames] = useState<string[]>([]);
  const [sharedDrivers, setSharedDrivers] = useState<SharedDriver[]>([]);
  const [plannerTriggers, setPlannerTriggers] = useState<PlannerTrigger[]>([]);
  const [newDriverName, setNewDriverName] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [newDriverForm, setNewDriverForm] = useState<DriverFormState>(EMPTY_DRIVER_FORM);
  const [driverSyncDebug, setDriverSyncDebug] = useState('');
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [draggedOperatorOrderId, setDraggedOperatorOrderId] = useState<number | null>(null);
  const [operatorDropTargetId, setOperatorDropTargetId] = useState<number | null>(null);
  const [isClearingOrders, setIsClearingOrders] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [csvImportFeedback, setCsvImportFeedback] = useState<{ type: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const [csvImportDate, setCsvImportDate] = useState(() => formatLocalDate(new Date()));
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('kd_orders');
    return saved ? JSON.parse(saved) : [];
  });
  const [dataSource, setDataSource] = useState(() => {
    const saved = localStorage.getItem('kd_datasource');
    const defaultData = {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1Byj_fUun6JMpbiv8WJKi1jnWIuQlRpsbMEpugxc2zC8/edit?gid=0#gid=0',
      calibrationUrls: {
        1: 'https://docs.google.com/spreadsheets/d/17aCk5YCMQDb93r6oseFlGG04V-IRTbEEdAByGRFF0Zc/edit?gid=0',
        2: 'https://docs.google.com/spreadsheets/d/17aCk5YCMQDb93r6oseFlGG04V-IRTbEEdAByGRFF0Zc/edit?gid=829830734',
        3: 'https://docs.google.com/spreadsheets/d/17aCk5YCMQDb93r6oseFlGG04V-IRTbEEdAByGRFF0Zc/edit?gid=1856803997'
      },
      lastSync: null as string | null,
      loading: false,
      error: null as string | null
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migratie: als er nog een oude calibrationUrl is, of als de URLs de generieke link zijn, herstel naar defaults
        const genericUrl = 'https://docs.google.com/spreadsheets/d/1Byj_fUun6JMpbiv8WJKi1jnWIuQlRpsbMEpugxc2zC8/edit?gid=0#gid=0';
        
        if (parsed.calibrationUrl || !parsed.calibrationUrls || 
            Object.values(parsed.calibrationUrls).some(url => url === genericUrl)) {
          parsed.calibrationUrls = { ...defaultData.calibrationUrls };
          delete parsed.calibrationUrl;
        }
        
        return { ...defaultData, ...parsed, loading: false };
      } catch (e) {
        return defaultData;
      }
    }
    return defaultData;
  });
  const plannerLockOwnerRef = useRef(`planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    localStorage.setItem('kd_datasource', JSON.stringify(dataSource));
  }, [dataSource]);

  useEffect(() => {
    localStorage.setItem('kd_orders', JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem('kd_selected_line', selectedLine.toString());
  }, [selectedLine]);

  useEffect(() => {
    if (plannedOrderIdsByLine) {
      localStorage.setItem('kd_planned_order_ids_by_line', JSON.stringify(plannedOrderIdsByLine));
    }
  }, [plannedOrderIdsByLine]);


  const laadOrders = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    setDataSource(prev => ({ ...prev, loading: true, error: null }));
      try {
        let importedOrders: Order[] = [];
        let sourceLabel = 'Google Sheets';
        if (isSupabaseConfigured()) {
          const sheetOrders = await fetchOrdersFromSheet(dataSource.sheetUrl);
          if (sheetOrders.length > 0) {
            await writeOrdersToSupabase(sheetOrders, { preserveExistingSchedule: true });
          }
          importedOrders = await fetchOrdersFromSupabase();
          sourceLabel = 'Supabase';
          if (sheetOrders.length > 0 && importedOrders.length === 0) {
            throw new Error('Sync naar Supabase gaf geen orders terug.');
          }
        } else {
          importedOrders = await fetchOrdersFromSheet(dataSource.sheetUrl);
          sourceLabel = 'Google Sheets';
        }
      
      setOrders(prev => {
        const orderKey = (o: Order) => {
          const productionOrder = String(o.productionOrder || '').trim();
          return productionOrder ? `po:${productionOrder}` : `${o.num}|${o.rit}|${o.recipe}|${o.line}`;
        };
        const importedByKey = new Map(importedOrders.map(o => [orderKey(o), o]));

        // Behoud alleen orders die lokaal al draaien of voltooid zijn als ze niet meer in de sheet staan.
        const completed = prev.filter(o => o.status === 'completed');
        const active = prev.filter(o => o.status === 'running');
        const preserved = [...completed, ...active].filter(o => !importedByKey.has(orderKey(o)));
        const prevByKey = new Map(prev.map(o => [orderKey(o), o]));

        const mergedImported = importedOrders.map(imported => {
          const existing = prevByKey.get(orderKey(imported));
          if (!existing) return imported;

          const sheetSaysArrived = imported.status === 'arrived' || imported.arrived === true;
          const keepLocalRunning = existing.status === 'running';
          const keepLocalArrived = existing.status === 'arrived' && !sheetSaysArrived;
          const keepLocalEta = (keepLocalRunning || keepLocalArrived) && !!normalizeEta(existing.eta);

        return {
          ...imported,
          status: keepLocalRunning ? 'running' : keepLocalArrived ? 'arrived' : imported.status,
          arrived: keepLocalRunning ? existing.arrived : keepLocalArrived ? true : imported.arrived,
          arrivedTime: keepLocalRunning ? (existing.arrivedTime || imported.arrivedTime) : keepLocalArrived ? (existing.arrivedTime || imported.arrivedTime) : imported.arrivedTime,
          startedAt: keepLocalRunning ? (existing.startedAt || imported.startedAt) : imported.startedAt,
          holdLoadTime: keepLocalRunning || keepLocalArrived ? !!existing.holdLoadTime : !!imported.holdLoadTime,
          eta: keepLocalEta ? existing.eta : imported.eta,
          driver: existing.driver || imported.driver,
          note: existing.note || imported.note,
            _autoMovedReason: existing._autoMovedReason,
            _autoMovedFromLine: existing._autoMovedFromLine,
            _autoMovedToLine: existing._autoMovedToLine
          };
        });

        return [...preserved, ...mergedImported];
      });

      setDataSource(prev => ({ ...prev, loading: false, lastSync: new Date().toISOString() }));

      if (!silent) {
        const newMelding: Melding = {
          id: Date.now(),
          type: importedOrders.length > 0 ? 'ok' : 'waarschuwing',
          icon: importedOrders.length > 0 ? 'OK' : 'WARN',
          titel: importedOrders.length > 0 ? 'Orders gesynchroniseerd' : 'Geen orders gevonden',
          tekst: importedOrders.length > 0 
            ? `${importedOrders.length} orders geladen uit ${sourceLabel}`
            : 'Geen geldige orders gevonden in de sheet. Controleer de kolomkoppen en tabblad-namen.',
          lijn: null,
          orderNum: null,
          tijd: new Date(),
          gelezen: false
        };
        setNotifications(prev => [newMelding, ...prev]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Sync mislukt';
      setDataSource(prev => ({ ...prev, loading: false, error: errorMsg }));
      if (!silent) {
        setNotifications(prev => [{
          id: Date.now(),
          type: 'fout',
          icon: 'ERR',
          titel: 'Sync mislukt',
          tekst: errorMsg,
          lijn: null,
          orderNum: null,
          tijd: new Date(),
          gelezen: false
        }, ...prev]);
      }
    }
  };

  const mergeImportedOrdersIntoState = (importedOrders: Order[]) => {
    setOrders(prev => {
      const orderKey = (o: Order) => {
        const productionOrder = String(o.productionOrder || '').trim();
        return productionOrder ? `po:${productionOrder}` : `${o.num}|${o.rit}|${o.recipe}|${o.line}`;
      };
      const importedByKey = new Map(importedOrders.map(o => [orderKey(o), o]));
      const completed = prev.filter(o => o.status === 'completed');
      const active = prev.filter(o => o.status === 'running');
      const preserved = [...completed, ...active].filter(o => !importedByKey.has(orderKey(o)));
      const prevByKey = new Map(prev.map(o => [orderKey(o), o]));

      const mergedImported = importedOrders.map(imported => {
        const existing = prevByKey.get(orderKey(imported));
        if (!existing) return imported;

        const keepLocalRunning = existing.status === 'running';
        const keepLocalArrived = existing.status === 'arrived';

        return {
          ...imported,
          status: keepLocalRunning ? 'running' : keepLocalArrived ? 'arrived' : imported.status,
          arrived: keepLocalRunning ? existing.arrived : keepLocalArrived ? true : imported.arrived,
          arrivedTime: keepLocalRunning ? (existing.arrivedTime || imported.arrivedTime) : keepLocalArrived ? (existing.arrivedTime || imported.arrivedTime) : imported.arrivedTime,
          startedAt: keepLocalRunning ? (existing.startedAt || imported.startedAt) : imported.startedAt,
          holdLoadTime: keepLocalRunning || keepLocalArrived ? !!existing.holdLoadTime : !!imported.holdLoadTime,
          eta: existing.eta || imported.eta,
          driver: existing.driver || imported.driver,
          note: existing.note || imported.note,
          _autoMovedReason: existing._autoMovedReason,
          _autoMovedFromLine: existing._autoMovedFromLine,
          _autoMovedToLine: existing._autoMovedToLine
        };
      });

      return [...preserved, ...mergedImported];
    });
  };

  const handleLocalCsvImport = async (file: File | null) => {
    if (!file) return;
    setIsImportingCsv(true);
    setCsvImportFeedback({ type: 'busy', text: `Bezig met importeren van ${file.name} voor ${csvImportDate}...` });
    setDataSource(prev => ({ ...prev, loading: true, error: null }));
    try {
      const importedOrders = await importOrdersFromCsvFile(file, csvImportDate);
      if (isSupabaseConfigured() && importedOrders.length > 0) {
        await writeOrdersToSupabase(importedOrders, { preserveExistingSchedule: true });
      }
      const finalOrders = isSupabaseConfigured() ? await fetchOrdersFromSupabase() : importedOrders;
      mergeImportedOrdersIntoState(finalOrders);
      setDataSource(prev => ({ ...prev, loading: false, lastSync: new Date().toISOString() }));
      setNotifications(prev => [{
        id: Date.now(),
        type: 'ok',
        icon: 'OK',
        titel: 'CSV geïmporteerd',
        tekst: `${finalOrders.length} orders geladen uit ${file.name}`,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      setCsvImportFeedback({ type: 'ok', text: `${finalOrders.length} orders succesvol geladen uit ${file.name}` });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'CSV import mislukt';
      setDataSource(prev => ({ ...prev, loading: false, error: errorMsg }));
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'CSV import mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      setCsvImportFeedback({ type: 'error', text: errorMsg });
    } finally {
      setIsImportingCsv(false);
    }
  };

  const laadKalibratie = async () => {
      setDataSource(prev => ({ ...prev, loading: true, error: null }));
      try {
        const urls = dataSource.calibrationUrls;
        const results = await Promise.all([
        fetchBunkersFromSheet(urls[1], 1),
        fetchBunkersFromSheet(urls[2], 2),
        fetchBunkersFromSheet(urls[3], 3)
      ]);
      
      const importedBunkers: Record<LineId, Bunker[]> = {
        1: results[0].bunkers[1],
        2: results[1].bunkers[2],
        3: results[2].bunkers[3]
      };
      
      // Merge materials and deduplicate by name
      const allMaterials = results.flatMap(r => r.materials);
      const materialsMap = new Map<string, CalibrationMaterial>();
      allMaterials.forEach(m => {
        const existing = materialsMap.get(m.name);
        if (!existing || (m.calibrationValue !== null && existing.calibrationValue === null)) {
          materialsMap.set(m.name, m);
        }
        });
        const importedMaterials = Array.from(materialsMap.values());
        
        const hasBunkers = Object.values(importedBunkers).some(arr => arr.length > 0);
        const hasMaterials = importedMaterials.length > 0;
        const sharedBunkerRows = isSupabaseConfigured() ? await fetchBunkerStateFromSupabase() : [];
        const sharedBunkerByKey = new Map(
          sharedBunkerRows.map(row => [
            `${Number(row.line_id || 0)}|${String(row.bunker_code || '')}`,
            row
          ])
        );

        // Merge with base bunker definitions so allowed/calibrated alternatives do not disappear
        // when the sheet only contains the current filling per bunker.
        const nextBunkers = { ...bunkers };
        (Object.keys(importedBunkers) as unknown as LineId[]).forEach(lid => {
          if (importedBunkers[lid] && importedBunkers[lid].length > 0) {
            const previousByCode = new Map((bunkers[lid] || []).map(b => [b.c, b]));
            const baseByCode = new Map((INITIAL_BUNKERS[lid] || []).map(b => [b.c, b]));
            nextBunkers[lid] = importedBunkers[lid].map(imported => {
              const previous = previousByCode.get(imported.c);
              const base = baseByCode.get(imported.c);
              const sharedState = sharedBunkerByKey.get(`${lid}|${imported.c}`);
              const mergedMaterials = Array.from(new Set([
                ...(base?.ms || []),
                ...(previous?.ms || []),
                ...(imported.ms || [])
              ]));
              return {
                ...base,
                ...previous,
                ...imported,
                m: sharedState?.current_material ?? sharedState?.material_name ?? imported.m ?? previous?.m ?? base?.m ?? null,
                mc: sharedState?.current_material_code ?? sharedState?.material_code ?? imported.mc ?? previous?.mc ?? base?.mc ?? null,
                fx: sharedState?.fixed ?? sharedState?.is_fixed ?? imported.fx ?? previous?.fx ?? base?.fx ?? false,
                mustEmpty: sharedState?.must_empty ?? imported.mustEmpty ?? previous?.mustEmpty ?? base?.mustEmpty,
                leegNaOrder: sharedState?.empty_after_order ?? imported.leegNaOrder ?? previous?.leegNaOrder ?? base?.leegNaOrder ?? null,
                ms: mergedMaterials,
                materialData: {
                  ...(base?.materialData || {}),
                  ...(previous?.materialData || {}),
                  ...(imported.materialData || {})
                }
              };
            });
          }
        });
        let finalCalibrationRows: SharedBunkerMaterialRow[] = [];

        if (isSupabaseConfigured() && hasBunkers) {
          await writeBunkersToSupabase(nextBunkers);
          await writeBunkerMaterialsToSupabase(nextBunkers);
          finalCalibrationRows = await fetchBunkerMaterialsFromSupabase();
        }

        const mergedCalibration = mergeSharedCalibrationIntoBunkers(nextBunkers, finalCalibrationRows);
        setBunkers(mergedCalibration.bunkers);
        setCalibrationMaterials(
          mergedCalibration.materials.length > 0
            ? mergedCalibration.materials
            : importedMaterials
        );

      setDataSource(prev => ({ ...prev, loading: false, lastSync: new Date().toISOString() }));
      
      let titel = 'Kalibratie gesynchroniseerd';
      let tekst = `Bunkergegevens geladen (${importedMaterials.length} grondstoffen gevonden)`;
      let type: 'ok' | 'info' | 'fout' = 'ok';
      let icon = 'INFO';

      const totalBunkers = Object.values(importedBunkers).reduce((acc, curr) => acc + curr.length, 0);

      if (totalBunkers === 0 && importedMaterials.length > 0) {
        titel = 'Grondstoffen geladen';
        tekst = `${importedMaterials.length} grondstoffen gevonden, maar geen bunker-indeling.`;
        type = 'info';
        icon = 'INFO';
      } else if (totalBunkers === 0 && importedMaterials.length === 0) {
        titel = 'Geen data gevonden';
        tekst = 'Geen bunkers of grondstoffen gevonden in de sheets. Controleer de tabblad-namen en kolomkoppen.';
        type = 'info';
        icon = 'INFO';
      } else {
        tekst = `${totalBunkers} bunkers bijgewerkt over ${Object.keys(importedBunkers).filter(k => importedBunkers[k as unknown as LineId].length > 0).length} lijnen.`;
      }

      const newMelding: Melding = {
        id: Date.now(),
        type,
        icon,
        titel,
        tekst,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      };
      setNotifications(prev => [newMelding, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Kalibratie sync mislukt';
      setDataSource(prev => ({ ...prev, loading: false, error: errorMsg }));
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Kalibratie sync mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    }
  };

  const clearAllOrders = async () => {
    if (isClearingOrders) return;
    setIsClearingOrders(true);
    setDataSource(prev => ({ ...prev, error: null }));
    try {
      await deleteAllOrdersFromSupabase();
      localStorage.removeItem('kd_orders');
      localStorage.removeItem('kd_planned_order_ids_by_line');
      setOrders([]);
      setPlannedOrderIdsByLine(null);
      setNotifications(prev => [{
        id: Date.now(),
        type: 'ok',
        icon: 'OK',
        titel: 'Orders leeggemaakt',
        tekst: 'Supabase en lokale ordercache zijn opgeschoond.',
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Orders leegmaken mislukt';
      setDataSource(prev => ({ ...prev, error: errorMsg }));
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Orders leegmaken mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } finally {
      setIsClearingOrders(false);
    }
  };

  const refreshBunkersFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    if (bunkerRefreshInFlight.current) return;
    bunkerRefreshInFlight.current = true;
    try {
      const sharedRows = await fetchBunkerStateFromSupabase();
      const sharedCalibrationRows = await fetchBunkerMaterialsFromSupabase();
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
        return mergeSharedCalibrationIntoBunkers(next, sharedCalibrationRows).bunkers;
      });
      const mergedMaterials = mergeSharedCalibrationIntoBunkers(INITIAL_BUNKERS, sharedCalibrationRows).materials;
      if (mergedMaterials.length > 0) {
        setCalibrationMaterials(mergedMaterials);
      }
    } catch {
      // keep current local state if supabase refresh fails
    } finally {
      bunkerRefreshInFlight.current = false;
    }
  }, []);

  const refreshDriversFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const drivers = await fetchDriversFromSupabase();
      const activeNames = drivers.filter(driver => driver.active).map(driver => driver.name);
      setSharedDrivers(drivers);
      setSharedDriverNames(activeNames);
      setDriverSyncDebug(`Supabase chauffeurs: ${activeNames.length} actief, ${drivers.length - activeNames.length} afwezig`);
    } catch {
      setDriverSyncDebug('Supabase chauffeurs refresh mislukt');
      // keep current local state if supabase driver refresh fails
    }
  }, []);

  const refreshPlannedOrderIdsFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const plan = await fetchPlannedOrderIdsFromSupabase();
      if (plan) {
        setPlannedOrderIdsByLine(plan);
      }
    } catch {
      // keep current local state if supabase planner sequence refresh fails
    }
  }, []);

  const refreshPlannerRecalcLockFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const lock = await fetchPlannerRecalcLockFromSupabase();
      setPlannerRecalcLock(lock);
    } catch {
      // keep current local lock state if supabase refresh fails
    }
  }, []);

  const refreshPlannerTriggersFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const triggers = await fetchPlannerTriggersFromSupabase();
      setPlannerTriggers(triggers);
    } catch {
      // keep default trigger view if supabase refresh fails
    }
  }, []);

  const activePlannerTriggerRows = useMemo(
    () => (plannerTriggers.length > 0 ? plannerTriggers : DEFAULT_PLANNER_TRIGGERS).filter(trigger => trigger.active !== false),
    [plannerTriggers]
  );

  const priorityOnePackages = useMemo(() => {
    return new Set(
      activePlannerTriggerRows
        .filter(trigger => trigger.fieldName === 'pkg' && trigger.actionName === 'priority_1')
        .map(trigger => normalizePkg(trigger.matchValue || ''))
        .filter(Boolean)
    );
  }, [activePlannerTriggerRows]);

  const bulkRequiresLoadTime = useMemo(
    () =>
      activePlannerTriggerRows.some(
        trigger => trigger.fieldName === 'pkg' && trigger.actionName === 'bulk_requires_load_time' && normalizePkg(trigger.matchValue || '') === 'bulk'
      ),
    [activePlannerTriggerRows]
  );

  const effectiveFirstOrderStart = useMemo(
    () =>
      activePlannerTriggerRows.some(
        trigger => trigger.fieldName === 'planner' && trigger.actionName === 'first_order_start_0515' && (trigger.matchValue || '') === 'first_order'
      )
        ? '05:15'
        : FIXED_FIRST_ORDER_START,
    [activePlannerTriggerRows]
  );

  const materialOverridePairs = useMemo(
    () =>
      activePlannerTriggerRows
        .filter(trigger => trigger.fieldName === 'material_override' && trigger.actionName === 'allow_over_existing')
        .map(trigger => String(trigger.matchValue || '').trim())
        .filter(value => value.includes('>'))
        .map(value => {
          const [requestedCode, existingCode] = value.split('>');
          return {
            requestedCode: requestedCode.trim(),
            existingCode: existingCode.trim()
          };
        })
        .filter(pair => !!pair.requestedCode && !!pair.existingCode),
    [activePlannerTriggerRows]
  );

  useEffect(() => {
    setRuntimeMaterialOverrides(materialOverridePairs);
  }, [materialOverridePairs]);

  const getOrderLoadReferenceTime = useCallback(
    (order: Order) => normalizeEta(order.status === 'arrived' ? (order.arrivedTime || order.eta) : order.eta),
    []
  );

  // Initial Sync
  useEffect(() => {
    laadOrders();
    laadKalibratie();
    refreshPlannerTriggersFromSupabase();
  }, [refreshPlannerTriggersFromSupabase]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden || dataSource.loading) return;
      laadOrders({ silent: true });
    }, 900000);

    return () => window.clearInterval(interval);
  }, [dataSource.loading, dataSource.sheetUrl]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const channel = supabase
      .channel('kd-bunker-state-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_bunker_state' },
        refreshBunkersFromSupabase
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_bunker_materials' },
        refreshBunkersFromSupabase
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_triggers' },
        refreshPlannerTriggersFromSupabase
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshBunkersFromSupabase, refreshPlannerTriggersFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    refreshDriversFromSupabase();

    const channel = supabase
      .channel('kd-drivers-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_drivers' },
        refreshDriversFromSupabase
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshDriversFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    refreshPlannedOrderIdsFromSupabase();
    refreshPlannerRecalcLockFromSupabase();

    const channel = supabase
      .channel('kd-planner-sequence-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_app_state' },
        () => {
          void refreshPlannedOrderIdsFromSupabase();
          void refreshPlannerRecalcLockFromSupabase();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshPlannedOrderIdsFromSupabase, refreshPlannerRecalcLockFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const interval = window.setInterval(() => {
      if (document.hidden) return;
      refreshBunkersFromSupabase();
    }, 900000);

    const handleVisibilityOrFocus = () => {
      refreshBunkersFromSupabase();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [refreshBunkersFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const refreshOrdersFromSupabase = async () => {
      try {
        const sharedOrders = await fetchOrdersFromSupabase();
        if (sharedOrders.length > 0) {
          setOrders(prev => {
            const orderKey = (o: Order) => {
              const productionOrder = String(o.productionOrder || '').trim();
              return productionOrder ? `po:${productionOrder}` : `${o.num}|${o.rit}|${o.recipe}|${o.line}`;
            };
            const prevByKey = new Map(prev.map(o => [orderKey(o), o]));
            return sharedOrders.map(order => {
              const existing = prevByKey.get(orderKey(order));
              if (!existing) return order;
              const keepLocalRunning = existing.status === 'running' && !order.startedAt;
              const keepLocalArrived = existing.status === 'arrived' && !order.arrivedTime;
              return {
                ...order,
                status: keepLocalRunning ? existing.status : order.status,
                arrived: keepLocalRunning ? existing.arrived : keepLocalArrived ? existing.arrived : order.arrived,
                arrivedTime: keepLocalRunning ? (existing.arrivedTime || order.arrivedTime) : keepLocalArrived ? (existing.arrivedTime || order.arrivedTime) : order.arrivedTime,
                startedAt: keepLocalRunning ? (existing.startedAt || order.startedAt) : order.startedAt,
                holdLoadTime: keepLocalRunning || keepLocalArrived ? !!existing.holdLoadTime : !!order.holdLoadTime,
                eta: keepLocalRunning ? (existing.eta || order.eta) : order.eta
              };
            });
          });
        }
      } catch {
        // keep current local state if realtime refresh fails
      }
    };

    void refreshOrdersFromSupabase();

    const channel = supabase
      .channel('kd-orders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_orders' },
        refreshOrdersFromSupabase
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const channel = supabase
      .channel('kd-events-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_events' },
        refreshIssuesFromSupabase
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshIssuesFromSupabase]);
  const [arrivedOrder, setArrivedOrder] = useState<Order | null>(null);
  const [arrivedTime, setArrivedTime] = useState('');
  const [arrivedHoldLoadTime, setArrivedHoldLoadTime] = useState(false);
  const [etaEditOrder, setEtaEditOrder] = useState<Order | null>(null);
  const [etaEditTime, setEtaEditTime] = useState('');
  const [selectedBunker, setSelectedBunker] = useState<{ lid: LineId, bunker: Bunker } | null>(null);
  const [calibrationMaterials, setCalibrationMaterials] = useState<CalibrationMaterial[]>([]);
  const [showAllMaterials, setShowAllMaterials] = useState(false);
  const [newCalibrationName, setNewCalibrationName] = useState('');
  const [newCalibrationCode, setNewCalibrationCode] = useState('');
  const [newCalibrationValue, setNewCalibrationValue] = useState('');
  const [isSavingCalibration, setIsSavingCalibration] = useState(false);
  const bunkerRefreshInFlight = useRef(false);
  const issueRefreshInFlight = useRef(false);
  const repairedRunningOrdersRef = useRef('');

  const handleBunkerUpdate = async (lid: LineId, bunkerCode: string, newMaterial: string | null) => {
    const lineBunkers = [...(bunkers[lid] || [])];
    const idx = lineBunkers.findIndex(b => b.c === bunkerCode);
    if (idx === -1) return;

    const bunker = lineBunkers[idx];
    const calMat = calibrationMaterials.find(m => m.name === newMaterial);
    const specificData = newMaterial ? bunker.materialData?.[newMaterial] : null;

    lineBunkers[idx] = {
      ...bunker,
      m: newMaterial,
      mc: specificData?.code || calMat?.code || orders.flatMap(o => o.components).find(c => c.name === newMaterial)?.code || null,
      calibrationValue: specificData?.calibrationValue ?? calMat?.calibrationValue ?? bunker.calibrationValue
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
        return;
      }
    }

    setSelectedBunker(null);
    setShowAllMaterials(false);
  };

  const handleAddCalibrationToBunker = async () => {
    if (!selectedBunker) return;

    const materialName = newCalibrationName.trim();
    const materialCode = newCalibrationCode.trim();
    const calibrationValue = newCalibrationValue.trim() === '' ? null : parseNumber(newCalibrationValue);

    if (!materialName) {
      setNotifications(prev => [{
        id: Date.now(),
        type: 'waarschuwing',
        icon: 'WARN',
        titel: 'Kalibratie toevoegen mislukt',
        tekst: 'Vul minimaal een materiaalnaam in.',
        lijn: selectedBunker.lid,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      return;
    }

    setIsSavingCalibration(true);
    const { lid, bunker } = selectedBunker;

    const nextBunkers: Record<LineId, Bunker[]> = {
      ...bunkers,
      [lid]: (bunkers[lid] || []).map(item => {
        if (item.c !== bunker.c) return item;
        const nextMaterialData = {
          ...(item.materialData || {}),
          [materialName]: {
            code: materialCode || null,
            calibrationValue
          }
        };
        const nextMs = Array.from(new Set([...(item.ms || []), materialName]));
        return {
          ...item,
          ms: nextMs,
          materialData: nextMaterialData
        };
      })
    };

    const nextCalibrationMaterials = (() => {
      const merged = new Map<string, CalibrationMaterial>();
      calibrationMaterials.forEach(item => merged.set(item.name, item));
      merged.set(materialName, {
        name: materialName,
        code: materialCode || null,
        calibrationValue
      });
      return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'nl-NL'));
    })();

    setBunkers(nextBunkers);
    setCalibrationMaterials(nextCalibrationMaterials);
    setSelectedBunker({
      lid,
      bunker: nextBunkers[lid].find(item => item.c === bunker.c) || bunker
    });

    try {
      if (isSupabaseConfigured()) {
        await writeBunkerMaterialsToSupabase(nextBunkers);
      }
      setNewCalibrationName('');
      setNewCalibrationCode('');
      setNewCalibrationValue('');
      setNotifications(prev => [{
        id: Date.now(),
        type: 'ok',
        icon: 'OK',
        titel: 'Kalibratie toegevoegd',
        tekst: `${materialName} toegevoegd aan ${bunker.c}.`,
        lijn: lid,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Kalibratie opslaan mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Kalibratie opslaan mislukt',
        tekst: errorMsg,
        lijn: lid,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } finally {
      setIsSavingCalibration(false);
    }
  };

  const handleArrivedConfirm = async () => {
    if (!arrivedOrder) return;
    const confirmedEta = normalizeEta(arrivedTime);
    if (!confirmedEta) return;
    const updatedOrder: Order = {
      ...arrivedOrder,
      eta: confirmedEta,
      arrivedTime: confirmedEta,
      status: 'arrived',
      arrived: true,
      holdLoadTime: arrivedHoldLoadTime
    };
    const nextOrders = orders.map(o => o.id === arrivedOrder.id ? updatedOrder : o);
    let nextPlan: Record<LineId, number[]> | null = null;

    if (arrivedHoldLoadTime) {
      const lid = updatedOrder.line;
      const lineSource = nextOrders.filter(o => o.status !== 'completed' && o.line === lid);
      const byId = new Map(lineSource.map(order => [order.id, order]));
      const currentLineIds = plannedOrderIdsByLine?.[lid]?.filter(id => byId.has(id)) || lineSource.map(order => order.id);
      const currentLineIdSet = new Set(currentLineIds);
      const orderedLineIds = [
        ...currentLineIds,
        ...lineSource.filter(order => !currentLineIdSet.has(order.id)).map(order => order.id)
      ].filter(id => id !== updatedOrder.id);
      const baseDate = parseLocalDate(updatedOrder.date) || currentTime;
      const heldLoadDateTime = getHeldLoadDateTime(updatedOrder, baseDate);
      const timelineByOrderId = new Map(lineTimelineByLine[lid].map(entry => [entry.order.id, entry]));
      let insertIndex = orderedLineIds.length;

      if (heldLoadDateTime) {
        const firstLaterIndex = orderedLineIds.findIndex(id => {
          const order = byId.get(id);
          if (!order || order.status === 'running') return false;
          const timelineStart = timelineByOrderId.get(id)?.prodStart || getOrderLoadReferenceDateTime(order, baseDate);
          return !!timelineStart && timelineStart.getTime() >= heldLoadDateTime.getTime();
        });
        if (firstLaterIndex >= 0) {
          insertIndex = firstLaterIndex;
        }
      }

      nextPlan = {
        1: plannedOrderIdsByLine?.[1] ? [...plannedOrderIdsByLine[1]] : nextOrders.filter(o => o.status !== 'completed' && o.line === 1).map(o => o.id),
        2: plannedOrderIdsByLine?.[2] ? [...plannedOrderIdsByLine[2]] : nextOrders.filter(o => o.status !== 'completed' && o.line === 2).map(o => o.id),
        3: plannedOrderIdsByLine?.[3] ? [...plannedOrderIdsByLine[3]] : nextOrders.filter(o => o.status !== 'completed' && o.line === 3).map(o => o.id)
      };
      nextPlan[lid] = [
        ...orderedLineIds.slice(0, insertIndex),
        updatedOrder.id,
        ...orderedLineIds.slice(insertIndex)
      ];
      setPlannedOrderIdsByLine(nextPlan);
    }

    await persistSingleOrder(updatedOrder, nextOrders, 'Order sync mislukt');
    if (nextPlan && isSupabaseConfigured()) {
      try {
        await writePlannedOrderIdsToSupabase(nextPlan);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Opslaan naar Supabase mislukt';
        setNotifications(prev => [{
          id: Date.now(),
          type: 'fout',
          icon: 'ERR',
          titel: 'Lijnvolgorde sync mislukt',
          tekst: errorMsg,
          lijn: updatedOrder.line,
          orderNum: updatedOrder.num,
          tijd: new Date(),
          gelezen: false
        }, ...prev]);
      }
    }
    setArrivedOrder(null);
    setArrivedTime('');
    setArrivedHoldLoadTime(false);
  };

  const openEtaEdit = (order: Order) => {
    setEtaEditOrder(order);
    setEtaEditTime(normalizeEta(order.eta) || '');
  };

  const closeEtaEdit = () => {
    setEtaEditOrder(null);
    setEtaEditTime('');
  };

  const handleEtaEditConfirm = async () => {
    if (!etaEditOrder) return;
    const confirmedEta = normalizeEta(etaEditTime);
    if (!confirmedEta) return;

    const updatedOrder: Order = { ...etaEditOrder, eta: confirmedEta };
    const nextOrders = orders.map(o =>
      o.id === etaEditOrder.id
        ? updatedOrder
        : o
    );

    await persistSingleOrder(updatedOrder, nextOrders, 'ETA sync mislukt');
    setSelectedOrderForDetail(prev => prev?.id === etaEditOrder.id ? { ...prev, eta: confirmedEta } : prev);
    closeEtaEdit();
  };
  const [bunkers, setBunkers] = useState<Record<LineId, Bunker[]>>(INITIAL_BUNKERS);
  const [notifications, setNotifications] = useState<Melding[]>([]);
  const [storingen, setStoringen] = useState<Record<LineId, Storing | null>>({ 1: null, 2: null, 3: null });
  const [issueDialogType, setIssueDialogType] = useState<'storing' | 'onderhoud' | null>(null);
  const [issueDescription, setIssueDescription] = useState('');
  const [issueDuration, setIssueDuration] = useState('');
  const [issueStartTime, setIssueStartTime] = useState('');
  const [config, setConfig] = useState<Record<LineId, AppConfig>>(() => {
    const fallback: Record<LineId, AppConfig> = {
      ...DEFAULT_CFG,
      1: { ...DEFAULT_CFG[1], wissel: 5 }
    };
    const saved = localStorage.getItem('kd_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          1: { ...fallback[1], ...(parsed?.[1] || {}) },
          2: { ...fallback[2], ...(parsed?.[2] || {}) },
          3: { ...fallback[3], ...(parsed?.[3] || {}) }
        };
      } catch {
        // ignore broken persisted config
      }
    }
    return fallback;
  });

  async function persistOrders(
    nextOrders: Order[],
    errorTitle = 'Order sync mislukt',
    line: LineId | null = null,
    orderNum: number | null = null
  ) {
    setOrders(nextOrders);
    if (!isSupabaseConfigured()) return;

    try {
      await writeOrdersToSupabase(nextOrders);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Opslaan naar Supabase mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: errorTitle,
        tekst: errorMsg,
        lijn: line,
        orderNum,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    }
  }

  async function persistSingleOrder(
    nextOrder: Order,
    nextOrders: Order[],
    errorTitle = 'Order sync mislukt'
  ) {
    setOrders(nextOrders);
    if (!isSupabaseConfigured()) return;

    try {
      await writeOrdersToSupabase([nextOrder]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Opslaan naar Supabase mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: errorTitle,
        tekst: errorMsg,
        lijn: nextOrder.line,
        orderNum: nextOrder.num,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    }
  }

  async function refreshIssuesFromSupabase() {
    if (!isSupabaseConfigured()) return;
    if (issueRefreshInFlight.current) return;
    issueRefreshInFlight.current = true;
    try {
      const nextIssues = await fetchIssuesFromSupabase();
      setStoringen(nextIssues);
    } catch {
      // keep current local state if supabase issue refresh fails
    } finally {
      issueRefreshInFlight.current = false;
    }
  }

  useEffect(() => {
    const runningWithoutStart = orders.filter(order => order.status === 'running' && !order.startedAt);
    if (runningWithoutStart.length === 0) {
      repairedRunningOrdersRef.current = '';
      return;
    }

    const repairKey = runningWithoutStart.map(order => `${order.id}:${order.status}`).join('|');
    if (repairedRunningOrdersRef.current === repairKey) return;

    repairedRunningOrdersRef.current = repairKey;
    const repairedStartedAt = new Date().toISOString();
    const nextOrders = orders.map(order =>
      order.status === 'running' && !order.startedAt
        ? { ...order, startedAt: repairedStartedAt }
        : order
    );

    setOrders(nextOrders);
    void persistOrders(nextOrders, 'Starttijd actieve order sync mislukt');
  }, [orders]);

  const orderDriverNames = useMemo(() => {
    return Array.from(
      new Set(
        orders
          .map(order => String(order.driver || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'nl-NL'));
  }, [orders]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (sharedDriverNames.length > 0) return;
    if (orderDriverNames.length === 0) return;

      const seededDrivers = Array.from(new Set(orderDriverNames))
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'nl-NL'));

    if (seededDrivers.length === 0) return;

    setSharedDriverNames(seededDrivers);
    setSharedDrivers(seededDrivers.map(name => ({ name, active: true })));
    setDriverSyncDebug(`Supabase chauffeurs gevuld uit orderdata: ${seededDrivers.length}`);

    writeDriverListToSupabase(seededDrivers).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : 'Chauffeurs initieel vullen mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Chauffeurs initieel vullen mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    });
  }, [orderDriverNames, sharedDriverNames]);

  const dayRosterBaseDrivers = useMemo(() => {
    const supabaseDrivers = sharedDriverNames
      .map(name => String(name || '').trim())
      .filter(Boolean);
    return Array.from(new Set(supabaseDrivers));
  }, [sharedDriverNames]);

  async function persistIssue(line: LineId, issue: Storing | null) {
    setStoringen(prev => ({ ...prev, [line]: issue }));
    if (!isSupabaseConfigured()) return;

    try {
      if (issue) {
        await writeIssueToSupabase(line, issue);
      } else {
        await resolveIssueInSupabase(line);
      }
      await refreshIssuesFromSupabase();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Issue sync mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Storing/onderhoud sync mislukt',
        tekst: errorMsg,
        lijn: line,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    }
  }

  async function handleAddDriver() {
    const trimmed = newDriverForm.name.trim();
    if (!trimmed) return;

    const toOptionalNumber = (value: string): number | null => {
      const normalized = value.trim().replace(',', '.');
      if (!normalized) return null;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    if (sharedDriverNames.some(name => name.toLowerCase() === trimmed.toLowerCase())) {
      setSelectedDriverName(sharedDriverNames.find(name => name.toLowerCase() === trimmed.toLowerCase()) || trimmed);
      setNewDriverName('');
      setNewDriverForm(prev => ({ ...prev, name: '' }));
      setDriverSyncDebug(`${trimmed} bestaat al in de centrale chauffeurslijst`);
      return;
    }

    const nextNames = Array.from(new Set([...sharedDriverNames, trimmed]))
      .sort((a, b) => a.localeCompare(b, 'nl-NL'));

    setSharedDriverNames(nextNames);
    setSharedDrivers(prev => {
      const without = prev.filter(driver => driver.name.toLowerCase() !== trimmed.toLowerCase());
      return [...without, { name: trimmed, active: true }].sort((a, b) => a.name.localeCompare(b.name, 'nl-NL'));
    });
    setSelectedDriverName(trimmed);
    setNewDriverName('');
    setNewDriverForm(EMPTY_DRIVER_FORM);
    setShowDriverForm(false);
    setIsSavingDriver(true);
    setDriverSyncDebug(`Opslaan: ${trimmed}...`);

    if (!isSupabaseConfigured()) {
      setIsSavingDriver(false);
      setDriverSyncDebug(`${trimmed} lokaal toegevoegd`);
      return;
    }

    try {
      await upsertDriverInSupabase({
        name: trimmed,
        company: newDriverForm.company,
        truckPlate: newDriverForm.truckPlate,
        trailerPlate: newDriverForm.trailerPlate,
        vehicleHeightM: toOptionalNumber(newDriverForm.vehicleHeightM),
        steeringAxles: toOptionalNumber(newDriverForm.steeringAxles),
        maxWeightKg: toOptionalNumber(newDriverForm.maxWeightKg),
        notes: newDriverForm.notes
      });
      const namesAfter = await fetchDriverListFromSupabase();
      await refreshDriversFromSupabase();
      if (!namesAfter.some(name => name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error(`Naam niet teruggevonden in Supabase (${trimmed})`);
      }
      setDriverSyncDebug(`Laatste sync: ${trimmed} toegevoegd`);
      setNotifications(prev => [{
        id: Date.now(),
        type: 'ok',
        icon: 'OK',
        titel: 'Chauffeur toegevoegd',
        tekst: `${trimmed} staat nu in de centrale chauffeurslijst`,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Chauffeur toevoegen mislukt';
      setDriverSyncDebug(`Opslaan mislukt: ${trimmed}`);
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Chauffeur toevoegen mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } finally {
      setIsSavingDriver(false);
    }
  }

  async function handleToggleDriverAbsent(driverName: string, absent: boolean) {
    const trimmed = driverName.trim();
    if (!trimmed) return;

    setSharedDrivers(prev => prev.map(driver =>
      driver.name === trimmed ? { ...driver, active: !absent } : driver
    ));
    setSharedDriverNames(prev => absent ? prev.filter(name => name !== trimmed) : Array.from(new Set([...prev, trimmed])).sort((a, b) => a.localeCompare(b, 'nl-NL')));
    setDriverSyncDebug(`${trimmed} ${absent ? 'op afwezig gezet' : 'weer beschikbaar'}`);

    if (!isSupabaseConfigured()) return;

    try {
      await setDriverActiveInSupabase(trimmed, !absent);
      await refreshDriversFromSupabase();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Chauffeurstatus opslaan mislukt';
      setDriverSyncDebug(`Afwezigheid sync mislukt: ${trimmed}`);
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Chauffeurstatus sync mislukt',
        tekst: errorMsg,
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      await refreshDriversFromSupabase();
    }
  }
  const [lineTiming, setLineTiming] = useState<Record<LineId, LineTimingSettings>>(() => {
    const saved = localStorage.getItem('kd_line_timing');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore broken persisted data
      }
    }
    return {
      1: { dayStart: '05:00', firstOrderStart: '05:15' },
      2: { dayStart: '05:00', firstOrderStart: '05:15' },
      3: { dayStart: '05:00', firstOrderStart: '05:15' }
    };
  });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isSupabaseConfigured()) {
      refreshIssuesFromSupabase();
      return;
    }
    const saved = localStorage.getItem('kd_storingen');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setStoringen({
        1: parsed?.[1] ? { ...parsed[1], start: new Date(parsed[1].start) } : null,
        2: parsed?.[2] ? { ...parsed[2], start: new Date(parsed[2].start) } : null,
        3: parsed?.[3] ? { ...parsed[3], start: new Date(parsed[3].start) } : null
      });
    } catch {
      // ignore broken persisted data
    }
  }, [refreshIssuesFromSupabase]);

  useEffect(() => {
    if (isSupabaseConfigured()) return;
    localStorage.setItem('kd_storingen', JSON.stringify(storingen));
  }, [storingen]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Tickers
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const progTimer = setInterval(() => {
      setProgress(p => Math.min(p + 0.06, 99));
    }, 3000);
    return () => {
      clearInterval(timer);
      clearInterval(progTimer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('kd_line_timing', JSON.stringify(lineTiming));
  }, [lineTiming]);

  useEffect(() => {
    localStorage.setItem('kd_config', JSON.stringify(config));
  }, [config]);

  const timeStringToMinutes = (value: string, fallback = 0) => {
    const normalized = normalizeEta(value);
    if (!normalized) return fallback;
    const [hh, mm] = normalized.split(':').map(v => parseInt(v, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return fallback;
    return hh * 60 + mm;
  };

  const BAG_COOLDOWN_MINUTES = 90;
  const isBagPkg = (order: Order | null) => order?.pkg?.toLowerCase() === 'bag';

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

  const getScheduledStartsForLine = (list: Order[], lid: LineId): Date[] => {
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
  };

  const getLinePlanCursor = useCallback((list: Order[], lid: LineId) => {
    const cfg = config[lid];
    const lineBunkers = bunkers[lid];
    const lineTimingCfg = lineTiming[lid];
    const baseDayStart = timeStringToMinutes(lineTimingCfg?.dayStart || '05:00', 5 * 60);
    const firstOrderStart = timeStringToMinutes(effectiveFirstOrderStart, baseDayStart + 15);
    const speed = LINES[lid].speed;
    let current = 0;
    let nextAllowedBagProdStart: number | null = null;

    list.forEach((order, index) => {
      const prevOrder = index > 0 ? list[index - 1] : null;
      const transitionMinutes = getTransitionMinutes(lid, prevOrder, order, lineBunkers);
      const slot = rt(order, speed) + transitionMinutes;
      let startMinutes = current;
      const eta = getOrderLoadReferenceTime(order);
      const etaMinutes = eta ? timeStringToMinutes(eta, baseDayStart) - baseDayStart : null;

      if (index === 0) {
        startMinutes = firstOrderStart - baseDayStart;
      }

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

      current = startMinutes + slot;

      if (isBagPkg(order)) {
        nextAllowedBagProdStart = startMinutes + slot + BAG_COOLDOWN_MINUTES;
      }
    });

    return {
      baseDayStart,
      firstOrderStart,
      current,
      nextAllowedBagProdStart
    };
  }, [bunkers, config, lineTiming, getTransitionMinutes]);

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

        if (actualMinutes < earliestAllowed) {
          return false;
        }

        if (actualMinutes > latestAllowed) {
          return false;
        }
      }
    return true;
  }, [bunkers, config]);

  const isBagOrder = useCallback((order: Order | null) => order?.pkg?.toLowerCase() === 'bag', []);
  const isBaleOrder = useCallback((order: Order | null) => order?.pkg?.toLowerCase() === 'bale', []);

  const fillSimpleSingleGapWithinLine = useCallback((lid: LineId, initialPlan: Order[]) => {
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
            const targetIndex = planState.findIndex(o => o.id === targetOrderId);
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

                if (tooSmallFirstFill) {
                  continue;
                }

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

      if (debugEntries.length > 0) {
        setGapDebug(prev => [...prev.filter(entry => entry.line !== lid), ...debugEntries]);
      }

      return workingPlan;
    }, [bunkers, config, getScheduledStartsForLine, planRespectsLoadWindows]);

  function getFutureBlockFitBonus(plan: Order[], insertIndex: number, lid: LineId) {
    const candidate = plan[insertIndex];
    if (!candidate) return 0;

    const nextOrders = plan.slice(insertIndex + 1, insertIndex + 3);
    if (nextOrders.length === 0) return 0;

    let bonus = 0;
    let futureLargeCount = 0;

    nextOrders.forEach((futureOrder, futureOffset) => {
      const proximityWeight = futureOffset === 0 ? 0.55 : 0.25;
      bonus += getContentClusterBonus(candidate, futureOrder, lid) * proximityWeight;

      const futureMetrics = getOrderContentMetrics(candidate, futureOrder, lid);
      if (futureMetrics.totalBulkLike > 0) {
        const overlapRatio = futureMetrics.prevOverlap / futureMetrics.totalBulkLike;
        if (overlapRatio >= 0.75) bonus += 22000;
        else if (overlapRatio >= 0.5) bonus += 12000;
      }

      if (ev(futureOrder) >= LARGE_ORDER_M3) futureLargeCount += 1;
      if (candidate.rit && futureOrder.rit && candidate.rit === futureOrder.rit) {
        bonus += 12000;
      }
    });

    const candidateIsLarge = ev(candidate) >= LARGE_ORDER_M3;
    if (candidateIsLarge && futureLargeCount >= 1) {
      bonus += futureLargeCount >= 2 ? 55000 : 28000;
    }

    if (!candidateIsLarge && futureLargeCount >= 2) {
      bonus -= 45000;
    }

    return bonus;
  }

  const fillQuickGapWithinLine = useCallback((lid: LineId, initialPlan: Order[]) => {
    if (initialPlan.length < 3) return initialPlan;

    const workingPlan = [...initialPlan];
    let changed = true;
    let passes = 0;
    const maxPasses = 4;

    while (changed && passes < maxPasses) {
      changed = false;
      passes += 1;

      const starts = getScheduledStartsForLine(workingPlan, lid);
      const timeline = workingPlan.map((order, index) => {
        const startTime = starts[index];
        const prevOrder = index > 0 ? workingPlan[index - 1] : null;
        const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
        const prodStart = new Date(startTime.getTime() + transitionMinutes * 60000);
        const endTime = new Date(prodStart.getTime() + rt(order, LINES[lid].speed) * 60000);
        return { order, startTime, prodStart, endTime };
      });

      for (let i = 0; i < timeline.length - 1 && !changed; i++) {
        const current = timeline[i];
        const next = timeline[i + 1];
        const gapMinutes = Math.round((next.startTime.getTime() - current.endTime.getTime()) / 60000);
        if (gapMinutes < 15) continue;

        const candidateLimit = workingPlan.length;
        const prioritizeBaleAfterBag = isBagOrder(current.order);
        const hasBaleCandidate = prioritizeBaleAfterBag && workingPlan
          .slice(i + 2, candidateLimit)
          .some(candidate => candidate.status !== 'running' && candidate.pkg !== 'bulk' && isBaleOrder(candidate));
        let bestIdx = -1;
        let bestGapScore = Number.NEGATIVE_INFINITY;
        const preferLargeFill = gapMinutes >= 45;

        for (let j = i + 2; j < candidateLimit; j++) {
          const candidate = workingPlan[j];
          if (candidate.status === 'running') continue;
          if (candidate.pkg === 'bulk') continue;
          if (prioritizeBaleAfterBag && hasBaleCandidate && !isBaleOrder(candidate)) continue;
          if (isBagOrder(current.order) && isBagOrder(candidate)) continue;

          const neededMinutes = getTransitionMinutes(lid, current.order, candidate) + rt(candidate, LINES[lid].speed);
          if (neededMinutes > gapMinutes) continue;

          const nextPlan = [...workingPlan];
          const [picked] = nextPlan.splice(j, 1);
          nextPlan.splice(i + 1, 0, picked);
          if (!planRespectsLoadWindows(lid, nextPlan)) continue;

          const candidateVolume = ev(candidate);
          const fillRatio = gapMinutes > 0 ? neededMinutes / gapMinutes : 0;
          const remainder = Math.max(0, gapMinutes - neededMinutes);
          const contentBonus = getContentClusterBonus(current.order, candidate, lid);
          const windowBonus = getWindowClusterBonus(workingPlan.slice(0, i + 1), candidate, lid);
          const materialBias = getTrailingBlockMaterialBias(workingPlan.slice(0, i + 1), candidate);
          const comboBias = getTrailingBlockComboBias(workingPlan.slice(0, i + 1), candidate);
          const prepContinuityBonus = getPreparationContinuityBonus(workingPlan.slice(0, i + 1), candidate, lid);
          const futureBlockBonus = getFutureBlockFitBonus(nextPlan, i + 1, lid);
          const continuationBonus = getContinuationPotential(lid, workingPlan.slice(0, i + 1), candidate, workingPlan.slice(i + 2));
          const baleAfterBagBoost = prioritizeBaleAfterBag && isBaleOrder(candidate) ? 50000 : 0;

          const gapScore = (
            (preferLargeFill ? candidateVolume * 900 : fillRatio * 100000) -
            (remainder * 300) -
            (neededMinutes * 40) +
            contentBonus +
            windowBonus +
            materialBias +
            comboBias +
            prepContinuityBonus +
            futureBlockBonus +
            Math.round(continuationBonus * 0.45) +
            baleAfterBagBoost
          );

          if (gapScore > bestGapScore) {
            bestIdx = j;
            bestGapScore = gapScore;
          }
        }

        if (bestIdx >= 0) {
          const [picked] = workingPlan.splice(bestIdx, 1);
          workingPlan.splice(i + 1, 0, picked);
          changed = true;
        }
      }
    }

    return workingPlan;
  }, [getScheduledStartsForLine, getTransitionMinutes, isBagOrder, planRespectsLoadWindows]);

  const planningMaterials = useMemo(() => {
    const mats = new Map<string, CalibrationMaterial>();
    orders.forEach(o => {
      o.components.forEach(c => {
        if (c.name && !mats.has(c.name)) {
          mats.set(c.name, {
            name: c.name,
            code: c.code || null,
            calibrationValue: null
          });
        }
      });
    });
    return Array.from(mats.values());
  }, [orders]);

  const allAvailableMaterials = useMemo(() => {
    const merged = new Map<string, CalibrationMaterial>();
    // Planning first
    planningMaterials.forEach(m => merged.set(m.name, m));
    // Calibration second (overwrites with calibration values)
    calibrationMaterials.forEach(m => merged.set(m.name, m));
    return Array.from(merged.values());
  }, [planningMaterials, calibrationMaterials]);

  const getEffectivePriority = (order: Order): 1 | 2 | 3 => {
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    const nowOperationalMinutes = nowMinutes - (5 * 60);
    const pkg = normalizePkg(order.pkg);
    if (priorityOnePackages.has(pkg)) return 1;
    if (pkg === 'bulk') {
      if (order.status === 'arrived' && order.holdLoadTime) return 1;
      const normalizedEta = getOrderLoadReferenceTime(order);
      const etaMinutes = etaToMins(normalizedEta);
      const loadWindowOpen = etaMinutes !== null && nowOperationalMinutes >= etaMinutes - 30;
      return order.status === 'arrived' && loadWindowOpen ? 1 : 2;
    }
    return [1, 2, 3].includes(order.prio) ? order.prio : 2;
  };

  const getLoadHoldSequenceRank = useCallback((order: Order): number => {
    const normalizedEta = normalizeEta(order.eta);
    if (getEffectivePriority(order) === 1 && normalizedEta === effectiveFirstOrderStart) return 2;
    if (order.status === 'arrived' && !!order.holdLoadTime) return 1;
    return 0;
  }, [effectiveFirstOrderStart, getEffectivePriority]);

  const getOrderContentMetrics = useCallback((prev: Order | null, order: Order, lid: LineId) => {
    const lineBunkers = bunkers[lid];
    const prevComponents = prev?.components || [];
    const prevByCode = new Set(prevComponents.map(c => c.code).filter(Boolean));
    const prevByName = new Set(prevComponents.map(c => (c.name || '').toLowerCase()).filter(Boolean));
    const bunkerByCode = new Set(lineBunkers.map(b => b.mc).filter(Boolean));
    const bunkerByName = new Set(lineBunkers.map(b => (b.m || '').toLowerCase()).filter(Boolean));

    let prevOverlap = 0;
    let bunkerOverlap = 0;
    let totalBulkLike = 0;

    order.components.forEach(component => {
      const unit = (component.unit || '').toUpperCase();
      const bulkLike = unit === 'M3' || unit === 'PERC' || unit === '' || lineBunkers.some(b =>
        (b.ms && b.ms.some(m => canUseExistingMaterialForRequested(m, null, component.name, component.code))) ||
        (b.materialData && Object.entries(b.materialData).some(([mName, mData]) => canUseExistingMaterialForRequested(mName, mData.code, component.name, component.code)))
      );
      if (!bulkLike) return;

      totalBulkLike += 1;
      const nameKey = (component.name || '').toLowerCase();
      const codeKey = component.code || '';

      const prevMatch = (codeKey && prevByCode.has(codeKey)) || (!!nameKey && prevByName.has(nameKey));
      const bunkerMatch = (codeKey && bunkerByCode.has(codeKey)) || (!!nameKey && bunkerByName.has(nameKey));

      if (prevMatch) prevOverlap += 1;
      if (bunkerMatch) bunkerOverlap += 1;
    });

    return {
      prevOverlap,
      bunkerOverlap,
      totalBulkLike
    };
  }, [bunkers]);

  const getContentClusterBonus = useCallback((prev: Order | null, order: Order, lid: LineId) => {
    if (!prev) return 0;

    const { prevOverlap, bunkerOverlap, totalBulkLike } = getOrderContentMetrics(prev, order, lid);
    if (totalBulkLike <= 0) return 0;

    const overlapRatio = prevOverlap / totalBulkLike;
    const bunkerRatio = bunkerOverlap / totalBulkLike;
    const sameRecipeBonus = prev.recipe === order.recipe ? 35000 : 0;
    const sameCustomerRecipeFamilyBonus = prev.customer === order.customer ? 4000 : 0;

    let ratioBonus = 0;
    if (overlapRatio >= 0.8) ratioBonus += 70000;
    else if (overlapRatio >= 0.6) ratioBonus += 42000;
    else if (overlapRatio >= 0.4) ratioBonus += 20000;

    if (bunkerRatio >= 0.8) ratioBonus += 40000;
    else if (bunkerRatio >= 0.6) ratioBonus += 24000;
    else if (bunkerRatio >= 0.4) ratioBonus += 10000;

    return sameRecipeBonus + sameCustomerRecipeFamilyBonus + ratioBonus;
  }, [getOrderContentMetrics]);

  const getWindowClusterBonus = useCallback((plan: Order[], order: Order, lid: LineId) => {
    const recentOrders = plan.slice(-3);
    if (recentOrders.length === 0) return 0;

    let bonus = 0;

    recentOrders.forEach(previous => {
      bonus += getContentClusterBonus(previous, order, lid) * 0.45;

      if (previous.rit && order.rit && previous.rit === order.rit) {
        bonus += 22000;
      }

      if (previous.recipe === order.recipe) {
        bonus += 12000;
      }
    });

    const sameRitCount = recentOrders.filter(previous => previous.rit && order.rit && previous.rit === order.rit).length;
    if (sameRitCount >= 2) bonus += 30000;

    const sameCustomerCount = recentOrders.filter(previous => previous.customer === order.customer).length;
    if (sameCustomerCount >= 2) bonus += 6000;

    return bonus;
  }, [getContentClusterBonus]);

  const getRitWindowClusterBonus = useCallback((plan: Order[], order: Order) => {
    const recentOrders = plan.slice(-4);
    if (recentOrders.length === 0 || !order.rit) return 0;

    const orderEta = etaToMins(normalizeEta(order.eta));
    let bonus = 0;

    recentOrders.forEach(previous => {
      if (!previous.rit || previous.rit !== order.rit) return;
      bonus += 26000;

      const previousEta = etaToMins(normalizeEta(previous.eta));
      if (orderEta !== null && previousEta !== null) {
        const diff = Math.abs(orderEta - previousEta);
        if (diff <= 15) bonus += 36000;
        else if (diff <= 30) bonus += 22000;
        else if (diff <= 60) bonus += 10000;
      }
    });

    const sameRitRecentCount = recentOrders.filter(previous => previous.rit === order.rit).length;
    if (sameRitRecentCount >= 2) bonus += 42000;

    return bonus;
  }, []);

  const getTrailingBlockMaterialBias = useCallback((plan: Order[], order: Order) => {
    const recentOrders = plan.slice(-3);
    if (recentOrders.length < 2) return 0;

    const materialCounts = new Map<string, number>();
    recentOrders.forEach(previous => {
      const seen = new Set<string>();
      previous.components.forEach(component => {
        const key = (component.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        materialCounts.set(key, (materialCounts.get(key) || 0) + 1);
      });
    });

    const dominantMaterials = Array.from(materialCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([name]) => name);

    if (dominantMaterials.length === 0) return 0;

    const orderMaterials = new Set(
      order.components
        .map(component => (component.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let matchingDominant = 0;
    dominantMaterials.forEach(materialName => {
      if (orderMaterials.has(materialName)) matchingDominant += 1;
    });

    if (matchingDominant === 0) {
      return -60000;
    }

    return matchingDominant * 28000;
  }, []);

  const getTrailingBlockComboBias = useCallback((plan: Order[], order: Order) => {
    const recentOrders = plan.slice(-3);
    if (recentOrders.length < 2) return 0;

    const comboCounts = new Map<string, number>();
    recentOrders.forEach(previous => {
      const materials = Array.from(new Set(
        previous.components
          .map(component => (component.name || '').trim().toLowerCase())
          .filter(Boolean)
      )).sort();

      for (let i = 0; i < materials.length; i++) {
        for (let j = i + 1; j < materials.length; j++) {
          const comboKey = `${materials[i]}__${materials[j]}`;
          comboCounts.set(comboKey, (comboCounts.get(comboKey) || 0) + 1);
        }
      }
    });

    const dominantCombos = Array.from(comboCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([comboKey]) => comboKey);

    if (dominantCombos.length === 0) return 0;

    const orderMaterials = new Set(
      order.components
        .map(component => (component.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let matchedCombos = 0;
    dominantCombos.forEach(comboKey => {
      const [left, right] = comboKey.split('__');
      if (orderMaterials.has(left) && orderMaterials.has(right)) {
        matchedCombos += 1;
      }
    });

    if (matchedCombos === 0) return 0;

    return matchedCombos * 36000;
  }, []);

  function getPreparationContinuityBonus(plan: Order[], order: Order, lid: LineId) {
    const recentOrders = plan.slice(-3);
    if (recentOrders.length === 0) return 0;

    const recentPrepMaterials = new Set<string>();

    recentOrders.forEach((recentOrder, index) => {
      const previousOrder = index > 0 ? recentOrders[index - 1] : null;
      getSwitchMaterials(previousOrder, recentOrder, bunkers[lid]).forEach(material => {
        const key = material.trim().toLowerCase();
        if (key) recentPrepMaterials.add(key);
      });
    });

    const previousGlobalOrder = plan.length > 0 ? plan[plan.length - 1] : null;
    const candidatePrepMaterials = getSwitchMaterials(previousGlobalOrder, order, bunkers[lid])
      .map(material => material.trim().toLowerCase())
      .filter(Boolean);

    if (candidatePrepMaterials.length === 0) {
      return recentPrepMaterials.size > 0 ? 12000 : 0;
    }

    let overlapCount = 0;
    candidatePrepMaterials.forEach(material => {
      if (recentPrepMaterials.has(material)) overlapCount += 1;
    });

    const overlapRatio = overlapCount / candidatePrepMaterials.length;
    const newPrepPenalty = (candidatePrepMaterials.length - overlapCount) * 9000;

    let bonus = overlapCount * 22000 - newPrepPenalty;

    if (overlapRatio >= 0.8) bonus += 26000;
    else if (overlapRatio >= 0.5) bonus += 12000;
    else if (overlapCount === 0) bonus -= 18000;

    return bonus;
  }

  const LARGE_ORDER_M3 = 70;
  const getTrailingLargeStreak = (plan: Order[]) => {
    let streak = 0;
    for (let i = plan.length - 1; i >= 0; i--) {
      if (ev(plan[i]) >= LARGE_ORDER_M3) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  };

  function getContinuationPotential(lid: LineId, currentPlan: Order[], candidate: Order, remainingPool: Order[]) {
    const futureCandidates = remainingPool.filter(other => other.id !== candidate.id);
    if (futureCandidates.length === 0) return 0;

    const candidatePlan = [...currentPlan, candidate];
    const candidateIsLarge = ev(candidate) >= LARGE_ORDER_M3;
    const continuationScores = futureCandidates.map(nextOrder => {
      const contentBonus = getContentClusterBonus(candidate, nextOrder, lid);
      const windowBonus = getWindowClusterBonus(candidatePlan, nextOrder, lid);
      const ritWindowBonus = getRitWindowClusterBonus(candidatePlan, nextOrder);
      const materialBias = getTrailingBlockMaterialBias(candidatePlan, nextOrder);
      const comboBias = getTrailingBlockComboBias(candidatePlan, nextOrder);
      const prepBonus = getPreparationContinuityBonus(candidatePlan, nextOrder, lid);
      const metrics = getOrderContentMetrics(candidate, nextOrder, lid);
      const overlapRatio = metrics.totalBulkLike > 0 ? metrics.prevOverlap / metrics.totalBulkLike : 0;

      let score =
        contentBonus +
        windowBonus +
        ritWindowBonus +
        materialBias +
        comboBias +
        prepBonus;

      if (overlapRatio >= 0.8) score += 28000;
      else if (overlapRatio >= 0.6) score += 16000;

      if (candidate.rit && nextOrder.rit && candidate.rit === nextOrder.rit) score += 22000;
      if (candidate.recipe === nextOrder.recipe) score += 14000;

      if (candidateIsLarge && ev(nextOrder) >= LARGE_ORDER_M3) score += 30000;

      if (isBagOrder(candidate) && isBaleOrder(nextOrder)) score += 50000;
      if (isBagOrder(candidate) && isBagOrder(nextOrder)) score -= 140000;

      const nextEffPrio = getEffectivePriority(nextOrder);
      if (nextOrder.pkg === 'bulk' && nextEffPrio > 1) score -= 12000;

      return score;
    }).sort((a, b) => b - a);

    const primary = continuationScores[0] || 0;
    const secondary = continuationScores[1] || 0;

    return primary + (secondary * 0.35);
  }

  const buildLinePlan = useCallback((lid: LineId, sourceOrders: Order[]) => {
    const running = sourceOrders.filter(o => o.status === 'running');
    const pool = sourceOrders.filter(o => o.status !== 'running');
    const plan: Order[] = [...running];
    let current: Order | null = running.length > 0 ? running[running.length - 1] : null;
    const fixedFirstEta = effectiveFirstOrderStart;
    const fixedFirstEtaMins = etaToMins(fixedFirstEta) ?? 15;

    if (!current && pool.length > 0) {
      const fixedFirstCandidates = pool
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => getEffectivePriority(order) === 1 && normalizeEta(order.eta) === fixedFirstEta);

      if (fixedFirstCandidates.length > 0) {
        fixedFirstCandidates.sort((a, b) => {
          const aBulkPenalty = a.order.pkg === 'bulk' ? 1 : 0;
          const bBulkPenalty = b.order.pkg === 'bulk' ? 1 : 0;
          if (aBulkPenalty !== bBulkPenalty) return aBulkPenalty - bBulkPenalty;
          return ev(a.order) - ev(b.order);
        });
        const picked = pool.splice(fixedFirstCandidates[0].index, 1)[0];
        plan.push(picked);
        current = picked;
      }
    }

    if (!current && pool.length > 0) {
      const holdLoadCandidates = pool
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => order.status === 'arrived' && !!order.holdLoadTime);

      if (holdLoadCandidates.length > 0) {
        holdLoadCandidates.sort((a, b) => {
          const etaA = etaToMins(normalizeEta(a.order.arrivedTime || a.order.eta)) || 9999;
          const etaB = etaToMins(normalizeEta(b.order.arrivedTime || b.order.eta)) || 9999;
          if (etaA !== etaB) return etaA - etaB;
          const swA = swCount(current, a.order, bunkers[lid]);
          const swB = swCount(current, b.order, bunkers[lid]);
          if (swA !== swB) return swA - swB;
          return ev(b.order) - ev(a.order);
        });
        const picked = pool.splice(holdLoadCandidates[0].index, 1)[0];
        plan.push(picked);
        current = picked;
      }
    }

    if (plan.length === 1 && pool.length > 0) {
      const anchoredHoldLoadCandidates = pool
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => order.status === 'arrived' && !!order.holdLoadTime);

      if (anchoredHoldLoadCandidates.length > 0) {
        anchoredHoldLoadCandidates.sort((a, b) => {
          const etaA = etaToMins(getOrderLoadReferenceTime(a.order)) || 9999;
          const etaB = etaToMins(getOrderLoadReferenceTime(b.order)) || 9999;
          if (etaA !== etaB) return etaA - etaB;
          const swA = swCount(current, a.order, bunkers[lid]);
          const swB = swCount(current, b.order, bunkers[lid]);
          if (swA !== swB) return swA - swB;
          return ev(a.order) - ev(b.order);
        });
        const picked = pool.splice(anchoredHoldLoadCandidates[0].index, 1)[0];
        plan.push(picked);
        current = picked;
      }
    }

    if (!current && pool.length > 0) {
      const flexibleStarterCandidates = pool
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => order.pkg !== 'bulk' && !normalizeEta(order.eta));

      if (flexibleStarterCandidates.length > 0) {
        flexibleStarterCandidates.sort((a, b) => {
          const aLarge = ev(a.order) >= LARGE_ORDER_M3 ? 1 : 0;
          const bLarge = ev(b.order) >= LARGE_ORDER_M3 ? 1 : 0;
          if (aLarge !== bLarge) return bLarge - aLarge;
          const prioDiff = getEffectivePriority(a.order) - getEffectivePriority(b.order);
          if (prioDiff !== 0) return prioDiff;
          return ev(b.order) - ev(a.order);
        });
        const picked = pool.splice(flexibleStarterCandidates[0].index, 1)[0];
        plan.push(picked);
        current = picked;
      }
    }

    while (pool.length > 0) {
      const arrivedEtaCandidates = pool
        .map((order, index) => ({ order, index }))
        .filter(({ order }) => order.status === 'arrived' && !!getOrderLoadReferenceTime(order));

      if (arrivedEtaCandidates.length > 0) {
        arrivedEtaCandidates.sort((a, b) => {
          const holdDiff = Number(!!b.order.holdLoadTime) - Number(!!a.order.holdLoadTime);
          if (holdDiff !== 0) return holdDiff;
          const etaA = etaToMins(getOrderLoadReferenceTime(a.order)) || 9999;
          const etaB = etaToMins(getOrderLoadReferenceTime(b.order)) || 9999;
          if (etaA !== etaB) return etaA - etaB;
          const swA = swCount(current, a.order, bunkers[lid]);
          const swB = swCount(current, b.order, bunkers[lid]);
          if (swA !== swB) return swA - swB;
          return ev(a.order) - ev(b.order);
        });
        const picked = pool.splice(arrivedEtaCandidates[0].index, 1)[0];
        plan.push(picked);
        current = picked;
        continue;
      }

      let bestIdx = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      const prioritizeBalePool = isBagOrder(current) && pool.some(order => isBaleOrder(order));
      const hasFlexibleEarlyStarter = !current && pool.some(other => {
        if (other.pkg === 'bulk') return false;
        const otherEta = normalizeEta(other.eta);
        return !otherEta || (etaToMins(otherEta) ?? 9999) <= fixedFirstEtaMins + 15;
      });
      const planCursor = getLinePlanCursor(plan, lid);

        pool.forEach((order, index) => {
          if (prioritizeBalePool && !isBaleOrder(order)) return;

          const effPrio = getEffectivePriority(order);
          const orderVolume = ev(order);
          const eta = normalizeEta(order.eta);
          const etaMins = etaToMins(eta);
          const hasEta = etaMins !== null && etaMins !== undefined;
          const switchCount = swCount(current, order, bunkers[lid]);
          const contentMetrics = getOrderContentMetrics(current, order, lid);
          const contentClusterBonus = getContentClusterBonus(current, order, lid);
          const windowClusterBonus = getWindowClusterBonus(plan, order, lid);
          const ritWindowClusterBonus = getRitWindowClusterBonus(plan, order);
          const trailingBlockMaterialBias = getTrailingBlockMaterialBias(plan, order);
          const trailingBlockComboBias = getTrailingBlockComboBias(plan, order);
          const preparationContinuityBonus = getPreparationContinuityBonus(plan, order, lid);
          const continuationBonus = getContinuationPotential(lid, plan, order, pool);
          const deferredBulkPenalty = order.pkg === 'bulk' && effPrio > 1 ? 50000 : 0;
          const holdLoadTimeBonus = order.status === 'arrived' && order.holdLoadTime ? 80000 : 0;
          const starterBulkDelayPenalty =
            !current &&
            hasFlexibleEarlyStarter &&
            order.pkg === 'bulk' &&
            hasEta &&
            etaMins! > fixedFirstEtaMins + 20
              ? 180000
              : 0;
          const bagAfterBagPenalty = isBagOrder(current) && isBagOrder(order) ? 260000 : 0;
          const baleAfterBagBonus = isBagOrder(current) && isBaleOrder(order) ? 90000 : 0;
          const fixedFirstBonus = !current && effPrio === 1 && eta && eta === fixedFirstEta ? -200000 : 0;
          const overlapBonus = ((contentMetrics.prevOverlap * 3500) + (contentMetrics.bunkerOverlap * 1800));
          const unknownContentPenalty = contentMetrics.totalBulkLike > 0 && contentMetrics.prevOverlap === 0 && contentMetrics.bunkerOverlap === 0 ? 2500 : 0;
          const recentOrders = plan.slice(-3);
          const recentLargeCount = recentOrders.filter(previous => ev(previous) >= LARGE_ORDER_M3).length;
          const trailingLargeStreak = getTrailingLargeStreak(plan);
          const isLargeOrder = orderVolume >= LARGE_ORDER_M3;
          const switchWeight =
            trailingLargeStreak >= 2 ? 450 :
            trailingLargeStreak === 1 ? 700 :
            1000;
          const largeBlockBonus = isLargeOrder
            ? (
                trailingLargeStreak >= 2 ? 110000 :
                trailingLargeStreak === 1 ? 60000 :
                recentLargeCount >= 2 ? 70000 :
                recentLargeCount === 1 ? 35000 :
                0
              )
            : 0;
          const sameRitBonus = current && order.rit && current.rit && current.rit === order.rit ? 40000 : 0;
          const sameCustomerLargeBonus = current && isLargeOrder && ev(current) >= LARGE_ORDER_M3 && current.customer === order.customer ? 30000 : 0;
          const transitionMinutes = getTransitionMinutes(lid, current, order);
          let candidateStartMinutes = plan.length === 0
            ? (planCursor.firstOrderStart - planCursor.baseDayStart)
            : planCursor.current;

          if (isBagPkg(order) && planCursor.nextAllowedBagProdStart !== null) {
            candidateStartMinutes = Math.max(candidateStartMinutes, planCursor.nextAllowedBagProdStart - transitionMinutes);
          }

          if (hasEta && plan.length > 0) {
            const windowStart = etaMins!;
            const windowEnd = etaMins! + (order.status === 'arrived' ? 30 : config[lid].maxWait);
            const earliestPrepStart = windowStart - transitionMinutes;
            const latestPrepStart = windowEnd - transitionMinutes;
            if (earliestPrepStart > candidateStartMinutes) {
              candidateStartMinutes = earliestPrepStart;
            }
            candidateStartMinutes = Math.min(candidateStartMinutes, latestPrepStart);
          }

          const candidateProdStartMinutes = planCursor.baseDayStart + candidateStartMinutes + transitionMinutes;

          let loadWindowPenalty = 0;
          let urgencyBonus = 0;
          let etaCanBreakLargeBlock = false;
          let safeSlackBonus = 0;
          if (hasEta) {
            const latestAllowed = etaMins! + (order.status === 'arrived' ? 30 : config[lid].maxWait);
            const earliestAllowed = etaMins!;
            const earlySlack = candidateProdStartMinutes - earliestAllowed;
            const slack = latestAllowed - candidateProdStartMinutes;
            if (earlySlack < 0) {
              loadWindowPenalty = 200000 + (Math.abs(earlySlack) * 5000);
            } else if (slack < 0) {
              loadWindowPenalty = 200000 + (Math.abs(slack) * 5000);
            } else {
              urgencyBonus = Math.max(0, 120 - slack) * 150;
              etaCanBreakLargeBlock = slack <= 25;
              safeSlackBonus = slack >= 45 ? 15000 : slack >= 30 ? 7000 : 0;
            }
          }

          const breakLargeBlockPenalty = !isLargeOrder && trailingLargeStreak >= 2 && !etaCanBreakLargeBlock ? 80000 : 0;

          let score = 0;

          if (plannerSort === 'customer') {
            score =
              effPrio * 100000 +
              deferredBulkPenalty +
              0 - holdLoadTimeBonus +
              starterBulkDelayPenalty +
              bagAfterBagPenalty -
              baleAfterBagBonus +
              breakLargeBlockPenalty +
              0 - largeBlockBonus -
              sameRitBonus -
              sameCustomerLargeBonus +
              loadWindowPenalty -
              urgencyBonus +
              0 - safeSlackBonus +
              (hasEta ? 0 : 2000) +
              switchCount * switchWeight -
              overlapBonus -
              contentClusterBonus +
              0 - Math.round(continuationBonus * 0.35) +
              0 - preparationContinuityBonus +
              0 - windowClusterBonus -
              trailingBlockMaterialBias -
              trailingBlockComboBias +
              unknownContentPenalty +
              0 - ritWindowClusterBonus +
              order.customer.toLowerCase().charCodeAt(0);
        } else if (plannerSort === 'eta') {
            score =
              effPrio * 100000 +
              deferredBulkPenalty +
              0 - holdLoadTimeBonus +
              starterBulkDelayPenalty +
              bagAfterBagPenalty -
              baleAfterBagBonus +
              breakLargeBlockPenalty +
              0 - largeBlockBonus -
              sameRitBonus -
              sameCustomerLargeBonus +
              loadWindowPenalty -
              urgencyBonus +
              0 - safeSlackBonus +
              (hasEta ? etaMins! : 40000) +
              switchCount * Math.max(150, Math.round(switchWeight * 0.25)) -
              overlapBonus -
              contentClusterBonus +
              0 - Math.round(continuationBonus * 0.2) +
              0 - preparationContinuityBonus +
              0 - windowClusterBonus -
              trailingBlockMaterialBias -
              trailingBlockComboBias +
              unknownContentPenalty;
            score -= ritWindowClusterBonus;
          } else if (plannerSort === 'prio') {
            score =
              effPrio * 100000 +
              deferredBulkPenalty +
              0 - holdLoadTimeBonus +
              starterBulkDelayPenalty +
              bagAfterBagPenalty -
              baleAfterBagBonus +
              breakLargeBlockPenalty +
              0 - largeBlockBonus -
              sameRitBonus -
              sameCustomerLargeBonus +
              loadWindowPenalty -
              urgencyBonus +
              0 - safeSlackBonus +
              switchCount * switchWeight -
              overlapBonus -
              contentClusterBonus +
              0 - Math.round(continuationBonus * 0.3) +
              0 - preparationContinuityBonus +
              0 - windowClusterBonus -
              trailingBlockMaterialBias -
              trailingBlockComboBias +
              unknownContentPenalty +
              0 - ritWindowClusterBonus +
              (hasEta ? etaMins! : 30000);
          } else {
            score =
              fixedFirstBonus +
              effPrio * 100000 +
              deferredBulkPenalty +
              0 - holdLoadTimeBonus +
              starterBulkDelayPenalty +
              bagAfterBagPenalty -
              baleAfterBagBonus +
              breakLargeBlockPenalty +
              0 - largeBlockBonus -
              sameRitBonus -
              sameCustomerLargeBonus +
              loadWindowPenalty -
              urgencyBonus +
              0 - safeSlackBonus +
              switchCount * (plannerSort === 'efficiency'
                ? (trailingLargeStreak >= 1 ? 1400 : 2600)
                : (trailingLargeStreak >= 2 ? 900 : trailingLargeStreak === 1 ? 1200 : 1800)) +
              unknownContentPenalty -
              overlapBonus -
              contentClusterBonus +
              0 - continuationBonus +
              0 - preparationContinuityBonus +
              0 - windowClusterBonus -
              ritWindowClusterBonus -
              trailingBlockMaterialBias -
              trailingBlockComboBias +
              (hasEta ? etaMins! * 4 : 18000) +
              orderVolume;
          }

        if (score < bestScore) {
          bestScore = score;
          bestIdx = index;
        }
      });

      const picked = pool.splice(bestIdx, 1)[0];
      plan.push(picked);
      current = picked;
    }

    return plan;
  }, [bunkers, lineTiming, plannerSort, getOrderContentMetrics, getContentClusterBonus, getWindowClusterBonus, getRitWindowClusterBonus, getTrailingBlockMaterialBias, getTrailingBlockComboBias, config, getTransitionMinutes, isBagOrder, isBaleOrder, getLinePlanCursor]);

  const activeOrders = useMemo(() => {
    const base = orders.filter(o => o.status !== 'completed');
    
    if (plannerSort === 'efficiency') {
      const sorted: Order[] = [];
      const lineIds: LineId[] = [1, 2, 3];
      
      lineIds.forEach(lid => {
        const lineOrders = base.filter(o => o.line === lid);
        if (!lineOrders.length) return;
        
        // Separate Prio 1
        const prio1 = lineOrders.filter(o => getEffectivePriority(o) === 1).sort((a, b) => (etaToMins(normalizeEta(a.eta)) || 9999) - (etaToMins(normalizeEta(b.eta)) || 9999));
        const others = lineOrders.filter(o => getEffectivePriority(o) !== 1);
        
        const lineSorted: Order[] = [];
        let current: Order | null = null;
        
        // Add Prio 1 first
        prio1.forEach(o => {
          lineSorted.push(o);
          current = o;
        });
        
        // Greedy sort for others to minimize switches
        const remaining = [...others];
        while (remaining.length > 0) {
          let bestIdx = 0;
          let minSw = 999;
          
          for (let i = 0; i < remaining.length; i++) {
            const sw = swCount(current, remaining[i], bunkers[lid]);
            if (sw < minSw) {
              minSw = sw;
              bestIdx = i;
            } else if (sw === minSw) {
              // Tie-break with ETA
              const etaA = etaToMins(normalizeEta(remaining[i].eta)) || 9999;
              const etaB = etaToMins(normalizeEta(remaining[bestIdx].eta)) || 9999;
              if (etaA < etaB) bestIdx = i;
            }
          }
          
          const picked = remaining.splice(bestIdx, 1)[0];
          lineSorted.push(picked);
          current = picked;
        }
        
        sorted.push(...lineSorted);
      });
      
      return sorted;
    }

    return base.sort((a, b) => {
      if (plannerSort === 'eta') {
        const etaA = etaToMins(normalizeEta(a.eta)) || 9999;
        const etaB = etaToMins(normalizeEta(b.eta)) || 9999;
        return etaA - etaB;
      }
      if (plannerSort === 'prio') return getEffectivePriority(a) - getEffectivePriority(b);
      if (plannerSort === 'customer') return a.customer.localeCompare(b.customer);
      
      const effA = getEffectivePriority(a);
      const effB = getEffectivePriority(b);
      if (effA !== effB) return effA - effB;
      const etaA = etaToMins(normalizeEta(a.eta)) || 9999;
      const etaB = etaToMins(normalizeEta(b.eta)) || 9999;
      return etaA - etaB;
    });
  }, [orders, plannerSort, bunkers]);
  const completedOrders = useMemo(() => orders.filter(o => o.status === 'completed'), [orders]);

  useEffect(() => {
    setPlannedOrderIdsByLine(prev => {
      if (!prev) return prev;
      const next: Record<LineId, number[]> = { 1: [], 2: [], 3: [] };
      let changed = false;

      ([1, 2, 3] as LineId[]).forEach(lid => {
        const sourceIds = activeOrders.filter(o => o.line === lid).map(o => o.id);
        const existingIds = (prev[lid] || []).filter(id => sourceIds.includes(id));
        const missingIds = sourceIds.filter(id => !existingIds.includes(id));
        next[lid] = [...existingIds, ...missingIds];
        if (
          next[lid].length !== (prev[lid] || []).length ||
          next[lid].some((id, index) => id !== (prev[lid] || [])[index])
        ) {
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [activeOrders]);

  const lineIds: LineId[] = [1, 2, 3];

  const handleRecalculate = useCallback(() => {
    if (plannerRecalcLock?.owner && plannerRecalcLock.owner !== plannerLockOwnerRef.current) {
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'LOCK',
        titel: 'Schema tijdelijk bezet',
        tekst: 'Een andere werkplek is nu bezig met herberekenen. Probeer het zo weer.',
        lijn: null,
        orderNum: null,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      return;
    }
    setIsRecalculating(true);
    setTimeout(() => {
      void (async () => {
        const lockOwner = plannerLockOwnerRef.current;
        let hasLock = false;
        try {
          if (isSupabaseConfigured()) {
            hasLock = await acquirePlannerRecalcLockInSupabase(lockOwner, 30);
            if (!hasLock) {
              setNotifications(prev => [{
                id: Date.now(),
                type: 'fout',
                icon: 'LOCK',
                titel: 'Schema tijdelijk bezet',
                tekst: 'Een andere werkplek is nu bezig met herberekenen. Probeer het zo weer.',
                lijn: null,
                orderNum: null,
                tijd: new Date(),
                gelezen: false
              }, ...prev]);
              return;
            }
            setPlannerRecalcLock({
              owner: lockOwner,
              expiresAt: new Date(Date.now() + 30000).toISOString()
            });
          }

          const next: Record<LineId, number[]> = { 1: [], 2: [], 3: [] };
          const recalculatedOrders = new Map<number, Order>();
          lineIds.forEach(lid => {
            const sourceOrders = activeOrders.filter(o => o.line === lid);
            const basePlan = buildLinePlan(lid, sourceOrders);
            const quickGapPlan = fillQuickGapWithinLine(lid, basePlan);
            const finalPlan = planRespectsLoadWindows(lid, quickGapPlan)
              ? quickGapPlan
              : (planRespectsLoadWindows(lid, basePlan) ? basePlan : sourceOrders);
            next[lid] = finalPlan.map(o => o.id);
            const starts = getScheduledStartsForLine(finalPlan, lid);
            finalPlan.forEach((order, index) => {
              const scheduledDate = starts[index] ? formatLocalDate(starts[index]) : order.date;
              recalculatedOrders.set(order.id, scheduledDate && scheduledDate !== order.date
                ? { ...order, date: scheduledDate }
                : order);
            });
          });
          const nextOrders = orders.map(order => recalculatedOrders.get(order.id) || order);
          setOrders(nextOrders);
          setPlannedOrderIdsByLine(next);
          if (isSupabaseConfigured()) {
            await writeOrdersToSupabase(nextOrders);
            await writePlannedOrderIdsToSupabase(next);
          }
        } catch (error) {
          console.error('Herbereken Schema fout', error);
        } finally {
          if (hasLock && isSupabaseConfigured()) {
            void releasePlannerRecalcLockInSupabase(lockOwner);
            setPlannerRecalcLock(null);
          }
          setIsRecalculating(false);
        }
      })();
    }, 0);
  }, [activeOrders, buildLinePlan, fillQuickGapWithinLine, getScheduledStartsForLine, orders, planRespectsLoadWindows, plannerRecalcLock]);

  const lineOrdersByLine = useMemo(() => {
    const res: Record<LineId, Order[]> = { 1: [], 2: [], 3: [] };
    lineIds.forEach(lid => {
      const source = activeOrders.filter(o => o.line === lid);
      const plannedIds = plannedOrderIdsByLine?.[lid];
      if (!plannedIds || plannedIds.length === 0) {
        res[lid] = source;
        return;
      }
      const byId = new Map(source.map(o => [o.id, o]));
      const ordered = plannedIds.map(id => byId.get(id)).filter(Boolean) as Order[];
      const leftovers = source.filter(o => !plannedIds.includes(o.id));
      res[lid] = [...ordered, ...leftovers];
    });
    return res;
  }, [activeOrders, plannedOrderIdsByLine]);

  const plannedActiveOrders = useMemo(
    () => lineIds.flatMap(lid => lineOrdersByLine[lid]),
    [lineOrdersByLine]
  );

  const schedule = useMemo(() => {
    const res: Record<LineId, Date[]> = { 1: [], 2: [], 3: [] };
    lineIds.forEach(lid => {
      const lineOrders = lineOrdersByLine[lid];
      res[lid] = getScheduledStartsForLine(lineOrders, lid);
    });
    return res;
  }, [lineIds, lineOrdersByLine, config, bunkers, lineTiming]);

  const lineTimelineByLine = useMemo(() => {
    const res: Record<LineId, ScheduledLineEntry[]> = { 1: [], 2: [], 3: [] };
      lineIds.forEach(lid => {
          const lineOrders = lineOrdersByLine[lid];
          const starts = schedule[lid];
          let cursorEnd: Date | null = null;
          res[lid] = lineOrders.map((order, index) => {
            const scheduledStart = starts[index] || starts[0] || currentTime;
            const prevOrder = index > 0 ? lineOrders[index - 1] : null;
            const swMats = index > 0 ? getSwitchMaterials(prevOrder, order, bunkers[lid]) : [];
            const sw = swMats.length;
            const duration = rt(order, LINES[lid].speed);
            const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
            let startTime = cursorEnd ? new Date(cursorEnd) : scheduledStart;
            let prodStart = new Date(startTime.getTime() + transitionMinutes * 60000);

            const runningStart = getRunningOrderStart(order);
            if (runningStart) {
              prodStart = runningStart;
              startTime = new Date(prodStart.getTime() - transitionMinutes * 60000);
            }

            const heldLoadDateTime = getHeldLoadDateTime(order, prodStart);
            if (heldLoadDateTime && prodStart.getTime() < heldLoadDateTime.getTime()) {
              const shiftMs = heldLoadDateTime.getTime() - prodStart.getTime();
              startTime = new Date(startTime.getTime() + shiftMs);
              prodStart = new Date(prodStart.getTime() + shiftMs);
            }

            const endTime = new Date(prodStart.getTime() + duration * 60000);
            cursorEnd = endTime;
            return { order, startTime, prodStart, endTime, swMats, sw, duration };
          });
      });
    return res;
  }, [lineIds, lineOrdersByLine, schedule, bunkers, config, currentTime, getTransitionMinutes]);

  const lineTimelineEntryByOrderId = useMemo(() => {
    const res: Record<LineId, Map<number, ScheduledLineEntry>> = { 1: new Map(), 2: new Map(), 3: new Map() };
    lineIds.forEach(lid => {
      lineTimelineByLine[lid].forEach(entry => {
        res[lid].set(entry.order.id, entry);
      });
    });
    return res;
  }, [lineIds, lineTimelineByLine]);

  const selectedLineOrders = useMemo(
    () => lineOrdersByLine[selectedLine],
    [lineOrdersByLine, selectedLine]
  );

  const selectedLineTimeline = useMemo(
    () => lineTimelineByLine[selectedLine],
    [lineTimelineByLine, selectedLine]
  );
  const getIssueAffectedOrderCount = useCallback((line: LineId) => {
    return lineTimelineByLine[line].filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived').length;
  }, [lineTimelineByLine]);
  const getIssueFirstAffectedOrderLabel = useCallback((line: LineId) => {
    const firstAffected = lineTimelineByLine[line].find(entry => entry.order.status === 'planned' || entry.order.status === 'arrived');
    if (!firstAffected) return null;
    return `Eerst geraakt: ${firstAffected.order.customer} (${fmt(firstAffected.prodStart)})`;
  }, [lineTimelineByLine]);
  const getIssueLastAffectedOrderLabel = useCallback((line: LineId) => {
    const affected = lineTimelineByLine[line].filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived');
    const lastAffected = affected.length > 0 ? affected[affected.length - 1] : null;
    if (!lastAffected) return null;
    return `Doorwerking t/m: ${lastAffected.order.customer} (${fmt(lastAffected.prodStart)})`;
  }, [lineTimelineByLine]);
  const getIssueAffectedVolumeLabel = useCallback((line: LineId) => {
    const totalVolume = lineTimelineByLine[line]
      .filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived')
      .reduce((sum, entry) => sum + ev(entry.order), 0);
    if (totalVolume <= 0) return null;
    return `Geraakt volume: ${totalVolume.toFixed(1)} m3`;
  }, [lineTimelineByLine]);
  const getIssueAffectedOrdersPreview = useCallback((line: LineId) => {
    return lineTimelineByLine[line]
      .filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived')
      .slice(0, 3)
      .map(entry => entry.order);
  }, [lineTimelineByLine]);

  const displayedCurrentOrder = useMemo(
    () => selectedLineOrders.find(o => o.status === 'running') || null,
    [selectedLineOrders]
  );

  const plannedOrders = useMemo(
    () => selectedLineOrders.filter(o => o.status === 'planned' || o.status === 'arrived'),
    [selectedLineOrders]
  );

  const displayedCurrentEntry = useMemo(() => {
    if (!displayedCurrentOrder) return null;
    return selectedLineTimeline.find(entry => entry.order.id === displayedCurrentOrder.id) || null;
  }, [displayedCurrentOrder, selectedLineTimeline]);

  const displayedCurrentActualStart = useMemo(() => {
    if (!displayedCurrentOrder) return null;
    if (displayedCurrentOrder.status === 'running' && displayedCurrentOrder.startedAt) {
      const actualStart = new Date(displayedCurrentOrder.startedAt);
      if (!Number.isNaN(actualStart.getTime())) return actualStart;
    }
    if (displayedCurrentOrder.status === 'running') {
      return new Date();
    }
    return displayedCurrentEntry?.prodStart || null;
  }, [displayedCurrentOrder, displayedCurrentEntry]);

  const displayedCurrentActualEnd = useMemo(() => {
    if (!displayedCurrentOrder || !displayedCurrentActualStart) {
      return displayedCurrentEntry?.endTime || null;
    }
    return new Date(displayedCurrentActualStart.getTime() + rt(displayedCurrentOrder, LINES[selectedLine].speed) * 60000);
  }, [displayedCurrentActualStart, displayedCurrentEntry, displayedCurrentOrder, selectedLine]);

  const displayedCurrentProgress = useMemo(() => {
    if (!displayedCurrentOrder || displayedCurrentOrder.status !== 'running' || !displayedCurrentActualStart) {
      return progress;
    }
    const total = rt(displayedCurrentOrder, LINES[selectedLine].speed) * 60000;
    if (total <= 0) return 0;
    const elapsed = currentTime.getTime() - displayedCurrentActualStart.getTime();
    return Math.max(0, Math.min(99, (elapsed / total) * 100));
  }, [currentTime, displayedCurrentActualStart, displayedCurrentOrder, progress, selectedLine]);

  const operatorRuntimeShiftMs = useMemo(() => {
    if (!displayedCurrentOrder || displayedCurrentOrder.status !== 'running') return 0;
    if (!displayedCurrentEntry || !displayedCurrentActualEnd) return 0;
    const shift = displayedCurrentActualEnd.getTime() - displayedCurrentEntry.endTime.getTime();
    return shift > 0 ? shift : 0;
  }, [displayedCurrentActualEnd, displayedCurrentEntry, displayedCurrentOrder]);

  const operatorLeegBunkers = useMemo(() => {
    if (!displayedCurrentOrder) return [];
    return bunkers[selectedLine]
      .filter(b => b.mustEmpty && b.m && (b.leegNaOrder === 'NU' || b.leegNaOrder === 'ACTIEF'))
      .sort((a, b) => {
        if (a.leegNaOrder === 'NU' && b.leegNaOrder !== 'NU') return -1;
        if (b.leegNaOrder === 'NU' && a.leegNaOrder !== 'NU') return 1;
        return a.c.localeCompare(b.c);
      });
  }, [bunkers, displayedCurrentOrder, selectedLine]);

  const plannedEntries = useMemo(
    () => selectedLineTimeline.filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived'),
    [selectedLineTimeline]
  );

  const reorderOperatorLineOrders = useCallback((lid: LineId, draggedId: number, targetId: number) => {
    if (draggedId === targetId) return;

    const currentLineOrders = lineOrdersByLine[lid] || [];
    const currentPlannedIds = currentLineOrders
      .filter(o => o.status === 'planned' || o.status === 'arrived')
      .map(o => o.id);

    const fromIndex = currentPlannedIds.indexOf(draggedId);
    const toIndex = currentPlannedIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reorderedPlannedIds = currentPlannedIds.slice();
    const [picked] = reorderedPlannedIds.splice(fromIndex, 1);
    reorderedPlannedIds.splice(toIndex, 0, picked);

    let plannedPointer = 0;
    const rebuiltLineIds = currentLineOrders.map(o => {
      if (o.status === 'planned' || o.status === 'arrived') {
        return reorderedPlannedIds[plannedPointer++];
      }
      return o.id;
    });

    const nextPlan = (() => {
      const base: Record<LineId, number[]> = plannedOrderIdsByLine || {
        1: lineOrdersByLine[1].map(o => o.id),
        2: lineOrdersByLine[2].map(o => o.id),
        3: lineOrdersByLine[3].map(o => o.id)
      };
      return { ...base, [lid]: rebuiltLineIds };
    })();

    setPlannedOrderIdsByLine(nextPlan);
    if (isSupabaseConfigured()) {
      void writePlannedOrderIdsToSupabase(nextPlan);
    }

    const draggedOrder = currentLineOrders.find(o => o.id === draggedId);
    const targetOrder = currentLineOrders.find(o => o.id === targetId);
    setNotifications(prev => [{
      id: Date.now(),
      type: 'info',
      icon: 'INFO',
      titel: 'Volgorde bijgewerkt',
      tekst: `${draggedOrder?.customer || 'Order'} verplaatst bij ${targetOrder?.customer || 'volgende order'}.`,
      lijn: lid,
      orderNum: draggedOrder?.num || null,
      tijd: new Date(),
      gelezen: false
    }, ...prev]);
  }, [lineOrdersByLine, plannedOrderIdsByLine]);

  const currentNeedsProlineCleaning = useMemo(
    () => hasProlineCleaningTrigger(displayedCurrentOrder),
    [displayedCurrentOrder]
  );

  const lineBunkers = bunkers[selectedLine];
  const activeIssue = storingen[selectedLine];
  const activeIssueEntries = useMemo(
    () =>
      (Object.keys(LINES) as unknown as LineId[])
        .map(line => ({ line, issue: storingen[line] }))
        .filter((entry): entry is { line: LineId; issue: NonNullable<typeof storingen[LineId]> } => !!entry.issue?.actief),
    [storingen]
  );
  const getIssueExpectedEndLabel = (issue: NonNullable<typeof storingen[LineId]>) => {
    if (!issue.duur || issue.duur <= 0) return null;
    const end = new Date(issue.start.getTime() + issue.duur * 60000);
    return `Verwacht tot: ${end.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const getIssueExpectedUntilTime = (issue: NonNullable<typeof storingen[LineId]>) => {
    if (!issue.duur || issue.duur <= 0) return null;
    const end = new Date(issue.start.getTime() + issue.duur * 60000);
    return end.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  };
  const getIssueRemainingMinutesLabel = (issue: NonNullable<typeof storingen[LineId]>) => {
    if (!issue.duur || issue.duur <= 0) return null;
    const remaining = Math.max(0, Math.round((issue.start.getTime() + issue.duur * 60000 - currentTime.getTime()) / 60000));
    return `Nog ${remaining} min`;
  };

  const openIssueDialog = (type: 'storing' | 'onderhoud') => {
    setIssueDialogType(type);
    setIssueDescription('');
    setIssueDuration('');
    setIssueStartTime(new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false }));
  };

  const editIssue = (line: LineId, issue: NonNullable<typeof storingen[LineId]>) => {
    if (selectedLine !== line) setSelectedLine(line);
    setIssueDialogType(issue.soort);
    setIssueDescription(issue.omschrijving);
    setIssueDuration(issue.duur ? String(issue.duur) : '');
    setIssueStartTime(issue.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false }));
  };

  const closeIssueDialog = () => {
    setIssueDialogType(null);
    setIssueDescription('');
    setIssueDuration('');
    setIssueStartTime('');
  };

  const handleIssueSave = async () => {
    if (!issueDialogType) return;
    const omschrijving = issueDescription.trim();
    if (!omschrijving) return;
    const duur = issueDuration.trim() ? Number(issueDuration) : null;
    const [startHour, startMinute] = (issueStartTime || '00:00').split(':').map(Number);
    const issueStart = new Date();
    issueStart.setHours(Number.isFinite(startHour) ? startHour : 0, Number.isFinite(startMinute) ? startMinute : 0, 0, 0);
    const nextIssue: Storing = {
      soort: issueDialogType,
      omschrijving,
      duur: typeof duur === 'number' && Number.isFinite(duur) ? duur : null,
      start: issueStart,
      actief: true
    };
    await persistIssue(selectedLine, nextIssue);
    setNotifications(prev => [{
      id: Date.now(),
      type: 'info',
      icon: issueDialogType === 'storing' ? 'ERR' : 'INFO',
      titel: issueDialogType === 'storing' ? 'Storing actief' : 'Onderhoud actief',
      tekst: `${LINES[selectedLine].name}: ${omschrijving}`,
      lijn: selectedLine,
      orderNum: null,
      tijd: new Date(),
      gelezen: false
    }, ...prev]);
    closeIssueDialog();
  };

  const resolveActiveIssue = () => {
    if (!activeIssue) return;
    persistIssue(selectedLine, null);
    setNotifications(prev => [{
      id: Date.now(),
      type: 'info',
      icon: 'OK',
      titel: activeIssue.soort === 'storing' ? 'Storing afgesloten' : 'Onderhoud afgesloten',
      tekst: `${LINES[selectedLine].name}: ${activeIssue.omschrijving}`,
      lijn: selectedLine,
      orderNum: null,
      tijd: new Date(),
      gelezen: false
    }, ...prev]);
  };
  const canBunkerServeOrderComponent = (bunker: Bunker, component: Order['components'][number]) =>
    (bunker.ms && bunker.ms.some(m => canUseExistingMaterialForRequested(m, null, component.name, component.code))) ||
    (bunker.materialData && Object.entries(bunker.materialData).some(([mName, mData]) =>
      canUseExistingMaterialForRequested(mName, mData.code, component.name, component.code)
    ));

  const getComponentGroupKey = (component: Order['components'][number]) => {
    const normalizedName = String(component.name || '').trim().toLowerCase();
    const normalizedUnit = String(component.unit || '').trim().toUpperCase();
    return `${normalizedUnit}|${normalizedName}`;
  };

  const isBulkLikeOrderComponent = (component: Order['components'][number], bunkerScope: Bunker[] = lineBunkers) => {
    const unit = (component.unit || '').trim().toUpperCase();
    const isInBunkerUniverse = bunkerScope.some(b =>
      (b.m && canUseExistingMaterialForRequested(b.m, b.mc, component.name, component.code)) ||
      canBunkerServeOrderComponent(b, component)
    );
    return isInBunkerUniverse || unit === 'M3' || unit === 'PERC' || unit === '%' || unit === '';
  };

  const isBunkerEffectivelyEmpty = (bunker: Bunker) => {
    const material = String(bunker.m || '').trim().toLowerCase();
    return !material || material === 'leeg' || material === 'empty';
  };

  const getOrderBunkerAssignments = (order: Order, bunkerScope: Bunker[] = bunkers[order.line] || lineBunkers) => {
    const assignments = new Map<string, Bunker | null>();
    const usedBunkers = new Set<string>();
    const bulkComponents = order.components.filter(component => isBulkLikeOrderComponent(component, bunkerScope));
    const componentKey = (component: Order['components'][number]) => `${component.name}|${component.code}`;
    const isReservedForOtherComponent = (bunker: Bunker, component: Order['components'][number]) =>
      bulkComponents.some(otherComponent =>
        componentKey(otherComponent) !== componentKey(component) &&
        isBunkerExactMatchForComponent(bunker, otherComponent) &&
        !canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code)
      );

    bulkComponents.forEach(component => {
      const key = componentKey(component);
      const currentMatch = bunkerScope.find(b =>
        !usedBunkers.has(b.c) &&
        isBunkerExactMatchForComponent(b, component)
      );
      if (currentMatch) {
        assignments.set(key, currentMatch);
        usedBunkers.add(currentMatch.c);
        return;
      }
      const reusableAssignedBunker = Array.from(assignments.values()).find((bunker): bunker is Bunker =>
        !!bunker && canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code)
      );
      if (reusableAssignedBunker) {
        assignments.set(key, reusableAssignedBunker);
      }
    });

    bulkComponents.forEach(component => {
      const key = componentKey(component);
      if (assignments.has(key)) return;
      const reusableAssignedBunker = Array.from(assignments.values()).find((bunker): bunker is Bunker =>
        !!bunker && canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code)
      );
      if (reusableAssignedBunker) {
        assignments.set(key, reusableAssignedBunker);
        return;
      }
      const possibleMatch = bunkerScope
        .filter(b => !usedBunkers.has(b.c) && canBunkerServeOrderComponent(b, component) && !isReservedForOtherComponent(b, component))
        .sort((a, b) => {
          const emptyDiff = Number(isBunkerEffectivelyEmpty(b)) - Number(isBunkerEffectivelyEmpty(a));
          if (emptyDiff !== 0) return emptyDiff;
          return a.c.localeCompare(b.c);
        })[0];
      if (possibleMatch) {
        assignments.set(key, possibleMatch);
        usedBunkers.add(possibleMatch.c);
      } else {
        assignments.set(key, null);
      }
    });

    return { bulkComponents, assignments };
  };

  const isBunkerReadyForComponent = (bunker: Bunker | null | undefined, component: Order['components'][number]) => {
    if (!bunker) return false;
    const exactMatch =
      canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code);
    if (exactMatch) return true;
    return !!bunker.fx && canBunkerServeOrderComponent(bunker, component);
  };

  const isOrderDirectlyRunnable = (order: Order, bunkerScope: Bunker[] = bunkers[order.line] || lineBunkers) => {
    const { bulkComponents, assignments } = getOrderBunkerAssignments(order, bunkerScope);
    return bulkComponents.every(component => isBunkerReadyForComponent(assignments.get(`${component.name}|${component.code}`), component));
  };

  const getOrderBunkerPrepReason = (order: Order, bunkerScope: Bunker[] = bunkers[order.line] || lineBunkers) => {
    const { bulkComponents, assignments } = getOrderBunkerAssignments(order, bunkerScope);
    const firstMismatch = bulkComponents.find(component => {
      const bunker = assignments.get(`${component.name}|${component.code}`);
      return !isBunkerReadyForComponent(bunker, component);
    });

    if (!firstMismatch) return null;

    const bunker = assignments.get(`${firstMismatch.name}|${firstMismatch.code}`);
    if (!bunker) return `Geen bunker voor ${firstMismatch.name}`;
    return `${bunker.c} -> ${firstMismatch.name}`;
  };

  const getLineMoveBlockers = (order: Order, targetLine: LineId) => {
    const sourceBunkers = bunkers[order.line] || [];
    const targetBunkers = bunkers[targetLine] || [];
    const blockers = new Map<string, Order['components'][number]>();

    order.components
      .filter(component => {
        const unit = (component.unit || '').trim().toUpperCase();
        return (
          unit === 'M3' ||
          unit === 'PERC' ||
          unit === '%' ||
          unit === '' ||
          isBulkLikeOrderComponent(component, sourceBunkers) ||
          isBulkLikeOrderComponent(component, targetBunkers)
        );
      })
      .forEach(component => {
        const canRunOnTarget = targetBunkers.some(bunker =>
          isBunkerReadyForComponent(bunker, component) || canBunkerServeOrderComponent(bunker, component)
        );
        if (!canRunOnTarget) {
          blockers.set(`${component.name}|${component.code}`, component);
        }
      });

    return Array.from(blockers.values());
  };

  const handleMoveOrderToLine = async (orderId: number, targetLine: LineId) => {
    const target = orders.find(order => order.id === orderId);
    if (!target || target.line === targetLine) return;
    if (target.status === 'running' || target.status === 'completed') {
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'LOCK',
        titel: 'Verplaatsen niet mogelijk',
        tekst: 'Een running of voltooide order kan niet naar een andere lijn.',
        lijn: target.line,
        orderNum: target.num,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      return;
    }

    const blockers = getLineMoveBlockers(target, targetLine);
    if (blockers.length > 0) {
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'WARN',
        titel: `ML${targetLine} mist kalibratie`,
        tekst: blockers.map(component => `${component.name}${component.code ? ` (${component.code})` : ''}`).join(', '),
        lijn: target.line,
        orderNum: target.num,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
      return;
    }

    const updatedOrder: Order = { ...target, line: targetLine };
    const nextOrders = orders.map(order => order.id === orderId ? updatedOrder : order);
    const basePlan: Record<LineId, number[]> = plannedOrderIdsByLine || {
      1: lineOrdersByLine[1].map(order => order.id),
      2: lineOrdersByLine[2].map(order => order.id),
      3: lineOrdersByLine[3].map(order => order.id)
    };
    const nextPlan: Record<LineId, number[]> = {
      1: basePlan[1].filter(id => id !== orderId),
      2: basePlan[2].filter(id => id !== orderId),
      3: basePlan[3].filter(id => id !== orderId)
    };
    nextPlan[targetLine] = [...nextPlan[targetLine], orderId];

    setOrders(nextOrders);
    setPlannedOrderIdsByLine(nextPlan);
    setSelectedOrderForDetail(prev => prev?.id === orderId ? updatedOrder : prev);

    try {
      if (isSupabaseConfigured()) {
        await writeOrdersToSupabase([updatedOrder]);
        await writePlannedOrderIdsToSupabase(nextPlan);
      }
      setNotifications(prev => [{
        id: Date.now(),
        type: 'ok',
        icon: 'OK',
        titel: 'Order verplaatst',
        tekst: `${target.customer} naar ML${targetLine}.`,
        lijn: targetLine,
        orderNum: target.num,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Opslaan naar Supabase mislukt';
      setNotifications(prev => [{
        id: Date.now(),
        type: 'fout',
        icon: 'ERR',
        titel: 'Order verplaatsen sync mislukt',
        tekst: errorMsg,
        lijn: targetLine,
        orderNum: target.num,
        tijd: new Date(),
        gelezen: false
      }, ...prev]);
    }
  };

  const getOperatorOrderState = (
    order: Order,
    index: number,
    nowMinutes: number
  ): { label: string; cls: string; reason: string; key: 'direct' | 'prep' | 'wait' } => {
    const lineIssue = storingen[order.line];
    const nowOperationalMinutes = nowMinutes - (5 * 60);
    const normalizedEta = getOrderLoadReferenceTime(order);
    const etaMinutes = etaToMins(normalizedEta);
    const pkg = normalizePkg(order.pkg);
    const missingBulkLoadTime = bulkRequiresLoadTime && pkg === 'bulk' && !order.holdLoadTime && !normalizedEta;
    const waitsForBulk = pkg === 'bulk' && !order.holdLoadTime && etaMinutes !== null && nowOperationalMinutes < etaMinutes - 30;
    const waitsForHeldLoadTime = order.status === 'arrived' && !!order.holdLoadTime && etaMinutes !== null && nowOperationalMinutes < etaMinutes;
    const orderLineBunkers = bunkers[order.line] || lineBunkers;
    const needsRecipeBunkerPrep = !isOrderDirectlyRunnable(order, orderLineBunkers);
    const needsCleaning = index === 0 && hasProlineCleaningTrigger(order);
    const bunkerPrepReason = getOrderBunkerPrepReason(order, orderLineBunkers);
    const needsPrep = needsRecipeBunkerPrep;

    if (lineIssue?.actief) {
      const expectedUntil = getIssueExpectedUntilTime(lineIssue);
      return {
        label: 'Wachten',
        cls: lineIssue.soort === 'storing' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700',
        reason: expectedUntil
          ? `Wacht op ${lineIssue.soort === 'storing' ? 'storing' : 'onderhoud'} tot ${expectedUntil}`
          : `Wacht op ${lineIssue.soort === 'storing' ? 'storing' : 'onderhoud'}`,
        key: 'wait'
      };
    }
    if (waitsForHeldLoadTime) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: `Wacht tot laadtijd ${normalizedEta}`, key: 'wait' };
    }
    if (needsPrep) {
      return {
        label: 'Voorbereiden',
        cls: 'bg-orange-100 text-orange-700',
        reason: bunkerPrepReason ? `Bunker ${bunkerPrepReason}` : 'Bunkerwissel nodig',
        key: 'prep'
      };
    }
    if (missingBulkLoadTime) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: 'Wacht op laadtijd', key: 'wait' };
    }
    if (waitsForBulk) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: `Bulk ${normalizedEta}`, key: 'wait' };
    }
    if (needsCleaning) {
      return { label: 'Direct', cls: 'bg-green-100 text-green-700', reason: 'Proline reinigingsactie', key: 'direct' };
    }
    return { label: 'Direct', cls: 'bg-green-100 text-green-700', reason: 'Direct startbaar', key: 'direct' };
  };

  const getPlannerOrderState = (
    order: Order,
    index: number,
    lineEntries: ScheduledLineEntry[],
    nowMinutes: number
  ): { label: string; cls: string; reason: string; key: 'direct' | 'prep' | 'wait' } => {
    const lineIssue = storingen[order.line];
    const nowOperationalMinutes = nowMinutes - (5 * 60);
    const normalizedEta = getOrderLoadReferenceTime(order);
    const etaMinutes = etaToMins(normalizedEta);
    const pkg = normalizePkg(order.pkg);
    const missingBulkLoadTime = bulkRequiresLoadTime && pkg === 'bulk' && !order.holdLoadTime && !normalizedEta;
    const waitsForBulk = pkg === 'bulk' && !order.holdLoadTime && etaMinutes !== null && nowOperationalMinutes < etaMinutes - 30;
    const waitsForHeldLoadTime = order.status === 'arrived' && !!order.holdLoadTime && etaMinutes !== null && nowOperationalMinutes < etaMinutes;
    const orderLineBunkers = bunkers[order.line] || lineBunkers;
    const needsRecipeBunkerPrep = !isOrderDirectlyRunnable(order, orderLineBunkers);
    const bunkerPrepReason = getOrderBunkerPrepReason(order, orderLineBunkers);
    const needsCleaning = index === 0 && hasProlineCleaningTrigger(order);

    if (lineIssue?.actief) {
      const expectedUntil = getIssueExpectedUntilTime(lineIssue);
      return {
        label: 'Wachten',
        cls: lineIssue.soort === 'storing' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700',
        reason: expectedUntil
          ? `Wacht op ${lineIssue.soort === 'storing' ? 'storing' : 'onderhoud'} tot ${expectedUntil}`
          : `Wacht op ${lineIssue.soort === 'storing' ? 'storing' : 'onderhoud'}`,
        key: 'wait'
      };
    }
    if (waitsForHeldLoadTime) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: `Wacht tot laadtijd ${normalizedEta}`, key: 'wait' };
    }
    if (needsRecipeBunkerPrep) {
      return {
        label: 'Voorbereiden',
        cls: 'bg-orange-100 text-orange-700',
        reason: bunkerPrepReason ? `Bunker ${bunkerPrepReason}` : 'Bunkerwissel nodig',
        key: 'prep'
      };
    }
    if (missingBulkLoadTime) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: 'Wacht op laadtijd', key: 'wait' };
    }
    if (waitsForBulk) {
      return { label: 'Wachten', cls: 'bg-blue-100 text-blue-700', reason: `Bulk ${normalizedEta}`, key: 'wait' };
    }
    if (needsCleaning) {
      return { label: 'Direct', cls: 'bg-green-100 text-green-700', reason: 'Proline reinigingsactie', key: 'direct' };
    }
    return { label: 'Direct', cls: 'bg-green-100 text-green-700', reason: 'Direct startbaar', key: 'direct' };
  };

  const getPlannerDisplayEntries = useCallback((lineEntries: ScheduledLineEntry[]) => {
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    const prioritizedEntries = lineEntries
      .filter(entry => entry.order.status === 'planned' || entry.order.status === 'arrived')
      .map((entry, index) => ({
        ...entry,
        originalIndex: index,
        plannerState: getPlannerOrderState(entry.order, index, lineEntries, nowMinutes)
      }));
    if (prioritizedEntries.length === 0) return [];

    const lid = prioritizedEntries[0].order.line;
    const orderedOrders = prioritizedEntries.map(entry => entry.order);
    const starts = getScheduledStartsForLine(orderedOrders, lid);
    let cursorEnd: Date | null = null;

    return prioritizedEntries.map((entry, index) => {
      const order = entry.order;
      const prevOrder = index > 0 ? orderedOrders[index - 1] : null;
      const scheduledStart = starts[index] || starts[0] || currentTime;
      const swMats = index > 0 ? getSwitchMaterials(prevOrder, order, bunkers[lid]) : [];
      const sw = swMats.length;
      const duration = rt(order, LINES[lid].speed);
      const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
      let startTime = cursorEnd ? new Date(cursorEnd) : scheduledStart;
      let prodStart = new Date(startTime.getTime() + transitionMinutes * 60000);
      const heldLoadDateTime = getHeldLoadDateTime(order, prodStart);
      if (heldLoadDateTime && prodStart.getTime() < heldLoadDateTime.getTime()) {
        const shiftMs = heldLoadDateTime.getTime() - prodStart.getTime();
        startTime = new Date(startTime.getTime() + shiftMs);
        prodStart = new Date(prodStart.getTime() + shiftMs);
      }
      const endTime = new Date(prodStart.getTime() + duration * 60000);
      cursorEnd = endTime;

      return {
        ...entry,
        startTime,
        prodStart,
        endTime,
        swMats,
        sw,
        duration,
        plannerState: getPlannerOrderState(order, index, prioritizedEntries as unknown as ScheduledLineEntry[], nowMinutes)
      };
    });
  }, [currentTime, storingen, bunkers, selectedLine, getScheduledStartsForLine, getTransitionMinutes]);

  const plannerDisplayEntriesByLine = useMemo(() => ({
    1: getPlannerDisplayEntries(lineTimelineByLine[1]),
    2: getPlannerDisplayEntries(lineTimelineByLine[2]),
    3: getPlannerDisplayEntries(lineTimelineByLine[3])
  }), [lineTimelineByLine, getPlannerDisplayEntries]);

  const plannerVisibleDates = useMemo(() => {
    const allDates = lineIds
      .flatMap(lid => plannerDisplayEntriesByLine[lid].map(entry => formatLocalDate(entry.prodStart)))
      .filter(Boolean);
    return Array.from(new Set(allDates))
      .sort()
      .map(value => parseLocalDate(value))
      .filter(Boolean) as Date[];
  }, [lineIds, plannerDisplayEntriesByLine]);

  const plannerWeekDates = useMemo(() => {
    const anchor = plannerVisibleDates[0] || currentTime;
    return getPlanningDateRange(anchor, plannerVisibleDates);
  }, [plannerVisibleDates, currentTime]);

  useEffect(() => {
    const hasSelectedDate = plannerVisibleDates.some(date => formatLocalDate(date) === plannerSelectedDate);
    if (!hasSelectedDate) {
      const nextVisibleDate = plannerVisibleDates[0] ? formatLocalDate(plannerVisibleDates[0]) : formatLocalDate(currentTime);
      setPlannerSelectedDate(nextVisibleDate);
    }
  }, [plannerVisibleDates, plannerSelectedDate, currentTime]);

  const filteredPlannerDisplayEntriesByLine = useMemo(() => {
    const isVisibleOnSelectedDate = (entry: ScheduledLineEntry) => {
      const runningStart = getRunningOrderStart(entry.order);
      return formatLocalDate(runningStart || entry.prodStart) === plannerSelectedDate;
    };
    return {
      1: plannerDisplayEntriesByLine[1].filter(isVisibleOnSelectedDate),
      2: plannerDisplayEntriesByLine[2].filter(isVisibleOnSelectedDate),
      3: plannerDisplayEntriesByLine[3].filter(isVisibleOnSelectedDate)
    };
  }, [plannerDisplayEntriesByLine, plannerSelectedDate]);

  const plannerDisplayIndexByLine = useMemo(() => ({
    1: new Map(filteredPlannerDisplayEntriesByLine[1].map((entry, index) => [entry.order.id, index])),
    2: new Map(filteredPlannerDisplayEntriesByLine[2].map((entry, index) => [entry.order.id, index])),
    3: new Map(filteredPlannerDisplayEntriesByLine[3].map((entry, index) => [entry.order.id, index]))
  }), [filteredPlannerDisplayEntriesByLine]);

  const dayRosterStartMinutes = 5 * 60 + 15;
  const dayRosterEndMinutes = 23 * 60;
  const dayRosterSlotMinutes = 15;
  const dayRosterRowHeight = 42;
  const dayRosterSlotCount = Math.floor((dayRosterEndMinutes - dayRosterStartMinutes) / dayRosterSlotMinutes) + 1;
  const dayRosterTimeSlots = useMemo(
    () => Array.from({ length: dayRosterSlotCount }, (_, index) => dayRosterStartMinutes + index * dayRosterSlotMinutes),
    [dayRosterSlotCount]
  );

  const dayRosterEntries = useMemo(() => {
    const search = plannerSearch.trim().toLowerCase();
    return lineIds
      .filter(lid => plannerLineFilter === 0 || lid === plannerLineFilter)
      .flatMap(lid =>
        filteredPlannerDisplayEntriesByLine[lid]
          .filter(entry => {
            if (!search) return true;
            const o = entry.order;
            return (
              o.customer.toLowerCase().includes(search) ||
              o.num.includes(search) ||
              o.recipe.toLowerCase().includes(search) ||
              String(o.driver || '').toLowerCase().includes(search) ||
              String(o.rit || '').toLowerCase().includes(search)
            );
          })
          .map(entry => {
            const productionStartMinutes = entry.prodStart.getHours() * 60 + entry.prodStart.getMinutes();
            const productionEndMinutes = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
            const productionDurationMinutes = Math.max(dayRosterSlotMinutes, productionEndMinutes - productionStartMinutes);
            const loadReferenceTime = getOrderLoadReferenceTime(entry.order);
            const loadReferenceMinutes = loadReferenceTime ? timeStringToMinutes(loadReferenceTime, productionStartMinutes) : null;
            const rawStartMinutes = loadReferenceMinutes ?? productionStartMinutes;
            const startMinutes = Math.min(
              Math.max(rawStartMinutes, dayRosterStartMinutes),
              dayRosterEndMinutes
            );
            const endMinutes = Math.min(
              Math.max(startMinutes + dayRosterSlotMinutes, startMinutes + productionDurationMinutes),
              dayRosterEndMinutes + dayRosterSlotMinutes
            );
            const driverName = String(entry.order.driver || '').trim();
            const columnKey = driverName ? `driver:${driverName}` : 'unassigned';
            const columnLabel = driverName ? driverName : 'Ongekoppeld';
            return {
              ...entry,
              startMinutes,
              endMinutes,
              columnKey,
              columnLabel,
              isUnassigned: !driverName
            };
          })
      )
      .sort((a, b) => {
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        if (a.order.line !== b.order.line) return a.order.line - b.order.line;
        return a.order.customer.localeCompare(b.order.customer, 'nl-NL');
      });
  }, [filteredPlannerDisplayEntriesByLine, lineIds, plannerLineFilter, plannerSearch]);

  const dayRosterColumns = useMemo(() => {
    const assignedDrivers = Array.from(new Set(
      dayRosterEntries
        .map(entry => String(entry.order.driver || '').trim())
        .filter(Boolean)
    ));
    const preferredDrivers = Array.from(new Set(
      [...dayRosterBaseDrivers, ...assignedDrivers]
        .map(name => String(name || '').trim())
        .filter(Boolean)
    ));
    const columnMap = new Map<string, { key: string; label: string; isUnassigned: boolean; firstStart: number; line: LineId }>();

    preferredDrivers.forEach(driverName => {
      const firstEntry = dayRosterEntries.find(entry => entry.columnKey === `driver:${driverName}`);
      columnMap.set(`driver:${driverName}`, {
        key: `driver:${driverName}`,
        label: driverName,
        isUnassigned: false,
        firstStart: firstEntry?.startMinutes ?? 9999,
        line: firstEntry?.order.line ?? 1
      });
    });

    dayRosterEntries.forEach(entry => {
      const existing = columnMap.get(entry.columnKey);
      if (!existing) {
        columnMap.set(entry.columnKey, {
          key: entry.columnKey,
          label: entry.columnLabel,
          isUnassigned: entry.isUnassigned,
          firstStart: entry.startMinutes,
          line: entry.order.line
        });
      } else if (entry.startMinutes < existing.firstStart) {
        existing.firstStart = entry.startMinutes;
      }
    });
    return Array.from(columnMap.values()).sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return Number(a.isUnassigned) - Number(b.isUnassigned);
      const aDefaultIndex = dayRosterBaseDrivers.findIndex(name => name === a.label);
      const bDefaultIndex = dayRosterBaseDrivers.findIndex(name => name === b.label);
      if (aDefaultIndex !== -1 || bDefaultIndex !== -1) {
        if (aDefaultIndex === -1) return 1;
        if (bDefaultIndex === -1) return -1;
        if (aDefaultIndex !== bDefaultIndex) return aDefaultIndex - bDefaultIndex;
      }
      if (a.firstStart !== b.firstStart) return a.firstStart - b.firstStart;
      if (a.line !== b.line) return a.line - b.line;
      return a.label.localeCompare(b.label, 'nl-NL');
    });
  }, [dayRosterBaseDrivers, dayRosterEntries]);

  const dayRosterOrdersPerColumn = useMemo(() => {
    const map = new Map<string, typeof dayRosterEntries>();
    dayRosterColumns.forEach(column => {
      map.set(
        column.key,
        dayRosterEntries.filter(entry => entry.columnKey === column.key)
      );
    });
    return map;
  }, [dayRosterColumns, dayRosterEntries]);

  const dayRosterDriverColumns = useMemo(
    () => dayRosterColumns.filter(column => !column.isUnassigned),
    [dayRosterColumns]
  );

  const dayRosterUnassignedEntries = useMemo(
    () => dayRosterEntries.filter(entry => entry.isUnassigned),
    [dayRosterEntries]
  );

  const visiblePlannerTriggers = activePlannerTriggerRows;

  const operatorDisplayEntries = useMemo(() => {
      const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  
      const prioritizedEntries = plannedEntries
        .map((entry, index) => ({
          ...entry,
          originalIndex: index,
          operatorState: getOperatorOrderState(entry.order, index, nowMinutes)
        }));
      if (prioritizedEntries.length === 0) return [];

      const lid = prioritizedEntries[0].order.line;
      const orderedOrders = prioritizedEntries.map(entry => entry.order);
      const starts = getScheduledStartsForLine(orderedOrders, lid);

      let cursorEnd: Date | null = null;
      if (!displayedCurrentOrder && prioritizedEntries.length > 0) {
        const firstOrder = prioritizedEntries[0].order;
        const firstPrevOrder = null;
        const firstStartTime = starts[0];
        const firstTransitionMinutes = getTransitionMinutes(lid, firstPrevOrder, firstOrder);
        const firstBaseProdStart = new Date(firstStartTime.getTime() + firstTransitionMinutes * 60000);
        const nowTime = currentTime.getTime();
        if (firstBaseProdStart.getTime() < nowTime) {
          cursorEnd = new Date(nowTime - firstTransitionMinutes * 60000);
        }
      }
      return prioritizedEntries.map((entry, index) => {
        const order = entry.order;
        const prevOrder = index > 0 ? orderedOrders[index - 1] : null;
        const scheduledStart = starts[index] || starts[0] || currentTime;
        const swMats = index > 0 ? getSwitchMaterials(prevOrder, order, bunkers[lid]) : [];
        const sw = swMats.length;
        const duration = rt(order, LINES[lid].speed);
        const transitionMinutes = getTransitionMinutes(lid, prevOrder, order);
        let startTime = cursorEnd ? new Date(cursorEnd) : new Date(scheduledStart.getTime() + operatorRuntimeShiftMs);
        let prodStart = new Date(startTime.getTime() + transitionMinutes * 60000);
        if (index === 0 && displayedCurrentOrder?.status === 'running' && displayedCurrentActualEnd && prodStart.getTime() < displayedCurrentActualEnd.getTime()) {
          prodStart = new Date(displayedCurrentActualEnd);
          startTime = new Date(prodStart.getTime() - transitionMinutes * 60000);
        }
        const heldLoadDateTime = getHeldLoadDateTime(order, prodStart);
        if (heldLoadDateTime && prodStart.getTime() < heldLoadDateTime.getTime()) {
          const shiftMs = heldLoadDateTime.getTime() - prodStart.getTime();
          startTime = new Date(startTime.getTime() + shiftMs);
          prodStart = new Date(prodStart.getTime() + shiftMs);
        }
        const endTime = new Date(prodStart.getTime() + duration * 60000);
        cursorEnd = endTime;
        let operatorState = getOperatorOrderState(order, index, nowMinutes);
        const loadDateTime = getOrderLoadReferenceDateTime(order, prodStart);
        if (
          operatorState.key === 'direct' &&
          normalizePkg(order.pkg) === 'bulk' &&
          loadDateTime &&
          currentTime.getTime() < loadDateTime.getTime()
        ) {
          operatorState = {
            label: 'Wachten',
            cls: 'bg-blue-100 text-blue-700',
            reason: `Wacht tot laadtijd ${fmt(loadDateTime)}`,
            key: 'wait'
          };
        }

        return {
          ...entry,
          startTime,
          prodStart,
          endTime,
          swMats,
          sw,
          duration,
          operatorState
        };
      });
    }, [plannedEntries, currentTime, storingen, bunkers, selectedLine, getScheduledStartsForLine, getTransitionMinutes, operatorRuntimeShiftMs, displayedCurrentOrder, displayedCurrentActualEnd]);

  const nextOperatorOrder = useMemo(
    () => operatorDisplayEntries[0]?.order || null,
    [operatorDisplayEntries]
  );

  const nextNeedsProlineCleaning = useMemo(
    () => hasProlineCleaningTrigger(nextOperatorOrder),
    [nextOperatorOrder]
  );

  const nextOrderBunkerSwitches = useMemo(() => {
    const upcomingOrders = operatorDisplayEntries.slice(0, 2).map(entry => entry.order);
    const nextOrder = upcomingOrders[0];
    if (!nextOrder) return [];
    const { assignments } = getOrderBunkerAssignments(nextOrder, lineBunkers);

    const switches: Array<{ name: string; code: string; bunker: string; supportCount: number; urgency: 'nu' | 'straks' }> = [];

    nextOrder.components.forEach(component => {
      if (!isBulkLikeOrderComponent(component, lineBunkers)) return;

      const alreadyLoaded = lineBunkers.some(b => isBunkerReadyForComponent(b, component));
      if (alreadyLoaded) return;

      const candidateBunkers = lineBunkers.filter(b => canBunkerServeOrderComponent(b, component));
      if (candidateBunkers.length === 0) return;

      const assignedBunker = assignments.get(`${component.name}|${component.code}`)?.c;
      if (assignedBunker) {
        let supportCount = 0;
        upcomingOrders.forEach(order => {
          order.components.forEach(orderComponent => {
            if (!isBulkLikeOrderComponent(orderComponent, lineBunkers)) return;
            const canServe = lineBunkers.find(b => b.c === assignedBunker);
            if (canServe && canBunkerServeOrderComponent(canServe, orderComponent)) supportCount += 1;
          });
        });
        switches.push({
          name: component.name,
          code: component.code,
          bunker: assignedBunker,
          supportCount,
          urgency: 'nu'
        });
        return;
      }

      const ranked = candidateBunkers
        .map(bunker => {
          let supportCount = 0;
          let nextOrderSupport = 0;
          upcomingOrders.forEach(order => {
            order.components.forEach(orderComponent => {
              if (!isBulkLikeOrderComponent(orderComponent, lineBunkers)) return;
              if (canBunkerServeOrderComponent(bunker, orderComponent)) {
                supportCount += 1;
                if (order.id === nextOrder.id) nextOrderSupport += 1;
              }
            });
          });
          if (bunker.me) supportCount -= 0.25;
          return { bunker: bunker.c, supportCount, nextOrderSupport };
        })
        .sort((a, b) => b.nextOrderSupport - a.nextOrderSupport || b.supportCount - a.supportCount || a.bunker.localeCompare(b.bunker));

      switches.push({
        name: component.name,
        code: component.code,
        bunker: ranked[0].bunker,
        supportCount: ranked[0].supportCount,
        urgency: ranked[0].nextOrderSupport > 0 ? 'nu' : 'straks'
      });
    });

    const seen = new Set<string>();
    return switches.filter(item => {
      const key = `${item.code}|${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === 'nu' ? -1 : 1;
      return b.supportCount - a.supportCount || a.name.localeCompare(b.name, 'nl-NL');
    });
  }, [operatorDisplayEntries, lineBunkers]);

  const nextOrderBunkerPlan = useMemo(() => {
    const grouped = new Map<string, Array<{ name: string; urgency: 'nu' | 'straks' }>>();
    nextOrderBunkerSwitches.forEach(item => {
      const list = grouped.get(item.bunker) || [];
      list.push({ name: item.name, urgency: item.urgency });
      grouped.set(item.bunker, list);
    });
    return Array.from(grouped.entries())
      .map(([bunker, items]) => ({
        bunker,
        items,
        nowCount: items.filter(item => item.urgency === 'nu').length,
        laterCount: items.filter(item => item.urgency === 'straks').length
      }))
      .sort((a, b) => b.nowCount - a.nowCount || b.laterCount - a.laterCount || a.bunker.localeCompare(b.bunker));
  }, [nextOrderBunkerSwitches]);

  const operatorExecutionCards = useMemo(() => {
    return operatorDisplayEntries.slice(0, 3).map((entry) => {
      const order = entry.order;
      const operatorState = entry.operatorState;

      return {
        id: order.id,
        customer: order.customer,
        schedule: formatOperatorDateTimeRange(entry.prodStart, entry.endTime, currentTime),
        status: operatorState.key,
        reason: operatorState.reason,
        volume: ev(order).toFixed(1),
        pkg: order.pkg.toUpperCase(),
        pkgLabel: getPkgLabel(order),
        pkgBadgeClass: getPkgBadgeClass(order),
        factor: getOrderVolumeFactor(order).toFixed(2),
        isBulk: order.pkg.toLowerCase() === 'bulk'
      };
    });
  }, [operatorDisplayEntries, currentTime]);

  const totalCompletedM3 = useMemo(() => 
    completedOrders.reduce((sum, o) => sum + ev(o), 0), 
  [completedOrders]);

  const truckOrders = useMemo(() => {
    return activeOrders
      .filter(o => o.pkg === 'bulk')
      .slice()
      .sort((a, b) => {
        const etaA = etaToMins(normalizeEta(a.eta)) || 9999;
        const etaB = etaToMins(normalizeEta(b.eta)) || 9999;
        if (etaA !== etaB) return etaA - etaB;
        if (a.line !== b.line) return a.line - b.line;
        return a.customer.localeCompare(b.customer);
      });
  }, [activeOrders]);

  const plannerDrivers = useMemo(() => {
    const driverCounts = new Map<string, { count: number; lines: Set<LineId>; totalVolume: number; firstStart: number | null; lastEnd: number | null }>();
    plannedActiveOrders
      .filter(order => plannerLineFilter === 0 || order.line === plannerLineFilter)
      .forEach(order => {
      const name = String(order.driver || '').trim();
      if (!name) return;
      const timelineEntry = lineTimelineEntryByOrderId[order.line].get(order.id) || null;
      const startMinutes = timelineEntry ? (timelineEntry.prodStart.getHours() * 60 + timelineEntry.prodStart.getMinutes()) : null;
      const endMinutes = timelineEntry ? (timelineEntry.endTime.getHours() * 60 + timelineEntry.endTime.getMinutes()) : null;
      const existing = driverCounts.get(name) || { count: 0, lines: new Set<LineId>(), totalVolume: 0, firstStart: null, lastEnd: null };
      existing.count += 1;
      existing.lines.add(order.line);
      existing.totalVolume += ev(order);
      if (startMinutes !== null) {
        existing.firstStart = existing.firstStart === null ? startMinutes : Math.min(existing.firstStart, startMinutes);
      }
      if (endMinutes !== null) {
        existing.lastEnd = existing.lastEnd === null ? endMinutes : Math.max(existing.lastEnd, endMinutes);
      }
      driverCounts.set(name, existing);
    });
    const driverActiveMap = new Map(sharedDrivers.map(driver => [driver.name, driver.active]));
    const allDriverNames = Array.from(new Set([
      ...sharedDrivers.map(driver => driver.name),
      ...sharedDriverNames,
      ...Array.from(driverCounts.keys())
    ]));
    return allDriverNames
      .map(name => {
        const meta = driverCounts.get(name) || { count: 0, lines: new Set<LineId>(), totalVolume: 0, firstStart: null, lastEnd: null };
        return {
        name,
        count: meta.count,
        lines: Array.from(meta.lines).sort((a, b) => a - b),
        totalVolume: meta.totalVolume,
        firstStart: meta.firstStart,
        lastEnd: meta.lastEnd,
        active: driverActiveMap.get(name) ?? true
      };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nl-NL'));
  }, [plannedActiveOrders, plannerLineFilter, lineTimelineEntryByOrderId, sharedDriverNames, sharedDrivers]);

  const visiblePlannerDrivers = useMemo(() => {
    const q = chauffeurSearch.trim().toLowerCase();
    if (!q) return plannerDrivers;
    return plannerDrivers.filter(driver =>
      driver.name.toLowerCase().includes(q) ||
      driver.lines.some(line => `ml${line}`.includes(q))
    );
  }, [plannerDrivers, chauffeurSearch]);

  const chauffeurOrders = useMemo(() => {
    return plannedActiveOrders
      .filter(o => plannerLineFilter === 0 || o.line === plannerLineFilter)
      .filter(o => {
        if (chauffeurTypeFilter === 'bulk') return o.pkg === 'bulk';
        if (chauffeurTypeFilter === 'packed') return o.pkg !== 'bulk';
        return true;
      })
      .filter(o => {
        const s = plannerSearch.toLowerCase();
        return (
          !s ||
          o.customer.toLowerCase().includes(s) ||
          o.num.includes(s) ||
          (o.rit || '').includes(s) ||
          o.recipe.toLowerCase().includes(s) ||
          (o.driver || '').toLowerCase().includes(s)
        );
      });
  }, [plannedActiveOrders, plannerLineFilter, plannerSearch, chauffeurTypeFilter]);

  const selectedDriverOrders = useMemo(() => {
    return chauffeurOrders
      .filter(o => !!selectedDriverName && (o.driver || '').trim() === selectedDriverName)
      .slice()
      .sort((a, b) => {
        const etaA = etaToMins(normalizeEta(a.eta)) || 9999;
        const etaB = etaToMins(normalizeEta(b.eta)) || 9999;
        if (etaA !== etaB) return etaA - etaB;
        if (a.line !== b.line) return a.line - b.line;
        return a.customer.localeCompare(b.customer, 'nl-NL');
      });
  }, [chauffeurOrders, selectedDriverName]);

  const minsToTime = (minutes: number) => {
    const normalizedMinutes = Math.round(minutes);
    const hrs = Math.floor(normalizedMinutes / 60);
    const mins = normalizedMinutes % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const driverConflictOrderIds = useMemo(() => {
    const conflicts = new Set<number>();
    const timelinesByDriver = new Map<string, Array<{ id: number; start: number; end: number }>>();

    chauffeurOrders.forEach(order => {
      if (order.pkg !== 'bulk') return;
      const driverName = String(order.driver || '').trim();
      if (!driverName) return;
      const relevantLoadTime = order.status === 'arrived'
        ? normalizeEta(order.arrivedTime || order.eta)
        : normalizeEta(order.eta);
      const etaMinutes = relevantLoadTime ? timeStringToMinutes(relevantLoadTime, 0) : null;
      const runtimeMinutes = rt(order, LINES[order.line].speed) + config[order.line].empty;
      const entry = lineTimelineEntryByOrderId[order.line].get(order.id) || null;
      const start = etaMinutes !== null
        ? etaMinutes
        : entry
          ? entry.prodStart.getHours() * 60 + entry.prodStart.getMinutes()
          : 0;
      const end = etaMinutes !== null
        ? (etaMinutes + runtimeMinutes)
        : entry
          ? entry.endTime.getHours() * 60 + entry.endTime.getMinutes()
          : 0;
      if (!start || !end) return;
      const list = timelinesByDriver.get(driverName) || [];
      list.push({ id: order.id, start, end });
      timelinesByDriver.set(driverName, list);
    });

    timelinesByDriver.forEach(list => {
      const sorted = list.slice().sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (next.start < current.end) {
          conflicts.add(current.id);
          conflicts.add(next.id);
        }
      }
    });

    return conflicts;
  }, [chauffeurOrders, lineTimelineEntryByOrderId]);

  const orderedChauffeurOrders = useMemo(() => {
    return chauffeurOrders
      .slice()
      .filter(order => {
        if (chauffeurActionFilter === 'unassigned') return !String(order.driver || '').trim();
        if (chauffeurActionFilter === 'conflicts') return order.pkg === 'bulk' && driverConflictOrderIds.has(order.id);
        return true;
      })
      .sort((a, b) => {
        const aUnassigned = !String(a.driver || '').trim();
        const bUnassigned = !String(b.driver || '').trim();
        if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;

        const aConflict = a.pkg === 'bulk' && driverConflictOrderIds.has(a.id);
        const bConflict = b.pkg === 'bulk' && driverConflictOrderIds.has(b.id);
        if (aConflict !== bConflict) return aConflict ? -1 : 1;

        const aSelected = !!selectedDriverName && (a.driver || '').trim() === selectedDriverName;
        const bSelected = !!selectedDriverName && (b.driver || '').trim() === selectedDriverName;
        if (aSelected !== bSelected) return aSelected ? -1 : 1;

        const etaA = etaToMins(normalizeEta(a.eta)) || 9999;
        const etaB = etaToMins(normalizeEta(b.eta)) || 9999;
        if (etaA !== etaB) return etaA - etaB;

        if (a.line !== b.line) return a.line - b.line;
        return a.customer.localeCompare(b.customer, 'nl-NL');
      });
  }, [chauffeurOrders, chauffeurActionFilter, driverConflictOrderIds, selectedDriverName]);

  const visibleChauffeurOrders = useMemo(() => {
    if (!selectedDriverName) return orderedChauffeurOrders;
    return orderedChauffeurOrders.filter(order => (order.driver || '').trim() !== selectedDriverName);
  }, [orderedChauffeurOrders, selectedDriverName]);

  const chauffeurActionCounts = useMemo(() => {
    return {
      all: chauffeurOrders.length,
      unassigned: chauffeurOrders.filter(order => !String(order.driver || '').trim()).length,
      conflicts: chauffeurOrders.filter(order => order.pkg === 'bulk' && driverConflictOrderIds.has(order.id)).length
    };
  }, [chauffeurOrders, driverConflictOrderIds]);

  const visiblePlannerDriversSorted = useMemo(() => {
    return visiblePlannerDrivers
      .map(driver => {
        const conflictCount = chauffeurOrders.filter(order =>
          (order.driver || '').trim() === driver.name &&
          order.pkg === 'bulk' &&
          driverConflictOrderIds.has(order.id)
        ).length;
        return { ...driver, conflictCount };
      })
      .sort((a, b) => {
        if (a.conflictCount !== b.conflictCount) return b.conflictCount - a.conflictCount;
        if (a.count !== b.count) return b.count - a.count;
        return a.name.localeCompare(b.name, 'nl-NL');
      });
  }, [visiblePlannerDrivers, chauffeurOrders, driverConflictOrderIds]);

  const getChauffeurOrderReason = (order: Order) => {
    if (!String(order.driver || '').trim()) return 'Ongekoppeld';
    if (order.pkg === 'bulk' && driverConflictOrderIds.has(order.id)) return 'Conflict';
    if (selectedDriverName && (order.driver || '').trim() === selectedDriverName) return 'Geselecteerde chauffeur';
    return 'Gepland';
  };

  const getDriverOccupancyWindow = (order: Order) => {
    if (order.pkg !== 'bulk') return null;
    const relevantLoadTime = order.status === 'arrived'
      ? normalizeEta(order.arrivedTime || order.eta)
      : normalizeEta(order.eta);
    const etaMinutes = relevantLoadTime ? timeStringToMinutes(relevantLoadTime, 0) : null;
      const entry = lineTimelineEntryByOrderId[order.line].get(order.id) || null;
    const runtimeMinutes = rt(order, LINES[order.line].speed) + config[order.line].empty;
    const startMinutes = etaMinutes !== null
      ? etaMinutes
      : entry
        ? entry.prodStart.getHours() * 60 + entry.prodStart.getMinutes()
        : null;

    if (startMinutes === null) return null;

    return {
      start: startMinutes,
      end: startMinutes + runtimeMinutes
    };
  };

  useEffect(() => {
    if (!visiblePlannerDrivers.length) {
      setSelectedDriverName('');
      return;
    }
    if (selectedDriverName && !visiblePlannerDrivers.some(driver => driver.name === selectedDriverName)) {
      setSelectedDriverName(visiblePlannerDrivers[0].name);
    }
  }, [visiblePlannerDrivers, selectedDriverName]);

  const lineDebug = useMemo(() => {
    return {
      total: orders.length,
      active: activeOrders.length,
      ml1: activeOrders.filter(o => o.line === 1).length,
      ml2: activeOrders.filter(o => o.line === 2).length,
      ml3: activeOrders.filter(o => o.line === 3).length,
    };
  }, [orders, activeOrders]);

  const handleStartOrder = async (id: number) => {
    const target = orders.find(o => o.id === id);
    if (!target) return;
    const startedAt = new Date().toISOString();
    const updatedOrder: Order = { ...target, status: 'running', startedAt };
    const nextOrders = orders.map(o => o.id === id ? updatedOrder : o);
    await persistSingleOrder(updatedOrder, nextOrders, 'Start sync mislukt');
    setProgress(0);
  };

  const handleFinishOrder = async (id: number) => {
    const target = orders.find(o => o.id === id);
    if (!target) return;
    const updatedOrder: Order = {
      ...target,
      status: 'completed',
      arrived: false,
      arrivedTime: undefined,
      holdLoadTime: false
    };
    const nextOrders = orders.map(o => o.id === id ? updatedOrder : o);
    await persistSingleOrder(updatedOrder, nextOrders, 'Voltooid sync mislukt');
  };

  const handleAssignDriverToOrder = async (orderId: number, driverName: string) => {
    const trimmed = driverName.trim();
    if (!trimmed) return;

    const target = orders.find(order => order.id === orderId);
    if (!target) return;
    const rit = (target.rit || '').trim();
    const nextOrders = orders.map(order => {
      const sameRit = !!rit && (order.rit || '').trim() === rit;
      if (order.id === orderId || sameRit) {
        return { ...order, driver: trimmed };
      }
      return order;
    });
    await persistOrders(nextOrders, 'Chauffeur sync mislukt', target.line, target.num);
    setSelectedDriverName(trimmed);
    setDraggedDriverName('');
  };

  const handleClearDriverFromOrder = async (orderId: number) => {
    const target = orders.find(order => order.id === orderId);
    if (!target) return;
    const rit = (target.rit || '').trim();
    const nextOrders = orders.map(order => {
      const sameRit = !!rit && (order.rit || '').trim() === rit;
      if (order.id === orderId || sameRit) {
        return { ...order, driver: '' };
      }
      return order;
    });
    await persistOrders(nextOrders, 'Chauffeur sync mislukt', target.line, target.num);
  };

  const handleDayRosterDragStart = (e: React.DragEvent<HTMLElement>, orderId: number) => {
    e.dataTransfer.setData('text/plain', String(orderId));
    e.dataTransfer.setData('text/dayroster-order-id', String(orderId));
    e.dataTransfer.effectAllowed = 'move';

    const order = orders.find(o => o.id === orderId);
    const dragPreview = document.createElement('div');
    dragPreview.textContent = order
      ? `${order.customer} - ${normalizeEta(order.eta) || fmt(new Date())}`
      : 'Order verplaatsen';
    dragPreview.style.position = 'fixed';
    dragPreview.style.left = '-1000px';
    dragPreview.style.top = '-1000px';
    dragPreview.style.width = '220px';
    dragPreview.style.padding = '10px 12px';
    dragPreview.style.border = '1px solid #bbf7d0';
    dragPreview.style.borderRadius = '14px';
    dragPreview.style.background = '#f0fdf4';
    dragPreview.style.color = '#14532d';
    dragPreview.style.font = '700 13px system-ui, sans-serif';
    dragPreview.style.boxShadow = '0 14px 30px rgba(15, 23, 42, 0.18)';
    dragPreview.style.pointerEvents = 'none';
    document.body.appendChild(dragPreview);
    e.dataTransfer.setDragImage(dragPreview, 18, 18);
    window.setTimeout(() => dragPreview.remove(), 0);

    setDraggedDayRosterOrderId(orderId);
  };

  const handleDayRosterDragEnd = () => {
    setDraggedDayRosterOrderId(null);
  };

  const handleRestoreCompletedOrder = async (id: number) => {
    const target = orders.find(o => o.id === id && o.status === 'completed');
    if (!target) return;

    const updatedOrder: Order = {
      ...target,
      status: 'planned',
      rawStatus: target.rawStatus === 'closed' ? 'planned' : target.rawStatus,
      arrived: false,
      arrivedTime: undefined,
      startedAt: undefined,
      holdLoadTime: false
    };
    const nextOrders = orders.map(o => o.id === id ? updatedOrder : o);
    await persistSingleOrder(updatedOrder, nextOrders, 'Terugzetten naar gepland mislukt');
  };

  const handleClearCompletedOrders = () => {
    setOrders(prev => prev.filter(o => o.status !== 'completed'));
  };

  const handleResetArrived = async (id: number) => {
    const target = orders.find(o => o.id === id);
    if (!target) return;
    const updatedOrder: Order = {
      ...target,
      status: 'planned',
      arrived: false,
      arrivedTime: undefined,
      holdLoadTime: false
    };
    const nextOrders = orders.map(o =>
      o.id === id && o.status === 'arrived'
        ? updatedOrder
        : o
    );
    await persistSingleOrder(updatedOrder, nextOrders, 'Order sync mislukt');
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Top Bar */}
      <header className="h-[58px] bg-white border-b border-gray-200 flex items-center px-5 gap-0.5 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-2.5 mr-4.5 min-w-max">
          <div className="flex flex-col justify-center gap-px">
            <div className="text-[13px] font-bold text-gray-700 leading-tight">Klasmann-Deilmann</div>
            <div className="text-[11px] text-gray-500 font-medium leading-tight">Productie Planning</div>
          </div>
        </div>

        <nav className="flex items-center gap-0.5 min-w-0 flex-wrap">
          <button className={`nt ${view === 'operator' ? 'on' : ''}`} onClick={() => setView('operator')}>
            <LayoutDashboard size={16} /> Operator
          </button>
          <button className={`nt ${view === 'planner' ? 'on' : ''}`} onClick={() => setView('planner')}>
            <ClipboardList size={16} /> Planner
          </button>
          <button className={`nt ${view === 'bunkers' ? 'on' : ''}`} onClick={() => setView('bunkers')}>
            <Database size={16} /> Bunkers
          </button>
          <button className={`nt ${view === 'settings' ? 'on' : ''}`} onClick={() => setView('settings')}>
            <Settings size={16} /> Instellingen
          </button>
          <button className={`nt ${view === 'notifications' ? 'on' : ''}`} onClick={() => setView('notifications')}>
            <Bell size={16} /> 
            {notifications.filter(m => !m.gelezen).length > 0 && (
              <span className="inline-flex items-center justify-center bg-red-500 text-white rounded-full w-4 h-4 text-[10px] font-bold ml-1">
                {notifications.filter(m => !m.gelezen).length}
              </span>
            )}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border border-gray-200 rounded-full bg-gray-50">
            <div className="text-[11px] text-gray-400 uppercase tracking-wider">Gedraaid</div>
            <div className="text-[13px] font-bold text-grd">{totalCompletedM3.toFixed(1)} m3</div>
          </div>
          <div className="text-xs text-gray-500 tabular-nums font-medium">
            {currentTime.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-7 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'operator' && (
              <div className="max-w-6xl mx-auto">
                {activeIssueEntries.length > 0 && (
                  <div className="space-y-3 mb-5">
                    {activeIssueEntries.map(({ line, issue }) => (
                      <div
                        key={`${line}-${issue.soort}-${issue.start.getTime()}`}
                        className={`rounded-2xl border px-5 py-4 ${
                          issue.soort === 'storing'
                            ? 'border-red-200 bg-red-50/55'
                            : 'border-blue-200 bg-blue-50/55'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-4">
                              <div className={`h-6 w-6 rounded-full shadow-sm ${
                                issue.soort === 'storing'
                                  ? 'bg-gradient-to-br from-red-300 to-red-600 shadow-red-200'
                                  : 'bg-gradient-to-br from-blue-300 to-blue-600 shadow-blue-200'
                              }`}></div>
                              <div className={`text-[15px] font-extrabold uppercase tracking-tight ${
                                issue.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                              }`}>
                                {issue.soort === 'storing' ? 'Storing' : 'Onderhoud'} - {LINES[line].name}
                              </div>
                            </div>
                            <div className={`mt-2 text-xl font-semibold leading-tight ${
                              issue.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                            }`}>
                              {issue.omschrijving}
                            </div>
                            <div className={`mt-2 flex flex-wrap gap-5 text-xs ${
                              issue.soort === 'storing' ? 'text-red-800' : 'text-blue-800'
                            }`}>
                              <div>Gestart: {issue.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</div>
                              <div>Duur tot nu: {Math.max(1, Math.round((currentTime.getTime() - issue.start.getTime()) / 60000))} min</div>
                              {getIssueExpectedEndLabel(issue) && <div>{getIssueExpectedEndLabel(issue)}</div>}
                              {getIssueRemainingMinutesLabel(issue) && <div>{getIssueRemainingMinutesLabel(issue)}</div>}
                              <div>Raakt {getIssueAffectedOrderCount(line)} komende orders</div>
                              {getIssueFirstAffectedOrderLabel(line) && <div>{getIssueFirstAffectedOrderLabel(line)}</div>}
                              {getIssueLastAffectedOrderLabel(line) && <div>{getIssueLastAffectedOrderLabel(line)}</div>}
                              {getIssueAffectedVolumeLabel(line) && <div>{getIssueAffectedVolumeLabel(line)}</div>}
                            </div>
                            {getIssueAffectedOrdersPreview(line).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {getIssueAffectedOrdersPreview(line).map(order => (
                                  <button
                                    key={order.id}
                                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                                      issue.soort === 'storing'
                                        ? 'border-red-200 bg-white/80 text-red-800 hover:bg-red-100'
                                        : 'border-blue-200 bg-white/80 text-blue-800 hover:bg-blue-100'
                                    }`}
                                    onClick={() => setSelectedOrderForDetail(order)}
                                  >
                                    {order.num}
                                  </button>
                                ))}
                                {getIssueAffectedOrderCount(line) > getIssueAffectedOrdersPreview(line).length && (
                                  <span className={`px-1 py-1 text-xs ${
                                    issue.soort === 'storing' ? 'text-red-700' : 'text-blue-700'
                                  }`}>
                                    ...
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-3">
                            <button
                              className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                                issue.soort === 'storing'
                                  ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                                  : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                              }`}
                              onClick={() => editIssue(line, issue)}
                            >
                              Bewerken
                            </button>
                            <button
                              className="rounded-xl border border-green-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-green-50"
                              onClick={() => {
                                if (selectedLine !== line) setSelectedLine(line);
                                persistIssue(line, null);
                                setNotifications(prev => [{
                                  id: Date.now(),
                                  type: 'info',
                                  icon: 'OK',
                                  titel: issue.soort === 'storing' ? 'Storing afgesloten' : 'Onderhoud afgesloten',
                                  tekst: `${LINES[line].name}: ${issue.omschrijving}`,
                                  lijn: line,
                                  orderNum: null,
                                  tijd: new Date(),
                                  gelezen: false
                                }, ...prev]);
                              }}
                            >
                              Opgelost
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mb-4.5">
                  <h1 className="text-xl font-bold">Operator Dashboard</h1>
                  <div className="flex gap-2">
                    <button
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        setView('planner');
                        setPlannerTab('wachtrij');
                      }}
                    >
                      Order wachtrij
                    </button>
                    <button
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                        activeIssue?.soort === 'storing'
                          ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                          : 'border-orange-200 bg-orange-50/70 text-orange-700 hover:bg-orange-100'
                      }`}
                      onClick={() => activeIssue?.soort === 'storing' ? resolveActiveIssue() : openIssueDialog('storing')}
                    >
                      <AlertTriangle size={14} /> {activeIssue?.soort === 'storing' ? 'Storing afsluiten' : 'Storing'}
                    </button>
                    <button
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                        activeIssue?.soort === 'onderhoud'
                          ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                          : 'border-blue-200 bg-blue-50/70 text-blue-700 hover:bg-blue-100'
                      }`}
                      onClick={() => activeIssue?.soort === 'onderhoud' ? resolveActiveIssue() : openIssueDialog('onderhoud')}
                    >
                      <Wrench size={14} /> {activeIssue?.soort === 'onderhoud' ? 'Onderhoud afsluiten' : 'Onderhoud'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-1.5 mb-4.5">
                  {(Object.keys(LINES) as unknown as LineId[]).map(l => {
                    const count = activeOrders.filter(o => o.line === l).length;
                    const hasIssue = !!storingen[l]?.actief;
                    return (
                      <button 
                        key={l}
                        className={`ltab flex items-center gap-2 ${selectedLine === l ? 'on' : ''}`}
                        onClick={() => setSelectedLine(l)}
                      >
                        {hasIssue && (
                          <span className={`inline-block h-2 w-2 rounded-full ${
                            storingen[l]?.soort === 'storing' ? 'bg-red-500' : 'bg-blue-500'
                          }`}></span>
                        )}
                        <span>{LINES[l].name}</span>
                        {count > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${selectedLine === l ? 'bg-white text-gr' : 'bg-gray-100 text-gray-500'}`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {dataSource.error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span><b>Sync Fout:</b> {dataSource.error}</span>
                  </div>
                )}

                {operatorLeegBunkers.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg mb-4">
                    <div className="text-sm font-bold mb-1">Bunker leegdraaien</div>
                    <div className="text-sm">
                      {operatorLeegBunkers.map(b => `${b.c}${b.m ? ` (${b.m})` : ''}`).join(', ')}
                    </div>
                    <div className="text-xs text-amber-700 mt-1">
                      Deze bunker{operatorLeegBunkers.length > 1 ? 's moeten' : ' moet'} na de actieve order leeggedraaid worden.
                    </div>
                  </div>
                )}

                {currentNeedsProlineCleaning && (
                  <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg mb-4">
                    <div className="text-sm font-bold mb-1">Proline reinigingsactie</div>
                    <div className="text-sm">
                      Huidige order vraagt een Proline reinigingsactie: <span className="font-semibold">{displayedCurrentOrder?.customer}</span>
                    </div>
                  </div>
                )}

                {nextNeedsProlineCleaning && (
                  <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg mb-4">
                    <div className="text-sm font-bold mb-1">Proline reinigingsactie voorbereiden</div>
                    <div className="text-sm">
                      Volgende order vraagt een Proline reinigingsactie: <span className="font-semibold">{nextOperatorOrder?.customer}</span>
                    </div>
                  </div>
                )}

                {nextOrderBunkerSwitches.length > 0 && (
                  <div className="bg-orange-50 border border-orange-200 text-orange-900 px-4 py-3 rounded-lg mb-4">
                    <div className="text-sm font-bold mb-1">Bunker wissel nodig voor volgende order</div>
                    <div className="space-y-1.5 text-sm">
                      {nextOrderBunkerSwitches.map(item => (
                        <div key={`${item.code}|${item.name}`} className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${item.urgency === 'nu' ? 'bg-orange-200 text-orange-900' : 'bg-amber-100 text-amber-800'}`}>
                            {item.urgency === 'nu' ? 'Nu' : 'Straks'}
                          </span>
                          <span>{item.name} {'->'} advies {item.bunker}</span>
                        </div>
                      ))}
                    </div>
                {nextOrderBunkerPlan.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-orange-200">
                        <div className="text-xs font-bold uppercase tracking-wider text-orange-800 mb-2">Beste bunkerplan komende 2 orders</div>
                        <div className="space-y-1.5 text-sm">
                          {nextOrderBunkerPlan.map(plan => (
                            <div key={plan.bunker}>
                              <span className="font-semibold">{plan.bunker}</span>
                              <span className="text-orange-800"> - {plan.items.map(item => item.name).join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {operatorExecutionCards.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    {operatorExecutionCards.map(card => (
                      <div
                        key={card.id}
                        className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm cursor-pointer hover:border-blue-300 transition-colors"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          const order = plannedEntries.find(entry => entry.order.id === card.id)?.order;
                          if (order) setSelectedOrderForDetail(order);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          const order = plannedEntries.find(entry => entry.order.id === card.id)?.order;
                          if (order) setSelectedOrderForDetail(order);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-gray-800 truncate">{card.customer}</div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500 font-medium flex-wrap">
                              <span className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${card.pkgBadgeClass}`}>
                                {card.pkgLabel}
                              </span>
                              <span className="text-gray-300">-</span>
                              <span>x{card.factor}</span>
                            </div>
                          </div>
                          <div className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            card.status === 'direct'
                              ? 'bg-green-100 text-green-700'
                              : card.status === 'prep'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-blue-100 text-blue-700'
                          }`}>
                            {card.status === 'direct' ? 'Direct' : card.status === 'prep' ? 'Voorbereiden' : 'Wachten'}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                          {card.isBulk ? (
                            <TruckIcon size={14} className="text-blue-500" />
                          ) : (
                            <Package size={14} className="text-orange-500" />
                          )}
                          <span>{card.schedule}</span>
                          <span className="text-gray-300">-</span>
                          <span>{card.volume} m3</span>
                          <span className="text-gray-300">-</span>
                          <span>{card.pkg}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-gray-600">{card.reason}</div>
                          <button
                            className="text-xs font-semibold text-blue-600 hover:underline shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              const order = plannedEntries.find(entry => entry.order.id === card.id)?.order;
                              if (order) setSelectedOrderForDetail(order);
                            }}
                          >
                            Receptuur
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_310px] gap-5 items-start">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Actieve order</div>
                    <div className={`abox ${displayedCurrentOrder ? 'has' : ''}`}>
                      {displayedCurrentOrder ? (
                        <div className="w-full cursor-pointer group" onClick={() => setSelectedOrderForDetail(displayedCurrentOrder)}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {displayedCurrentOrder.pkg.toLowerCase() === 'bulk' ? (
                                <TruckIcon size={18} className="text-blue-500" />
                              ) : (
                                <Package size={18} className="text-orange-500" />
                              )}
                              <div className="text-[17px] font-bold group-hover:text-blue-600 transition-colors">{displayedCurrentOrder.customer}</div>
                            </div>
                            <span className="badge badge-bg">{displayedCurrentOrder.status === 'running' ? 'Running' : 'Gepland'}</span>
                          </div>
                          <div className="text-[12px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                            <span>{getOrderRefLabel(displayedCurrentOrder)}</span>
                            <span className="text-gray-200">-</span>
                            <span className="font-bold text-gray-600">{displayedCurrentOrder.recipe}</span>
                            <span className="text-gray-200">-</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                              {displayedCurrentOrder.pkg.toUpperCase()}
                            </span>
                            <span className="text-gray-200">-</span>
                            <span>{ev(displayedCurrentOrder).toFixed(1)} m3</span>
                            {displayedCurrentEntry && (
                              <>
                                <span className="text-gray-200">-</span>
                                <span>{displayedCurrentActualStart ? fmt(displayedCurrentActualStart) : '--:--'} - {displayedCurrentActualEnd ? fmt(displayedCurrentActualEnd) : '--:--'}</span>
                              </>
                            )}
                          </div>
                          <div className="pb">
                            <div className="pf" style={{ width: `${displayedCurrentProgress}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-400">
                            <span>{displayedCurrentOrder.status === 'running' ? 'Gestart' : 'Gepland'}</span>
                            <span>{displayedCurrentOrder.status === 'running' ? `${Math.round(displayedCurrentProgress)}%` : (normalizeEta(displayedCurrentOrder.eta) || '--')}</span>
                            <span>~{displayedCurrentEntry ? displayedCurrentEntry.duration.toFixed(1) : rt(displayedCurrentOrder, LINES[selectedLine].speed).toFixed(1)} min</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-3">
                            <div className="bg-gray-50 rounded-md p-2">
                              <div className="text-[10px] text-gray-400 mb-0.5">Runtime</div>
                              <div className="text-sm font-semibold">{displayedCurrentEntry ? displayedCurrentEntry.duration.toFixed(1) : rt(displayedCurrentOrder, LINES[selectedLine].speed).toFixed(1)} min</div>
                            </div>
                            <div className="bg-gray-50 rounded-md p-2">
                              <div className="text-[10px] text-gray-400 mb-0.5">Volume</div>
                              <div className="text-sm font-semibold">{ev(displayedCurrentOrder).toFixed(1)} m3</div>
                            </div>
                            {displayedCurrentEntry && (
                              <div className="bg-gray-50 rounded-md p-2">
                                <div className="text-[10px] text-gray-400 mb-0.5">Eindtijd</div>
                                <div className="text-sm font-semibold">{displayedCurrentActualEnd ? fmt(displayedCurrentActualEnd) : '--:--'}</div>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button className="btn btn-s btn-sm" onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrderForDetail(displayedCurrentOrder);
                            }}>Receptuur</button>
                            {displayedCurrentOrder.status === 'running' ? (
                              <button className="btn btn-p btn-sm" onClick={(e) => {
                                e.stopPropagation();
                                handleFinishOrder(displayedCurrentOrder.id);
                              }}>Gereed</button>
                            ) : (
                              <button className="btn btn-p btn-sm" onClick={(e) => {
                                e.stopPropagation();
                                handleStartOrder(displayedCurrentOrder.id);
                              }}>Start</button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">Geen actieve order op {LINES[selectedLine].name}</span>
                      )}
                    </div>

                    <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mt-4 mb-2.5">Volgende orders</div>
                    <div className="flex flex-col gap-2 mb-3.5">
                      {operatorDisplayEntries.length > 0 ? operatorDisplayEntries.map((entry, i) => {
                        const o = entry.order;
                        const effectivePriority = getEffectivePriority(o);
                        const operatorState = entry.operatorState;
                        const canStart = !displayedCurrentOrder && operatorState.key === 'direct';
                        
                        return (
                          <div 
                            key={o.id} 
                            className={`ocard ocard-${effectivePriority === 1 ? 'ph' : effectivePriority === 2 ? 'pm' : 'pl'} !p-2.5 flex items-center gap-3 group cursor-pointer transition-all ${
                              operatorDropTargetId === o.id && draggedOperatorOrderId !== o.id
                                ? 'ring-2 ring-blue-400 border-blue-400 bg-blue-50/50'
                                : ''
                            }`}
                            role="button"
                            tabIndex={0}
                            draggable
                            onClick={() => setSelectedOrderForDetail(o)}
                            onDragStart={(e) => {
                              setDraggedOperatorOrderId(o.id);
                              setOperatorDropTargetId(null);
                              e.dataTransfer.setData('text/plain', String(o.id));
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggedOperatorOrderId(null);
                              setOperatorDropTargetId(null);
                            }}
                            onDragOver={(e) => {
                              if (draggedOperatorOrderId === null || draggedOperatorOrderId === o.id) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setOperatorDropTargetId(o.id);
                            }}
                            onDragLeave={() => {
                              if (operatorDropTargetId === o.id) setOperatorDropTargetId(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const droppedId = Number(e.dataTransfer.getData('text/plain') || draggedOperatorOrderId);
                              if (!droppedId || droppedId === o.id) return;
                              reorderOperatorLineOrders(selectedLine, droppedId, o.id);
                              setDraggedOperatorOrderId(null);
                              setOperatorDropTargetId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault();
                              setSelectedOrderForDetail(o);
                            }}
                          >
                            <div className="flex flex-col items-center gap-1 shrink-0 w-10">
                              <div className="w-7 h-7 bg-gray-100 rounded flex items-center justify-center text-[11px] font-bold text-gray-500">
                                #{i + 1}
                              </div>
                              {o.eta && (
                                <div className="text-[10px] font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 tabular-nums">
                                  {fmt(entry.prodStart)}
                                </div>
                              )}
                            </div>

                            <div className="w-8 h-8 bg-gray-50 rounded flex items-center justify-center shrink-0">
                              {o.pkg.toLowerCase() === 'bulk' ? (
                                <TruckIcon size={16} className="text-blue-500" />
                              ) : (
                                <Package size={16} className="text-orange-500" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">{o.customer}</div>
                              <div className="text-[10px] text-gray-400 font-medium truncate uppercase tracking-wider">
                                {getOrderRefLabel(o)}
                              </div>
                              <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                                <span className="font-medium">{o.recipe}</span> - {ev(o).toFixed(1)} m3 - {formatOperatorDateTimeRange(entry.prodStart, entry.endTime, currentTime)}
                              </div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] font-medium text-gray-500">
                                <span className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${getPkgBadgeClass(o)}`}>
                                  {getPkgLabel(o)}
                                </span>
                                <span className="text-gray-300">-</span>
                                <span>x{getOrderVolumeFactor(o).toFixed(2)}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${operatorState.cls}`}>
                                  {operatorState.label}
                                </span>
                                <span className="text-[10px] text-gray-500 truncate">{operatorState.reason}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                className="text-xs font-semibold text-blue-600 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOrderForDetail(o);
                                }}
                              >
                                Receptuur
                              </button>
                              {canStart && (
                                <button 
                                  className="btn btn-p btn-sm shadow-sm" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartOrder(o.id);
                                  }}
                                >
                                  Start
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-4 text-gray-400 text-xs text-center">
                          Geen orders in wachtrij
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="text-[12px] font-bold uppercase tracking-wider text-gray-400 px-3.5 py-2 border-b border-gray-100">
                        Bunker status
                      </div>
                      <div className="divide-y divide-gray-100">
                        {bunkers[selectedLine].map(b => (
                          <div 
                            key={b.c} 
                            className="px-3.5 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors group"
                            onClick={() => {
                              setSelectedBunker({ lid: selectedLine, bunker: b });
                              setShowAllMaterials(false);
                              setNewCalibrationName('');
                              setNewCalibrationCode('');
                              setNewCalibrationValue('');
                            }}
                          >
                            <div className="text-xs font-bold text-gray-700 min-w-[40px]">{b.c}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-600 truncate">{b.m || 'Leeg'}</div>
                              {b.calibrationValue !== null && b.calibrationValue !== undefined && (
                                <div className="text-[9px] text-blue-500 font-bold">K: {b.calibrationValue}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {b.fx && <span className="text-[9px] font-bold text-or uppercase">Vast</span>}
                              <Pencil size={10} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {view === 'planner' && (
              <div className="max-w-[1600px] mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-800">Productie Planning</h1>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-1 font-medium text-green-700">
                        <span className="h-2 w-2 rounded-full bg-green-500"></span>
                        Auto-sync elke 15 min
                      </span>
                      <span>
                        Laatste sync: {dataSource.lastSync ? new Date(dataSource.lastSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : 'Nog niet'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-s btn-sm" onClick={handleRecalculate} disabled={isRecalculating || (!!plannerRecalcLock?.owner && plannerRecalcLock.owner !== plannerLockOwnerRef.current)}>
                      <motion.span animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} className="inline-block mr-1">...</motion.span>
                      {isRecalculating ? 'Bezig...' : (!!plannerRecalcLock?.owner && plannerRecalcLock.owner !== plannerLockOwnerRef.current) ? 'Schema bezet...' : 'Herbereken Schema'}
                    </button>
                    </div>
                  </div>

                {plannerWeekDates.length > 0 && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                        Weekplanning
                      </span>
                      {plannerWeekDates.map((date) => {
                        const dateKey = formatLocalDate(date);
                        const isPlanned = plannerVisibleDates.some(visibleDate => formatLocalDate(visibleDate) === formatLocalDate(date));
                        const isToday = formatLocalDate(date) === formatLocalDate(currentTime);
                        const isSelected = plannerSelectedDate === dateKey;
                        return (
                          <button
                            type="button"
                            key={dateKey}
                            onClick={() => setPlannerSelectedDate(dateKey)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold border transition-colors ${
                              isSelected
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : isPlanned
                                  ? 'bg-white text-amber-800 border-amber-200 hover:bg-amber-100/60'
                                  : isToday
                                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100/70'
                                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {formatPlannerDateChip(date)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sub Tabs */}
                <div className="flex items-center justify-between gap-4 mb-5 border-b-2 border-gray-200">
                  <div className="flex overflow-x-auto no-scrollbar">
                    {[
                      { id: 'schema', lbl: 'Lijn Schema' },
                      { id: 'wachtrij', lbl: 'Order Wachtrij' },
                      { id: 'dagrooster', lbl: 'Dagrooster' },
                      { id: 'chauffeurs', lbl: `Chauffeurs (${plannerDrivers.length})` },
                      { id: 'vrachtwagens', lbl: 'Vrachtwagenritten' },
                      { id: 'voltooid', lbl: `Voltooid (${completedOrders.length})` }
                    ].map(t => (
                      <button 
                        key={t.id}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${plannerTab === t.id ? 'border-gr text-gr' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        onClick={() => setPlannerTab(t.id as any)}
                      >
                        {t.lbl}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 pb-2 shrink-0">
                    <span className="text-xs font-semibold text-gray-400 uppercase">Sorteer</span>
                    <select 
                      className="fi !w-48 !py-1.5 !text-xs"
                      value={plannerSort}
                      onChange={(e) => setPlannerSort(e.target.value)}
                    >
                      <option value="default">Standaard volgorde</option>
                      <option value="efficiency">Efficientie (Min. wissels)</option>
                      <option value="eta">Laadtijd</option>
                      <option value="prio">Prioriteit</option>
                      <option value="customer">Klant</option>
                    </select>
                  </div>
                </div>

                {/* Filters Row */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div className="flex gap-1.5">
                    {[
                      { id: 0, lbl: 'Alle lijnen' },
                      { id: 1, lbl: 'Menglijn 1' },
                      { id: 2, lbl: 'Menglijn 2' },
                      { id: 3, lbl: 'Menglijn 3' }
                    ].map(l => (
                      <button 
                        key={l.id}
                        className={`ltab flex items-center gap-2 ${plannerLineFilter === l.id ? 'on' : ''}`}
                        onClick={() => setPlannerLineFilter(l.id)}
                      >
                        {!!storingen[l.id as LineId]?.actief && (
                          <span className={`inline-block h-2 w-2 rounded-full ${
                            storingen[l.id as LineId]?.soort === 'storing' ? 'bg-red-500' : 'bg-blue-500'
                          }`}></span>
                        )}
                        {l.lbl}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <div className="relative flex-1">
                      <input 
                        className="fi !pl-10" 
                        placeholder="Zoek op order, rit, klant of recept"
                        value={plannerSearch}
                        onChange={(e) => setPlannerSearch(e.target.value)}
                      />
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <ClipboardList size={16} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub View Content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={plannerTab}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                  >
                    {plannerTab === 'dagrooster' && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-base font-bold text-gray-800">Dagrooster</div>
                            <div className="text-sm text-gray-500">
                              Eerste opzet voor planners: sleep orders links naar de juiste chauffeurkolom rechts.
                            </div>
                          </div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {formatPlannerDateLong(parseLocalDate(plannerSelectedDate) || currentTime)}
                          </div>
                        </div>

                        {dayRosterColumns.length === 0 && dayRosterEntries.length === 0 ? (
                          <div className="px-6 py-14 text-center text-gray-400 italic">
                            Geen plannerblokken voor deze dag of filter.
                          </div>
                        ) : (
                          <div className="flex min-h-[720px] max-h-[78vh] overflow-hidden">
                            <div
                              className={`w-[320px] shrink-0 border-r border-gray-200 bg-gray-50/60 transition-colors ${draggedDayRosterOrderId ? 'bg-orange-50/80 ring-1 ring-inset ring-orange-200' : ''}`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const rawId = e.dataTransfer.getData('text/dayroster-order-id') || String(draggedDayRosterOrderId || '');
                                const orderId = Number(rawId);
                                if (orderId) {
                                  void handleClearDriverFromOrder(orderId);
                                }
                                setDraggedDayRosterOrderId(null);
                              }}
                            >
                              <div className="border-b border-gray-200 px-4 py-3">
                                <div className="text-sm font-bold text-gray-800">Ongekoppelde orders</div>
                                <div className="mt-1 text-xs text-gray-500">
                                  Sleep een order naar een chauffeurkolom. Sleep hem terug hierheen om hem weer los te koppelen.
                                </div>
                              </div>
                              <div className="h-[calc(78vh-72px)] overflow-auto px-3 py-3 space-y-3">
                                {dayRosterUnassignedEntries.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-5 text-sm italic text-gray-400">
                                    {draggedDayRosterOrderId ? 'Laat hier los om terug te zetten.' : 'Geen ongekoppelde orders voor deze dag.'}
                                  </div>
                                ) : (
                                  dayRosterUnassignedEntries.map(entry => (
                                    <div
                                      key={`list-${entry.order.id}`}
                                      draggable
                                      onDragStart={(e) => handleDayRosterDragStart(e, entry.order.id)}
                                      onDragEnd={handleDayRosterDragEnd}
                                      onClick={() => setSelectedOrderForDetail(entry.order)}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          setSelectedOrderForDetail(entry.order);
                                        }
                                      }}
                                      className="w-full cursor-grab active:cursor-grabbing rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="truncate text-sm font-bold text-gray-800">{entry.order.customer}</div>
                                      </div>
                                      <div className="mt-2 text-xs text-gray-500">
                                        Order {entry.order.num} • {ev(entry.order).toFixed(1)} m3 • {normalizePkg(entry.order.pkg).toUpperCase()}
                                      </div>
                                      <div className="mt-2 text-[11px] font-medium text-blue-600">
                                        Nog niet gekoppeld
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>

                            <div className="min-w-0 flex-1 overflow-auto overscroll-contain">
                              <div
                                className="grid w-max min-w-full"
                                style={{ gridTemplateColumns: `88px repeat(${Math.max(dayRosterDriverColumns.length, 1)}, 240px)` }}
                              >
                                <div className="sticky left-0 top-0 z-30 bg-white border-b border-r border-gray-200 px-3 py-3 text-xs font-bold uppercase tracking-wider text-gray-400 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.45)]">
                                  Tijd
                                </div>
                                {dayRosterDriverColumns.map(column => (
                                  <div
                                    key={column.key}
                                    className={`sticky top-0 z-20 border-b border-r border-gray-200 bg-white px-3 py-3 transition-colors ${draggedDayRosterOrderId ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200' : ''}`}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const rawId = e.dataTransfer.getData('text/dayroster-order-id') || String(draggedDayRosterOrderId || '');
                                      const orderId = Number(rawId);
                                      const driverName = column.key.replace('driver:', '');
                                      if (orderId && driverName) {
                                        void handleAssignDriverToOrder(orderId, driverName);
                                      }
                                      setDraggedDayRosterOrderId(null);
                                    }}
                                  >
                                    <div className="text-sm font-bold text-gray-800">{column.label}</div>
                                    <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                      Chauffeur
                                    </div>
                                    {draggedDayRosterOrderId && (
                                      <div className="mt-2 text-[11px] font-medium text-blue-600">
                                        Sleep order hierheen
                                      </div>
                                    )}
                                  </div>
                                ))}
                                <div className="sticky left-0 z-20 border-r border-gray-200 bg-gray-50/95 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.45)]">
                                  {dayRosterTimeSlots.map((slot) => (
                                    <div
                                      key={slot}
                                      className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-500"
                                      style={{ height: `${dayRosterRowHeight}px` }}
                                    >
                                      {minutesToTimeString(slot)}
                                    </div>
                                  ))}
                                </div>

                                {dayRosterDriverColumns.map(column => {
                                  const entries = dayRosterOrdersPerColumn.get(column.key) || [];
                                  let previousCardBottom = 0;
                                  const positionedEntries = entries.map(entry => {
                                    const rawTop = Math.max(0, ((entry.startMinutes - dayRosterStartMinutes) / dayRosterSlotMinutes) * dayRosterRowHeight);
                                    const durationMinutes = Math.max(dayRosterSlotMinutes, entry.endMinutes - entry.startMinutes);
                                    const height = Math.max(54, (durationMinutes / dayRosterSlotMinutes) * dayRosterRowHeight - 6);
                                    const top = Math.max(rawTop, previousCardBottom + 6);
                                    previousCardBottom = top + height;
                                    return { entry, top, height };
                                  });
                                  return (
                                    <div
                                      key={column.key}
                                      className={`relative border-r border-gray-200 bg-white/90 ${draggedDayRosterOrderId ? 'bg-blue-50/20' : ''}`}
                                      style={{ height: `${dayRosterSlotCount * dayRosterRowHeight}px` }}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        const rawId = e.dataTransfer.getData('text/dayroster-order-id') || String(draggedDayRosterOrderId || '');
                                        const orderId = Number(rawId);
                                        if (!orderId) return;
                                        const driverName = column.key.replace('driver:', '');
                                        if (driverName) {
                                          void handleAssignDriverToOrder(orderId, driverName);
                                        }
                                        setDraggedDayRosterOrderId(null);
                                      }}
                                    >
                                      {dayRosterTimeSlots.map((slot) => (
                                        <div
                                          key={`${column.key}-${slot}`}
                                          className="border-b border-gray-100"
                                          style={{ height: `${dayRosterRowHeight}px` }}
                                        />
                                      ))}

                                      {positionedEntries.map(({ entry, top, height }) => {
                                        return (
                                          <div
                                            key={entry.order.id}
                                            draggable
                                            onDragStart={(e) => handleDayRosterDragStart(e, entry.order.id)}
                                            onDragEnd={handleDayRosterDragEnd}
                                            onClick={() => setSelectedOrderForDetail(entry.order)}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setSelectedOrderForDetail(entry.order);
                                              }
                                            }}
                                            className="absolute left-2 right-2 cursor-grab active:cursor-grabbing rounded-xl border px-3 py-2 text-left shadow-sm transition-all hover:shadow-md"
                                            style={{
                                              top: `${top + 3}px`,
                                              height: `${height}px`,
                                              backgroundColor: `${LINES[entry.order.line].color}18`,
                                              borderColor: `${LINES[entry.order.line].color}55`
                                            }}
                                          >
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="min-w-0 truncate text-sm font-bold text-gray-800">
                                                {entry.order.customer}
                                              </div>
                                              <div className="shrink-0 text-[11px] font-bold tabular-nums text-gray-500">
                                                {minutesToTimeString(entry.startMinutes)}
                                              </div>
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] text-gray-600">
                                              Order {entry.order.num} • {ev(entry.order).toFixed(1)} m3 • {normalizePkg(entry.order.pkg).toUpperCase()}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {plannerTab === 'schema' && (
                      <>
                        {plannerLineFilter !== 0 && storingen[plannerLineFilter as LineId]?.actief && (
                          <div className={`mb-4 rounded-2xl border px-6 py-5 ${
                            storingen[plannerLineFilter as LineId]?.soort === 'storing'
                              ? 'border-red-200 bg-red-50/60'
                              : 'border-blue-200 bg-blue-50/60'
                          }`}>
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-3">
                                  <div className={`h-4 w-4 rounded-full shadow-sm ${
                                    storingen[plannerLineFilter as LineId]?.soort === 'storing'
                                      ? 'bg-red-500 shadow-red-200'
                                      : 'bg-blue-500 shadow-blue-200'
                                  }`}></div>
                                  <div className={`text-[15px] font-extrabold uppercase tracking-tight ${
                                    storingen[plannerLineFilter as LineId]?.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                                  }`}>
                                    {storingen[plannerLineFilter as LineId]?.soort === 'storing' ? 'Storing' : 'Onderhoud'} - {LINES[plannerLineFilter as LineId].name}
                                  </div>
                                </div>
                                <div className={`mt-3 text-xl font-semibold ${
                                  storingen[plannerLineFilter as LineId]?.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                                }`}>
                                  {storingen[plannerLineFilter as LineId]?.omschrijving}
                                </div>
                                <div className={`mt-3 flex flex-wrap gap-5 text-sm ${
                                  storingen[plannerLineFilter as LineId]?.soort === 'storing' ? 'text-red-800' : 'text-blue-800'
                                }`}>
                                  <div>Gestart: {storingen[plannerLineFilter as LineId]?.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</div>
                                  <div>Duur tot nu: {Math.max(1, Math.round((currentTime.getTime() - storingen[plannerLineFilter as LineId]!.start.getTime()) / 60000))} min</div>
                                  {getIssueExpectedEndLabel(storingen[plannerLineFilter as LineId]!) && <div>{getIssueExpectedEndLabel(storingen[plannerLineFilter as LineId]!)}</div>}
                                  {getIssueRemainingMinutesLabel(storingen[plannerLineFilter as LineId]!) && <div>{getIssueRemainingMinutesLabel(storingen[plannerLineFilter as LineId]!)}</div>}
                                  <div>Raakt {getIssueAffectedOrderCount(plannerLineFilter as LineId)} komende orders</div>
                                  {getIssueFirstAffectedOrderLabel(plannerLineFilter as LineId) && <div>{getIssueFirstAffectedOrderLabel(plannerLineFilter as LineId)}</div>}
                                  {getIssueLastAffectedOrderLabel(plannerLineFilter as LineId) && <div>{getIssueLastAffectedOrderLabel(plannerLineFilter as LineId)}</div>}
                                  {getIssueAffectedVolumeLabel(plannerLineFilter as LineId) && <div>{getIssueAffectedVolumeLabel(plannerLineFilter as LineId)}</div>}
                                </div>
                                {getIssueAffectedOrdersPreview(plannerLineFilter as LineId).length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {getIssueAffectedOrdersPreview(plannerLineFilter as LineId).map(order => (
                                      <button
                                        key={order.id}
                                        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                                          storingen[plannerLineFilter as LineId]?.soort === 'storing'
                                            ? 'border-red-200 bg-white/80 text-red-800 hover:bg-red-100'
                                            : 'border-blue-200 bg-white/80 text-blue-800 hover:bg-blue-100'
                                        }`}
                                        onClick={() => setSelectedOrderForDetail(order)}
                                      >
                                        {order.num}
                                      </button>
                                    ))}
                                    {getIssueAffectedOrderCount(plannerLineFilter as LineId) > getIssueAffectedOrdersPreview(plannerLineFilter as LineId).length && (
                                      <span className={`px-1 py-1 text-xs ${
                                        storingen[plannerLineFilter as LineId]?.soort === 'storing' ? 'text-red-700' : 'text-blue-700'
                                      }`}>
                                        ...
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold ${
                                storingen[plannerLineFilter as LineId]?.soort === 'storing'
                                  ? 'border-red-200 bg-white/70 text-red-800'
                                  : 'border-blue-200 bg-white/70 text-blue-800'
                              }`}>
                                Actief
                              </div>
                            </div>
                          </div>
                        )}
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
                        {(Object.keys(LINES) as unknown as LineId[])
                          .filter(lid => plannerLineFilter === 0 || Number(lid) === plannerLineFilter)
                          .sort((a, b) => {
                            const aIssue = storingen[a]?.actief ? 1 : 0;
                            const bIssue = storingen[b]?.actief ? 1 : 0;
                            if (aIssue !== bIssue) return bIssue - aIssue;
                            return a - b;
                          })
                          .map(lidStr => {
                            const lid = Number(lidStr) as LineId;
                            const lineOrders = activeOrders
                              .filter(o => o.line === lid)
                              .filter(o => {
                                const s = plannerSearch.toLowerCase();
                                return o.customer.toLowerCase().includes(s) || o.num.includes(s) || o.recipe.toLowerCase().includes(s);
                              });
                            const plannerDisplayTimelineCandidates = filteredPlannerDisplayEntriesByLine[lid].filter(entry => {
                              const o = entry.order;
                              const s = plannerSearch.toLowerCase();
                              return o.customer.toLowerCase().includes(s) || o.num.includes(s) || o.recipe.toLowerCase().includes(s);
                            });
                            const runningEntry = lineTimelineByLine[lid].find(entry => entry.order.status === 'running') || null;
                            const runningOrder = runningEntry?.order || null;
                            const runningStart = runningEntry && runningOrder
                              ? (getRunningOrderStart(runningOrder) || runningEntry.prodStart)
                              : null;
                            const runningEnd = runningEntry && runningStart
                              ? new Date(runningStart.getTime() + runningEntry.duration * 60000)
                              : null;
                            const runningProgress = runningEntry && runningStart
                              ? Math.max(0, Math.min(99, ((currentTime.getTime() - runningStart.getTime()) / (runningEntry.duration * 60000)) * 100))
                              : 0;
                            const lineTimelineIndexByOrderId = new Map(lineTimelineByLine[lid].map((entry, index) => [entry.order.id, index]));
                            const runningIndex = runningEntry ? (lineTimelineIndexByOrderId.get(runningEntry.order.id) ?? -1) : -1;
                            const plannerDisplayTimeline = plannerDisplayTimelineCandidates.filter(entry => {
                              if (entry.order.status === 'running') return false;
                              if (runningIndex < 0) return true;
                              const entryIndex = lineTimelineIndexByOrderId.get(entry.order.id) ?? -1;
                              return entryIndex > runningIndex;
                            });
                            const plannerLineDisplayTimesByOrderId = new Map<number, { start: Date; end: Date }>();
                            if (runningEnd && runningOrder && runningIndex >= 0) {
                              let cursor = runningEnd;
                              let previousOrder: Order | null = runningOrder;
                              plannerDisplayTimeline.forEach(entry => {
                                const transitionMinutes = getTransitionMinutes(lid, previousOrder, entry.order);
                                let start = new Date(cursor.getTime() + transitionMinutes * 60000);
                                const heldLoadDateTime = getHeldLoadDateTime(entry.order, start);
                                if (heldLoadDateTime && start.getTime() < heldLoadDateTime.getTime()) {
                                  start = heldLoadDateTime;
                                }
                                const end = new Date(start.getTime() + entry.duration * 60000);
                                plannerLineDisplayTimesByOrderId.set(entry.order.id, { start, end });
                                cursor = end;
                                previousOrder = entry.order;
                              });
                            }
                            const getPlannerLineDisplayStart = (entry: ScheduledLineEntry) => {
                              const entryRunningStart = getRunningOrderStart(entry.order);
                              if (entryRunningStart) return entryRunningStart;
                              return plannerLineDisplayTimesByOrderId.get(entry.order.id)?.start || entry.prodStart;
                            };
                            const getPlannerLineDisplayEnd = (entry: ScheduledLineEntry) =>
                              plannerLineDisplayTimesByOrderId.get(entry.order.id)?.end ||
                              new Date(getPlannerLineDisplayStart(entry).getTime() + entry.duration * 60000);
                            
                              const lineIssue = storingen[lid];
                          return (
                            <div key={lid} className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                              <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: LINES[lid].color }}></div>
                                  <div className="font-bold text-gray-800">{LINES[lid].name}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Cap: {LINES[lid].speed}m3/u</span>
                                  <span className={`badge ${
                                    lineIssue?.actief
                                      ? lineIssue.soort === 'storing'
                                        ? 'bg-orange-100 text-orange-700'
                                        : 'bg-blue-100 text-blue-700'
                                      : 'badge-bg'
                                  }`}>
                                    {lineIssue?.actief ? (lineIssue.soort === 'storing' ? 'Storing' : 'Onderhoud') : 'Actief'}
                                  </span>
                                </div>
                              </div>
                              {lineIssue?.actief && (
                                <div className={`border-b px-4 py-4 ${
                                  lineIssue.soort === 'storing'
                                    ? 'border-red-100 bg-red-50/60'
                                    : 'border-blue-100 bg-blue-50/60'
                                }`}>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <div className={`h-3 w-3 rounded-full ${
                                          lineIssue.soort === 'storing' ? 'bg-red-500' : 'bg-blue-500'
                                        }`}></div>
                                        <div className={`text-sm font-extrabold uppercase tracking-tight ${
                                          lineIssue.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                                        }`}>
                                          {lineIssue.soort === 'storing' ? 'Storing' : 'Onderhoud'} - {LINES[lid].name}
                                        </div>
                                      </div>
                                      <div className={`mt-2 text-base font-semibold ${
                                        lineIssue.soort === 'storing' ? 'text-red-900' : 'text-blue-900'
                                      }`}>
                                        {lineIssue.omschrijving}
                                      </div>
                                      <div className={`mt-2 flex flex-wrap gap-4 text-xs ${
                                        lineIssue.soort === 'storing' ? 'text-red-800' : 'text-blue-800'
                                      }`}>
                                        <div>Gestart: {lineIssue.start.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</div>
                                        <div>Duur: {Math.max(1, Math.round((currentTime.getTime() - lineIssue.start.getTime()) / 60000))} min</div>
                                        {getIssueExpectedEndLabel(lineIssue) && <div>{getIssueExpectedEndLabel(lineIssue)}</div>}
                                        {getIssueRemainingMinutesLabel(lineIssue) && <div>{getIssueRemainingMinutesLabel(lineIssue)}</div>}
                                        <div>Raakt {getIssueAffectedOrderCount(lid)} komende orders</div>
                                        {getIssueFirstAffectedOrderLabel(lid) && <div>{getIssueFirstAffectedOrderLabel(lid)}</div>}
                                        {getIssueLastAffectedOrderLabel(lid) && <div>{getIssueLastAffectedOrderLabel(lid)}</div>}
                                        {getIssueAffectedVolumeLabel(lid) && <div>{getIssueAffectedVolumeLabel(lid)}</div>}
                                      </div>
                                      {getIssueAffectedOrdersPreview(lid).length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {getIssueAffectedOrdersPreview(lid).map(order => (
                                            <button
                                              key={order.id}
                                              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                                                lineIssue.soort === 'storing'
                                                  ? 'border-red-200 bg-white/80 text-red-800 hover:bg-red-100'
                                                  : 'border-blue-200 bg-white/80 text-blue-800 hover:bg-blue-100'
                                              }`}
                                              onClick={() => setSelectedOrderForDetail(order)}
                                            >
                                              {order.num}
                                            </button>
                                          ))}
                                          {getIssueAffectedOrderCount(lid) > getIssueAffectedOrdersPreview(lid).length && (
                                            <span className={`px-1 py-1 text-[11px] ${
                                              lineIssue.soort === 'storing' ? 'text-red-700' : 'text-blue-700'
                                            }`}>
                                              ...
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    <div className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                                      lineIssue.soort === 'storing'
                                        ? 'border-red-200 bg-white/80 text-red-800'
                                        : 'border-blue-200 bg-white/80 text-blue-800'
                                    }`}>
                                      Actief
                                    </div>
                                  </div>
                                </div>
                              )}
                              {runningEntry && runningOrder && runningStart && runningEnd && (
                                <div
                                  className="border-b border-green-200 bg-green-50/70 px-4 py-4 cursor-pointer hover:bg-green-50 transition-colors"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedOrderForDetail(runningOrder)}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    setSelectedOrderForDetail(runningOrder);
                                  }}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="flex flex-col items-center shrink-0 pt-0.5">
                                      <div className="text-[11px] font-bold text-gray-900 tabular-nums leading-none">{fmt(runningStart)}</div>
                                      <div className="w-px h-4 bg-green-200 my-1"></div>
                                      <div className="text-[10px] font-medium text-gray-500 tabular-nums leading-none">{fmt(runningEnd)}</div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="mb-1 flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            {runningOrder.pkg.toLowerCase() === 'bulk' ? (
                                              <TruckIcon size={15} className="shrink-0 text-blue-500" />
                                            ) : (
                                              <Package size={15} className="shrink-0 text-orange-500" />
                                            )}
                                            <div className="truncate text-sm font-extrabold text-gray-900">{runningOrder.customer}</div>
                                          </div>
                                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-gray-500">
                                            <span>{runningOrder.productionOrder ? `PO ${runningOrder.productionOrder}` : `#${runningOrder.num}`}</span>
                                            <span className="text-gray-300">-</span>
                                            <span>{runningOrder.recipe}</span>
                                            <span className="text-gray-300">-</span>
                                            <span>{ev(runningOrder).toFixed(1)} m3</span>
                                            <span className="text-gray-300">-</span>
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPkgBadgeClass(runningOrder)}`}>
                                              {getPkgLabel(runningOrder)}
                                            </span>
                                          </div>
                                        </div>
                                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                                          Running
                                        </span>
                                      </div>
                                      <div className="mt-2">
                                        <div className="mb-1 flex items-center justify-between">
                                          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Actieve order op operator dashboard</span>
                                          <span className="text-[10px] font-bold text-gr tabular-nums">{Math.round(runningProgress)}%</span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                                          <motion.div
                                            className="h-full bg-gr"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${runningProgress}%` }}
                                          />
                                        </div>
                                      </div>
                                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                                        <div className="rounded-lg bg-white/80 px-2 py-1">
                                          <div className="text-gray-400">Runtime</div>
                                          <div className="font-bold text-gray-800">{runningEntry.duration.toFixed(1)} min</div>
                                        </div>
                                        <div className="rounded-lg bg-white/80 px-2 py-1">
                                          <div className="text-gray-400">Volume</div>
                                          <div className="font-bold text-gray-800">{ev(runningOrder).toFixed(1)} m3</div>
                                        </div>
                                        <div className="rounded-lg bg-white/80 px-2 py-1">
                                          <div className="text-gray-400">Eindtijd</div>
                                          <div className="font-bold text-gray-800">{fmt(runningEnd)}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div className="divide-y divide-gray-100">
                                {plannerDisplayTimeline.length > 0 ? plannerDisplayTimeline.map((entry, i) => {
                                  const o = entry.order;
                                  const { prodStart, endTime, swMats, sw, duration } = entry;
                                  const isRunning = o.status === 'running';
                                  const displayProdStart = getPlannerLineDisplayStart(entry);
                                  const displayEndTime = getPlannerLineDisplayEnd(entry);
                                  const previousEntry = i > 0 ? plannerDisplayTimeline[i - 1] : null;
                                  const plannerState = entry.plannerState;
                                  const dateKey = formatLocalDate(displayProdStart);
                                  const previousDateKey = previousEntry ? formatLocalDate(getPlannerLineDisplayStart(previousEntry)) : null;
                                  const showDateHeading = i === 0 || previousDateKey !== dateKey;

                                  // Real-time progress calculation
                                  let orderProgress = 0;
                                  if (isRunning) {
                                    const total = duration * 60000;
                                    const elapsed = currentTime.getTime() - displayProdStart.getTime();
                                    orderProgress = Math.max(0, Math.min(99, (elapsed / total) * 100));
                                  }

                                  return (
                                    <React.Fragment key={o.id}>
                                      {showDateHeading && (
                                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                                          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                            {formatPlannerDateHeading(displayProdStart)}
                                          </div>
                                        </div>
                                      )}
                                      {/* Wissel indicator if applicable */}
                                      {(sw > 0 || (i > 0 && config[lid].prep > 0)) && (
                                        <div className="px-4 py-2 bg-orange-50/50 flex flex-col gap-1 border-y border-orange-100/30">
                                          <div className="flex items-center gap-2">
                                            <div className="w-1 h-4 bg-orange-300 rounded-full"></div>
                                            <div className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">
                                              Voorbereiding: {getTransitionMinutes(lid, previousEntry?.order || null, o)} min
                                            </div>
                                          </div>
                                          {sw > 0 && (
                                            <div className="flex flex-wrap gap-1 ml-3">
                                              {swMats.map((m, mi) => (
                                                <span key={mi} className="text-[9px] bg-white border border-orange-200 text-orange-700 px-1.5 py-0.5 rounded leading-none">
                                                  + {m}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      
                                      <div className={`p-4 flex flex-col gap-2 transition-colors ${isRunning ? 'bg-green-50/60 border-l-4 border-gr shadow-inner' : 'hover:bg-gray-50'}`}>
                                        <div className="flex items-start gap-3">
                                          <div className="flex flex-col items-center shrink-0 pt-0.5">
                                            <div className="text-[11px] font-bold text-gray-800 tabular-nums leading-none">{fmt(displayProdStart)}</div>
                                            <div className="w-px h-4 bg-gray-200 my-1"></div>
                                            <div className="text-[10px] font-medium text-gray-400 tabular-nums leading-none">{fmt(displayEndTime)}</div>
                                          </div>

                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2 mb-0.5">
                                              <div className="flex items-center gap-2 min-w-0">
                                                <div className="shrink-0">
                                                  {o.pkg.toLowerCase() === 'bulk' ? (
                                                    <TruckIcon size={14} className="text-blue-500" />
                                                  ) : (
                                                    <Package size={14} className="text-orange-500" />
                                                  )}
                                                </div>
                                              <div className="text-sm font-bold truncate text-gray-800">{o.customer}</div>
                                            </div>
                                              <div className="flex items-center gap-2 shrink-0">
                                                {isRunning && (
                                                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                                                    Running
                                                  </span>
                                                )}
                                                <div className="text-[10px] font-bold text-gray-400 tabular-nums shrink-0">{o.productionOrder ? `PO ${o.productionOrder}` : `#${o.num}`}</div>
                                              </div>
                                            </div>
                                            <div className="text-[11px] text-gray-500 font-medium mb-2 flex items-center gap-1.5 flex-wrap">
                                              <span className="cursor-pointer hover:text-blue-600 hover:underline truncate max-w-[180px]" onClick={() => setSelectedOrderForDetail(o)} title={o.recipe}>{o.recipe}</span>
                                              <span className="text-gray-300">-</span>
                                              <span className="tabular-nums">{ev(o).toFixed(1)} m3</span>
                                              <span className="text-gray-300">-</span>
                                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getPkgBadgeClass(o)}`}>
                                                {getPkgLabel(o)}
                                              </span>
                                              <span className="text-gray-300">-</span>
                                              <span className="text-[10px] font-semibold text-gray-400">
                                                x{getOrderVolumeFactor(o).toFixed(2)}
                                              </span>
                                            </div>

                                            {!isRunning && (
                                              <div className="mb-2 flex items-center gap-2 flex-wrap">
                                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${plannerState.cls}`}>
                                                  {plannerState.label}
                                                </span>
                                                <span className="text-[10px] font-medium text-gray-500">{plannerState.reason}</span>
                                              </div>
                                            )}

                                            {isRunning && (
                                              <div className="mb-2 rounded-xl border border-green-200 bg-white/90 p-3 shadow-sm">
                                                <div className="flex items-center justify-between mb-1">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Actieve order</span>
                                                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-700">
                                                      Running
                                                    </span>
                                                  </div>
                                                  <span className="text-[10px] font-bold text-gr tabular-nums">{Math.round(orderProgress)}%</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                  <motion.div 
                                                    className="h-full bg-gr" 
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${orderProgress}%` }}
                                                  />
                                                </div>
                                                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                                                  <div className="rounded-lg bg-gray-50 px-2 py-1">
                                                    <div className="text-gray-400">Runtime</div>
                                                    <div className="font-bold text-gray-800">{duration.toFixed(1)} min</div>
                                                  </div>
                                                  <div className="rounded-lg bg-gray-50 px-2 py-1">
                                                    <div className="text-gray-400">Volume</div>
                                                    <div className="font-bold text-gray-800">{ev(o).toFixed(1)} m3</div>
                                                  </div>
                                                  <div className="rounded-lg bg-gray-50 px-2 py-1">
                                                    <div className="text-gray-400">Eindtijd</div>
                                                    <div className="font-bold text-gray-800">{fmt(displayEndTime)}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            )}

                                            <div className="flex items-center justify-between">
                                              <div className="flex gap-1">
                                                <span className="text-[9px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">{o.rit || 'Geen rit'}</span>
                                              </div>
                                              <div className="text-[10px] font-bold text-gray-400">
                                                ETA: {o.eta || '--'}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </React.Fragment>
                                  );
                                }) : (
                                  <div className="p-12 text-center flex flex-col items-center gap-2">
                                    <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                                      <ClipboardList size={20} />
                                    </div>
                                    <div className="text-xs text-gray-400 italic">Geen orders gepland</div>
                                  </div>
                                )}
                              </div>
                              {lid === selectedLine && gapDebug.filter(entry => entry.line === lid).length > 0 && (
                                <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-3">
                                  <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-2">Gap debug</div>
                                  <div className="space-y-2">
                                    {gapDebug
                                      .filter(entry => entry.line === lid)
                                      .slice(0, 3)
                                      .map((entry, idx) => (
                                        <div key={`${entry.afterOrderId}-${entry.beforeOrderId}-${idx}`} className="text-[11px] text-gray-600">
                                          <div className="font-semibold text-gray-700">
                                            Gat {entry.gapMinutes} min na #{entry.afterOrderId} voor #{entry.beforeOrderId}
                                            {entry.chosenOrderId ? ` - gekozen #${entry.chosenOrderId}` : ' - geen keuze'}
                                          </div>
                                          <div className="space-y-1 mt-1">
                                            {entry.candidates.map(candidate => (
                                              <div key={candidate.orderId} className="flex flex-wrap gap-x-3 gap-y-1">
                                                <span>#{candidate.orderId}</span>
                                                <span>{candidate.customer}</span>
                                                <span>{candidate.neededMinutes} min</span>
                                                <span>{candidate.volume.toFixed(1)} m3</span>
                                                <span>{candidate.valid ? `geldig (${candidate.filledMinutes} min gevuld)` : candidate.reason}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      </>
                    )}

                    {plannerTab === 'wachtrij' && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="wtbl">
                          <thead>
                            <tr>
                              <th>OrderNr</th>
                              <th>Rit</th>
                              <th>Klant</th>
                              <th>Recept</th>
                              <th>Lijn</th>
                              <th>Prio</th>
                              <th>Vol (m3)</th>
                              <th>Gepland</th>
                              <th>Laadtijd</th>
                              <th>Uitvoer</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plannedActiveOrders
                              .filter(o => plannerLineFilter === 0 || o.line === plannerLineFilter)
                              .filter(o => {
                                const displayEntry = filteredPlannerDisplayEntriesByLine[o.line].find(entry => entry.order.id === o.id) || null;
                                if (!displayEntry) return false;
                                const s = plannerSearch.toLowerCase();
                                return o.customer.toLowerCase().includes(s) || o.num.includes(s) || o.recipe.toLowerCase().includes(s);
                              })
                              .sort((a, b) => {
                                  const indexA = plannerDisplayIndexByLine[a.line].get(a.id) ?? Number.MAX_SAFE_INTEGER;
                                  const indexB = plannerDisplayIndexByLine[b.line].get(b.id) ?? Number.MAX_SAFE_INTEGER;
                                  if (a.line !== b.line) return a.line - b.line;
                                  if (indexA !== indexB) return indexA - indexB;
                                  return a.customer.localeCompare(b.customer);
                                })
                                .map(o => {
                                  const displayEntries = filteredPlannerDisplayEntriesByLine[o.line];
                                  const displayEntry = displayEntries.find(entry => entry.order.id === o.id) || null;
                                  const prodStart = displayEntry?.prodStart || null;
                                  const plannerState = displayEntry?.plannerState || null;

                                return (
                                  <tr key={o.id}>
                                    <td className="font-bold">
                                      <div>{o.num}</div>
                                      <div className="text-[10px] font-medium text-gray-400">{o.productionOrder ? `PO ${o.productionOrder}` : '--'}</div>
                                    </td>
                                    <td className="text-gray-400 text-xs">{o.rit}</td>
                                    <td className="font-medium">
                                      <div className="flex items-center gap-2">
                                        {o.pkg.toLowerCase() === 'bulk' ? (
                                          <TruckIcon size={14} className="text-blue-500" />
                                        ) : (
                                          <Package size={14} className="text-orange-500" />
                                        )}
                                        <div className="min-w-0">
                                          <div className="truncate">{o.customer}</div>
                                          <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
                                            <span className={`rounded-full px-2 py-0.5 ${getPkgBadgeClass(o)}`}>
                                              {getPkgLabel(o)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="text-gray-500 text-xs">
                                      <span className="cursor-pointer hover:text-blue-600 hover:underline" onClick={() => setSelectedOrderForDetail(o)}>
                                        {o.recipe}
                                      </span>
                                    </td>
                                    <td>
                                      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: LINES[o.line].color }}>
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: LINES[o.line].color }}></span>
                                        Lijn {o.line}
                                      </span>
                                    </td>
                                    <td className={`text-center font-bold ${getEffectivePriority(o) === 1 ? 'text-re' : 'text-or'}`}>{getEffectivePriority(o)}</td>
                                    <td className="font-semibold">
                                      <div>{ev(o).toFixed(1)}</div>
                                      <div className="text-[10px] font-medium text-gray-400">x{getOrderVolumeFactor(o).toFixed(2)}</div>
                                    </td>
                                    <td className="font-bold text-gr tabular-nums">{prodStart ? fmt(prodStart) : '--'}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                        onClick={() => openEtaEdit(o)}
                                        title="ETA / laadtijd aanpassen"
                                      >
                                        {o.eta || '--'}
                                        <Pencil size={12} />
                                      </button>
                                    </td>
                                    <td>
                                      {plannerState ? (
                                        <div className="flex flex-col gap-1">
                                          <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${plannerState.cls}`}>
                                            {plannerState.label}
                                          </span>
                                          <span className="text-[11px] text-gray-500">{plannerState.reason}</span>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-gray-400">--</span>
                                      )}
                                    </td>
                                    <td>
                                      <span className={`badge ${
                                        o.status === 'running' ? 'badge-bg' : 
                                        o.status === 'arrived' ? 'badge-bb' : 
                                        'badge-gr'
                                      }`}>
                                        {o.status === 'running' ? 'Running' : 
                                         o.status === 'arrived' ? 'Gearriveerd' : 
                                         'Gepland'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {plannerTab === 'vrachtwagens' && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="wtbl">
                          <thead>
                            <tr>
                              <th>RitNr</th>
                              <th>OrderNr</th>
                              <th>Chauffeur</th>
                              <th>Klant</th>
                              <th>Laadtijd</th>
                              <th>Vol (m3)</th>
                              <th>Lijn</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {truckOrders.length > 0 ? (
                              truckOrders
                                .filter(o => plannerLineFilter === 0 || o.line === plannerLineFilter)
                                .filter(o => {
                                  const s = plannerSearch.toLowerCase();
                                  return o.customer.toLowerCase().includes(s) || o.num.includes(s) || (o.driver || '').toLowerCase().includes(s) || (o.rit || '').includes(s);
                                })
                                .map(o => (
                                  <tr key={o.id}>
                                    <td className="font-bold text-re">{o.rit || '--'}</td>
                                    <td className="font-medium">
                                      <div>{o.num}</div>
                                      <div className="text-[10px] font-medium text-gray-400">{o.productionOrder ? `PO ${o.productionOrder}` : '--'}</div>
                                    </td>
                                    <td className="text-gray-600 italic">{o.driver || 'Onbekend'}</td>
                                    <td className="font-medium">
                                      <div className="flex items-center gap-2">
                                        {o.pkg.toLowerCase() === 'bulk' ? (
                                          <TruckIcon size={14} className="text-blue-500" />
                                        ) : (
                                          <Package size={14} className="text-orange-500" />
                                        )}
                                        <div className="min-w-0">
                                          <div className="truncate">{o.customer}</div>
                                          <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
                                            <span className={`rounded-full px-2 py-0.5 ${getPkgBadgeClass(o)}`}>
                                              {getPkgLabel(o)}
                                            </span>
                                            <span className="text-gray-300">-</span>
                                            <span className="text-gray-400 normal-case font-medium">
                                              Productie order {o.productionOrder || '--'} - Order {o.num} - Rit {o.rit || '--'}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold tabular-nums text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                        onClick={() => openEtaEdit(o)}
                                        title="ETA / laadtijd aanpassen"
                                      >
                                        {o.eta || '--'}
                                        <Pencil size={13} />
                                      </button>
                                    </td>
                                    <td className="font-semibold">
                                      <div>{o.vol} m3</div>
                                      <div className="text-[10px] font-medium text-gray-400">x{getOrderVolumeFactor(o).toFixed(2)}</div>
                                    </td>
                                    <td>
                                      <span className="text-xs font-bold" style={{ color: LINES[o.line].color }}>Lijn {o.line}</span>
                                    </td>
                                    <td>
                                      <div className="flex items-center gap-2">
                                        <span className={`badge ${
                                          o.status === 'running' ? 'badge-bg' : 
                                          o.status === 'arrived' ? 'badge-bb' : 
                                          'badge-gr'
                                        }`}>
                                        {o.status === 'running' ? 'Running' : 
                                           o.status === 'arrived' ? 'Gearriveerd' : 
                                           'Gepland'}
                                        </span>
                                        {o.status === 'arrived' && (
                                          <button
                                            className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 hover:text-blue-700 transition-colors"
                                            onClick={() => {
                                              setArrivedOrder(o);
                                              setArrivedTime(o.eta || '');
                                              setArrivedHoldLoadTime(!!o.holdLoadTime);
                                            }}
                                            title="Wijzig laadtijd"
                                          >
                                            <Pencil size={15} />
                                          </button>
                                        )}
                                        {o.status === 'arrived' && (
                                          <button
                                            className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 hover:text-gray-700 transition-colors"
                                            onClick={() => handleResetArrived(o.id)}
                                            title="Zet terug naar Gepland"
                                          >
                                            <RefreshCw size={15} />
                                          </button>
                                        )}
                                        {o.status === 'planned' && (
                                          <button 
                                            className="w-8 h-8 rounded-lg bg-gr text-white flex items-center justify-center hover:bg-gr/80 transition-colors"
                                            onClick={() => {
                                              setArrivedOrder(o);
                                              setArrivedTime(o.eta || fmt(new Date()));
                                              setArrivedHoldLoadTime(!!o.holdLoadTime);
                                            }}
                                          >
                                            <Check size={16} />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                            ) : (
                              <tr>
                                <td colSpan={8} className="p-10 text-center text-gray-400 italic">Geen vrachtwagenritten (Bulk/M3) gepland</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {plannerTab === 'chauffeurs' && (
                      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                          <div className="max-h-[78vh] overflow-y-auto px-4 pb-4">
                          <div className="sticky top-0 z-20 -mx-4 px-4 pt-4 pb-3 mb-3 bg-white border-b border-gray-100 shadow-[0_6px_10px_-8px_rgba(15,23,42,0.28)]">
                            <div className="text-lg font-bold text-gray-800">Beschikbare chauffeurs</div>
                            <div className="text-sm text-gray-500">Centrale chauffeurslijst uit Supabase. Klik om de dagvrachten te zien of sleep naar een vracht.</div>
                            {driverSyncDebug && (
                              <div className="mt-2 text-xs font-medium text-blue-600">{driverSyncDebug}</div>
                            )}
                            <div className="mt-3">
                              <button
                                type="button"
                                className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                                onClick={() => setShowDriverForm(prev => !prev)}
                                disabled={isSavingDriver}
                              >
                                {showDriverForm ? 'Formulier sluiten' : '+ Chauffeur'}
                              </button>
                            </div>
                            {showDriverForm && (
                              <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                                <div className="grid grid-cols-1 gap-2">
                                  <input
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                    placeholder="Naam chauffeur *"
                                    value={newDriverForm.name}
                                    onChange={(e) => setNewDriverForm(prev => ({ ...prev, name: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddDriver();
                                      }
                                    }}
                                  />
                                  <input
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                    placeholder="Bedrijf"
                                    value={newDriverForm.company}
                                    onChange={(e) => setNewDriverForm(prev => ({ ...prev, company: e.target.value }))}
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                      placeholder="Kenteken truck"
                                      value={newDriverForm.truckPlate}
                                      onChange={(e) => setNewDriverForm(prev => ({ ...prev, truckPlate: e.target.value }))}
                                    />
                                    <input
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                      placeholder="Kenteken trailer"
                                      value={newDriverForm.trailerPlate}
                                      onChange={(e) => setNewDriverForm(prev => ({ ...prev, trailerPlate: e.target.value }))}
                                    />
                                  </div>
                                  <div className="grid grid-cols-3 gap-2">
                                    <input
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                      placeholder="Hoogte"
                                      value={newDriverForm.vehicleHeightM}
                                      onChange={(e) => setNewDriverForm(prev => ({ ...prev, vehicleHeightM: e.target.value }))}
                                    />
                                    <input
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                      placeholder="Stuurassen"
                                      value={newDriverForm.steeringAxles}
                                      onChange={(e) => setNewDriverForm(prev => ({ ...prev, steeringAxles: e.target.value }))}
                                    />
                                    <input
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                      placeholder="Max kg"
                                      value={newDriverForm.maxWeightKg}
                                      onChange={(e) => setNewDriverForm(prev => ({ ...prev, maxWeightKg: e.target.value }))}
                                    />
                                  </div>
                                  <textarea
                                    className="min-h-[72px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-500"
                                    placeholder="Notities"
                                    value={newDriverForm.notes}
                                    onChange={(e) => setNewDriverForm(prev => ({ ...prev, notes: e.target.value }))}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                                      onClick={() => {
                                        setNewDriverForm(EMPTY_DRIVER_FORM);
                                        setShowDriverForm(false);
                                      }}
                                      disabled={isSavingDriver}
                                    >
                                      Annuleren
                                    </button>
                                    <button
                                      type="button"
                                      className="flex-1 rounded-xl bg-green-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-green-300"
                                      onClick={handleAddDriver}
                                      disabled={isSavingDriver || !newDriverForm.name.trim()}
                                    >
                                      {isSavingDriver ? 'Opslaan...' : 'Opslaan'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="mt-3">
                              <input
                                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-500"
                                placeholder="Zoek chauffeur"
                                value={chauffeurSearch}
                                onChange={(e) => setChauffeurSearch(e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="space-y-2 pr-1">
                            {visiblePlannerDriversSorted.length > 0 ? visiblePlannerDriversSorted.map(driver => (
                              <div
                                key={driver.name}
                                draggable={driver.active}
                                role="button"
                                tabIndex={0}
                                className={`w-full text-left rounded-xl border p-4 transition-all ${selectedDriverName === driver.name ? 'border-gr bg-green-50' : driver.active ? 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50' : 'border-amber-200 bg-amber-50/50 opacity-75'}`}
                                onClick={() => setSelectedDriverName(prev => prev === driver.name ? '' : driver.name)}
                                onDragStart={(e) => {
                                  if (!driver.active) {
                                    e.preventDefault();
                                    return;
                                  }
                                  e.dataTransfer.setData('text/plain', driver.name);
                                  e.dataTransfer.effectAllowed = 'move';
                                  setDraggedDriverName(driver.name);
                                }}
                                onDragEnd={() => setDraggedDriverName('')}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter' && e.key !== ' ') return;
                                  e.preventDefault();
                                  setSelectedDriverName(prev => prev === driver.name ? '' : driver.name);
                                }}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="font-bold text-gray-800 truncate">{driver.name}</div>
                                      {!driver.active && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                          Afwezig
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-sm text-gray-400">{driver.count} gekoppelde orders</div>
                                    <div className="mt-1 text-xs text-gray-400">
                                      {driver.lines.map(line => `ML${line}`).join(' - ')}
                                    </div>
                                    {(driver.count > 0 || driver.totalVolume > 0) && (
                                      <div className="mt-1 text-xs text-gray-400">
                                        {driver.firstStart !== null && driver.lastEnd !== null
                                          ? `${minsToTime(driver.firstStart)} - ${minsToTime(driver.lastEnd)}`
                                          : '--'}
                                        {' - '}
                                        {driver.totalVolume.toFixed(1)} m3
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-2">
                                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedDriverName === driver.name ? 'bg-green-100 text-gr' : 'bg-gray-100 text-gray-500'}`}>
                                      {driver.count}
                                    </div>
                                    <label
                                      className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={!driver.active}
                                        onChange={(e) => void handleToggleDriverAbsent(driver.name, e.target.checked)}
                                      />
                                      Afwezig
                                    </label>
                                  </div>
                                </div>
                                {driver.conflictCount > 0 && (
                                  <div className="mt-2 inline-flex rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600">
                                    {driver.conflictCount} conflict{driver.conflictCount === 1 ? '' : 'en'}
                                  </div>
                                )}
                              </div>
                            )) : (
                              <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                                Geen chauffeurs gevonden voor deze zoekopdracht
                              </div>
                            )}
                          </div>
                          </div>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                          <div className="max-h-[78vh] overflow-y-auto px-4 pb-4">
                          <div className="sticky top-0 z-20 -mx-4 px-4 pt-4 pb-3 mb-3 bg-white border-b border-gray-100 shadow-[0_6px_10px_-8px_rgba(15,23,42,0.28)]">
                            <div className="mb-4 flex items-start justify-between gap-4">
                              <div>
                                <div className="text-lg font-bold text-gray-800">Orders</div>
                                <div className="text-sm text-gray-500">Sleep een chauffeur naar een vracht. De gekoppelde rit neemt dezelfde chauffeur over.</div>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${chauffeurActionFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                  onClick={() => setChauffeurActionFilter('all')}
                                >
                                  Alles ({chauffeurActionCounts.all})
                                </button>
                                <button
                                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${chauffeurActionFilter === 'unassigned' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                  onClick={() => setChauffeurActionFilter('unassigned')}
                                >
                                  Ongekoppeld ({chauffeurActionCounts.unassigned})
                                </button>
                                <button
                                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${chauffeurActionFilter === 'conflicts' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                  onClick={() => setChauffeurActionFilter('conflicts')}
                                >
                                  Conflicten ({chauffeurActionCounts.conflicts})
                                </button>
                              </div>
                            </div>

                            <div className="mb-4 flex gap-2">
                              <button
                                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${chauffeurTypeFilter === 'bulk' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                onClick={() => setChauffeurTypeFilter('bulk')}
                              >
                                Bulk
                              </button>
                              <button
                                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${chauffeurTypeFilter === 'packed' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                onClick={() => setChauffeurTypeFilter('packed')}
                              >
                                Verpakt
                              </button>
                            </div>

                            {selectedDriverName && (
                              <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-4">
                                  <div>
                                    <div className="text-lg font-bold text-blue-900">{selectedDriverName}</div>
                                    <div className="text-sm text-blue-700">{selectedDriverOrders.length} vrachten op deze dag</div>
                                  </div>
                                  <div className="badge badge-bb">{selectedDriverOrders.length} vrachten</div>
                                </div>
                                {selectedDriverOrders.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                                    <div className="rounded-full bg-white px-3 py-1 text-blue-800 border border-blue-200">
                                      Totaal: {selectedDriverOrders.reduce((sum, order) => sum + ev(order), 0).toFixed(1)} m3
                                    </div>
                                    <div className="rounded-full bg-white px-3 py-1 text-blue-800 border border-blue-200">
                                      Lijnen: {Array.from(new Set(selectedDriverOrders.map(order => `ML${order.line}`))).join(' - ')}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {chauffeurOrders.length > 0 ? (
                            <div className="space-y-3 pr-1">
                              {selectedDriverName && selectedDriverOrders.length > 0 && (
                                <div className="mb-4 space-y-2">
                                  {selectedDriverOrders.map(o => (
                                    <div key={`selected-${o.id}`} className="rounded-xl border border-blue-200 bg-blue-50/40 px-3 py-2 text-sm text-blue-900">
                                      <div className="font-semibold">{o.customer}</div>
                                      <div className="text-xs text-blue-700">
                                        {getOrderRefLabel(o)} - Rit {o.rit || '--'} - {ev(o).toFixed(1)} m3 - Lijn {o.line} - {o.eta || '--'}
                                      </div>
                                      {o.pkg === 'bulk' && getDriverOccupancyWindow(o) && (
                                        <div className="mt-1 text-xs text-blue-700">
                                          Bezet: {minsToTime(getDriverOccupancyWindow(o)!.start)} - {minsToTime(getDriverOccupancyWindow(o)!.end)}
                                        </div>
                                      )}
                                      {o.pkg === 'bulk' && driverConflictOrderIds.has(o.id) && (
                                        <div className="mt-1 text-xs font-semibold text-red-600">Conflict in planningstijd</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {visibleChauffeurOrders.map(o => {
                                const entry = lineTimelineEntryByOrderId[o.line].get(o.id) || null;
                                const hasDriverConflict = o.pkg === 'bulk' && driverConflictOrderIds.has(o.id);
                                return (
                                  <div key={o.id} className="rounded-2xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between gap-6">
                                      <div className="min-w-0 flex-1">
                                        <div className="font-bold text-2xl text-gray-800 truncate">{o.customer}</div>
                                        <div className="text-sm text-gray-400 mt-1">
                                          {getOrderRefLabel(o)} - Rit {o.rit || '--'} - {o.recipe} - {ev(o).toFixed(1)} m3
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
                                          <div>Gepland: <span className="font-semibold text-gray-700">{entry ? fmt(entry.prodStart) : '--'}</span></div>
                                          <div>Laadtijd: <span className="font-semibold text-gray-700">{o.eta || '--'}</span></div>
                                          <div>Eenheid: <span className="font-semibold text-gray-700 uppercase">{o.pkg === 'bulk' ? 'M3' : o.pkg === 'bag' ? 'BAG' : o.pkg === 'bale' ? 'BAL' : 'PKG'}</span></div>
                                          <div>Reden: <span className="font-semibold text-gray-700">{getChauffeurOrderReason(o)}</span></div>
                                          {o.pkg === 'bulk' && getDriverOccupancyWindow(o) && (
                                            <div>Bezet tot: <span className="font-semibold text-gray-700">{minsToTime(getDriverOccupancyWindow(o)!.end)}</span></div>
                                          )}
                                        </div>
                                        {hasDriverConflict && (
                                          <div className="mt-2 text-sm font-semibold text-red-600">Chauffeurconflict: overlappende planning</div>
                                        )}
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <div className="text-xs font-semibold" style={{ color: LINES[o.line].color }}>Lijn {o.line}</div>
                                        <div className="mt-2 badge badge-gr">
                                          {o.status === 'arrived' ? 'Gearriveerd' : o.status === 'running' ? 'Running' : 'Gepland'}
                                        </div>
                                      </div>
                                      <div
                                      className={`shrink-0 w-full max-w-[390px] rounded-[26px] border-2 border-dashed px-6 py-5 transition-colors ${draggedDriverName ? 'border-blue-500 bg-blue-50/80' : o.driver ? 'border-blue-500 bg-blue-50/70' : 'border-gray-200 bg-gray-50'}`}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        const driverName = e.dataTransfer.getData('text/plain') || draggedDriverName;
                                        if (driverName) handleAssignDriverToOrder(o.id, driverName);
                                      }}
                                    >
                                      <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                          <div className="text-sm text-gray-400">Chauffeur</div>
                                          <div className={`mt-1 text-[18px] font-bold leading-tight ${o.driver ? 'text-blue-700' : 'text-gray-500'}`}>
                                            {o.driver || 'Sleep chauffeur hierheen'}
                                          </div>
                                          {selectedDriverName && o.driver === selectedDriverName && (
                                            <div className="mt-1 text-xs font-medium text-blue-700">Geselecteerde chauffeur</div>
                                          )}
                                        </div>
                                        {o.driver && (
                                          <button
                                            className="rounded-xl bg-white/90 px-4 py-3 text-base font-semibold text-gray-900 shadow-sm border border-gray-100 hover:bg-white"
                                            onClick={() => handleClearDriverFromOrder(o.id)}
                                          >
                                            Wissen
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400 italic">
                              Geen orders beschikbaar voor deze selectie
                            </div>
                          )}
                          </div>
                        </div>
                      </div>
                    )}

                    {plannerTab === 'voltooid' && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
                          <div className="text-sm text-gray-500">
                            {completedOrders.length} voltooide orders opgeslagen
                          </div>
                          {completedOrders.length > 0 && (
                            <button
                              className="btn btn-s btn-sm"
                              onClick={handleClearCompletedOrders}
                            >
                              Leeg Voltooid
                            </button>
                          )}
                        </div>
                        <table className="wtbl">
                          <thead>
                            <tr>
                              <th>OrderNr</th>
                              <th>Klant</th>
                              <th>Recept</th>
                              <th>Lijn</th>
                              <th>Vol (m3)</th>
                              <th>Eenheid</th>
                              <th>Status</th>
                              <th>Actie</th>
                            </tr>
                          </thead>
                          <tbody>
                            {completedOrders.length > 0 ? completedOrders.map(o => (
                              <tr key={o.id}>
                                <td className="font-bold">
                                  <div>{o.num}</div>
                                  <div className="text-[10px] font-medium text-gray-400">{o.productionOrder ? `PO ${o.productionOrder}` : '--'}</div>
                                </td>
                                <td>{o.customer}</td>
                                <td className="text-gray-500 text-xs">{o.recipe}</td>
                                <td>Lijn {o.line}</td>
                                <td className="font-semibold">{ev(o).toFixed(1)}</td>
                                <td className="text-xs uppercase font-bold text-gray-500">{o.pkg === 'bulk' ? 'M3' : o.pkg === 'bag' ? 'BAG' : o.pkg === 'bale' ? 'BAL' : 'PKG'}</td>
                                <td><span className="badge badge-bg">Voltooid</span></td>
                                <td>
                                  <button
                                    className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 hover:text-gray-700 transition-colors"
                                    onClick={() => handleRestoreCompletedOrder(o.id)}
                                    title="Zet terug naar gepland"
                                  >
                                    <X size={15} />
                                  </button>
                                </td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={8} className="p-10 text-center text-gray-400 italic">Nog geen voltooide orders vandaag</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}

            {view === 'notifications' && (
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-4.5">
                  <div>
                    <h1 className="text-lg font-bold">Meldingen</h1>
                    {notifications.filter(m => !m.gelezen).length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {notifications.filter(m => !m.gelezen).length} ongelezen
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      className="btn btn-s btn-sm"
                      onClick={() => setNotifications(prev => prev.map(m => ({ ...m, gelezen: true })))}
                    >
                      Alles gelezen
                    </button>
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                  {notifications.length > 0 ? notifications.map(m => (
                    <div 
                      key={m.id} 
                      className={`flex items-start gap-3.5 p-4 cursor-pointer transition-colors ${m.gelezen ? 'bg-gray-50' : 'bg-white'}`}
                      onClick={() => setNotifications(prev => prev.map(item => item.id === m.id ? { ...item, gelezen: true } : item))}
                    >
                      <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-lg shrink-0">
                        {m.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <div className={`text-[13px] font-bold ${m.gelezen ? 'text-gray-500' : 'text-gray-800'}`}>{m.titel}</div>
                          {m.lijn && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">ML{m.lijn}</span>}
                          {!m.gelezen && <span className="w-1.5 h-1.5 rounded-full bg-gr shrink-0"></span>}
                        </div>
                        <div className="text-xs text-gray-500">{m.tekst}</div>
                      </div>
                      <div className="text-[10px] text-gray-400 shrink-0 text-right">
                        {m.tijd.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )) : (
                    <div className="p-10 text-center text-gray-400">
                      <Bell size={32} className="mx-auto mb-3 opacity-20" />
                      <div className="text-sm">Geen meldingen</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {view === 'bunkers' && (
              <div className="max-w-6xl mx-auto">
                <h1 className="text-lg font-bold mb-5">Bunkerbeheer</h1>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(Object.keys(LINES) as unknown as LineId[]).map(lid => (
                    <div key={lid} className="bg-white border border-gray-200 rounded-lg p-5">
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: LINES[lid].color }}></div>
                          <div className="text-[15px] font-bold">{LINES[lid].full}</div>
                        </div>
                        <span className="text-xs text-gray-400">
                          {bunkers[lid].filter(b => b.m).length}/{bunkers[lid].length} gevuld
                        </span>
                      </div>
                      <div className="space-y-2">
                        {bunkers[lid].map(b => (
                          <div 
                            key={b.c} 
                            className="grid grid-cols-[44px_1fr_auto] items-center gap-2 p-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors rounded"
                            onClick={() => {
                              setSelectedBunker({ lid, bunker: b });
                              setShowAllMaterials(false);
                              setNewCalibrationName('');
                              setNewCalibrationCode('');
                              setNewCalibrationValue('');
                            }}
                          >
                            <div className="text-[11px] font-bold text-gray-700">{b.c}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-600 truncate">{b.m || 'Leeg'}</div>
                              {b.mc && <div className="text-[9px] text-gray-400 font-mono">{b.mc}</div>}
                              {b.calibrationValue !== null && b.calibrationValue !== undefined && (
                                <div className="text-[9px] text-blue-500 font-bold">K: {b.calibrationValue}</div>
                              )}
                            </div>
                            {b.fx && <span className="text-[9px] font-bold text-or">VAST</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view === 'settings' && (
              <div className="max-w-4xl mx-auto">
                <h1 className="text-lg font-bold mb-4.5">Instellingen</h1>

                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Tijdsinstellingen & Planning</h2>
                  <div className="space-y-5">
                    {lineIds.map(lid => (
                      <div key={lid} className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: LINES[lid].color }}></div>
                          <div className="font-bold text-gray-800">{LINES[lid].name}</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="fg">
                            <label className="fl">Start Dag (Voorbereiding)</label>
                            <input
                              type="time"
                              className="fi"
                              value={lineTiming[lid].dayStart}
                              onChange={(e) => setLineTiming(prev => ({
                                ...prev,
                                [lid]: { ...prev[lid], dayStart: normalizeEta(e.target.value) || prev[lid].dayStart }
                              }))}
                            />
                            <div className="text-[11px] text-gray-400 mt-1">Tijdstip waarop de voorbereiding begint.</div>
                          </div>
                          <div className="fg">
                            <label className="fl">Start Eerste Order</label>
                            <input
                              type="time"
                              className="fi"
                              value={lineTiming[lid].firstOrderStart}
                              onChange={(e) => setLineTiming(prev => ({
                                ...prev,
                                [lid]: { ...prev[lid], firstOrderStart: normalizeEta(e.target.value) || prev[lid].firstOrderStart }
                              }))}
                            />
                            <div className="text-[11px] text-gray-400 mt-1">Vaste start van de eerste order op deze lijn.</div>
                          </div>
                          <div className="fg">
                            <label className="fl">Wisseltijd (min)</label>
                            <input
                              type="number"
                              min={0}
                              className="fi"
                              value={config[lid].wissel}
                              onChange={(e) => {
                                const next = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                                setConfig(prev => ({
                                  ...prev,
                                  [lid]: { ...prev[lid], wissel: next }
                                }));
                              }}
                            />
                            <div className="text-[11px] text-gray-400 mt-1">Extra tijd per grondstofwissel.</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Lijnsnelheden</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(Object.keys(LINES) as unknown as LineId[]).map(lid => (
                      <div key={lid}>
                        <label className="text-xs font-semibold text-gray-500 mb-1.5 block">{LINES[lid].name} (m3/min)</label>
                        <input type="number" className="fi" defaultValue={LINES[lid].speed} step="0.1" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Triggers</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
                    {visiblePlannerTriggers.map(trigger => (
                      <div key={trigger.key} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                        <div className="font-semibold text-gray-800 mb-1">{trigger.label}</div>
                        <div>{trigger.description || 'Geen omschrijving'}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Lokale CSV Import</h2>
                  <div className="space-y-3">
                    <div className="text-xs text-gray-500">
                      Importeer een lokale order-CSV met kolommen zoals `Menglijn`, `Order Nummer`, `Klantnaam`, `Product`, `Item / recept`, `Ritnummer`, `Geplande hoeveelheid`, `Gepland aantal` en `Eenheid`. Als de CSV geen `Datum` kolom heeft, gebruiken we de importdatum hieronder.
                    </div>
                    <label className="block">
                      <span className="block text-[11px] font-medium text-gray-500 mb-1">Importdatum</span>
                      <input
                        type="date"
                        className="fi fi-lg max-w-[220px]"
                        value={csvImportDate}
                        onChange={(e) => setCsvImportDate(e.target.value || formatLocalDate(new Date()))}
                        disabled={isImportingCsv || dataSource.loading}
                      />
                    </label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="fi"
                      onChange={async (e) => {
                        const file = e.target.files?.[0] || null;
                        await handleLocalCsvImport(file);
                        e.currentTarget.value = '';
                      }}
                      disabled={isImportingCsv || dataSource.loading}
                    />
                    <div className="text-[11px] text-gray-400">
                      De import schrijft direct naar Supabase en ververst daarna de orders in de app. Zonder CSV-datum wordt `order_date` gevuld met deze importdatum.
                    </div>
                    {csvImportFeedback && (
                      <div className={`text-[11px] font-medium ${
                        csvImportFeedback.type === 'ok'
                          ? 'text-green-600'
                          : csvImportFeedback.type === 'error'
                            ? 'text-red-600'
                            : 'text-blue-600'
                      }`}>
                        {csvImportFeedback.text}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Synchronisatie</h2>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs text-gray-500">
                      Realtime Supabase is leidend. Auto-sync draait elke 15 minuten als vangnet en wordt rood gemeld als er iets misgaat. Gebruik handmatig verversen alleen bij twijfel.
                    </div>
                    <button
                      type="button"
                      className="btn btn-p btn-sm whitespace-nowrap"
                      onClick={laadOrders}
                      disabled={dataSource.loading || isImportingCsv || isClearingOrders}
                    >
                      <RefreshCw size={14} className={dataSource.loading ? 'animate-spin' : ''} />
                      {dataSource.loading ? 'Bezig...' : 'Nood-sync orders'}
                    </button>
                  </div>
                  <div className="mt-3 text-[11px] text-gray-400">
                    Laatste vangnet-sync: {dataSource.lastSync ? new Date(dataSource.lastSync).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : 'Nog niet'}
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                  <h2 className="text-sm font-bold mb-3.5">Beheer</h2>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-xs text-gray-500">
                      Wis alle orders uit Supabase en verwijder ook de lokale planningscache.
                    </div>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                      onClick={clearAllOrders}
                      disabled={isClearingOrders || dataSource.loading}
                    >
                      {isClearingOrders ? 'Orders leegmaken...' : 'Orders leegmaken'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Bunker Edit Modal */}
        <AnimatePresence>
          {selectedBunker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
              >
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Bunker Aanpassen: {selectedBunker.bunker.c}</h2>
                    <p className="text-sm text-gray-400">Lijn {selectedBunker.lid} - {LINES[selectedBunker.lid].full}</p>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedBunker(null);
                      setShowAllMaterials(false);
                      setNewCalibrationName('');
                      setNewCalibrationCode('');
                      setNewCalibrationValue('');
                    }}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-6 max-h-[60vh] overflow-y-auto">
                  <div className="mb-4">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Huidige Grondstof</label>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-gray-800">{selectedBunker.bunker.m || 'Leeg'}</div>
                        {selectedBunker.bunker.mc && <div className="text-xs text-gray-400 font-mono">{selectedBunker.bunker.mc}</div>}
                      </div>
                      <button 
                        className="text-xs font-bold text-re hover:underline"
                        onClick={() => handleBunkerUpdate(selectedBunker.lid, selectedBunker.bunker.c, null)}
                      >
                        Leegmaken
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 p-3 bg-blue-50/60 rounded-xl border border-blue-100">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                      <div>
                        <label className="text-[11px] font-bold text-blue-500 uppercase tracking-wider block">Kalibratie Toevoegen</label>
                        <p className="text-[11px] text-gray-500 mt-1">Nieuwe grondstof voor deze bunker.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddCalibrationToBunker}
                        disabled={isSavingCalibration}
                        className="px-3 py-2 rounded-lg bg-blue-500 text-white text-[11px] font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                      >
                        {isSavingCalibration ? 'Opslaan...' : '+ Kalibratie toevoegen'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Grondstof</label>
                        <input
                          type="text"
                          value={newCalibrationName}
                          onChange={e => setNewCalibrationName(e.target.value)}
                          placeholder="Bijv. Perliet Grof"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Code</label>
                        <input
                          type="text"
                          value={newCalibrationCode}
                          onChange={e => setNewCalibrationCode(e.target.value)}
                          placeholder="Bijv. 7001234"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Kalibratie</label>
                        <input
                          type="text"
                          value={newCalibrationValue}
                          onChange={e => setNewCalibrationValue(e.target.value)}
                          placeholder="Bijv. 3.2"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                        {showAllMaterials ? 'Alle Grondstoffen' : 'Gekalibreerde Grondstoffen'}
                      </label>
                      <button 
                        onClick={() => setShowAllMaterials(!showAllMaterials)}
                        className="text-[10px] font-bold text-blue-500 hover:underline uppercase"
                      >
                        {showAllMaterials ? 'Toon alleen gekalibreerd' : 'Toon alles (foutieve vulling)'}
                      </button>
                    </div>
                    <div className="space-y-2 mb-6">
                      {allAvailableMaterials
                        .filter(m => {
                          if (m.name === selectedBunker.bunker.m) return false;
                          if (showAllMaterials) return true;
                          // Default: only show calibrated/allowed materials for this bunker
                          return selectedBunker.bunker.ms.includes(m.name);
                        })
                        .sort((a, b) => {
                          const aAllowed = selectedBunker.bunker.ms.includes(a.name);
                          const bAllowed = selectedBunker.bunker.ms.includes(b.name);
                          
                          if (aAllowed && !bAllowed) return -1;
                          if (!aAllowed && bAllowed) return 1;
                          
                          const aInPlanning = orders.flatMap(o => o.components).some(c => c.name === a.name);
                          const bInPlanning = orders.flatMap(o => o.components).some(c => c.name === b.name);
                          
                          if (aInPlanning && !bInPlanning) return -1;
                          if (!aInPlanning && bInPlanning) return 1;
                          
                          return a.name.localeCompare(b.name);
                        })
                        .map(m => {
                          const inPlanning = orders.flatMap(o => o.components).some(c => c.name === m.name);
                          const isAllowed = selectedBunker.bunker.ms.includes(m.name);
                          
                          // Use bunker-specific data if available
                          const specificData = selectedBunker.bunker.materialData?.[m.name];
                          const displayCode = specificData?.code || m.code;
                          const displayCal = specificData?.calibrationValue ?? m.calibrationValue;
                          const hasCal = displayCal !== null;

                          return (
                            <button 
                              key={m.name}
                              className={`w-full p-3 text-left rounded-xl border transition-colors flex items-center justify-between ${
                                isAllowed 
                                  ? 'border-blue-200 bg-blue-50/50 hover:bg-blue-100' 
                                  : 'border-gray-200 bg-white hover:bg-gray-50'
                              }`}
                              onClick={() => handleBunkerUpdate(selectedBunker.lid, selectedBunker.bunker.c, m.name)}
                            >
                              <div>
                                <div className="text-sm font-bold text-gray-800">{m.name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {displayCode && <span className="text-[10px] text-gray-400 font-mono">{displayCode}</span>}
                                  {hasCal && <span className="text-[10px] text-blue-500 font-bold">K: {displayCal}</span>}
                                </div>
                              </div>
                              <div className="flex gap-1">
                                {inPlanning && <span className="text-[9px] font-bold text-gr bg-grl px-2 py-0.5 rounded-full uppercase">In Planning</span>}
                                {isAllowed && <span className="text-[9px] font-bold text-blue-500 bg-blue-100 px-2 py-0.5 rounded-full uppercase">Gekalibreerd</span>}
                              </div>
                            </button>
                          );
                        })}
                      {!showAllMaterials && allAvailableMaterials.filter(m => selectedBunker.bunker.ms.includes(m.name)).length === 0 && (
                        <div className="text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                          <p className="text-xs text-gray-400 mb-2">Geen specifieke grondstoffen gekalibreerd voor deze bunker.</p>
                          <button 
                            onClick={() => setShowAllMaterials(true)}
                            className="text-[10px] font-bold text-blue-500 hover:underline uppercase"
                          >
                            Toon alle grondstoffen
                          </button>
                        </div>
                      )}
                      {allAvailableMaterials.length === 0 && (
                        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                          <p className="text-sm text-gray-400">Geen grondstoffen gevonden.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-6 bg-gray-50/50 flex justify-end">
                  <button 
                    className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                    onClick={() => {
                      setSelectedBunker(null);
                      setShowAllMaterials(false);
                      setNewCalibrationName('');
                      setNewCalibrationCode('');
                      setNewCalibrationValue('');
                    }}
                  >
                    Sluiten
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Issue Modal */}
        <AnimatePresence>
          {issueDialogType && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden"
              >
                <div className="p-7 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <h2 className={`text-[22px] font-bold flex items-center gap-3 ${
                      issueDialogType === 'storing' ? 'text-red-800' : 'text-blue-600'
                    }`}>
                      {issueDialogType === 'storing' ? <AlertTriangle size={26} /> : <Wrench size={26} />}
                      {issueDialogType === 'storing' ? 'Storing melden' : 'Onderhoud melden'} — {LINES[selectedLine].name}
                    </h2>
                    <p className="text-[18px] text-gray-400 mt-1">Vul in wat er aan de hand is</p>
                  </div>
                  <button
                    onClick={closeIssueDialog}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-300 transition-colors"
                  >
                    <X size={28} />
                  </button>
                </div>

                <div className="p-7 space-y-6">
                  <div>
                    <label className="block text-[18px] font-semibold text-gray-500 mb-3">
                      {issueDialogType === 'storing' ? 'Omschrijving storing *' : 'Omschrijving onderhoud *'}
                    </label>
                    <textarea
                      className="w-full min-h-[180px] rounded-2xl border border-gray-300 px-5 py-4 text-[18px] text-gray-800 placeholder:text-gray-400 outline-none focus:border-gr"
                      value={issueDescription}
                      onChange={(e) => setIssueDescription(e.target.value)}
                      placeholder={issueDialogType === 'storing'
                        ? 'bv. Transportband defect, sensor alarm, lekkage...'
                        : 'bv. Lagers smeren, reinigen, inspectie, afstelling...'}
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[18px] font-semibold text-gray-500 mb-3">Verwachte hersteltduur (min)</label>
                      <input
                        type="number"
                        min="1"
                        className="fi !h-18 !text-[18px]"
                        value={issueDuration}
                        onChange={(e) => setIssueDuration(e.target.value)}
                        placeholder="bv. 30"
                      />
                      <div className="mt-3 text-[14px] text-gray-400">Laat leeg als onbekend</div>
                    </div>
                    <div>
                      <label className="block text-[18px] font-semibold text-gray-500 mb-3">
                        {issueDialogType === 'storing' ? 'Storing gestart' : 'Onderhoud gestart'}
                      </label>
                      <div className="relative">
                        <input
                          type="time"
                          className="fi !h-18 !text-[18px]"
                          value={issueStartTime}
                          onChange={(e) => setIssueStartTime(e.target.value)}
                        />
                      </div>
                      <div className="mt-3 text-[14px] text-gray-400">Plan onderhoud of storing vanaf dit tijdstip</div>
                    </div>
                  </div>

                  <div className={`rounded-2xl px-6 py-5 text-[18px] ${
                    issueDialogType === 'storing' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-600'
                  }`}>
                    <span className="mr-2">💡</span>
                    De planning kan later automatisch aangepast worden op basis van de verwachte hersteltduur
                  </div>
                </div>

                <div className="p-7 bg-gray-50/50 flex justify-end gap-4">
                  <button
                    className="px-12 py-4 rounded-2xl font-bold text-[18px] text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors"
                    onClick={closeIssueDialog}
                  >
                    Annuleren
                  </button>
                  <button
                    className={`px-12 py-4 rounded-2xl font-bold text-[18px] text-white transition-colors disabled:opacity-50 ${
                      issueDialogType === 'storing' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                    onClick={handleIssueSave}
                    disabled={!issueDescription.trim()}
                  >
                    {issueDialogType === 'storing' ? '🔴 Storing opslaan' : '🔧 Onderhoud opslaan'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Arrived Modal */}
        <AnimatePresence>
          {arrivedOrder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Chauffeur gearriveerd of arriveert om:</h2>
                    <p className="text-sm text-gray-400">{arrivedOrder.customer}</p>
                  </div>
                  <button 
                    onClick={() => { setArrivedOrder(null); setArrivedHoldLoadTime(false); }}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-6">
                    <p className="text-sm text-gray-500 mb-6">
                      Vul of bevestig de laadtijd. Daarna gaat deze bulkorder naar <span className="font-bold text-gray-700">Prio 1</span> en de status naar <span className="font-bold text-gray-700">Gearriveerd</span>. Als de truck later komt, kun je hier de tijd opnieuw wijzigen of hem rechts weer terugzetten naar <span className="font-bold text-gray-700">Gepland</span>.
                    </p>
                  
                  <div className="fg">
                    <label className="fl">Laadtijd *</label>
                    <div className="relative">
                      <input 
                        type="time"
                        className="fi !pl-4 !pr-10"
                        value={arrivedTime}
                        onChange={(e) => setArrivedTime(e.target.value)}
                        autoFocus
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <Clock size={18} />
                      </div>
                    </div>
                  </div>

                  <label className="mt-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      checked={arrivedHoldLoadTime}
                      onChange={(e) => setArrivedHoldLoadTime(e.target.checked)}
                    />
                    <span className="text-sm text-gray-700">
                      <span className="block font-semibold text-gray-900">Laadtijd aanhouden</span>
                      Houd deze wagen als vast blok vooraan. De planner laat hier dan niet onnodig andere verpakte orders tussendoor schuiven.
                    </span>
                  </label>
                </div>
                
                <div className="p-6 bg-gray-50/50 flex justify-end gap-3">
                  <button 
                    className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                    onClick={() => { setArrivedOrder(null); setArrivedHoldLoadTime(false); }}
                  >
                    Annuleren
                  </button>
                  <button 
                    className="px-8 py-2.5 rounded-xl font-bold text-white bg-gr hover:bg-gr/90 transition-colors"
                    onClick={handleArrivedConfirm}
                  >
                    Bevestigen
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ETA Edit Modal */}
        <AnimatePresence>
          {etaEditOrder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeEtaEdit}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">ETA / laadtijd aanpassen</h2>
                    <p className="text-sm text-gray-400">{etaEditOrder.customer}</p>
                  </div>
                  <button
                    onClick={closeEtaEdit}
                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6">
                  <p className="text-sm text-gray-500 mb-6">
                    Pas alleen de verwachte laadtijd aan. De orderstatus blijft verder hetzelfde.
                  </p>
                  <div className="fg">
                    <label className="fl">ETA / laadtijd *</label>
                    <div className="relative">
                      <input
                        type="time"
                        className="fi !pl-4 !pr-10"
                        value={etaEditTime}
                        onChange={(e) => setEtaEditTime(e.target.value)}
                        autoFocus
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <Clock size={18} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-gray-50/50 flex justify-end gap-3">
                  <button
                    className="px-6 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                    onClick={closeEtaEdit}
                  >
                    Annuleren
                  </button>
                  <button
                    className="px-8 py-2.5 rounded-xl font-bold text-white bg-gr hover:bg-gr/90 transition-colors disabled:opacity-50"
                    onClick={handleEtaEditConfirm}
                    disabled={!normalizeEta(etaEditTime)}
                  >
                    Opslaan
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Order Detail Modal */}
        <AnimatePresence>
          {selectedOrderForDetail && (
            <OrderDetailModal 
              order={selectedOrderForDetail} 
              onClose={() => setSelectedOrderForDetail(null)}
              lineBunkers={bunkers[selectedOrderForDetail.line]}
              lineConfig={config[selectedOrderForDetail.line]}
              lineSpeed={LINES[selectedOrderForDetail.line].speed}
              getLineMoveBlockers={(targetLine) => getLineMoveBlockers(selectedOrderForDetail, targetLine)}
              onMoveOrderToLine={(targetLine) => handleMoveOrderToLine(selectedOrderForDetail.id, targetLine)}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function OrderDetailModal({ order, onClose, lineBunkers, lineConfig, lineSpeed, getLineMoveBlockers, onMoveOrderToLine }: { 
  order: Order; 
  onClose: () => void; 
  lineBunkers: Bunker[];
  lineConfig: AppConfig;
  lineSpeed: number;
  getLineMoveBlockers: (targetLine: LineId) => Order['components'];
  onMoveOrderToLine: (targetLine: LineId) => void;
}) {
  const volume = order.vol || 0;
  const effectiveVolume = ev(order);
  const volumeFactor = volume > 0 ? (effectiveVolume / volume) : 1;
  const duration = rt(order, lineSpeed);
  const getOrderDetailComponentGroupKey = (component: Order['components'][number]) => {
    const normalizedName = String(component.name || '').trim().toLowerCase();
    const normalizedUnit = String(component.unit || '').trim().toUpperCase();
    return `${normalizedName}|${normalizedUnit}`;
  };

  const canBunkerServeOrderComponent = (bunker: Bunker, component: Order['components'][number]) =>
    (bunker.ms && bunker.ms.some(m => canUseExistingMaterialForRequested(m, null, component.name, component.code))) ||
    (bunker.materialData && Object.entries(bunker.materialData).some(([mName, mData]) =>
      canUseExistingMaterialForRequested(mName, mData.code, component.name, component.code)
    ));

  const isBunkerEffectivelyEmpty = (bunker: Bunker) => {
    const material = String(bunker.m || '').trim().toLowerCase();
    return !material || material === 'leeg' || material === 'empty';
  };

  const isBunkerReadyForComponent = (bunker: Bunker | null | undefined, component: Order['components'][number]) => {
    if (!bunker) return false;
    const exactMatch = canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code);
    if (exactMatch) return true;
    return !!bunker.fx && canBunkerServeOrderComponent(bunker, component);
  };

  const { bulkComponents, additives } = useMemo(() => {
    const bulkGroups = new Map<string, { name: string, code: string, value: number, unit: string }>();
    const additiveGroups = new Map<string, { name: string, code: string, value: number, unit: string }>();

    order.components.forEach(c => {
      const unit = (c.unit || '').toUpperCase();
      // Bunker-fed materials stay bulk, even if they are dosed in KG/L per m3.
      // True additives are materials outside bunker/calibration flow.
      const isInBunker = lineBunkers.some(b => 
        canUseExistingMaterialForRequested(b.m, b.mc, c.name, c.code) ||
        (b.ms && b.ms.some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code))) ||
        (b.materialData && Object.entries(b.materialData).some(([mName, mData]) => canUseExistingMaterialForRequested(mName, mData.code, c.name, c.code)))
      );

      const isBulk = isInBunker || unit === 'M3' || unit === 'PERC' || unit === '%' || unit === '';
      const targetMap = isBulk ? bulkGroups : additiveGroups;
      
      const key = getOrderDetailComponentGroupKey(c);
      const existing = targetMap.get(key);
      if (existing) {
        existing.value += (c.value || 0);
      } else {
        targetMap.set(key, { name: c.name, code: c.code, value: c.value || 0, unit: c.unit || '' });
      }
    });

    return {
      bulkComponents: Array.from(bulkGroups.values()),
      additives: Array.from(additiveGroups.values())
    };
  }, [order.components, lineBunkers]);

  const bunkerAssignments = useMemo(() => {
    const assignments = new Map<string, Bunker | null>();
    const usedBunkers = new Set<string>();
    const componentKey = (component: Order['components'][number]) => `${component.name}|${component.code}`;
    const isReservedForOtherComponent = (bunker: Bunker, component: Order['components'][number]) =>
      bulkComponents.some(otherComponent =>
        componentKey(otherComponent) !== componentKey(component) &&
        isBunkerExactMatchForComponent(bunker, otherComponent) &&
        !canUseExistingMaterialForRequested(bunker.m, bunker.mc, component.name, component.code)
      );

    // 1. Prioritize bunkers that ALREADY contain the material (Match by name or code)
    bulkComponents.forEach(c => {
      const key = componentKey(c);
      const currentMatch = lineBunkers.find(b =>
        !usedBunkers.has(b.c) &&
        isBunkerExactMatchForComponent(b, c)
      );
      if (currentMatch) {
        assignments.set(key, currentMatch);
        usedBunkers.add(currentMatch.c);
        return;
      }
      const reusableAssignedBunker = Array.from(assignments.values()).find((bunker): bunker is Bunker =>
        !!bunker && canUseExistingMaterialForRequested(bunker.m, bunker.mc, c.name, c.code)
      );
      if (reusableAssignedBunker) {
        assignments.set(key, reusableAssignedBunker);
      }
    });

    // 2. Match remaining components to bunkers that CAN contain the material (from calibration sheet)
    bulkComponents.forEach(c => {
      const key = componentKey(c);
      if (assignments.has(key)) return;
      const reusableAssignedBunker = Array.from(assignments.values()).find((bunker): bunker is Bunker =>
        !!bunker && canUseExistingMaterialForRequested(bunker.m, bunker.mc, c.name, c.code)
      );
      if (reusableAssignedBunker) {
        assignments.set(key, reusableAssignedBunker);
        return;
      }

      const possibleMatch = lineBunkers
        .filter(b => 
          !usedBunkers.has(b.c) &&
          !isReservedForOtherComponent(b, c) && (
            (b.ms && b.ms.some(m => canUseExistingMaterialForRequested(m, null, c.name, c.code))) ||
            (b.materialData && Object.entries(b.materialData).some(([mName, mData]) => 
              canUseExistingMaterialForRequested(mName, mData.code, c.name, c.code)
            ))
          )
        )
        .sort((a, b) => {
          const emptyDiff = Number(isBunkerEffectivelyEmpty(b)) - Number(isBunkerEffectivelyEmpty(a));
          if (emptyDiff !== 0) return emptyDiff;
          return a.c.localeCompare(b.c);
        })[0];
      if (possibleMatch) {
        assignments.set(key, possibleMatch);
        usedBunkers.add(possibleMatch.c);
      } else {
        assignments.set(key, null);
      }
    });

    return assignments;
  }, [bulkComponents, lineBunkers]);

  const bunkerWarnings = useMemo(() => {
    return bulkComponents
      .map(component => {
        const bunker = bunkerAssignments.get(`${component.name}|${component.code}`);
        const isMatch = isBunkerReadyForComponent(bunker, component);
        if (isMatch) return null;
        if (!bunker) return `Geen bunker gevonden voor ${component.name}`;
        return `Bunkerwissel nodig: ${bunker.c} -> ${component.name}`;
      })
      .filter(Boolean) as string[];
  }, [bulkComponents, bunkerAssignments]);

  const lineMoveOptions = ([1, 2, 3] as LineId[]).map(line => ({
    line,
    blockers: getLineMoveBlockers(line),
    isCurrent: line === order.line,
    isLocked: order.status === 'running' || order.status === 'completed'
  }));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div 
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition-colors z-10"
        >
          <X size={20} className="text-gray-400" />
        </button>

        <div className="p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">{order.customer}</h2>
            <div className="text-sm text-gray-500 mt-1">
              {getOrderRefLabel(order)} - Rit {order.rit} - Recept {order.recipe}
            </div>
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Verplaatsen naar lijn</div>
              <div className="flex flex-wrap gap-2">
                {lineMoveOptions.map(option => {
                  const disabled = option.isCurrent || option.isLocked || option.blockers.length > 0;
                  const blockerText = option.blockers
                    .map(component => `${component.name}${component.code ? ` (${component.code})` : ''}`)
                    .join(', ');
                  return (
                    <button
                      key={option.line}
                      type="button"
                      disabled={disabled}
                      title={blockerText ? `Mist kalibratie: ${blockerText}` : undefined}
                      onClick={() => onMoveOrderToLine(option.line)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                        option.isCurrent
                          ? 'bg-green-100 text-green-700'
                          : option.blockers.length > 0
                            ? 'bg-orange-50 text-orange-700 border border-orange-200 cursor-not-allowed'
                            : option.isLocked
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-white text-blue-600 border border-blue-100 hover:bg-blue-50'
                      }`}
                    >
                      {option.isCurrent
                        ? `ML${option.line} huidig`
                        : option.blockers.length > 0
                          ? `ML${option.line} mist kalibratie`
                          : `Naar ML${option.line}`}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-gray-400">
                Verplaatsen wordt geblokkeerd als een bulkgrondstof geen passende bunker/kalibratie op die lijn heeft.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{effectiveVolume.toFixed(1)} m3</div>
              <div className="text-sm text-gray-400 mt-1">Te draaien volume</div>
              <div className="text-xs text-gray-500 mt-2">
                Ordervolume: {volume.toFixed(1)} m3 (factor x{volumeFactor.toFixed(2)})
              </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{duration.toFixed(1)} min</div>
              <div className="text-sm text-gray-400 mt-1">Totale slottijd</div>
            </div>
          </div>

          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 mb-8">
            <div className="text-blue-600 text-sm">
              {order.recipeSource === 'recipe_library'
                ? 'Receptinhoud geladen uit centrale receptbibliotheek'
                : 'Receptinhoud geladen uit centrale database'}
            </div>
          </div>

          {bunkerWarnings.length > 0 && (
            <div className="bg-orange-50/60 border border-orange-200 rounded-lg p-3 mb-8">
              <div className="text-orange-800 text-sm font-bold mb-1">Bunkerwissel nodig</div>
              <div className="space-y-1">
                {bunkerWarnings.map((warning, index) => (
                  <div key={index} className="text-sm text-orange-700">{warning}</div>
                ))}
              </div>
            </div>
          )}

          {bulkComponents.length > 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_96px] items-center gap-4 mb-4">
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">BULK GRONDSTOFFEN</h3>
                <span className="text-[10px] font-bold text-gray-400 uppercase text-right">PER M3</span>
                <span className="text-[10px] font-bold text-gray-400 uppercase text-right">TOTAAL</span>
                <span></span>
              </div>
              <div className="space-y-4">
                {bulkComponents.map((c, i) => {
                  const unit = (c.unit || '').toUpperCase();
                  const isPercentage = unit === 'PERC' || unit === '%';
                  const isWeightOrLiquid = unit === 'KG' || unit === 'L';
                  const perM3Value = c.value || 0;
                  const totalValue = isPercentage ? ((c.value || 0) / 100) * effectiveVolume : (c.value || 0) * effectiveVolume;
                  const displayUnit = isPercentage ? '%' : (unit || 'm3');
                  const totalUnit = isPercentage ? 'm3' : displayUnit;
                  const percentage = isPercentage
                    ? perM3Value
                    : unit === 'M3'
                      ? Math.min(100, Math.max(4, perM3Value * 100))
                      : Math.min(100, Math.max(4, perM3Value * 4));

                  return (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_110px_96px] items-center gap-4">
                      <div className="text-sm font-medium text-gray-700">{c.name}</div>
                      <span className="text-xs text-gray-500 text-right tabular-nums">{perM3Value.toFixed(isWeightOrLiquid ? 1 : 2)} {displayUnit}</span>
                      <span className="text-xs text-gray-400 text-right tabular-nums">{totalValue.toFixed(isWeightOrLiquid ? 1 : 1)} {totalUnit}</span>
                      <div className="w-24 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-200" style={{ width: `${Math.min(100, percentage)}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-8">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4">BUNKERADVIES</h3>
            <div className="space-y-3">
              {bulkComponents.map((c, i) => {
                const bunker = bunkerAssignments.get(`${c.name}|${c.code}`);
                const isMatch = !!bunker && (
                  (bunker.m && (bunker.m === c.name || materialsEquivalent(bunker.m, c.name))) ||
                  (bunker.mc && materialCodesEquivalent(bunker.mc, c.code))
                );
                
                return (
                  <div 
                    key={i} 
                    className={`p-4 rounded-xl border flex items-center justify-between ${isMatch ? 'bg-green-50/50 border-green-100' : 'bg-orange-50/50 border-orange-100'}`}
                  >
                    <div>
                      <div className="text-sm font-bold text-gray-800">{c.name} - {c.code}</div>
                      <div className={`text-xs mt-0.5 ${isMatch ? 'text-green-600' : 'text-orange-600'}`}>
                        {bunker 
                          ? (isMatch ? `${bunker.c} bevat al ${bunker.m || c.name}` : `Wissel ${bunker.c} naar ${c.name}`)
                          : `Geen bunker gevonden voor ${c.name}`
                        }
                      </div>
                    </div>
                    <div className={`text-sm font-bold ${isMatch ? 'text-green-800' : 'text-orange-800'}`}>
                      {bunker ? bunker.c : '??'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {additives.length > 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-4 mb-4">
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">MESTSTOFFEN</h3>
                <span className="text-[10px] font-bold text-gray-400 uppercase text-right">PER M3</span>
                <span className="text-[10px] font-bold text-gray-400 uppercase text-right">TOTAAL</span>
              </div>
              <div className="space-y-4">
                {additives.map((c, i) => {
                  const unit = (c.unit || '').toUpperCase();
                  const isWeightOrLiquid = unit === 'KG' || unit === 'L';
                  const isPercentage = unit === 'PERC' || unit === '%';

                  // Google Sheets stores the dosage per m3. The total is dosage times order volume.
                  const dosage = c.value || 0;
                  const total = isPercentage ? ((c.value || 0) / 100) * effectiveVolume : (c.value || 0) * effectiveVolume;
                  const displayUnit = isPercentage ? '%' : (unit || '');
                  const totalUnit = isPercentage ? 'm3' : displayUnit;
                  const dosageDecimals = unit === 'M3' ? 2 : isWeightOrLiquid ? 2 : 2;
                  const totalDecimals = isWeightOrLiquid ? 1 : 1;

                  return (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-4">
                      <div className="text-sm text-gray-600">{c.name}</div>
                      <span className="text-sm font-bold text-green-600 text-right tabular-nums">{dosage.toFixed(dosageDecimals)} {displayUnit}</span>
                      <span className="text-sm font-bold text-gray-400 text-right tabular-nums">{total.toFixed(totalDecimals)} {totalUnit}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-8 pt-6 border-t border-gray-100">
            <div>
              <div className="text-xs text-gray-400 mb-1">Verpakking</div>
              <div className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                {order.pkg.toLowerCase() === 'bulk' ? (
                  <TruckIcon size={14} className="text-blue-500" />
                ) : (
                  <Package size={14} className="text-orange-500" />
                )}
                {order.pkg.toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Lijn</div>
              <div className="text-sm font-bold text-gray-900">ML{order.line}</div>
            </div>
          </div>

          <div className="mt-8">
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium">
              <TruckIcon size={16} />
              Laadtijd: {order.eta || '--'}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


