import { appStore, useAppStore } from './app.store';

type ShiftStore = {
  factoryId: string;
  shiftId?: string;
  setFactory: (factoryId: string) => void;
};

// Compatibility hook for the unused prototype entrypoint. Factory identity and
// context invalidation belong to appStore, not a second independent store.
export function useShiftStore(): ShiftStore;
export function useShiftStore<T>(selector: (state: ShiftStore) => T): T;
export function useShiftStore<T>(selector?: (state: ShiftStore) => T) {
  const { selectedFactoryId } = useAppStore();
  const current: ShiftStore = { factoryId: selectedFactoryId, setFactory: appStore.selectFactory };
  return selector ? selector(current) : current;
}
