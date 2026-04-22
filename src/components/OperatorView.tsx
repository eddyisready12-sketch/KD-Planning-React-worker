import React from 'react';
import { LINES } from '../constants';
import { Bunker, LineId, Order } from '../types';
import { ev, fmt, isFractieMixMaterial, normalizeEta, rt } from '../utils';
import {
  AlertTriangle,
  Package,
  Pencil,
  Shuffle,
  Truck as TruckIcon,
  Wrench
} from 'lucide-react';

type OperatorViewProps = {
  activeIssue: any;
  activeIssueEntries: Array<{ line: LineId; issue: any }>;
  bunkers: Record<LineId, Bunker[]>;
  changePlannerTab: (tab: string) => void;
  changeSelectedLine: (line: LineId) => void;
  changeView: (view: string) => void;
  currentNeedsProlineCleaning: boolean;
  currentTime: Date;
  dataSource: { error: string | null };
  displayedCurrentActualEnd: Date | null;
  displayedCurrentActualStart: Date | null;
  displayedCurrentEntry: any;
  displayedCurrentOrder: Order | null;
  displayedCurrentProgress: number;
  draggedOperatorOrderId: number | null;
  draggedOperatorOrderIdRef: React.MutableRefObject<number | null>;
  editIssue: (line: LineId, issue: any) => void;
  formatOperatorDateTimeRange: (start: Date, end: Date, now: Date) => string;
  getEffectivePriority: (order: Order) => number;
  getIssueAffectedOrderCount: (line: LineId) => number;
  getIssueAffectedOrdersPreview: (line: LineId) => Order[];
  getIssueAffectedVolumeLabel: (line: LineId) => string | null;
  getIssueExpectedEndLabel: (issue: any) => string | null;
  getIssueFirstAffectedOrderLabel: (line: LineId) => string | null;
  getIssueLastAffectedOrderLabel: (line: LineId) => string | null;
  getIssueRemainingMinutesLabel: (issue: any) => string | null;
  getOrderRefLabel: (order: Pick<Order, 'num' | 'productionOrder'>) => string;
  getOrderVolumeFactor: (order: Pick<Order, 'vol' | 'pkg'>) => number;
  getPkgBadgeClass: (order: Pick<Order, 'pkg'>) => string;
  getPkgLabel: (order: Pick<Order, 'pkg'>) => string;
  handleFinishOrder: (id: number) => void;
  handleStartOrder: (id: number) => void;
  lineDebug: { countsByLine: Partial<Record<LineId, number>> };
  manualOperatorOrderLines: Partial<Record<LineId, boolean>>;
  nextNeedsProlineCleaning: boolean;
  nextOperatorOrder: Order | null;
  nextOrderBunkerPlan: Array<{ bunker: string; items: Array<{ name: string }> }>;
  nextOrderBunkerSwitches: Array<{ code: string; name: string; bunker: string; urgency: 'nu' | 'straks' }>;
  openIssueDialog: (type: 'storing' | 'onderhoud') => void;
  operatorDisplayEntries: any[];
  operatorDropTargetId: number | null;
  operatorExecutionCards: Array<{
    id: number;
    customer: string;
    factor: string;
    isBulk: boolean;
    pkg: string;
    pkgBadgeClass: string;
    pkgLabel: string;
    reason: string;
    schedule: string;
    status: 'direct' | 'prep' | 'wait';
    volume: string;
  }>;
  operatorLeegBunkers: Bunker[];
  plannedEntries: Array<{ order: Order }>;
  persistIssue: (line: LineId, issue: any) => void;
  reorderOperatorLineOrders: (line: LineId, sourceId: number, targetId: number) => void;
  resolveActiveIssue: () => void;
  selectedLine: LineId;
  setDraggedOperatorOrderId: React.Dispatch<React.SetStateAction<number | null>>;
  setNewCalibrationCode: React.Dispatch<React.SetStateAction<string>>;
  setNewCalibrationName: React.Dispatch<React.SetStateAction<string>>;
  setNewCalibrationValue: React.Dispatch<React.SetStateAction<string>>;
  setNotifications: React.Dispatch<React.SetStateAction<any[]>>;
  setOperatorDropTargetId: React.Dispatch<React.SetStateAction<number | null>>;
  setSelectedBunker: React.Dispatch<React.SetStateAction<any>>;
  setSelectedOrderForDetail: (order: Order) => void;
  setShowAllMaterials: React.Dispatch<React.SetStateAction<boolean>>;
  storingen: Record<LineId, any>;
};

export const OperatorView = React.memo(function OperatorView({
  activeIssue,
  activeIssueEntries,
  bunkers,
  changePlannerTab,
  changeSelectedLine,
  changeView,
  currentNeedsProlineCleaning,
  currentTime,
  dataSource,
  displayedCurrentActualEnd,
  displayedCurrentActualStart,
  displayedCurrentEntry,
  displayedCurrentOrder,
  displayedCurrentProgress,
  draggedOperatorOrderId,
  draggedOperatorOrderIdRef,
  editIssue,
  formatOperatorDateTimeRange,
  getEffectivePriority,
  getIssueAffectedOrderCount,
  getIssueAffectedOrdersPreview,
  getIssueAffectedVolumeLabel,
  getIssueExpectedEndLabel,
  getIssueFirstAffectedOrderLabel,
  getIssueLastAffectedOrderLabel,
  getIssueRemainingMinutesLabel,
  getOrderRefLabel,
  getOrderVolumeFactor,
  getPkgBadgeClass,
  getPkgLabel,
  handleFinishOrder,
  handleStartOrder,
  lineDebug,
  manualOperatorOrderLines,
  nextNeedsProlineCleaning,
  nextOperatorOrder,
  nextOrderBunkerPlan,
  nextOrderBunkerSwitches,
  openIssueDialog,
  operatorDisplayEntries,
  operatorDropTargetId,
  operatorExecutionCards,
  operatorLeegBunkers,
  plannedEntries,
  persistIssue,
  reorderOperatorLineOrders,
  resolveActiveIssue,
  selectedLine,
  setDraggedOperatorOrderId,
  setNewCalibrationCode,
  setNewCalibrationName,
  setNewCalibrationValue,
  setNotifications,
  setOperatorDropTargetId,
  setSelectedBunker,
  setSelectedOrderForDetail,
  setShowAllMaterials,
  storingen
}: OperatorViewProps) {
  return (
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
                      if (selectedLine !== line) changeSelectedLine(line);
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
              changeView('planner');
              changePlannerTab('wachtrij');
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
          const count = lineDebug.countsByLine[l] || 0;
          const hasIssue = !!storingen[l]?.actief;
          return (
            <button
              key={l}
              className={`ltab flex items-center gap-2 ${selectedLine === l ? 'on' : ''}`}
              onClick={() => changeSelectedLine(l)}
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
                    draggedOperatorOrderIdRef.current = o.id;
                    setDraggedOperatorOrderId(o.id);
                    setOperatorDropTargetId(null);
                    e.currentTarget.classList.add('opacity-60');
                    e.dataTransfer.setData('text/plain', String(o.id));
                    e.dataTransfer.setData('application/x-kd-operator-order-id', String(o.id));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={(e) => {
                    e.currentTarget.classList.remove('opacity-60');
                    draggedOperatorOrderIdRef.current = null;
                    setDraggedOperatorOrderId(null);
                    setOperatorDropTargetId(null);
                  }}
                  onDragEnter={(e) => {
                    const draggedId = draggedOperatorOrderIdRef.current || draggedOperatorOrderId;
                    if (!draggedId || draggedId === o.id) return;
                    e.preventDefault();
                    if (operatorDropTargetId !== o.id) setOperatorDropTargetId(o.id);
                  }}
                  onDragOver={(e) => {
                    const draggedId = draggedOperatorOrderIdRef.current || draggedOperatorOrderId;
                    if (!draggedId || draggedId === o.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (operatorDropTargetId !== o.id) setOperatorDropTargetId(o.id);
                  }}
                  onDragLeave={() => {
                    if (operatorDropTargetId === o.id) setOperatorDropTargetId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const droppedId = Number(
                      e.dataTransfer.getData('application/x-kd-operator-order-id') ||
                      e.dataTransfer.getData('text/plain') ||
                      draggedOperatorOrderIdRef.current ||
                      draggedOperatorOrderId
                    );
                    if (!droppedId || droppedId === o.id) return;
                    reorderOperatorLineOrders(selectedLine, droppedId, o.id);
                    draggedOperatorOrderIdRef.current = null;
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
                    <div className="text-xs text-gray-600 truncate flex items-center gap-1.5">
                      {isFractieMixMaterial(b.m, b.mc) && (
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-gray-900" title="Mixbunker">
                          <Shuffle size={10} />
                        </span>
                      )}
                      <span className="truncate">{b.m || 'Leeg'}</span>
                    </div>
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
  );
});
