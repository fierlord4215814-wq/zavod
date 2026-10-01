export function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function microphoneContextProblem() {
  if (typeof window === 'undefined') return 'Запись голоса сейчас недоступна.';
  if (!window.isSecureContext) {
    return 'Микрофон доступен только в защищённой версии приложения по HTTPS.';
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return 'Запись голоса не поддерживается этим браузером.';
  }
  return null;
}

export async function microphonePermissionState() {
  try {
    if (!navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

export async function microphoneErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  const permission = await microphonePermissionState();
  const standalone = isStandalonePwa();

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Микрофон не найден на устройстве.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Микрофон занят другим приложением. Закройте его и повторите.';
  if (name === 'AbortError') return 'Запись не началась. Повторите ещё раз.';
  if (name === 'SecurityError') return 'Браузер заблокировал доступ к микрофону для этого адреса.';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || permission === 'denied') {
    if (permission === 'denied') {
      return standalone
        ? 'Chrome больше не показывает запрос микрофона. Разрешите доступ в настройках сайта Chrome, вернитесь в приложение и нажмите «Повторить».'
        : 'Доступ к микрофону отключён для этого сайта. Разрешите его в настройках сайта Chrome и нажмите «Повторить».';
    }
    if (permission === 'prompt') {
      return 'Разрешение на микрофон не предоставлено. Нажмите «Повторить», чтобы снова запросить доступ.';
    }
    return 'Chrome не предоставил доступ к микрофону. Нажмите «Повторить». Если системный запрос больше не появляется, разрешите доступ в настройках сайта Chrome.';
  }
  return 'Не удалось включить микрофон. Проверьте разрешение и нажмите «Повторить».';
}
