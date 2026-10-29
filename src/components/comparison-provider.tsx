'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { comparisonIds, toggleComparison } from '../lib/comparison';
const key = 'autoveri-compare';
const Context = createContext<{
  ids: string[];
  ready: boolean;
  storageFailed: boolean;
  toggle: (id: string) => void;
  clear: () => void;
}>(null!);
export function ComparisonProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]),
    [ready, setReady] = useState(false),
    [storageFailed, setFailed] = useState(false);
  const current = useRef(ids);
  useEffect(() => {
    const load = () => {
      try {
        current.current = comparisonIds(localStorage.getItem(key));
        setIds(current.current);
      } catch {
        setFailed(true);
      }
      setReady(true);
    };
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) load();
    };
    load();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function write(next: string[]) {
    current.current = next;
    setIds(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <Context.Provider
      value={{
        ids,
        ready,
        storageFailed,
        toggle: (id) => write(toggleComparison(current.current, id)),
        clear: () => write([]),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useComparison = () => useContext(Context);
