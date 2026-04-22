import React from 'react';
import { RefreshCw } from 'lucide-react';
import { LINES } from '../constants';
import { LineId } from '../types';
import { normalizeEta } from '../utils';

export const SettingsView = React.memo(function SettingsView(props: any) {
  const {
    addBagVolumeRuleDraft,
    bagVolumeRuleDrafts,
    bagVolumeRuleFeedback,
    clearAllOrders,
    config,
    csvImportDate,
    csvImportFeedback,
    dataSource,
    formatLocalDate,
    handleLocalOrderImport,
    handleSaveBagVolumeRules,
    isClearingOrders,
    isImportingCsv,
    isSavingBagVolumeRules,
    laadOrders,
    lineIds,
    lineTiming,
    parseBagRuleCodesInput,
    parseBagRuleNumber,
    removeBagVolumeRuleDraft,
    setConfig,
    setCsvImportDate,
    setLineTiming,
    updateBagVolumeRuleDraft,
    visiblePlannerTriggers
  } = props;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-lg font-bold mb-4.5">Instellingen</h1>

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-bold mb-3.5">Tijdsinstellingen & Planning</h2>
        <div className="space-y-5">
          {lineIds.map((lid: LineId) => (
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
                    onChange={(e) => setLineTiming((prev: any) => ({
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
                    onChange={(e) => setLineTiming((prev: any) => ({
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
                      setConfig((prev: any) => ({
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
          {visiblePlannerTriggers.map((trigger: any) => (
            <div key={trigger.key} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="font-semibold text-gray-800 mb-1">{trigger.label}</div>
              <div>{trigger.description || 'Geen omschrijving'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold mb-1">BAG volume-regels</h2>
            <div className="text-xs text-gray-500 max-w-3xl">
              Gebruikt bij lokale CSV/XLS/XLSX import. Voor `BAG` zoekt de app de code in `Item / recept` en rekent dan: `(gepland aantal + extra bigbags) x m3 per bigbag`.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm whitespace-nowrap"
            onClick={addBagVolumeRuleDraft}
            disabled={isSavingBagVolumeRules}
          >
            + Regel
          </button>
        </div>

        <div className="space-y-3">
          {bagVolumeRuleDrafts.map((rule: any) => (
            <div
              key={rule.id}
              className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr_0.7fr_0.7fr_auto] gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3"
            >
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Naam</span>
                <input
                  type="text"
                  className="fi mt-1"
                  value={rule.label}
                  onChange={(e) => updateBagVolumeRuleDraft(rule.id, { label: e.target.value })}
                  disabled={isSavingBagVolumeRules}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Codes in item/recept</span>
                <input
                  type="text"
                  className="fi mt-1"
                  value={(rule.codes || []).join(', ')}
                  placeholder="Bijv. 150, 152"
                  onChange={(e) => updateBagVolumeRuleDraft(rule.id, { codes: parseBagRuleCodesInput(e.target.value) })}
                  disabled={isSavingBagVolumeRules}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">M3 per bag</span>
                <input
                  type="number"
                  className="fi mt-1"
                  step="0.1"
                  value={rule.volumePerBag}
                  onChange={(e) => updateBagVolumeRuleDraft(rule.id, { volumePerBag: parseBagRuleNumber(e.target.value) })}
                  disabled={isSavingBagVolumeRules}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Extra bags</span>
                <input
                  type="number"
                  className="fi mt-1"
                  step="1"
                  value={rule.extraBags}
                  onChange={(e) => updateBagVolumeRuleDraft(rule.id, { extraBags: parseBagRuleNumber(e.target.value) })}
                  disabled={isSavingBagVolumeRules}
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600">
                  <input
                    type="checkbox"
                    checked={rule.active !== false}
                    onChange={(e) => updateBagVolumeRuleDraft(rule.id, { active: e.target.checked })}
                    disabled={isSavingBagVolumeRules}
                  />
                  Actief
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600"
                  onClick={() => removeBagVolumeRuleDraft(rule.id)}
                  disabled={isSavingBagVolumeRules || bagVolumeRuleDrafts.length <= 1}
                >
                  Verwijder
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-[11px] text-gray-400">
            Standaard: codes 150/152 = +1 x 1.7 m3, codes 250/251/252 = +1 x 2.7 m3.
          </div>
          <button
            type="button"
            className="btn btn-p btn-sm whitespace-nowrap"
            onClick={handleSaveBagVolumeRules}
            disabled={isSavingBagVolumeRules}
          >
            {isSavingBagVolumeRules ? 'Opslaan...' : 'BAG-regels opslaan'}
          </button>
        </div>
        {bagVolumeRuleFeedback && (
          <div className={`mt-3 text-[11px] font-medium ${
            bagVolumeRuleFeedback.type === 'ok'
              ? 'text-green-600'
              : bagVolumeRuleFeedback.type === 'error'
                ? 'text-red-600'
                : 'text-blue-600'
          }`}>
            {bagVolumeRuleFeedback.text}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-bold mb-3.5">Lokale order-import</h2>
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Importeer een lokaal CSV-, XLS- of XLSX-bestand met kolommen zoals `Menglijn`, `Order Nummer`, `P.O.`, `Klantnaam`, `Product`, `Item / recept`, `Ritnummer`, `Geplande hoeveelheid`, `Gepland aantal` en `Eenheid`. Als het bestand geen `Datum` kolom heeft, gebruiken we de importdatum hieronder.
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
            accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="fi"
            onChange={async (e) => {
              const file = e.target.files?.[0] || null;
              await handleLocalOrderImport(file);
              e.currentTarget.value = '';
            }}
            disabled={isImportingCsv || dataSource.loading}
          />
          <div className="text-[11px] text-gray-400">
            De import schrijft direct naar Supabase en ververst daarna de orders in de app. Zonder bestandsdatum wordt `order_date` gevuld met deze importdatum.
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
  );
});
