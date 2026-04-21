import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Melding } from '../types';
import { fetchDriverListFromSupabase, fetchDriversFromSupabase, isSupabaseConfigured, setDriverActiveInSupabase, upsertDriverInSupabase, type SharedDriver } from '../services/supabaseService';

export type DriverFormState = {
  name: string;
  company: string;
  truckPlate: string;
  trailerPlate: string;
  vehicleHeightM: string;
  steeringAxles: string;
  maxWeightKg: string;
  notes: string;
};

type UseDriversOptions = {
  setNotifications: Dispatch<SetStateAction<Melding[]>>;
  setSelectedDriverName: Dispatch<SetStateAction<string>>;
  setNewDriverName: Dispatch<SetStateAction<string>>;
  setNewDriverForm: Dispatch<SetStateAction<DriverFormState>>;
  setShowDriverForm: Dispatch<SetStateAction<boolean>>;
  setIsSavingDriver: Dispatch<SetStateAction<boolean>>;
  setDriverSyncDebug: Dispatch<SetStateAction<string>>;
  emptyDriverForm: DriverFormState;
  newDriverForm: DriverFormState;
};

export function useDrivers({
  setNotifications,
  setSelectedDriverName,
  setNewDriverName,
  setNewDriverForm,
  setShowDriverForm,
  setIsSavingDriver,
  setDriverSyncDebug,
  emptyDriverForm,
  newDriverForm
}: UseDriversOptions) {
  const [sharedDriverNames, setSharedDriverNames] = useState<string[]>([]);
  const [sharedDrivers, setSharedDrivers] = useState<SharedDriver[]>([]);

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
    }
  }, [setDriverSyncDebug]);

  const handleAddDriver = useCallback(async () => {
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
    setNewDriverForm(emptyDriverForm);
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
  }, [
    emptyDriverForm,
    newDriverForm,
    refreshDriversFromSupabase,
    setDriverSyncDebug,
    setIsSavingDriver,
    setNewDriverForm,
    setNewDriverName,
    setNotifications,
    setSelectedDriverName,
    setShowDriverForm,
    sharedDriverNames
  ]);

  const handleToggleDriverAbsent = useCallback(async (driverName: string, absent: boolean) => {
    const trimmed = driverName.trim();
    if (!trimmed) return;

    setSharedDrivers(prev => prev.map(driver =>
      driver.name === trimmed ? { ...driver, active: !absent } : driver
    ));
    setSharedDriverNames(prev =>
      absent
        ? prev.filter(name => name !== trimmed)
        : Array.from(new Set([...prev, trimmed])).sort((a, b) => a.localeCompare(b, 'nl-NL'))
    );
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
  }, [refreshDriversFromSupabase, setDriverSyncDebug, setNotifications]);

  return {
    sharedDrivers,
    setSharedDrivers,
    sharedDriverNames,
    setSharedDriverNames,
    refreshDriversFromSupabase,
    handleAddDriver,
    handleToggleDriverAbsent
  };
}
