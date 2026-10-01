import { useEffect, useRef } from 'react';

type BodySnapshot = {
  scrollY: number;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  bodyOverflow: string;
  htmlOverflow: string;
};

const activeLocks = new Set<symbol>();
let snapshot: BodySnapshot | null = null;

function freezePage() {
  if (typeof window === 'undefined' || snapshot) return;
  snapshot = {
    scrollY: window.scrollY,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyWidth: document.body.style.width,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
  };
  document.body.classList.add('app-scroll-locked');
  document.body.style.position = 'fixed';
  document.body.style.top = `-${snapshot.scrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
}

function restorePage() {
  if (typeof window === 'undefined' || !snapshot) return;
  const current = snapshot;
  snapshot = null;
  document.body.classList.remove('app-scroll-locked');
  document.body.style.position = current.bodyPosition;
  document.body.style.top = current.bodyTop;
  document.body.style.width = current.bodyWidth;
  document.body.style.overflow = current.bodyOverflow;
  document.documentElement.style.overflow = current.htmlOverflow;
  // Restore in the same lifecycle turn as the styles. A deferred callback can
  // otherwise run after another screen or lock has already taken ownership.
  window.scrollTo({ top: current.scrollY, left: 0, behavior: 'auto' });
}

export function useBodyScrollLock(locked: boolean) {
  const token = useRef(Symbol('body-scroll-lock'));

  useEffect(() => {
    if (!locked) return undefined;
    const key = token.current;
    const wasEmpty = activeLocks.size === 0;
    activeLocks.add(key);
    if (wasEmpty) freezePage();

    return () => {
      activeLocks.delete(key);
      if (activeLocks.size === 0) restorePage();
    };
  }, [locked]);
}
