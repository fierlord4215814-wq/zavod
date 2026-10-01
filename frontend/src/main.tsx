import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const notifyUpdate = (worker: ServiceWorker | null) => {
    if (!worker) return;
    window.dispatchEvent(new CustomEvent('zavod:pwa-update', { detail: { worker } }));
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        notifyUpdate(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const nextWorker = registration.installing;
        if (!nextWorker) return;
        nextWorker.addEventListener('statechange', () => {
          if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdate(nextWorker);
          }
        });
      });
    });
  });
}

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
  caches.keys().then((keys) => {
    keys.forEach((key) => void caches.delete(key));
  });
}
