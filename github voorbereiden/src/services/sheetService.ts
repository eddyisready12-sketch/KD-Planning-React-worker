import { Order, LineId, OrderComponent, Bunker } from '../types';
import { normalizeEta, normalizePkg, parseNumber, materialCodesEquivalent, normalizeMaterialCode } from '../utils';

interface GvizCell {
  v: string | number | null;
  f?: string;
}

interface GvizRow {
  c: (GvizCell | null)[];
}

interface GvizTable {
  cols: { id: string; label: string; type: string }[];
  rows: GvizRow[];
}

interface GvizResponse {
  status: string;
  table: GvizTable;
  errors?: { message: string; detailed_message?: string }[];
}

const HEADER_MAP: Record<string, string[]> = {
  recipe: ['ProductCode', 'recipe', 'recept', 'artikel', 'artikelnummer', 'productcode', 'rawcode', 'art_nr', 'artnr', 'product', 'mix'],
  orderNum: ['OrderNummer', 'order', 'ordernr', 'ordernummer', 'order_num', 'num', 'bestelnummer', 'opdracht', 'opdrachtnummer'],
  productionOrder: ['ProductieOrder', 'productieorder', 'productie_order', 'productionorder', 'prodorder', 'prod_order', 'po_nummer'],
  rit: ['Ritnummer', 'rit', 'trip', 'route', 'ritnummer', 'rit_nr', 'ritnr'],
  customer: ['Klantnaam', 'customer', 'klant', 'debiteur', 'naam', 'klantnaam', 'ontvanger'],
  line: ['Menglijn', 'line', 'lijn', 'mixline', 'menglijn', 'lijn_nr', 'lijnnr'],
  vol: ['Prod_Volume_M3', 'vol', 'volume', 'm3', 'inhoud', 'prodvolumem3', 'prod_volume_m3', 'orderaantal', 'hoeveelheid', 'aantal'],
  prio: ['prio', 'prioriteit', 'priority', 'urgentie'],
  status: ['Status', 'status', 'orderstatus', 'statusorder', 'productiestatus', 'planningstatus'],
  arrived: ['Gearriveerd', 'gearriveerd', 'Arriveerd', 'arriveerd', 'Aangekomen', 'aangekomen', 'arrived', 'isarrived', 'truck_arrived'],
  eta: ['Laadtijd', 'eta', 'laadtijd', 'loadtime', 'tijd', 'aankomsttijd', 'tijdstip'],
  note: ['note', 'notitie', 'opmerking', 'remarks', 'memo', 'bijzonderheden'],
  componentName: ['Component_Beschrijving', 'component_beschrijving', 'componentbeschrijving', 'component', 'grondstof', 'componentomschrijving', 'materiaal', 'naam'],
  componentCode: ['RAW_Code', 'raw_code', 'rawcode', 'grondstofnummer', 'grondstof_nummer', 'componentcode', 'art_code', 'code'],
  ratio: ['Verhouding', 'verhouding', 'ratio', 'percentage', 'aandeel', 'perc', 'waarde'],
  unit: ['Comp_Eenheid', 'comp_eenheid', 'compeenheid', 'component_eenheid', 'eenheid_component', 'unit', 'eenheid'],
  pkg: ['Eenheid', 'pkg', 'packaging', 'packagingtype', 'packaging_type', 'package', 'package_type', 'verpakking', 'verpakkingstype', 'verpakking_type', 'verpakkingsvorm', 'type', 'afvulvorm', 'emballage', 'eenheid', 'vorm'],
  driver: ['Chauffeur', 'chauffeur', 'driver', 'truckdriver', 'vervoerder'],
  yZeile: ['Y-Zeile', 'y_zeile', 'yzeile', 'y zeile'],
  productName: ['Productnaam', 'productnaam', 'product_name', 'mixnaam', 'omschrijving']
};

function normalizeHeader(val: string | number | null | undefined): string {
  return String(val ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getColumnIndex(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const idx = normalizedHeaders.indexOf(normalizedAlias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseBooleanLike(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'waar', 'yes', 'ja', 'y', 'x'].includes(normalized);
}

export async function fetchOrdersFromSheet(url: string): Promise<Order[]> {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error('Ongeldige Google Sheets URL');
  
  const id = idMatch[1];
  const sheetNames = ['ML1', 'ML2', 'ML3', 'Menglijn 1', 'Menglijn 2', 'Menglijn 3', 'Planning', 'Orders'];
  const allOrders: Order[] = [];

  for (const sheetName of sheetNames) {
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?sheet=${sheetName}&tqx=out:json`;
      
      const response = await fetch(gvizUrl);
      if (!response.ok) continue;

      const text = await response.text();
      const jsonMatch = text.match(/setResponse\((.*)\);/);
      if (!jsonMatch) continue;
      
      const data: GvizResponse = JSON.parse(jsonMatch[1]);
      if (data.status !== 'ok') continue;

      const table = data.table;
      const rawHeaders = table.cols.map(col => col.label || col.id || '');
      
      const indices: Record<string, number> = {};
      Object.entries(HEADER_MAP).forEach(([key, aliases]) => {
        indices[key] = getColumnIndex(rawHeaders, aliases);
      });

      const importedRows = table.rows.map((row, idx) => {
        const getValue = (key: string) => {
          const cell = row.c[indices[key]];
          return cell ? String(cell.v ?? '').trim() : '';
        };

        const recipe = getValue('recipe');
        const orderNum = getValue('orderNum');
        if (!recipe || !orderNum) return null;

        // If line is not in sheet, use the sheetName to infer it
        const rawLine = getValue('line');
        let lineVal = parseInt(rawLine.replace(/[^0-9]/g, ''), 10);
        if (isNaN(lineVal)) {
          lineVal = parseInt(sheetName.replace(/[^0-9]/g, ''), 10);
        }
        const line: LineId = ([1, 2, 3].includes(lineVal) ? lineVal : 1) as LineId;
        
        const vol = parseNumber(getValue('vol'));
        const ratio = parseNumber(getValue('ratio'));
        
        const component: OrderComponent | null = getValue('componentName') || getValue('componentCode') 
          ? {
              name: getValue('componentName'),
              code: getValue('componentCode'),
              value: ratio,
              unit: getValue('unit')
            }
          : null;

        const pkg = normalizePkg(getValue('pkg'));
        const rawStatus = getValue('status');
        const arrived = parseBooleanLike(getValue('arrived')) || rawStatus.toLowerCase() === 'arrived' || rawStatus.toLowerCase() === 'gearriveerd';
        const prio = (pkg === 'bale' || pkg === 'bag') ? 1 : (parseInt(getValue('prio'), 10) || 2);

        return {
          id: idx + Date.now(), // Fallback if no unique ID, but we'll collapse later
          num: orderNum,
          rit: getValue('rit'),
          productionOrder: getValue('productionOrder'),
          customer: getValue('customer') || 'Onbekende klant',
          recipe,
          line,
          vol: isNaN(vol) ? 0 : vol,
          pkg,
          prio: prio as any,
          status: (arrived ? 'arrived' : 'planned') as any,
          rawStatus,
          arrived,
          eta: normalizeEta(getValue('eta')),
          note: getValue('note'),
          driver: getValue('driver'),
          yZeile: getValue('yZeile'),
          productName: getValue('productName'),
          components: component ? [component] : []
        };
      }).filter((o): o is any => o !== null);

      allOrders.push(...importedRows);
    } catch (e) {
      console.warn(`Could not fetch sheet ${sheetName}:`, e);
    }
  }

  if (allOrders.length === 0) {
    // Fallback to gid=0 or specific gid in URL if ML tabs don't exist
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?gid=${gid}&tqx=out:json`;
    const response = await fetch(gvizUrl);
    const text = await response.text();
    const jsonMatch = text.match(/setResponse\((.*)\);/);
    if (jsonMatch) {
      const data: GvizResponse = JSON.parse(jsonMatch[1]);
      if (data.status === 'error') {
        throw new Error(`Google Sheets fout: ${data.errors?.[0]?.message || 'Onbekende fout'}`);
      }
      if (data.status === 'ok') {
        const table = data.table;
        const rawHeaders = table.cols.map(col => col.label || col.id || '');
        const indices: Record<string, number> = {};
        Object.entries(HEADER_MAP).forEach(([key, aliases]) => {
          indices[key] = getColumnIndex(rawHeaders, aliases);
        });
        const importedRows = table.rows.map((row, idx) => {
          const getValue = (key: string) => {
            const cell = row.c[indices[key]];
            return cell ? String(cell.v ?? '').trim() : '';
          };
          const recipe = getValue('recipe');
          const orderNum = getValue('orderNum');
          if (!recipe || !orderNum) return null;
        // If line is not in sheet, use the sheetName to infer it
        const rawLine = getValue('line');
        let lineVal = parseInt(rawLine.replace(/[^0-9]/g, ''), 10);
        const line: LineId = ([1, 2, 3].includes(lineVal) ? lineVal : 1) as LineId;
          const vol = parseNumber(getValue('vol'));
          const ratio = parseNumber(getValue('ratio'));
          const component: OrderComponent | null = getValue('componentName') || getValue('componentCode') 
            ? { name: getValue('componentName'), code: getValue('componentCode'), value: ratio, unit: getValue('unit') }
            : null;
          const pkg = normalizePkg(getValue('pkg'));
          const rawStatus = getValue('status');
          const arrived = parseBooleanLike(getValue('arrived')) || rawStatus.toLowerCase() === 'arrived' || rawStatus.toLowerCase() === 'gearriveerd';
          const prio = (pkg === 'bale' || pkg === 'bag') ? 1 : (parseInt(getValue('prio'), 10) || 2);
          return {
            id: 1000 + idx,
            num: orderNum,
            rit: getValue('rit'),
            productionOrder: getValue('productionOrder'),
            customer: getValue('customer') || 'Onbekende klant',
            recipe,
            line,
            vol: isNaN(vol) ? 0 : vol,
            pkg,
            prio: prio as any,
            status: (arrived ? 'arrived' : 'planned') as any,
            rawStatus,
            arrived,
            eta: normalizeEta(getValue('eta')),
            note: getValue('note'),
            driver: getValue('driver'),
            yZeile: getValue('yZeile'),
            productName: getValue('productName'),
            components: component ? [component] : []
          };
        }).filter((o): o is any => o !== null);
        allOrders.push(...importedRows);
      }
    }
  }

  // Collapse rows with same Order Identity
  const collapsed = new Map<string, Order>();
  allOrders.forEach(row => {
    const key = `${row.num}|${row.rit}|${row.recipe}|${row.line}`;
    if (collapsed.has(key)) {
      const existing = collapsed.get(key)!;
      if (row.components.length) {
        existing.components.push(...row.components);
      }
    } else {
      // Use the key as a stable ID
      row.id = Math.abs(key.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0));
      collapsed.set(key, row);
    }
  });

  return Array.from(collapsed.values()).map(order => {
    const uniqueComponents = new Map<string, OrderComponent>();
    order.components.forEach(component => {
      const compKey = [
        component.code || '',
        component.name || '',
        component.value ?? '',
        component.unit || ''
      ].join('|');
      if (!uniqueComponents.has(compKey)) {
        uniqueComponents.set(compKey, component);
      }
    });
    return {
      ...order,
      components: Array.from(uniqueComponents.values())
    };
  });
}

export interface CalibrationMaterial {
  name: string;
  code: string | null;
  calibrationValue: number | null;
}

export async function fetchBunkersFromSheet(url: string, forcedLineId?: LineId): Promise<{ bunkers: Record<LineId, Bunker[]>, materials: CalibrationMaterial[] }> {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error('Ongeldige Google Sheets URL');
  
  const id = idMatch[1];
  const gidMatch = url.match(/[?&]gid=([0-9]+)/);
  const sheetNameMatch = url.match(/[?&]sheet=([^&]+)/);
  
  const targets: string[] = [];
  if (sheetNameMatch) {
    targets.push(`sheet=${sheetNameMatch[1]}`);
  } else if (gidMatch) {
    targets.push(`gid=${gidMatch[1]}`);
  } else {
    // Only search if no specific tab is specified
    const sheetNames = [
      'Kalibratiesheet', 'Kalibratie', 'DB Kalibratie', 'Grondstoffen', 'ML1', 'ML2', 'ML3',
      'Menglijn 1', 'Menglijn 2', 'Menglijn 3'
    ];
    targets.push(...sheetNames.map(name => `sheet=${encodeURIComponent(name)}`));
    targets.push(`gid=0`);
  }
  
  const bunkersMap: Record<LineId, Map<string, Bunker>> = { 
    1: new Map(), 
    2: new Map(), 
    3: new Map() 
  };
  const materialsMap = new Map<string, CalibrationMaterial>();
  let successCount = 0;
  let error: string | null = null;

  const BUNKER_HEADER_MAP = {
    line: ['Menglijn', 'line', 'lijn', 'Lijn', 'Mixline', 'Mixlijn', 'meng_lijn', 'lijn_nr', 'lijnnr', 'mixlijn_nr', 'lijn nr', 'lijn no', 'production line', 'ml'],
    code: ['Bunker', 'Bunkernummer', 'bunker', 'bunkercode', 'nr', 'code', 'bunkernr', 'bunker_nr', 'bunker_no', 'bunkerno', 'pos', 'positie', 'db', 'db_nr', 'db_no', 'dbnr', 'dbno', 'bunker nr', 'bunker no', 'db nr', 'db no', 'bunkerid', 'bunker_id', 'silo', 'vak', 'bak', 'silonr', 'vaknr', 'baknr', 'vak nr', 'bunker code', 'id'],
    material: ['Grondstof', 'Materiaal', 'material', 'grondstof', 'product', 'naam', 'omschrijving', 'component', 'beschrijving', 'grondstofnaam', 'productnaam', 'artikelnaam', 'materiaalnaam', 'rawname', 'raw_name', 'product_naam', 'materiaal_naam', 'artikel', 'artikel_naam', 'component_naam', 'grondstof_naam', 'mat', 'comp', 'naam grondstof', 'naam materiaal', 'name'],
    materialCode: ['Grondstof nummer', 'Grondstofnummer', 'materialcode', 'artnr', 'artikelcode', 'raw_code', 'rawcode', 'grondstofnr', 'productnr', 'art_nr', 'artikelnummer', 'raw', 'rawnr', 'productcode', 'product_code', 'art_code', 'component_code', 'artikelnr', 'mat_code', 'matcode', 'art_nummer', 'art.nr', 'art nr', 'item code', 'product code', 'materiaalcode', 'materiaal code', 'artikelcode'],
    fixed: ['VAST', 'Vast', 'fixed', 'fx', 'gefixeerd', 'locked', 'vastzetten', 'fix', 'vastgezet', 'geblokkeerd', 'gefixeerd', 'lock', 'vast_zetten', 'vast_gezet', 'vastgezet_db', 'gefixeerd_db'],
    mustEmpty: ['Leegmaken', 'mustempty', 'me', 'leeg', 'moetleeg', 'empty', 'leeg_maken', 'leegm', 'leegmaken_db', 'opschonen', 'leegmaken', 'must empty', 'moet leeg', 'opschoning', 'leeg_maken_db', 'leeg_maken_bunker'],
    calibration: ['Kalibratie', 'calibration', 'factor', 'waarde', 'k-factor', 'kalibratiewaarde', 'k_factor', 'kfactor', 'cal', 'cal_val', 'kwaarde', 'kal', 'k-waarde', 'k waarde', 'kalibratie_waarde', 'correctie', 'correctiefactor', 'k', 'k_waarde', 'k_factor', 'kwaarde', 'k-waarde', 'k waarde', 'k factor', 'k_waarde', 'k_factor', 'kalibratiewaarde', 'factor', 'ijking', 'ijkwaarde', 'ijk', 'ijking_waarde', 'ijk_waarde', 'ijk_factor', 'ijk factor'],
    current: ['Huidig', 'Current', 'actief', 'active', 'nu', 'now', 'huidig_materiaal', 'current_material', 'in_gebruik', 'actueel', 'in gebruik', 'actief', 'selected', 'selectie', 'huidige']
  };

  for (const target of targets) {
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?${target}&tqx=out:json`;
      const response = await fetch(gvizUrl);
      if (!response.ok) continue;
      
      const text = await response.text();
      const jsonMatch = text.match(/setResponse\((.*)\);/);
      if (!jsonMatch) continue;
      
      const data: GvizResponse = JSON.parse(jsonMatch[1]);
      if (data.status !== 'ok') continue;

      const table = data.table;
      let rawHeaders = table.cols.map(col => col.label || col.id || '');
      
      // Header detection
      const looksLikeDefaultIds = rawHeaders.every(h => h.length <= 2 || !/[a-zA-Z]/.test(h));
      if (looksLikeDefaultIds && table.rows.length > 0) {
        for (let i = 0; i < Math.min(10, table.rows.length); i++) {
          const rowHeaders = table.rows[i].c.map(cell => String(cell?.v ?? '').trim());
          const hasBunkerInRow = rowHeaders.some(h => 
            BUNKER_HEADER_MAP.code.map(normalizeHeader).includes(normalizeHeader(h)) ||
            BUNKER_HEADER_MAP.material.map(normalizeHeader).includes(normalizeHeader(h))
          );
          if (hasBunkerInRow) {
            rawHeaders = rowHeaders;
            break;
          }
        }
      }
      
      const indices: Record<string, number> = {};
      Object.entries(BUNKER_HEADER_MAP).forEach(([key, aliases]) => {
        indices[key] = getColumnIndex(rawHeaders, aliases);
      });

      if (indices['code'] === -1 && indices['material'] === -1) continue;
      if (table.rows.length === 0) continue;

      successCount++;
      
      // Infer line from target name
      let inferredLine: LineId | null = null;
      const targetName = decodeURIComponent(target.split('=')[1] || '').toLowerCase();
      if (targetName.match(/menglijn\s*1|ml\s*1|^1$|lijn\s*1/)) inferredLine = 1;
      else if (targetName.match(/menglijn\s*2|ml\s*2|^2$|lijn\s*2/)) inferredLine = 2;
      else if (targetName.match(/menglijn\s*3|ml\s*3|^3$|lijn\s*3/)) inferredLine = 3;

      const hasCalibrationColumn = indices['calibration'] !== -1;

      table.rows.forEach(row => {
        const getValue = (key: string) => {
          const idx = indices[key];
          if (idx === undefined || idx === -1) return '';
          const cell = row.c[idx];
          return cell ? String(cell.v ?? '').trim() : '';
        };

        const materialRaw = getValue('material');
        const materialCode = normalizeMaterialCode(getValue('materialCode'));
        const calVal = parseFloat(getValue('calibration').replace(',', '.'));
        const hasValidCal = hasCalibrationColumn && !isNaN(calVal);

        const materials = materialRaw.split(/[,;|]/).map(m => m.trim()).filter(m => m.length > 0);
        const materialsToProcess = materials.length > 0 ? materials : [''];

        materialsToProcess.forEach((material) => {
          if (material) {
            const existingMat = materialsMap.get(material);
            if (!existingMat || (hasValidCal && existingMat.calibrationValue === null)) {
              materialsMap.set(material, {
                name: material,
                code: materialCode || (existingMat?.code || null),
                calibrationValue: hasValidCal ? calVal : (existingMat?.calibrationValue ?? null)
              });
            }
          }

          const code = getValue('code');
          if (code) {
            // Determine which line(s) this row belongs to
            const lineInSheet = parseInt(getValue('line'), 10);
            const lineToUse = [1, 2, 3].includes(lineInSheet) 
              ? (lineInSheet as LineId) 
              : (forcedLineId || inferredLine || null);
            
            // CRITICAL: If we are syncing for a specific line, ignore rows that belong to other lines
            if (forcedLineId && lineToUse && lineToUse !== forcedLineId) return;

            const targetLines: LineId[] = lineToUse ? [lineToUse as LineId] : [1, 2, 3];
            
            const isTrue = (val: string) => ['ja', 'true', '1', 'yes', 'v', 'waar', 'x', 'vinkje'].includes(val.toLowerCase());
            const fixed = isTrue(getValue('fixed'));
            const mustEmpty = isTrue(getValue('mustEmpty'));
            const isCurrent = indices['current'] !== -1 ? isTrue(getValue('current')) : fixed;

            targetLines.forEach(line => {
              const existing = bunkersMap[line].get(code);
              if (!existing) {
                bunkersMap[line].set(code, {
                  c: code,
                  m: isCurrent ? material : (material || null), 
                  mc: materialCode || null,
                  ms: material ? [material] : [],
                  materialData: material ? { [material]: { code: materialCode || null, calibrationValue: hasValidCal ? calVal : null } } : {},
                  fx: fixed,
                  me: mustEmpty,
                  calibrationValue: isCurrent && hasValidCal ? calVal : null
                });
              } else {
                if (material && !existing.ms.includes(material)) existing.ms.push(material);
                if (material) {
                  if (!existing.materialData) existing.materialData = {};
                  existing.materialData[material] = {
                    code: materialCode || (existing.materialData[material]?.code || null),
                    calibrationValue: hasValidCal ? calVal : (existing.materialData[material]?.calibrationValue ?? null)
                  };
                  Object.entries(existing.materialData).forEach(([aliasName, aliasData]) => {
                    if (aliasName !== material && materialCodesEquivalent(aliasData.code, materialCode)) {
                      if (!existing.ms.includes(aliasName)) existing.ms.push(aliasName);
                      if (!existing.ms.includes(material)) existing.ms.push(material);
                    }
                  });
                }
                if (isCurrent || (material && existing.m === material) || !existing.m) {
                  if (isCurrent || !existing.m) {
                    existing.m = material || existing.m;
                    existing.mc = materialCode || existing.mc;
                  }
                  if (hasValidCal) existing.calibrationValue = calVal;
                }
                if (fixed) existing.fx = true;
                if (mustEmpty) existing.me = true;
              }
            });
          }
        });
      });

      // If we are looking for a specific GID or sheet name, we stop after the first successful fetch
      if (gidMatch || sheetNameMatch) {
        break;
      }
    } catch (e) {
      console.warn(`Failed to fetch target ${target}`, e);
    }
  }

  if (successCount === 0) {
    throw new Error(error || 'Kon geen kalibratie data vinden. Controleer of de sheet openbaar is en de tabblad-namen/kolomkoppen correct zijn.');
  }

  const bunkers: Record<LineId, Bunker[]> = {
    1: Array.from(bunkersMap[1].values()),
    2: Array.from(bunkersMap[2].values()),
    3: Array.from(bunkersMap[3].values())
  };

  return { bunkers, materials: Array.from(materialsMap.values()) };
}
