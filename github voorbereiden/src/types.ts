export type LineId = 1 | 2 | 3;

export interface LineConfig {
  name: string;
  full: string;
  speed: number;
  prep: number;
  empty: number;
  color: string;
}

export interface AppConfig {
  prep: number;
  empty: number;
  wissel: number;
  maxWait: number;
}

export interface Bunker {
  c: string;
  ms: string[];
  m: string | null;
  mc?: string | null;
  materialData?: Record<string, { code: string | null, calibrationValue: number | null }>;
  fx: boolean;
  me: boolean;
  shared?: LineId[];
  calibrationCodes?: string[];
  calibrationValue?: number | null;
  isCalibrated?: boolean;
  mustEmpty?: boolean;
  leegNaOrder?: string | null;
  leegVoor?: string | null;
  _sharedUpdatedAt?: number;
}

export interface OrderComponent {
  name: string;
  code: string;
  value: number | null;
  unit: string;
}

export interface Order {
  id: number;
  productionOrder?: string;
  num: string;
  rit: string;
  customer: string;
  recipe: string;
  line: LineId;
  sourceLine?: LineId;
  vol: number;
  pkg: 'bulk' | 'bag' | 'bale' | 'packaged';
  prio: 1 | 2 | 3;
  status: 'planned' | 'arrived' | 'running' | 'completed';
  rawStatus?: string;
  eta: string;
  note: string;
  arrived?: boolean;
  driver?: string;
  productName?: string;
  yZeile?: string;
  date?: string;
  components: OrderComponent[];
  recipeSource?: 'recipe_library';
  _autoMovedReason?: string;
  _autoMovedFromLine?: LineId;
  _autoMovedToLine?: LineId;
  _deadlineWarning?: boolean;
  _deadlineLatest?: number;
  _deadlineActual?: number;
  _ml3WindowConflictReason?: string;
}

export interface Truck {
  id: number;
  orderId?: number;
  customer: string;
  eta: string;
  type: 'pickup' | 'delivery';
  note: string;
  arrived: boolean;
  driver?: string;
  auto?: boolean;
}

export interface Melding {
  id: number;
  type: 'info' | 'waarschuwing' | 'fout' | 'ok' | 'bunker' | 'deadline';
  icon: string;
  titel: string;
  tekst: string;
  lijn: LineId | null;
  orderNum: string | null;
  tijd: Date;
  gelezen: boolean;
}

export interface Storing {
  soort: 'storing' | 'onderhoud';
  omschrijving: string;
  duur: number | null;
  start: Date;
  actief: boolean;
}
