# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: three-themes.spec.ts >> TC14-01 real modal form labels and affected shared consumers
- Location: e2e\three-themes.spec.ts:1341:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog').locator('.form-grid > label').filter({ has: getByRole('dialog').getByText('Название', { exact: true }) }).first()
Expected: visible
Timeout: 8000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for getByRole('dialog').locator('.form-grid > label').filter({ has: getByRole('dialog').getByText('Название', { exact: true }) }).first()

```

```yaml
- main:
  - heading "Завод оформления" [level=1]
  - paragraph: Завод
  - text: Онлайн · Администратор Тест о.
  - 'button "Уведомления: 3"': "3"
  - status:
    - strong: Мгновенные обновления недоступны
    - text: Уведомления продолжают обновляться резервным опросом.
  - heading "Чаты" [level=2]
  - paragraph: "Внутренний мессенджер завода: отделы, группы, вложения и прочитанные сообщения."
  - button "Личный чат"
  - button "Создать чат"
  - text: Нет новых событий
  - complementary:
    - textbox "Поиск по чатам"
    - button "Все"
    - button "Непрочитанные"
    - button "Личные"
    - button "Отделы"
    - button "Группы"
    - text: Доступных чатов пока нет.
  - heading "Выберите чат" [level=3]
  - paragraph: Откройте общий, отделовой или групповой чат, чтобы продолжить переписку.
  - dialog:
    - heading "Создать чат" [level=3]
    - button "Закрыть"
    - text: Название
    - textbox "Название":
      - /placeholder: "Группа: Запуск Пицца Рондо"
    - text: Тип
    - combobox "Тип":
      - option "Групповой чат"
      - option "Чат отдела"
      - option "Общий чат завода" [selected]
    - text: Описание
    - textbox "Описание":
      - /placeholder: Для чего нужен этот чат
    - 'checkbox "Закрытый чат: видят только участники и администраторы с доступом к этому заводу" [checked]'
    - text: "Закрытый чат: видят только участники и администраторы с доступом к этому заводу"
    - button "Отмена"
    - button "Сохранить" [disabled]
  - navigation "Основная навигация":
    - button "Смена"
    - button "История смен"
    - button "Люди"
    - button "Админка Администрирование"
    - button "Линии"
    - button "Заявки"
    - button "Мойка"
    - button "ОКК"
    - button "Некондиция"
    - button "Заказы / Остатки"
    - button "Чек-листы"
    - button "Оттайка"
    - button "Возвраты на производство"
    - button "Пересменка / Журнал"
    - button "Чаты"
    - button "Объявления"
    - button "Архив"
    - button "Уведомления 3"
    - button "Статистика / Аудит"
    - button "Сообщить об ошибке"
    - button "Настройки"
```

# Test source

```ts
  395 |           summary: checklistState === 'filled'
  396 |             ? { inProgress: 1, dueSoon: 0, overdue: 0, paused: 0, completed: 1, autoClosed: 0, notTaken: 1 }
  397 |             : { inProgress: 0, dueSoon: 0, overdue: 0, paused: 0, completed: 0, autoClosed: 0, notTaken: 0 },
  398 |           runs: checklistState === 'filled' ? [checklistActiveRunFixture] : [],
  399 |         },
  400 |       });
  401 |       return;
  402 |     }
  403 |     if (apiPath === '/shift/timeline') {
  404 |       await json(route, {
  405 |         current: { shiftDate: '2026-09-13', targetShiftDate: '2026-09-13', shiftType: 'DAY', label: 'Дневная смена 13 сентября' },
  406 |         next: { shiftDate: '2026-09-13', targetShiftDate: '2026-09-13', shiftType: 'NIGHT', label: 'Ночная смена 13 сентября' },
  407 |         future: [], past: [],
  408 |       });
  409 |       return;
  410 |     }
  411 |     if (apiPath === '/health') { await json(route, { timestamp: '2026-09-13T09:00:00.000Z' }); return; }
  412 |     if (apiPath === '/shift-log/handover/previous' || apiPath === '/shift-log/handover/summary') { await json(route, null); return; }
  413 |     if (apiPath === '/shift-log/handover/availability') { await json(route, { available: false }); return; }
  414 |     if (apiPath === '/archive/options') {
  415 |       await json(route, {
  416 |         sections: [
  417 |           ['tasks', 'Заявки и простои'], ['checklists', 'Чек-листы'], ['okk', 'ОКК'],
  418 |           ['returns', 'Возвраты на производство'], ['stock', 'Некондиция'], ['orders', 'Заказы / Остатки'],
  419 |           ['wash', 'Мойка'], ['defrost', 'Оттайка'], ['shiftLog', 'Пересменка / Журнал'],
  420 |           ['announcements', 'Объявления'], ['attachments', 'Файлы и вложения'],
  421 |         ].map(([key, label]) => ({ key, label, description: 'Изолированная визуальная проверка темы.' })),
  422 |         departments: [], lines: [], checklistTemplates: [],
  423 |       });
  424 |       return;
  425 |     }
  426 |     if (apiPath === '/archive/downtime/options') { await json(route, { lines: [], departments: [], assignees: [], reasons: [] }); return; }
  427 |     if (apiPath.startsWith('/archive/items')) { await json(route, { items: [], page: 1, pageSize: 24, total: 0, hasMore: false, metrics: null }); return; }
  428 |     if (apiPath.startsWith('/archive/attachments')) { await json(route, { items: [], page: 1, pageSize: 24, total: 0, hasMore: false }); return; }
  429 |     if (apiPath.startsWith('/ops/operations/overview')) {
  430 |       await json(route, {
  431 |         generatedAt: '2026-09-13T09:00:00.000Z', period: { label: '7 дней', days: 7, capped: false, asOf: '2026-09-13' },
  432 |         summary: {
  433 |           totalLostMinutes: 0, totalLostLabel: '0 мин', downtimeCount: 0, averageDowntimeMinutes: null,
  434 |           medianDowntimeMinutes: null, p90DowntimeMinutes: null, openDowntimeCount: 0, preliminary: false,
  435 |           worstLine: null, urgentOpenTasks: 0, overdueLongTasks: 0, tasksTotal: 0, tasksOpen: 0,
  436 |           tasksCompleted: 0, averageResponseMinutes: null, medianResponseMinutes: null, p90ResponseMinutes: null,
  437 |           maxResponseMinutes: null, averageExecutionMinutes: null, medianExecutionMinutes: null,
  438 |           p90ExecutionMinutes: null, maxExecutionMinutes: null, averageResolutionMinutes: null,
  439 |           medianResolutionMinutes: null, p90ResolutionMinutes: null,
  440 |           tenMinuteDailyEffect: { yearlyLabel: '0 ч', text: 'Нет потерь времени в изолированном состоянии.' },
  441 |         },
  442 |         weakSpots: [], lineEvents: { stop: 0, pause: 0, work: 0, downtimeLinkedTasks: 0 },
  443 |         quality: { okkDefects: 0, stockDefects: 0, stockDefectQuantity: 0, returns: 0 },
  444 |         checklists: { started: 0, active: 0, runsCompleted: 0, checksCompleted: 0, checksOverdue: 0, manuallyClosed: 0, shiftClosed: 0 },
  445 |         wash: { active: 0, completed: 0, issues: 0, openIssues: 0, miniTasks: 0, miniTasksDone: 0 },
  446 |         lines: [], downtimeReasons: [], downtimes: [], tasks: [], departments: [], repeatedProblems: [],
  447 |         dataQuality: { status: 'OK', warnings: [] }, limitations: [],
  448 |         filterOptions: { lines: [], departments: [], taskScopes: [] },
  449 |       });
  450 |       return;
  451 |     }
  452 |     if (apiPath.startsWith('/ops/overview')) {
  453 |       await json(route, {
  454 |         activeTasksCount: 0, overdueLongTasksCount: 0, activeWashCount: 0, washIssuesCount: 0,
  455 |         activeDefrostCount: 0, lowStockItemsCount: 0, openOrderRequestsCount: 0,
  456 |         activeImportantShiftLogsCount: 0, unreadNotificationsCount: 0, checklistAutoClosedCount: 0,
  457 |         recentAccessDeniedCount: 0,
  458 |       });
  459 |       return;
  460 |     }
  461 |     if (apiPath.startsWith('/ops/events') || apiPath.startsWith('/ops/audit') || apiPath.startsWith('/ops/module-summary')) { await json(route, []); return; }
  462 |     if (apiPath === '/chats' || apiPath === '/error-reports' || apiPath.startsWith('/tasks')) { await json(route, []); return; }
  463 |     await json(route, []);
  464 |   });
  465 | }
  466 | 
  467 | async function capture(page: Page, name: string, extra: Record<string, unknown> = {}, fullPage = false) {
  468 |   const file = `${name}.png`;
  469 |   const target = path.join(evidenceRoot, file);
  470 |   await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  471 |   const geometry = await page.evaluate(() => ({
  472 |     theme: document.documentElement.dataset.theme || 'dark',
  473 |     width: innerWidth,
  474 |     overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  475 |     bodyBackground: getComputedStyle(document.body).backgroundColor,
  476 |     textColor: getComputedStyle(document.body).color,
  477 |   }));
  478 |   runtime.screenshots.push({
  479 |     file,
  480 |     capturedAt: new Date().toISOString(),
  481 |     productStyleFingerprint,
  482 |     harnessFingerprint,
  483 |     ...geometry,
  484 |     ...extra,
  485 |   });
  486 |   expect(geometry.overflowX).toBeLessThanOrEqual(4);
  487 | }
  488 | 
  489 | async function recordLocatorComputedStyle(
  490 |   locator: Locator,
  491 |   selectorLabel: string,
  492 |   caseId: string,
  493 |   extra: Record<string, unknown> = {},
  494 | ) {
> 495 |   await expect(locator).toBeVisible();
      |                         ^ Error: expect(locator).toBeVisible() failed
  496 |   const style = await locator.evaluate((element, selectorValue) => {
  497 |     const computed = getComputedStyle(element);
  498 |     const rect = element.getBoundingClientRect();
  499 |     const control = element as HTMLButtonElement | HTMLInputElement;
  500 |     return {
  501 |       selector: selectorValue,
  502 |       color: computed.color,
  503 |       backgroundColor: computed.backgroundColor,
  504 |       backgroundImage: computed.backgroundImage,
  505 |       borderColor: computed.borderColor,
  506 |       opacity: computed.opacity,
  507 |       disabled: 'disabled' in control ? Boolean(control.disabled) : null,
  508 |       ariaPressed: element.getAttribute('aria-pressed'),
  509 |       text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  510 |       rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  511 |     };
  512 |   }, selectorLabel);
  513 |   runtime.computedStyles.push({ caseId, ...extra, ...style });
  514 |   return style;
  515 | }
  516 | 
  517 | async function recordComputedStyle(
  518 |   page: Page,
  519 |   selector: string,
  520 |   caseId: string,
  521 |   extra: Record<string, unknown> = {},
  522 | ) {
  523 |   const locator = page.locator(selector).filter({ visible: true }).first();
  524 |   await expect(locator).toBeVisible();
  525 |   const style = await locator.evaluate((element, selectorValue) => {
  526 |     const computed = getComputedStyle(element);
  527 |     const rect = element.getBoundingClientRect();
  528 |     const control = element as HTMLButtonElement | HTMLInputElement;
  529 |     return {
  530 |       selector: selectorValue,
  531 |       color: computed.color,
  532 |       backgroundColor: computed.backgroundColor,
  533 |       backgroundImage: computed.backgroundImage,
  534 |       borderColor: computed.borderColor,
  535 |       opacity: computed.opacity,
  536 |       disabled: 'disabled' in control ? Boolean(control.disabled) : null,
  537 |       ariaPressed: element.getAttribute('aria-pressed'),
  538 |       text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  539 |       rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  540 |     };
  541 |   }, selector);
  542 |   runtime.computedStyles.push({ caseId, ...extra, ...style });
  543 |   return style;
  544 | }
  545 | 
  546 | async function recordTargetVisibility(
  547 |   page: Page,
  548 |   locator: Locator,
  549 |   caseId: string,
  550 |   extra: Record<string, unknown> = {},
  551 |   scrollMethod: 'none' | 'scrollIntoView-center' = 'none',
  552 | ) {
  553 |   await expect(locator).toBeVisible();
  554 |   if (scrollMethod === 'scrollIntoView-center') {
  555 |     await locator.evaluate((element) => element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' }));
  556 |     await page.waitForTimeout(80);
  557 |   }
  558 |   const visibility = await locator.evaluate((element) => {
  559 |     const rect = element.getBoundingClientRect();
  560 |     let clipLeft = 0;
  561 |     let clipTop = 0;
  562 |     let clipRight = innerWidth;
  563 |     let clipBottom = innerHeight;
  564 |     const clippingAncestors: Array<Record<string, unknown>> = [];
  565 |     let ancestor = element.parentElement;
  566 |     while (ancestor) {
  567 |       const style = getComputedStyle(ancestor);
  568 |       const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
  569 |       const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
  570 |       if (clipsX || clipsY) {
  571 |         const ancestorRect = ancestor.getBoundingClientRect();
  572 |         if (clipsX) {
  573 |           clipLeft = Math.max(clipLeft, ancestorRect.left);
  574 |           clipRight = Math.min(clipRight, ancestorRect.right);
  575 |         }
  576 |         if (clipsY) {
  577 |           clipTop = Math.max(clipTop, ancestorRect.top);
  578 |           clipBottom = Math.min(clipBottom, ancestorRect.bottom);
  579 |         }
  580 |         clippingAncestors.push({
  581 |           tag: ancestor.tagName,
  582 |           className: ancestor.className,
  583 |           overflowX: style.overflowX,
  584 |           overflowY: style.overflowY,
  585 |           scrollLeft: ancestor.scrollLeft,
  586 |           scrollTop: ancestor.scrollTop,
  587 |           rect: { x: ancestorRect.x, y: ancestorRect.y, width: ancestorRect.width, height: ancestorRect.height },
  588 |         });
  589 |       }
  590 |       ancestor = ancestor.parentElement;
  591 |     }
  592 |     const epsilon = 1;
  593 |     const fullyInsideClip = rect.left >= clipLeft - epsilon
  594 |       && rect.top >= clipTop - epsilon
  595 |       && rect.right <= clipRight + epsilon
```