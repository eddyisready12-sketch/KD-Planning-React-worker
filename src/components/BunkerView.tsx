import React from 'react';
import { Shuffle } from 'lucide-react';
import { LINES } from '../constants';
import { Bunker, LineId } from '../types';
import { isFractieMixMaterial } from '../utils';

type BunkerViewProps = {
  bunkers: Record<LineId, Bunker[]>;
  setNewCalibrationCode: React.Dispatch<React.SetStateAction<string>>;
  setNewCalibrationName: React.Dispatch<React.SetStateAction<string>>;
  setNewCalibrationValue: React.Dispatch<React.SetStateAction<string>>;
  setSelectedBunker: React.Dispatch<React.SetStateAction<any>>;
  setShowAllMaterials: React.Dispatch<React.SetStateAction<boolean>>;
};

export const BunkerView = React.memo(function BunkerView({
  bunkers,
  setNewCalibrationCode,
  setNewCalibrationName,
  setNewCalibrationValue,
  setSelectedBunker,
  setShowAllMaterials
}: BunkerViewProps) {
  return (
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
                    <div className="text-xs text-gray-600 truncate flex items-center gap-1.5">
                      {isFractieMixMaterial(b.m, b.mc) && (
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-gray-900" title="Mixbunker">
                          <Shuffle size={10} />
                        </span>
                      )}
                      <span className="truncate">{b.m || 'Leeg'}</span>
                    </div>
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
  );
});
