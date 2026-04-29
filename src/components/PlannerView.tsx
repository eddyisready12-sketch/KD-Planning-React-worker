import React from 'react';
import { motion } from 'motion/react';
import { ClipboardList, Check, Package, Pencil, RefreshCw, Truck as TruckIcon, X } from 'lucide-react';
import { LINES } from '../constants';
import { LineId, Order } from '../types';
import { ev, fmt, normalizePkg } from '../utils';

type ScheduledLineEntry = any;

export const PlannerView = React.memo(function PlannerView(props: any) {
  const {
    activeOrders,
    changePlannerLineFilter,
    changePlannerTab,
    chauffeurActionCounts,
    chauffeurActionFilter,
    chauffeurOrders,
    chauffeurSearch,
    chauffeurTypeFilter,
    completedOrderCount,
    completedOrders,
    config,
    currentTime,
    dataSource,
    dayRosterColumns,
    dayRosterDriverColumns,
    dayRosterEntries,
    dayRosterOrdersPerColumn,
    dayRosterRowHeight,
    dayRosterSlotCount,
    dayRosterSlotMinutes,
    dayRosterStartMinutes,
    dayRosterTimeSlots,
    dayRosterUnassignedEntries,
    draggedDayRosterOrderId,
    draggedDriverName,
    driverConflictOrderIds,
    driverSyncDebug,
    emptyDriverForm,
    filteredPlannerDisplayEntriesByLine,
    formatLocalDate,
    formatPlannerDateChip,
    formatPlannerDateHeading,
    formatPlannerDateLong,
    gapDebug,
    getChauffeurOrderReason,
    getDriverOccupancyWindow,
    getEffectivePriority,
    getHeldLoadDateTime,
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
    getRunningOrderStart,
    getTransitionMinutes,
    handleAddDriver,
    handleAssignDriverToOrder,
    handleClearCompletedOrders,
    handleClearDriverFromOrder,
    handleDayRosterDragEnd,
    handleDayRosterDragStart,
    handleRecalculate,
    handleResetArrived,
    handleRestoreCompletedOrder,
    handleToggleDriverAbsent,
    isRecalculating,
    isSavingDriver,
    lineTimelineByLine,
    lineTimelineEntryByOrderId,
    minsToTime,
    minutesToTimeString,
    newDriverForm,
    openEtaEdit,
    operatorSchemaEntriesByLine,
    parseLocalDate,
    plannedActiveOrders,
    plannerDisplayIndexByLine,
    plannerDriverCount,
    plannerLineFilter,
    plannerLockOwnerRef,
    plannerRecalcLock,
    plannerSearch,
    plannerSelectedDate,
    plannerSort,
    plannerTab,
    plannerVisibleDates,
    plannerWeekDates,
    selectedDriverName,
    selectedDriverOrders,
    selectedLine,
    setArrivedHoldLoadTime,
    setArrivedOrder,
    setArrivedTime,
    setChauffeurActionFilter,
    setChauffeurSearch,
    setChauffeurTypeFilter,
    setDraggedDayRosterOrderId,
    setDraggedDriverName,
    setNewDriverForm,
    setPlannerSelectedDate,
    setPlannerSearch,
    setPlannerSort,
    setSelectedDriverName,
    setSelectedOrderForDetail,
    setShowDriverForm,
    showDriverForm,
    storingen,
    truckOrders,
    visibleChauffeurOrders,
    visiblePlannerDriversSorted
  } = props;

  return (
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
                      { id: 'chauffeurs', lbl: `Chauffeurs (${plannerDriverCount})` },
                      { id: 'vrachtwagens', lbl: 'Vrachtwagenritten' },
                      { id: 'voltooid', lbl: `Voltooid (${completedOrderCount})` }
                    ].map(t => (
                      <button 
                        key={t.id}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${plannerTab === t.id ? 'border-gr text-gr' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                        onClick={() => changePlannerTab(t.id as typeof plannerTab)}
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
                        onClick={() => changePlannerLineFilter(l.id)}
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
                <div>
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
                            const plannerDisplayTimelineCandidates = (operatorSchemaEntriesByLine?.[lid] || filteredPlannerDisplayEntriesByLine[lid]).filter(entry => {
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
                            const plannerDisplayTimeline = plannerDisplayTimelineCandidates.filter(entry => {
                              if (entry.order.status === 'running') return false;
                              return true;
                            });
                            const getPlannerLineDisplayStart = (entry: ScheduledLineEntry) => {
                              const entryRunningStart = getRunningOrderStart(entry.order);
                              if (entryRunningStart) return entryRunningStart;
                              return entry.prodStart;
                            };
                            const getPlannerLineDisplayEnd = (entry: ScheduledLineEntry) =>
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
                                        setNewDriverForm(emptyDriverForm);
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
                </div>
              </div>
  );
});
