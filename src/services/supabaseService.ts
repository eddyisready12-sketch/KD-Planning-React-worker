import { BagVolumeRule, Bunker, LineId, Order, OrderComponent, PlannerTrigger, Storing } from '../types';
import { normalizeEta, normalizePkg, parseNumber } from '../utils';
import { supabase } from './supabaseClient';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_WORKSPACE = import.meta.env.VITE_SUPABASE_WORKSPACE || 'default';

type SharedOrderRow = {
  id?: string | null;
  order_num?: string;
  rit_num?: string | null;
  production_order?: string | null;
  customer?: string | null;
  recipe?: string | null;
  order_date?: string | null;
  line_id?: number | string | null;
  pkg?: string | null;
  volume?: number | string | null;
  eta?: string | null;
  arrived?: boolean | null;
  arrived_time?: string | null;
  started_at?: string | null;
  hold_load_time?: boolean | null;
  status?: string | null;
  driver_name?: string | null;
  note?: string | null;
  priority?: number | string | null;
  y_zeile?: string | null;
};

type SharedRecipeComponentRow = {
  workspace?: string | null;
  recipe_code?: string | null;
  component_name?: string | null;
  component_code?: string | null;
  ratio?: number | string | null;
  unit?: string | null;
};

type SharedBunkerRow = {
  id?: string | null;
  line_id?: number | string | null;
  bunker_code?: string | null;
  current_material?: string | null;
  current_material_code?: string | null;
  fixed?: boolean | null;
  material_code?: string | null;
  material_name?: string | null;
  is_fixed?: boolean | null;
  must_empty?: boolean | null;
  empty_after_order?: string | null;
};

export type SharedBunkerMaterialRow = {
  id?: string | null;
  workspace?: string | null;
  line_id?: number | string | null;
  bunker_code?: string | null;
  material_name?: string | null;
  material_code?: string | null;
  calibration_value?: number | string | null;
  updated_at?: string | null;
};

type SharedEventRow = {
  id?: string | null;
  workspace?: string | null;
  line_id?: number | string | null;
  event_type?: string | null;
  description?: string | null;
  started_at?: string | null;
  expected_minutes?: number | string | null;
  active?: boolean | null;
  updated_at?: string | null;
};

type SharedAppStateRow = {
  id?: string | null;
  workspace?: string | null;
  state_key?: string | null;
  state_type?: string | null;
  state_value?: Record<string, unknown> | unknown[] | string | null;
  updated_at?: string | null;
};

export type SharedDriverInput = {
  name: string;
  active?: boolean;
  company?: string;
  truckPlate?: string;
  trailerPlate?: string;
  vehicleHeightM?: number | null;
  steeringAxles?: number | null;
  maxWeightKg?: number | null;
  notes?: string;
};

export type SharedDriver = SharedDriverInput & {
  id?: string;
  active: boolean;
};

type SharedDriverRow = {
  id?: string | null;
  workspace?: string | null;
  name?: string | null;
  active?: boolean | null;
  company?: string | null;
  truck_plate?: string | null;
  trailer_plate?: string | null;
  vehicle_height_m?: number | string | null;
  steering_axles?: number | string | null;
  max_weight_kg?: number | string | null;
  notes?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

function rowToSharedDriver(row: SharedDriverRow): SharedDriver | null {
  const name = String(row.name || '').trim();
  if (!name) return null;
  return {
    id: row.id || undefined,
    name,
    active: row.active !== false,
    company: row.company || '',
    truckPlate: row.truck_plate || '',
    trailerPlate: row.trailer_plate || '',
    vehicleHeightM: row.vehicle_height_m === null || row.vehicle_height_m === undefined ? null : parseNumber(row.vehicle_height_m),
    steeringAxles: row.steering_axles === null || row.steering_axles === undefined ? null : parseNumber(row.steering_axles),
    maxWeightKg: row.max_weight_kg === null || row.max_weight_kg === undefined ? null : parseNumber(row.max_weight_kg),
    notes: row.notes || ''
  };
}

type SharedTriggerRow = {
  id?: string | null;
  workspace?: string | null;
  trigger_key?: string | null;
  key?: string | null;
  code?: string | null;
  name?: string | null;
  title?: string | null;
  label?: string | null;
  description?: string | null;
  text?: string | null;
  trigger_value?: string | number | boolean | null;
  value?: string | number | boolean | null;
  active?: boolean | null;
  enabled?: boolean | null;
  type?: string | null;
};

export type PlannerRecalcLockState = {
  owner: string | null;
  expiresAt: string | null;
};

function rowToPlannerTrigger(row: SharedTriggerRow): PlannerTrigger | null {
  const actionName = String((row as { action_name?: string | null }).action_name || row.trigger_key || row.key || '').trim();
  const fieldName = String((row as { field_name?: string | null }).field_name || '').trim();
  const matchValue = String((row as { match_value?: string | null }).match_value || '').trim();
  const targetLine = String((row as { target_line?: string | null }).target_line || '').trim();
  const key = String(actionName || row.code || row.name || row.title || '').trim();
  const label = String(row.label || row.title || row.name || key).trim();
  const rawDescription = row.description ?? row.text ?? row.trigger_value ?? row.value ?? '';
  const description = String(rawDescription ?? '').trim();
  const active = row.active ?? row.enabled ?? true;
  if (!key || !label) return null;
  return {
    key,
    label,
    description,
    active: active !== false,
    fieldName: fieldName || undefined,
    matchValue: matchValue || undefined,
    actionName: actionName || undefined,
    targetLine: targetLine || undefined
  };
}

function normalizeStatus(status: string | null | undefined, arrived?: boolean | null): Order['status'] {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'closed' || normalized === 'completed' || normalized === 'voltooid') return 'completed';
  if (normalized === 'running' || normalized === 'gestart') return 'running';
  if (normalized === 'arrived' || normalized === 'gearriveerd' || arrived) return 'arrived';
  return 'planned';
}

function normalizeRecipeKey(recipe: string | null | undefined): string {
  return String(recipe || '').trim().toUpperCase();
}

function getRecipeSuffix(recipe: string | null | undefined): string {
  const normalized = normalizeRecipeKey(recipe);
  const alnum = normalized.replace(/[^A-Z0-9]/g, '');
  return alnum.slice(-3);
}

function recipeRowToComponent(row: SharedRecipeComponentRow): OrderComponent | null {
  const name = String(row.component_name || '').trim();
  const code = String(row.component_code || '').trim();
  const unit = String(row.unit || '').trim();
  const value = parseNumber(row.ratio);
  if (!name && !code) return null;
  return {
    name,
    code,
    value: Number.isFinite(value) ? value : null,
    unit
  };
}

function stableOrderHash(key: string): number {
  return Math.abs(key.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0));
}

function getSharedOrderKey(order: Pick<Order, 'num' | 'rit' | 'recipe' | 'line' | 'productionOrder'>): string {
  const productionOrder = String(order.productionOrder || '').trim();
  if (productionOrder) return `po:${productionOrder}`;
  return [order.num, order.rit || '', order.recipe || '', order.line].join('|');
}

function getSharedOrderRowKey(row: Pick<SharedOrderRow, 'order_num' | 'rit_num' | 'recipe' | 'line_id' | 'production_order'>): string {
  const productionOrder = String(row.production_order || '').trim();
  if (productionOrder) return `po:${productionOrder}`;
  return [
    String(row.order_num || '').trim(),
    String(row.rit_num || '').trim(),
    String(row.recipe || '').trim(),
    String(row.line_id || '').trim()
  ].join('|');
}

function rowToOrder(
  row: SharedOrderRow,
  components: OrderComponent[],
  recipeSource?: Order['recipeSource']
): Order | null {
  if (!row.order_num || !row.recipe) return null;

  const rawLine = parseInt(String(row.line_id ?? '').replace(/[^0-9]/g, ''), 10);
  const line: LineId = ([1, 2, 3].includes(rawLine) ? rawLine : 1) as LineId;
  const vol = parseNumber(row.volume);
  const pkg = normalizePkg(String(row.pkg || ''));
  const status = normalizeStatus(row.status, row.arrived);
  const priority = parseInt(String(row.priority ?? ''), 10);
  const normalizedPriority: 1 | 2 | 3 =
    pkg === 'bale' || pkg === 'bag'
      ? 1
      : (status === 'arrived' && !!normalizeEta(String(row.arrived_time || row.eta || '')) ? 1 : ([1, 2, 3].includes(priority) ? (priority as 1 | 2 | 3) : 2));

  return {
    id: stableOrderHash(getSharedOrderRowKey(row)),
    num: String(row.order_num),
    rit: String(row.rit_num || ''),
    productionOrder: row.production_order || undefined,
    customer: String(row.customer || 'Onbekende klant'),
    recipe: String(row.recipe || ''),
    line,
    vol: isNaN(vol) ? 0 : vol,
    pkg,
    prio: normalizedPriority,
    status,
    rawStatus: String(row.status || ''),
    arrived: !!row.arrived || status === 'arrived',
    eta: normalizeEta(String(row.eta || '')),
    arrivedTime: normalizeEta(String(row.arrived_time || '')) || undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    holdLoadTime: !!row.hold_load_time,
    note: String(row.note || ''),
    driver: row.driver_name || undefined,
    yZeile: row.y_zeile || undefined,
    date: row.order_date || undefined,
    recipeSource,
    components
  };
}

async function supabaseFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    cache: 'no-store',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase fout: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

async function supabaseWrite(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase schrijf fout: ${response.status} ${text}`);
  }
}

async function supabaseInsert(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase insert fout: ${response.status} ${text}`);
  }
}

async function supabasePatch(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase update fout: ${response.status} ${text}`);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchRecipeComponentsForRecipes(recipes: string[]): Promise<SharedRecipeComponentRow[]> {
  if (!isSupabaseConfigured() || recipes.length === 0) return [];

  const wantedCodes = Array.from(new Set(
    recipes
      .flatMap(recipe => {
        const normalized = normalizeRecipeKey(recipe);
        const suffix = getRecipeSuffix(recipe);
        return [normalized, suffix];
      })
      .filter(Boolean)
  ));

  if (wantedCodes.length === 0) return [];

  const allRows: SharedRecipeComponentRow[] = [];

  for (const batch of chunkArray(wantedCodes, 100)) {
    const { data, error } = await supabase
      .from('shared_recipe_components')
      .select('workspace, recipe_code, component_name, component_code, ratio, unit')
      .eq('workspace', SUPABASE_WORKSPACE)
      .in('recipe_code', batch);

    if (error) {
      throw new Error(`Receptbibliotheek laden mislukt: ${error.message}`);
    }

    if (Array.isArray(data)) {
      allRows.push(...(data as SharedRecipeComponentRow[]));
    }
  }

  return allRows;
}

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

export async function fetchOrdersFromSupabase(): Promise<Order[]> {
  if (!isSupabaseConfigured()) return [];

  const orders = await supabaseFetch<SharedOrderRow[]>(
    `shared_orders?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&select=*&order=order_num.asc`
  );

  if (orders.length === 0) return [];

  const recipeRows = await fetchRecipeComponentsForRecipes(
    orders.map(row => String(row.recipe || ''))
  );

  const componentsByRecipe = new Map<string, OrderComponent[]>();
  const componentsByRecipeSuffix = new Map<string, OrderComponent[]>();
  recipeRows.forEach(row => {
    const recipeCode = normalizeRecipeKey(row.recipe_code);
    if (!recipeCode) return;
    const component = recipeRowToComponent(row);
    if (!component) return;

    const addUnique = (map: Map<string, OrderComponent[]>, key: string) => {
      if (!key) return;
      const list = map.get(key) || [];
      if (!list.some(existing =>
        String(existing.name || '') === String(component.name || '') &&
        String(existing.code || '') === String(component.code || '') &&
        String(existing.unit || '') === String(component.unit || '')
      )) {
        list.push(component);
        map.set(key, list);
      }
    };

    addUnique(componentsByRecipe, recipeCode);
    addUnique(componentsByRecipeSuffix, getRecipeSuffix(recipeCode));
  });

  return orders
    .map(row => {
      const recipeCode = normalizeRecipeKey(row.recipe);
      const recipeLibraryComponents =
        componentsByRecipe.get(recipeCode) ||
        componentsByRecipeSuffix.get(getRecipeSuffix(recipeCode)) ||
        [];
      return rowToOrder(
        row,
        recipeLibraryComponents,
        recipeLibraryComponents.length > 0 ? 'recipe_library' : undefined
      );
    })
    .filter((order): order is Order => order !== null);
}

export async function writeOrdersToSupabase(orders: Order[], options?: { preserveExistingSchedule?: boolean }): Promise<void> {
  if (!isSupabaseConfigured() || orders.length === 0) return;

  const uniqueOrders = new Map<string, Order>();
  orders.forEach(order => {
    uniqueOrders.set(`${SUPABASE_WORKSPACE}|${getSharedOrderKey(order)}`, order);
  });

  const existingRows = await supabaseFetch<Array<Pick<SharedOrderRow, 'id' | 'order_num' | 'rit_num' | 'recipe' | 'line_id' | 'production_order' | 'order_date'>>>(
    `shared_orders?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&select=id,order_num,rit_num,recipe,line_id,production_order,order_date`
  );
  const existingByOrderKey = new Map<string, Pick<SharedOrderRow, 'id' | 'order_date'>>();
  existingRows.forEach(row => {
    const orderKey = getSharedOrderRowKey(row);
    if (orderKey && row.id) {
      existingByOrderKey.set(orderKey, { id: row.id, order_date: row.order_date });
    }
  });

  const orderRows = Array.from(uniqueOrders.values()).map(order => {
    const normalizedPriority =
      order.pkg === 'bale' || order.pkg === 'bag'
        ? 1
        : (order.status === 'arrived' && !!normalizeEta(order.arrivedTime || order.eta) ? 1 : 2);
    const orderKey = getSharedOrderKey(order);
    const existingRow = existingByOrderKey.get(orderKey);
    const preservedOrderDate =
      (options?.preserveExistingSchedule ? existingRow?.order_date : null) || order.date || null;
    const productionOrder = String(order.productionOrder || '').trim() || null;

    return {
      workspace: SUPABASE_WORKSPACE,
      order_num: order.num,
      rit_num: order.rit || null,
      production_order: productionOrder,
      customer: order.customer || null,
      recipe: order.recipe || null,
      line_id: order.line,
      pkg: order.pkg,
      volume: order.vol,
      eta: order.eta || null,
      arrived: !!order.arrived,
      arrived_time: order.arrived ? (order.arrivedTime || order.eta || null) : null,
      started_at: order.startedAt || null,
      hold_load_time: !!order.holdLoadTime,
      status: order.status,
      driver_name: order.driver || null,
      note: order.note || null,
      priority: normalizedPriority,
      y_zeile: order.yZeile || null,
      order_date: preservedOrderDate,
      updated_at: new Date().toISOString()
    };
  });

  for (const row of orderRows) {
    const existingRow = existingByOrderKey.get(getSharedOrderRowKey(row));
    if (existingRow?.id) {
      await supabasePatch(`shared_orders?id=eq.${encodeURIComponent(existingRow.id)}`, row);
    } else {
      await supabaseInsert('shared_orders', row);
      existingByOrderKey.set(getSharedOrderRowKey(row), { id: null, order_date: row.order_date });
    }
  }
}

export async function deleteAllOrdersFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const { error } = await supabase
    .from('shared_orders')
    .delete()
    .eq('workspace', SUPABASE_WORKSPACE);

  if (error) {
    throw new Error(`Orders leegmaken mislukt: ${error.message}`);
  }
}

export async function fetchBunkerStateFromSupabase(): Promise<SharedBunkerRow[]> {
  if (!isSupabaseConfigured()) return [];

  return supabaseFetch<SharedBunkerRow[]>(
    `shared_bunker_state?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&select=*&order=line_id.asc,bunker_code.asc`
  );
}

export async function fetchBunkerMaterialsFromSupabase(): Promise<SharedBunkerMaterialRow[]> {
  if (!isSupabaseConfigured()) return [];

  return supabaseFetch<SharedBunkerMaterialRow[]>(
    `shared_bunker_materials?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&select=*&order=line_id.asc,bunker_code.asc,material_name.asc`
  );
}

export async function writeBunkersToSupabase(bunkersByLine: Record<LineId, Bunker[]>): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const rows = (Object.keys(bunkersByLine) as unknown as LineId[]).flatMap(lineId =>
    (bunkersByLine[lineId] || []).map(bunker => ({
      workspace: SUPABASE_WORKSPACE,
      line_id: lineId,
      bunker_code: bunker.c,
      material_code: bunker.mc || null,
      material_name: bunker.m || null,
      is_fixed: !!bunker.fx,
      must_empty: !!bunker.mustEmpty,
      empty_after_order: bunker.leegNaOrder || null,
      updated_at: new Date().toISOString()
    }))
  );

  if (rows.length === 0) return;

  const existingRows = await fetchBunkerStateFromSupabase();
  const existingByKey = new Map(
    existingRows.map(row => [
      `${Number(row.line_id || 0)}|${String(row.bunker_code || '')}`,
      row
    ])
  );

  for (const row of rows) {
    const key = `${row.line_id}|${row.bunker_code}`;
    const existing = existingByKey.get(key);
    if (!existing?.id) {
      await supabaseInsert('shared_bunker_state', {
        workspace: row.workspace,
        line_id: row.line_id,
        bunker_code: row.bunker_code,
        updated_at: row.updated_at
      });
      existingByKey.set(key, { ...row, id: null });
    }
  }
}

export async function writeSingleBunkerToSupabase(lineId: LineId, bunker: Bunker): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const row = {
    workspace: SUPABASE_WORKSPACE,
    line_id: lineId,
    bunker_code: bunker.c,
    material_code: bunker.mc || null,
    material_name: bunker.m || null,
    is_fixed: !!bunker.fx,
    must_empty: !!bunker.mustEmpty,
    empty_after_order: bunker.leegNaOrder || null,
    updated_at: new Date().toISOString()
  };

  const existingRows = await fetchBunkerStateFromSupabase();
  const existing = existingRows.find(item =>
    Number(item.line_id || 0) === Number(lineId) &&
    String(item.bunker_code || '') === bunker.c
  );

  if (existing?.id) {
    await supabasePatch(
      `shared_bunker_state?id=eq.${encodeURIComponent(existing.id)}`,
      {
        current_material: row.material_name,
        current_material_code: row.material_code,
        fixed: row.is_fixed,
        material_code: row.material_code,
        material_name: row.material_name,
        is_fixed: row.is_fixed,
        must_empty: row.must_empty,
        empty_after_order: row.empty_after_order,
        updated_at: row.updated_at
      }
    );
    return;
  }

  await supabaseInsert('shared_bunker_state', {
    ...row,
    current_material: row.material_name,
    current_material_code: row.material_code,
    fixed: row.is_fixed
  });
}

export async function writeBunkerMaterialsToSupabase(bunkersByLine: Record<LineId, Bunker[]>): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const rows = (Object.keys(bunkersByLine) as unknown as LineId[]).flatMap(lineId =>
    (bunkersByLine[lineId] || []).flatMap(bunker =>
      Object.entries(bunker.materialData || {}).map(([materialName, materialData]) => ({
        workspace: SUPABASE_WORKSPACE,
        line_id: lineId,
        bunker_code: bunker.c,
        material_name: materialName,
        material_code: materialData?.code || null,
        calibration_value: materialData?.calibrationValue ?? null,
        updated_at: new Date().toISOString()
      }))
    )
  );

  if (rows.length === 0) return;

  for (const batch of chunkArray(rows, 250)) {
    await supabaseWrite(
      'shared_bunker_materials?on_conflict=workspace,line_id,bunker_code,material_name,material_code',
      batch
    );
  }
}

export async function fetchIssuesFromSupabase(): Promise<Record<LineId, Storing | null>> {
  if (!isSupabaseConfigured()) return { 1: null, 2: null, 3: null };

  const rows = await supabaseFetch<SharedEventRow[]>(
    `shared_events?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&active=is.true&event_type=in.(storing,onderhoud)&select=*&order=updated_at.desc`
  );

  const next: Record<LineId, Storing | null> = { 1: null, 2: null, 3: null };
  rows.forEach(row => {
    const lineId = Number(row.line_id || 0) as LineId;
    if (![1, 2, 3].includes(lineId) || next[lineId]) return;
    const soort = String(row.event_type || '').trim().toLowerCase() === 'onderhoud' ? 'onderhoud' : 'storing';
    const startedAt = row.started_at ? new Date(row.started_at) : new Date();
    const expectedMinutes = parseInt(String(row.expected_minutes ?? ''), 10);
    next[lineId] = {
      soort,
      omschrijving: String(row.description || ''),
      duur: Number.isFinite(expectedMinutes) ? expectedMinutes : null,
      start: startedAt,
      actief: row.active !== false
    };
  });

  return next;
}

export async function writeIssueToSupabase(line: LineId, issue: Storing): Promise<void> {
  if (!isSupabaseConfigured()) return;

  await supabasePatch(
    `shared_events?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&line_id=eq.${line}&active=is.true&event_type=in.(storing,onderhoud)`,
    {
      active: false,
      updated_at: new Date().toISOString()
    }
  );

  await supabaseInsert('shared_events', {
    workspace: SUPABASE_WORKSPACE,
    line_id: line,
    event_type: issue.soort,
    description: issue.omschrijving,
    started_at: issue.start.toISOString(),
    expected_minutes: issue.duur,
    active: issue.actief,
    updated_at: new Date().toISOString()
  });
}

export async function resolveIssueInSupabase(line: LineId): Promise<void> {
  if (!isSupabaseConfigured()) return;

  await supabasePatch(
    `shared_events?workspace=eq.${encodeURIComponent(SUPABASE_WORKSPACE)}&line_id=eq.${line}&active=is.true&event_type=in.(storing,onderhoud)`,
    {
      active: false,
      updated_at: new Date().toISOString()
    }
  );
}

export async function fetchDriverListFromSupabase(): Promise<string[]> {
  const drivers = await fetchDriversFromSupabase();
  return drivers
    .filter(driver => driver.active)
    .map(driver => driver.name)
    .sort((a, b) => a.localeCompare(b, 'nl-NL'));
}

export async function fetchDriversFromSupabase(): Promise<SharedDriver[]> {
  if (!isSupabaseConfigured()) return [];

  const { data: rows, error } = await supabase
    .from('shared_drivers')
    .select('*')
    .eq('workspace', SUPABASE_WORKSPACE)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Supabase fout: ${error.message}`);
  }

  return (rows || [])
    .map(row => rowToSharedDriver(row as SharedDriverRow))
    .filter((driver): driver is SharedDriver => driver !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'nl-NL'));
}

export async function fetchPlannerTriggersFromSupabase(): Promise<PlannerTrigger[]> {
  if (!isSupabaseConfigured()) return [];

  const tryWithWorkspace = async (): Promise<PlannerTrigger[]> => {
    const { data, error } = await supabase
      .from('shared_triggers')
      .select('*')
      .eq('workspace', SUPABASE_WORKSPACE)
      .order('id', { ascending: true });

    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .map(row => rowToPlannerTrigger(row as SharedTriggerRow))
      .filter((row): row is PlannerTrigger => row !== null);
  };

  const tryWithoutWorkspace = async (): Promise<PlannerTrigger[]> => {
    const { data, error } = await supabase
      .from('shared_triggers')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .map(row => rowToPlannerTrigger(row as SharedTriggerRow))
      .filter((row): row is PlannerTrigger => row !== null);
  };

  try {
    return await tryWithWorkspace();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/workspace/i.test(message) || /column/i.test(message)) {
      return tryWithoutWorkspace();
    }
    throw new Error(`Triggers laden mislukt: ${message}`);
  }
}

export async function writeDriverListToSupabase(driverNames: string[]): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const names = Array.from(
    new Set(
      driverNames
        .map(name => String(name || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'nl-NL'));

  await Promise.all(names.map(name => upsertDriverInSupabase({ name })));
}

export async function upsertDriverInSupabase(driver: SharedDriverInput): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const name = driver.name.trim();
  if (!name) return;

  const payload = {
    workspace: SUPABASE_WORKSPACE,
    name,
    active: driver.active ?? true,
    company: driver.company?.trim() || null,
    truck_plate: driver.truckPlate?.trim() || null,
    trailer_plate: driver.trailerPlate?.trim() || null,
    vehicle_height_m: driver.vehicleHeightM ?? null,
    steering_axles: driver.steeringAxles ?? null,
    max_weight_kg: driver.maxWeightKg ?? null,
    notes: driver.notes?.trim() || null,
    updated_at: new Date().toISOString()
  };

  const { data: existingRows, error: existingError } = await supabase
    .from('shared_drivers')
    .select('id')
    .eq('workspace', SUPABASE_WORKSPACE)
    .ilike('name', name)
    .limit(1);

  if (existingError) {
    throw new Error(`Supabase fout: ${existingError.message}`);
  }

  const existingId = (existingRows?.[0] as SharedDriverRow | undefined)?.id;
  if (existingId) {
    const { error } = await supabase
      .from('shared_drivers')
      .update(payload)
      .eq('id', existingId);
    if (error) {
      throw new Error(`Supabase update fout: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase
    .from('shared_drivers')
    .insert(payload);

  if (error) {
    throw new Error(`Supabase insert fout: ${error.message}`);
  }
}

export async function setDriverActiveInSupabase(name: string, active: boolean): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const { error } = await supabase
    .from('shared_drivers')
    .update({
      active,
      updated_at: new Date().toISOString()
    })
    .eq('workspace', SUPABASE_WORKSPACE)
    .ilike('name', trimmed);

  if (error) {
    throw new Error(`Supabase update fout: ${error.message}`);
  }
}

export async function fetchPlannedOrderIdsFromSupabase(): Promise<Record<LineId, number[]> | null> {
  if (!isSupabaseConfigured()) return null;

  const { data: rows, error } = await supabase
    .from('shared_app_state')
    .select('*')
    .eq('workspace', SUPABASE_WORKSPACE)
    .eq('state_key', 'planned_order_ids_by_line')
    .limit(1);

  if (error) {
    throw new Error(`Supabase fout: ${error.message}`);
  }

  const raw = rows?.[0]?.state_value;
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const result: Record<LineId, number[]> = { 1: [], 2: [], 3: [] };
  ([1, 2, 3] as LineId[]).forEach(lid => {
    const value = parsed[String(lid)] ?? parsed[lid];
    result[lid] = Array.isArray(value)
      ? value
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isFinite(id))
      : [];
  });
  return result;
}

export async function writePlannedOrderIdsToSupabase(plan: Record<LineId, number[]>): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const payload = {
    workspace: SUPABASE_WORKSPACE,
    state_key: 'planned_order_ids_by_line',
    state_type: 'planner_sequence',
    state_value: {
      1: (plan[1] || []).map(id => Number(id)).filter(Number.isFinite),
      2: (plan[2] || []).map(id => Number(id)).filter(Number.isFinite),
      3: (plan[3] || []).map(id => Number(id)).filter(Number.isFinite)
    },
    updated_at: new Date().toISOString()
  };

  const { data: existingRows, error: existingError } = await supabase
    .from('shared_app_state')
    .select('id')
    .eq('workspace', SUPABASE_WORKSPACE)
    .eq('state_key', 'planned_order_ids_by_line')
    .limit(1);

  if (existingError) {
    throw new Error(`Supabase fout: ${existingError.message}`);
  }

  if (existingRows?.[0]?.id) {
    const { error } = await supabase
      .from('shared_app_state')
      .update(payload)
      .eq('id', String(existingRows[0].id));
    if (error) {
      throw new Error(`Supabase update fout: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from('shared_app_state')
      .insert(payload);
    if (error) {
      throw new Error(`Supabase insert fout: ${error.message}`);
    }
  }
}

function parseSharedAppStateValue(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchSharedAppStateRow(stateKey: string): Promise<SharedAppStateRow | null> {
  const { data: rows, error } = await supabase
    .from('shared_app_state')
    .select('*')
    .eq('workspace', SUPABASE_WORKSPACE)
    .eq('state_key', stateKey)
    .limit(1);

  if (error) {
    throw new Error(`Supabase fout: ${error.message}`);
  }

  return (rows?.[0] as SharedAppStateRow | undefined) || null;
}

async function writeSharedAppStateRow(stateKey: string, stateType: string, stateValue: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const existingRow = await fetchSharedAppStateRow(stateKey);
  const payload = {
    workspace: SUPABASE_WORKSPACE,
    state_key: stateKey,
    state_type: stateType,
    state_value: stateValue,
    updated_at: new Date().toISOString()
  };

  if (existingRow?.id) {
    const { error } = await supabase
      .from('shared_app_state')
      .update(payload)
      .eq('id', String(existingRow.id));
    if (error) {
      throw new Error(`Supabase update fout: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from('shared_app_state')
      .insert(payload);
    if (error) {
      throw new Error(`Supabase insert fout: ${error.message}`);
    }
  }
}

function sanitizeBagVolumeRules(raw: unknown): BagVolumeRule[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((rule, index) => {
    const item = (rule || {}) as Partial<BagVolumeRule>;
    const codes = Array.isArray(item.codes)
      ? item.codes.map(code => String(code || '').replace(/\D/g, '')).filter(Boolean)
      : [];
    const volumePerBag = parseNumber(item.volumePerBag);
    const extraBags = parseNumber(item.extraBags);
    return {
      id: String(item.id || `bag_rule_${index + 1}`),
      label: String(item.label || `BAG regel ${index + 1}`).trim(),
      codes,
      volumePerBag: Number.isFinite(volumePerBag) ? volumePerBag : 0,
      extraBags: Number.isFinite(extraBags) ? extraBags : 0,
      active: item.active !== false
    };
  }).filter(rule => rule.label.trim() && rule.codes.length > 0 && rule.volumePerBag > 0);
}

export async function fetchBagVolumeRulesFromSupabase(): Promise<BagVolumeRule[] | null> {
  if (!isSupabaseConfigured()) return null;

  const row = await fetchSharedAppStateRow('bag_volume_rules');
  if (!row) return null;

  return sanitizeBagVolumeRules(parseSharedAppStateValue(row.state_value));
}

export async function writeBagVolumeRulesToSupabase(rules: BagVolumeRule[]): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const cleaned = sanitizeBagVolumeRules(rules);
  await writeSharedAppStateRow('bag_volume_rules', 'settings', cleaned);
}

export async function fetchPlannerRecalcLockFromSupabase(): Promise<PlannerRecalcLockState | null> {
  if (!isSupabaseConfigured()) return null;

  const row = await fetchSharedAppStateRow('planner_recalc_lock');
  if (!row) return null;

  const parsed = parseSharedAppStateValue(row.state_value);
  const owner = parsed?.owner ? String(parsed.owner) : null;
  const expiresAt = parsed?.expiresAt ? String(parsed.expiresAt) : null;

  if (!owner || !expiresAt) return null;
  if (new Date(expiresAt).getTime() <= Date.now()) return null;

  return { owner, expiresAt };
}

export async function acquirePlannerRecalcLockInSupabase(owner: string, ttlSeconds = 30): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;

  const existingRow = await fetchSharedAppStateRow('planner_recalc_lock');
  const existing = parseSharedAppStateValue(existingRow?.state_value);
  const existingOwner = existing?.owner ? String(existing.owner) : null;
  const existingExpiresAt = existing?.expiresAt ? new Date(String(existing.expiresAt)).getTime() : 0;

  if (existingOwner && existingOwner !== owner && existingExpiresAt > Date.now()) {
    return false;
  }

  const payload = {
    workspace: SUPABASE_WORKSPACE,
    state_key: 'planner_recalc_lock',
    state_type: 'lock',
    state_value: {
      owner,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
    },
    updated_at: new Date().toISOString()
  };

  if (existingRow?.id) {
    const { error } = await supabase
      .from('shared_app_state')
      .update(payload)
      .eq('id', String(existingRow.id));
    if (error) {
      throw new Error(`Supabase update fout: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from('shared_app_state')
      .insert(payload);
    if (error) {
      throw new Error(`Supabase insert fout: ${error.message}`);
    }
  }

  const confirmedLock = await fetchPlannerRecalcLockFromSupabase();
  return confirmedLock?.owner === owner;
}

export async function releasePlannerRecalcLockInSupabase(owner: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const existingRow = await fetchSharedAppStateRow('planner_recalc_lock');
  const existing = parseSharedAppStateValue(existingRow?.state_value);
  const existingOwner = existing?.owner ? String(existing.owner) : null;

  if (!existingRow?.id || (existingOwner && existingOwner !== owner)) {
    return;
  }

  const { error } = await supabase
    .from('shared_app_state')
    .update({
      workspace: SUPABASE_WORKSPACE,
      state_key: 'planner_recalc_lock',
      state_type: 'lock',
      state_value: { owner: null, expiresAt: null },
      updated_at: new Date().toISOString()
    })
    .eq('id', String(existingRow.id));

  if (error) {
    throw new Error(`Supabase update fout: ${error.message}`);
  }
}
