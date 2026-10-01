import type { NotificationItem } from '../store/app.store';

export const SOUND_STORAGE_KEY = 'zavod.notificationSoundEnabled';
export const VIBRATION_STORAGE_KEY = 'zavod.notificationVibrationEnabled';
export const BROWSER_NOTIFY_STORAGE_KEY = 'zavod.browserNotificationsEnabled';

let lastSignalAt = 0;
const SIGNAL_COOLDOWN_MS = 8000;

export type NotificationNavigationIntent = {
  notificationId?: string | null;
  factoryId?: string | null;
  sourceRoute?: string | null;
};

export const NOTIFICATION_NAVIGATION_EVENT = 'zavod:notification-navigation';

export function notificationNavigationIntent(item: NotificationItem): NotificationNavigationIntent {
  return { notificationId: item.id, factoryId: item.factoryId ?? null, sourceRoute: item.sourceRoute ?? null };
}

export function dispatchNotificationNavigation(intent: NotificationNavigationIntent) {
  window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATION_EVENT, { detail: intent }));
}

function getFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function setNotificationFlag(key: string, enabled: boolean) {
  try {
    window.localStorage.setItem(key, enabled ? '1' : '0');
  } catch {
    // Local preferences are optional.
  }
}

export function notificationFlags() {
  return {
    sound: getFlag(SOUND_STORAGE_KEY),
    vibration: getFlag(VIBRATION_STORAGE_KEY),
    browser: getFlag(BROWSER_NOTIFY_STORAGE_KEY),
  };
}

export function browserNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export async function playNotificationSound() {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return false;
  const audio = new AudioContextCtor();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 660;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.12);
  window.setTimeout(() => void audio.close(), 250);
  return true;
}

export function vibrateNotification() {
  if (!('vibrate' in navigator)) return false;
  return navigator.vibrate([90, 60, 90]);
}

export async function signalImportantNotification(item: NotificationItem) {
  const now = Date.now();
  if (now - lastSignalAt < SIGNAL_COOLDOWN_MS) return;
  lastSignalAt = now;
  const flags = notificationFlags();
  if (flags.sound && item.severity !== 'INFO') {
    await playNotificationSound().catch(() => undefined);
  }
  if (flags.vibration && item.severity !== 'INFO') {
    vibrateNotification();
  }
  if (flags.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const notification = new Notification(item.title, {
      body: item.message,
      tag: item.id,
      icon: '/pwa-icon-192.png',
      badge: '/pwa-icon-192.png',
      data: notificationNavigationIntent(item),
    });
    notification.onclick = () => {
      window.focus();
      dispatchNotificationNavigation(notificationNavigationIntent(item));
      notification.close();
    };
  }
}
