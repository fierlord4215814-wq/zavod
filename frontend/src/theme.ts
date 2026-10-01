export const APP_THEME_STORAGE_KEY = 'zavod.appearanceTheme';

export const APP_THEMES = ['dark', 'gray', 'light'] as const;

export type AppTheme = (typeof APP_THEMES)[number];

const THEME_META: Record<AppTheme, { themeColor: string; backgroundColor: string; colorScheme: 'dark' | 'light' }> = {
  dark: { themeColor: '#172033', backgroundColor: '#1e1e2e', colorScheme: 'dark' },
  gray: { themeColor: '#cbd2d8', backgroundColor: '#cbd2d8', colorScheme: 'light' },
  light: { themeColor: '#f8f4ec', backgroundColor: '#f3efe7', colorScheme: 'light' },
};

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && APP_THEMES.includes(value as AppTheme);
}

export function readAppTheme(): AppTheme {
  const earlyTheme = document.documentElement.dataset.theme;
  if (isAppTheme(earlyTheme)) return earlyTheme;

  try {
    const savedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isAppTheme(savedTheme)) return savedTheme;
  } catch {
    // Device-local appearance is best-effort; dark remains the safe default.
  }

  return 'dark';
}

export function applyAppTheme(theme: AppTheme) {
  const meta = THEME_META[theme];
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = meta.colorScheme;

  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', meta.themeColor);
  document.querySelector<HTMLMetaElement>('meta[name="background-color"]')?.setAttribute('content', meta.backgroundColor);
}

export function persistAppTheme(theme: AppTheme) {
  applyAppTheme(theme);
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
