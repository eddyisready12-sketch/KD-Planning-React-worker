import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LineId, Melding, Order } from '../types';
import { fetchOrdersFromSupabase, isSupabaseConfigured, writeOrdersToSupabase } from '../services/supabaseService';
import { normalizeEta } from '../utils';

type OrdersDataSourceState = {
  lastSync: string | null;
  loading: boolean;
  error: string | null;
};

type UseOrdersOptions = {
  setDataSource: Dispatch<SetStateAction<OrdersDataSourceState>>;
  setNotifications: Dispatch<SetStateAction<Melding[]>>;
};

function getOrderIdentityKey(order: Pick<Order, 'num' | 'rit' | 'recipe' | 'productionOrder'>): string {
  const productionOrder = String(order.productionOrder || '').trim();
  return productionOrder
    ? `po:${productionOrder}`
    : `${order.num}|${order.rit || ''}|${order.recipe || ''}`;
}

export function useOrders({ setDataSource, setNotifications }: UseOrdersOptions) {
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('kd_orders');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      localStorage.setItem('kd_orders', JSON.stringify(orders));
    }, 1500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [orders]);

  const mergeImportedOrdersIntoState = useCallback((importedOrders: Order[]) => {
    setOrders(prev => {
      const orderKey = (order: Order) => getOrderIdentityKey(order);
      const importedByKey = new Map(importedOrders.map(order => [orderKey(order), order]));
      const completed = prev.filter(order => order.status === 'completed');
      const active = prev.filter(order => order.status === 'running');
      const preserved = [...completed, ...active].filter(order => !importedByKey.has(orderKey(order)));
      const prevByKey = new Map(prev.map(order => [orderKey(order), order]));

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
  }, []);

  const laadOrders = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    setDataSource(prev => ({ ...prev, loading: true, error: null }));
    try {
      const importedOrders = await fetchOrdersFromSupabase();
      const sourceLabel = 'Supabase';

      setOrders(prev => {
        const orderKey = (order: Order) => getOrderIdentityKey(order);
        const importedByKey = new Map(importedOrders.map(order => [orderKey(order), order]));
        const completed = prev.filter(order => order.status === 'completed');
        const active = prev.filter(order => order.status === 'running');
        const preserved = [...completed, ...active].filter(order => !importedByKey.has(orderKey(order)));
        const prevByKey = new Map(prev.map(order => [orderKey(order), order]));

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
        setNotifications(prev => [{
          id: Date.now(),
          type: importedOrders.length > 0 ? 'ok' : 'waarschuwing',
          icon: importedOrders.length > 0 ? 'OK' : 'WARN',
          titel: importedOrders.length > 0 ? 'Orders gesynchroniseerd' : 'Geen orders gevonden',
          tekst: importedOrders.length > 0
            ? `${importedOrders.length} orders geladen uit ${sourceLabel}`
            : 'Geen geldige orders gevonden in Supabase.',
          lijn: null,
          orderNum: null,
          tijd: new Date(),
          gelezen: false
        }, ...prev]);
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
  }, [setDataSource, setNotifications]);

  const persistOrders = useCallback(async (
    nextOrders: Order[],
    errorTitle = 'Order sync mislukt',
    line: LineId | null = null,
    orderNum: number | null = null
  ) => {
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
  }, [setNotifications]);

  const persistSingleOrder = useCallback(async (
    nextOrder: Order,
    nextOrders: Order[],
    errorTitle = 'Order sync mislukt'
  ) => {
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
  }, [setNotifications]);

  return {
    orders,
    setOrders,
    laadOrders,
    persistOrders,
    persistSingleOrder,
    mergeImportedOrdersIntoState
  };
}
