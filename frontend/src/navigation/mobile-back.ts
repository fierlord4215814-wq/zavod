import { useEffect, useRef } from 'react';

type Layer = {
  id: number;
  priority: number;
  order: number;
  onBack: () => void;
};

const layers = new Map<number, Layer>();
let nextId = 1;
let nextOrder = 1;

export function dispatchMobileBack() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && (
    active.matches('input, textarea, select, [contenteditable="true"]')
    || active.closest('[role="combobox"]')
  )) {
    active.blur();
    return true;
  }
  const top = Array.from(layers.values())
    .sort((left, right) => right.priority - left.priority || right.order - left.order)[0];
  if (!top) return false;
  top.onBack();
  return true;
}

const DIRTY_FORM_EVENT = 'zavod:dirty-forms-changed';
const dirtyForms = new Set<string>();

export function setMobileFormDirty(id: string, dirty: boolean) {
  if (dirty) dirtyForms.add(id);
  else dirtyForms.delete(id);
  window.dispatchEvent(new CustomEvent(DIRTY_FORM_EVENT, { detail: { dirty: dirtyForms.size > 0 } }));
}

export function hasDirtyMobileForms() {
  return dirtyForms.size > 0;
}

export function hasDirtyMobileForm(id: string) {
  return dirtyForms.has(id);
}

export function useMobileFormDirty(id: string, dirty: boolean) {
  useEffect(() => {
    setMobileFormDirty(id, dirty);
    return () => setMobileFormDirty(id, false);
  }, [dirty, id]);
}

export function useMobileBackLayer(active: boolean, onBack: () => void, priority = 500) {
  const callbackRef = useRef(onBack);
  callbackRef.current = onBack;
  const idRef = useRef<number | null>(null);
  if (!idRef.current) idRef.current = nextId++;

  useEffect(() => {
    if (!active) return undefined;
    const id = idRef.current!;
    layers.set(id, { id, priority, order: nextOrder++, onBack: () => callbackRef.current() });
    return () => {
      layers.delete(id);
    };
  }, [active, priority]);
}

export function installMobileBackCoordinator(onRootBack: () => void) {
  const requestBack = () => {
    if (!dispatchMobileBack()) onRootBack();
  };
  const onRequest = () => requestBack();
  const onPopState = () => {
    requestBack();
    window.history.pushState({ ...(window.history.state ?? {}), zavodBackGuard: true }, '', window.location.href);
  };

  window.addEventListener('zavod:mobile-back-request', onRequest);
  if (!window.history.state?.zavodBackGuard) {
    window.history.replaceState({ ...(window.history.state ?? {}), zavodAppRoot: true }, '', window.location.href);
    window.history.pushState({ ...(window.history.state ?? {}), zavodBackGuard: true }, '', window.location.href);
  }
  window.addEventListener('popstate', onPopState);

  return () => {
    window.removeEventListener('zavod:mobile-back-request', onRequest);
    window.removeEventListener('popstate', onPopState);
  };
}

export function leaveStandaloneApp() {
  window.close();
  window.setTimeout(() => window.history.go(-2), 40);
}
