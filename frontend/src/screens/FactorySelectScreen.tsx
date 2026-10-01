import React, { FormEvent, useState } from 'react';
import { apiClient } from '../api/client';
import { PwaInstallButton } from '../components/PwaInstallButton';
import { PremiumSheet } from '../components/PremiumShell';
import { useMobileBackLayer } from '../navigation/mobile-back';
import {
  appStore,
  AvailableFactory,
  CurrentUser,
  useAppStore,
} from '../store/app.store';
import { roleLabel } from '../labels';
import { isPilotFixtureText } from '../utils/pilot-ui';

void React;

type DevLoginResponse = {
  userId: string;
  availableFactories: AvailableFactory[];
  recommendedFactoryId: string | null;
};

type LoginResponse = DevLoginResponse & {
  token?: string;
  requiresPasswordChange?: boolean;
  setupToken?: string;
};

type SetPasswordResponse = {
  ok: boolean;
  requiresLogin: boolean;
};

type MeResponse = {
  userId: string;
  selectedFactoryId: string;
  role: string;
  departmentId: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGuest: boolean;
  displayName?: string | null;
  jobTitleName?: string | null;
  departmentName?: string | null;
  availableFactories: AvailableFactory[];
};

function toCurrentUser(response: MeResponse): CurrentUser {
  return {
    userId: response.userId,
    role: response.role,
    departmentId: response.departmentId,
    permissions: response.permissions,
    isAdmin: response.isAdmin,
    isGuest: response.isGuest,
    displayName: response.displayName ?? null,
    jobTitleName: response.jobTitleName ?? null,
    departmentName: response.departmentName ?? null,
  };
}

function isRuntimeFactoryOption(factory: AvailableFactory) {
  if (isPilotFixtureText(factory.id, factory.name, factory.code)) return false;
  if (/\b(quality cross|cross factory|quality other)\b/i.test(`${factory.name} ${factory.code}`)) return false;
  return !/^\d+$/.test(factory.name.trim()) || !/^\d+$/.test(factory.code.trim());
}

export function FactorySelectScreen() {
  const { userId, currentUser, availableFactories, selectedFactoryId, authStatus, authError, authToken } = useAppStore();
  const [devUserId, setDevUserId] = useState(userId || 'test-admin');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [registrationOperationId, setRegistrationOperationId] = useState(() => `register-${crypto.randomUUID()}`);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'set-password'>('login');
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [factoryPickerOpen, setFactoryPickerOpen] = useState(false);
  const showDevLogin = import.meta.env.DEV || import.meta.env.MODE === 'e2e';
  const visibleFactories = React.useMemo(
    () => availableFactories.filter(isRuntimeFactoryOption),
    [availableFactories],
  );
  const hasLoggedIn = Boolean(currentUser || userId || authToken);
  const hasGuestAccess = visibleFactories.some((factory) => factory.isGuest) || Boolean(currentUser?.isGuest && selectedFactoryId);
  const showWaitingAssignment = authStatus === 'noFactories' || (hasLoggedIn && availableFactories.length > 0 && visibleFactories.length === 0);
  const returnToLogin = () => {
    if (authMode === 'set-password') {
      setSetupToken('');
      setNewPassword('');
      setNewPasswordRepeat('');
    } else {
      setPassword('');
      setPasswordRepeat('');
      setRegistrationOperationId(`register-${crypto.randomUUID()}`);
    }
    setLocalError(null);
    setAuthMode('login');
  };
  useMobileBackLayer(authMode !== 'login', returnToLogin, 700);

  React.useEffect(() => {
    if (!hasLoggedIn || selectedFactoryId || visibleFactories.length === 0) {
      setFactoryPickerOpen(false);
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    setFactoryPickerOpen(true);
  }, [hasLoggedIn, selectedFactoryId, visibleFactories.length]);

  const finishLogin = async (response: LoginResponse) => {
    if (response.token) appStore.setAuthToken(response.token);
    appStore.setSession({
      currentUser: {
        userId: response.userId,
        role: 'OTHER',
        departmentId: null,
        permissions: [],
        isAdmin: false,
        isGuest: true,
      },
      availableFactories: response.availableFactories,
      selectedFactoryId: '',
      authStatus: response.availableFactories.length ? 'ready' : 'noFactories',
      authToken: response.token ?? null,
    });
  };

  const passwordLogin = async (event?: FormEvent) => {
    event?.preventDefault();
    setLocalError(null);
    setLocalNotice(null);
    if (!phone.trim()) {
      setLocalError('Укажите телефон');
      return;
    }
    appStore.setAuthLoading();
    try {
      const response = await apiClient.request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
        skipContextHeaders: true,
      });
      if (response.requiresPasswordChange && response.setupToken) {
        setPassword('');
        setSetupToken(response.setupToken);
        setAuthMode('set-password');
        appStore.setSession({ currentUser: null, availableFactories: response.availableFactories, selectedFactoryId: '', authStatus: 'ready' });
        return;
      }
      await finishLogin(response);
    } catch (error) {
      appStore.setAuthError(error instanceof Error ? error.message : 'Не удалось войти');
    }
  };

  const register = async (event?: FormEvent) => {
    event?.preventDefault();
    setLocalError(null);
    setLocalNotice(null);
    if (!phone.trim()) {
      setLocalError('Укажите телефон');
      return;
    }
    if (!password) {
      setLocalError('Введите пароль');
      return;
    }
    if (password !== passwordRepeat) {
      setLocalError('Пароли не совпадают');
      return;
    }
    appStore.setAuthLoading();
    try {
      const response = await apiClient.request<LoginResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ phone, password, passwordRepeat, operationId: registrationOperationId }),
        skipContextHeaders: true,
      });
      setPassword('');
      setPasswordRepeat('');
      setRegistrationOperationId(`register-${crypto.randomUUID()}`);
      setLocalNotice('Регистрация завершена. Выберите завод и отправьте заявку на назначение.');
      await finishLogin(response);
    } catch (error) {
      appStore.setAuthError(error instanceof Error ? error.message : 'Не удалось зарегистрироваться');
    }
  };

  const submitNewPassword = async (event?: FormEvent) => {
    event?.preventDefault();
    setLocalError(null);
    setLocalNotice(null);
    if (!newPassword) {
      setLocalError('Введите новый пароль');
      return;
    }
    if (newPassword !== newPasswordRepeat) {
      setLocalError('Пароли не совпадают');
      return;
    }
    appStore.setAuthLoading();
    try {
      const response = await apiClient.request<SetPasswordResponse>('/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ setupToken, newPassword, passwordRepeat: newPasswordRepeat }),
        skipContextHeaders: true,
      });
      setPassword('');
      setNewPassword('');
      setNewPasswordRepeat('');
      setSetupToken('');
      setAuthMode('login');
      setLocalNotice(response.requiresLogin
        ? 'Новый пароль сохранён. Войдите с ним.'
        : 'Новый пароль сохранён.');
      appStore.setSession({
        currentUser: null,
        availableFactories: [],
        selectedFactoryId: '',
        authStatus: 'ready',
        authToken: null,
      });
    } catch (error) {
      appStore.setAuthError(error instanceof Error ? error.message : 'Не удалось установить пароль');
    }
  };

  const login = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmedUserId = devUserId.trim();
    if (!trimmedUserId) {
      setLocalError('Укажите dev-пользователя');
      return;
    }

    setLocalError(null);
    appStore.setAuthLoading();

    try {
      const response = await apiClient.request<DevLoginResponse>('/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ userId: trimmedUserId }),
        skipContextHeaders: true,
      });

      appStore.setDevUserId(response.userId);
      appStore.setSession({
        currentUser: {
          userId: response.userId,
          role: 'OTHER',
          departmentId: null,
          permissions: [],
          isAdmin: false,
          isGuest: true,
        },
        availableFactories: response.availableFactories,
        selectedFactoryId: '',
        authStatus: response.availableFactories.length ? 'ready' : 'noFactories',
        authToken: null,
      });
    } catch (error) {
      appStore.setAuthError(error instanceof Error ? error.message : 'Не удалось войти в dev-режиме');
    }
  };

  const selectFactory = async (factoryId: string) => {
    setFactoryPickerOpen(false);
    appStore.selectFactory(factoryId);
    appStore.setAuthLoading();

    try {
      const me = await apiClient.get<MeResponse>('/auth/me');
      appStore.setSession({
        currentUser: toCurrentUser(me),
        availableFactories: me.availableFactories,
        selectedFactoryId: me.selectedFactoryId,
        authStatus: 'ready',
      });
    } catch (error) {
      appStore.setAuthError(error instanceof Error ? error.message : 'Завод недоступен для пользователя');
    }
  };

  const errorText = localError ?? authError;

  return (
    <main className="app-shell factory-shell">
      <section className="factory-panel">
        <div className="factory-hero">
          <div className="brand-mark factory-mark" aria-hidden="true" />
          <div>
            <h1 className="factory-title">Завод</h1>
            <p className="factory-subtitle">Вход, первый запуск и выбор завода</p>
          </div>
        </div>

        {!hasLoggedIn ? (
          <section className="onboarding-status-card factory-intro-card">
            <h2>Вход в систему</h2>
            <p>Введите телефон и пароль. После входа выберите доступный вам завод.</p>
          </section>
        ) : null}

        {authMode === 'set-password' ? (
          <form className="dev-login-card" onSubmit={(event) => void submitNewPassword(event)}>
            <label className="field-label" htmlFor="new-password">Новый пароль</label>
            <input
              id="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Новый пароль"
              type="password"
              autoComplete="new-password"
            />
            <label className="field-label" htmlFor="new-password-repeat">Повторите новый пароль</label>
            <input
              id="new-password-repeat"
              value={newPasswordRepeat}
              onChange={(event) => setNewPasswordRepeat(event.target.value)}
              placeholder="Повтор нового пароля"
              type="password"
              autoComplete="new-password"
            />
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={returnToLogin}>
                Назад ко входу
              </button>
              <button className="primary-button" type="submit" disabled={authStatus === 'loading'}>
                Сохранить
              </button>
            </div>
            <p className="helper-text">Используйте не менее 6 символов. Подойдёт парольная фраза. После сохранения войдите с новым паролем.</p>
          </form>
        ) : authMode === 'register' ? (
          <form className="dev-login-card" onSubmit={(event) => void register(event)}>
            <h2>Регистрация</h2>
            <p className="helper-text">После регистрации рабочий доступ назначит руководитель или администратор.</p>
            <label className="field-label" htmlFor="register-phone">Телефон</label>
            <input
              id="register-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+7..."
              inputMode="tel"
              autoComplete="tel"
            />
            <label className="field-label" htmlFor="register-password">Пароль</label>
            <input
              id="register-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Пароль"
              type="password"
              autoComplete="new-password"
            />
            <label className="field-label" htmlFor="register-password-repeat">Повторите пароль</label>
            <input
              id="register-password-repeat"
              value={passwordRepeat}
              onChange={(event) => setPasswordRepeat(event.target.value)}
              placeholder="Повтор пароля"
              type="password"
              autoComplete="new-password"
            />
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={returnToLogin}>
                Назад ко входу
              </button>
              <button className="primary-button" type="submit" disabled={authStatus === 'loading'}>
                Зарегистрироваться
              </button>
            </div>
          </form>
        ) : (
          <form className="dev-login-card" onSubmit={(event) => void passwordLogin(event)}>
            <label className="field-label" htmlFor="login-phone">Телефон</label>
            <input
              id="login-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+7..."
              inputMode="tel"
              autoComplete="tel"
            />
            <label className="field-label" htmlFor="login-password">Пароль</label>
            <div className="dev-login-row">
              <input
                id="login-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Пароль"
                type="password"
                autoComplete="current-password"
              />
              <button className="primary-button" type="submit" disabled={authStatus === 'loading'}>
                Войти
              </button>
            </div>
            <p className="helper-text">
              Если администратор выдал временный код, введите его в поле пароля. Код одноразовый и имеет ограниченный срок действия.
            </p>
            <button className="secondary-button" type="button" onClick={() => {
              setPassword('');
              setPasswordRepeat('');
              setLocalError(null);
              setAuthMode('register');
            }}>
              Регистрация
            </button>
            <PwaInstallButton />
          </form>
        )}

        {showDevLogin ? (
        <form className="dev-login-card" onSubmit={(event) => void login(event)}>
          <label className="field-label" htmlFor="dev-user-id">Тестовый пользователь</label>
          <div className="dev-login-row">
            <input
              id="dev-user-id"
              value={devUserId}
              onChange={(event) => setDevUserId(event.target.value)}
              placeholder="test-admin"
              autoComplete="username"
            />
            <button className="primary-button" type="submit" disabled={authStatus === 'loading'}>
              Войти
            </button>
          </div>
          <p className="helper-text">
            Локальный вход только для автопроверок и диагностики.
          </p>
        </form>
        ) : null}

        {authStatus === 'loading' ? <div className="empty-state">Загружаю доступные заводы...</div> : null}
        {errorText ? <div className="empty-state error-state">{errorText}</div> : null}
        {localNotice ? <div className="empty-state success-state" role="status">{localNotice}</div> : null}
        {showWaitingAssignment ? (
          <section className="onboarding-status-card waiting-assignment-card" role="status">
            <h2>Доступ ещё не назначен</h2>
            <p>Для этого пользователя пока нет активного завода или рабочей роли.</p>
            <p>После назначения доступа здесь появится выбор завода, а внутри приложения откроются рабочие разделы.</p>
            <p>Обратитесь к мастеру, руководителю или администратору.</p>
          </section>
        ) : null}

        {hasGuestAccess && visibleFactories.length ? (
          <section className="onboarding-status-card guest-access-card" role="status">
            <h2>Вы вошли как Гость</h2>
            <p>Ваш доступ ещё не назначен полностью. Выберите завод и отправьте одну заявку ответственному руководителю.</p>
            <p>До назначения доступны заявка на назначение, сообщение об ошибке, настройки и выход.</p>
          </section>
        ) : null}

        {visibleFactories.length ? (
          <section className="onboarding-status-card factory-choice-card">
            <h2>Выберите рабочий завод</h2>
            <p>Показаны только заводы, к которым вам назначен доступ.</p>
            <button className="primary-button factory-picker-trigger" type="button" onClick={() => setFactoryPickerOpen(true)}>
              Выбрать завод
            </button>
          </section>
        ) : null}
        <p className="helper-text">Версия приложения: {import.meta.env.VITE_APP_VERSION || 'локальная разработка'}</p>
      </section>

      <PremiumSheet
        className="factory-picker-sheet"
        closeLabel="Назад"
        description="Выберите завод, в котором будете работать сейчас."
        onClose={() => setFactoryPickerOpen(false)}
        open={factoryPickerOpen}
        title="Выберите завод"
      >
        <div className="factory-picker-list" data-testid="factory-picker">
          {visibleFactories.map((factory) => (
            <button
              className="factory-picker-option"
              disabled={authStatus === 'loading'}
              key={factory.id}
              onClick={() => void selectFactory(factory.id)}
              type="button"
            >
              <span className="factory-picker-option-copy">
                <strong>{factory.name}</strong>
                <span>{roleLabel(factory.role)}{factory.departmentName ? ` · ${factory.departmentName}` : ''}</span>
                {factory.isGuest ? <small>Гостевой доступ до назначения рабочей роли</small> : null}
              </span>
              <span className="factory-picker-option-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </PremiumSheet>
    </main>
  );
}
