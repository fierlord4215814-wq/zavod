const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify');
const ADMIN_USER_ID = process.env.V3_ADMIN_USER_ID || 'test-admin';
const REASON = 'Утверждённая структура Завода 4, Physical Field Fixes V3';

const lines = [
  {
    name: 'Пицца Цезарь',
    uiConfigured: true,
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 1, 1],
      ['Отбраковщик', 1, 1],
      ['Декоратор', 1, 1],
      ['Фасовщик обычный', 2, 4],
      ['Фасовщик СЛ', 1, 1],
      ['Нарезчик', 1, 2],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Пицца Рондо',
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 2, 6],
      ['Фасовщик обычный', 3, 3],
      ['Нарезчик', 1, 2],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Основа Райкорт',
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Фасовщик обычный', 3, 3],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Блины конверт №3',
    aliases: ['Блины №3', 'Блины конверт 3'],
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 1, 1],
      ['Фасовщик обычный', 2, 4],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Блины конверт №4',
    aliases: ['Блины №4', 'Блины конверт 4'],
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 1, 1],
      ['Фасовщик обычный', 2, 4],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Чебурек',
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Оператор', 1, 1],
      ['Помощник оператора', 1, 1],
      ['Фасовщик обычный', 4, 4],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Блины Трубочка',
    positions: [
      ['Тестодел-оператор', 1, 1],
      ['Начинщик', 0, 1],
      ['Контролёр', 3, 3],
      ['Фасовщик обычный', 2, 8],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Фрикадельки, наггетсы, куриные палочки',
    aliases: [
      'Фрикадельки / наггетсы / куриные палочки',
      'Фрикадельки / Наггетсы / Куриные палочки',
    ],
    positions: [
      ['Оператор', 1, 1],
      ['Оператор фасовки', 1, 1],
      ['Фасовщик', 1, 1],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Котлеты',
    positions: [
      ['Оператор', 1, 1],
      ['Контролёр', 1, 2],
      ['Фасовщик', 2, 7],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Экструзионные пельмени',
    positions: [
      ['Оператор-тестодел', 1, 1],
      ['Оператор', 1, 1],
      ['Фасовщик', 5, 5],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Манты и Хинкали 7 лепестков',
    positions: [
      ['Оператор-тестодел', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 6, 6],
      ['Фасовщик', 2, 2],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Хинкали мини',
    positions: [
      ['Оператор-тестодел', 1, 1],
      ['Оператор', 1, 1],
      ['Фасовщик', 2, 2],
      ['Дополнительно', 0, 1, true],
    ],
  },
  {
    name: 'Пельмени Сигнал-пак',
    positions: [
      ['Оператор-тестодел', 1, 1],
      ['Оператор-помощник', 1, 1],
      ['Оператор', 1, 1],
      ['Контролёр', 1, 1],
      ['Фасовщик', 2, 2],
      ['Дополнительно', 0, 1, true],
    ],
  },
];

const timeworkerPositions = [
  ['Оператор-наладчик', 1, 2],
  ['Грузчик склада', 1, 2],
  ['Грузчик', 1, 5],
  ['Водитель погрузчика', 1, 1],
  ['Уборщица', 2, 4, false, ['Уборщицы']],
  ['Мойка тары', 1, 1],
  ['Запасной сотрудник', 0, 1],
  ['Жарщик', 2, 2, false, ['Жарщики']],
  ['Дополнительно', 0, 1, true],
];

const plan = [];

function positionName(position) {
  return position.displayName || position.name || position.title;
}

function normalizedSkill(name) {
  return name.toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, '_').replace(/^_+|_+$/g, '');
}

async function request(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'x-user-id': ADMIN_USER_ID,
      ...(options.factoryId ? { 'x-factory-id': options.factoryId } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname}: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function applyOrPlan(label, action) {
  plan.push(label);
  if (APPLY) return action();
  return null;
}

async function loadLines(factoryId) {
  return request(`/admin/lines?factoryId=${factoryId}`, { factoryId });
}

async function ensureLine(factoryId, definition) {
  let currentLines = await loadLines(factoryId);
  let line = currentLines.find((item) => item.name === definition.name && !item.deletedAt);

  if (!line) {
    const aliases = definition.aliases || [];
    const candidates = currentLines.filter((item) => aliases.includes(item.name) && !item.deletedAt);
    if (candidates.length > 1) {
      throw new Error(`Найдено несколько линий-кандидатов для «${definition.name}»`);
    }
    if (candidates.length === 1) {
      line = candidates[0];
      await applyOrPlan(`Переименовать линию «${line.name}» → «${definition.name}»`, () => request(
        `/admin/lines/${line.id}`,
        { method: 'PATCH', factoryId, body: { name: definition.name, reason: REASON } },
      ));
    } else {
      const created = await applyOrPlan(`Создать линию «${definition.name}»`, () => request(
        '/admin/lines',
        { method: 'POST', factoryId, body: { factoryId, name: definition.name, status: 'STOP', reason: REASON } },
      ));
      if (created) line = created;
    }
    if (APPLY) {
      currentLines = await loadLines(factoryId);
      line = currentLines.find((item) => item.name === definition.name && !item.deletedAt);
    }
  }

  if (!line) return;
  if (definition.uiConfigured) return verifyUiConfiguredLine(line, definition);

  const desiredNames = new Set(definition.positions.map(([name]) => name));
  const keeperPositionIds = new Set();
  let order = 10;
  for (const [name, min, max, extra = false] of definition.positions) {
    let position = line.positions.find((item) => positionName(item) === name && !item.deletedAt);
    const body = {
      name,
      displayName: name,
      skillCode: normalizedSkill(name),
      skillFamilyKey: normalizedSkill(name),
      isExtraSlot: extra,
      doesNotAffectShortage: extra,
      isFlexibleSkillGroup: min !== max,
      sortOrder: order,
      reason: REASON,
    };
    if (!position) {
      position = await applyOrPlan(`«${definition.name}»: создать позицию «${name}»`, () => request(
        `/admin/lines/${line.id}/positions`,
        { method: 'POST', factoryId, body },
      ));
    } else {
      await applyOrPlan(`«${definition.name}»: нормализовать позицию «${name}»`, () => request(
        `/admin/lines/${line.id}/positions/${position.id}`,
        { method: 'PATCH', factoryId, body: { ...body, isActive: true } },
      ));
    }
    if (position?.id) keeperPositionIds.add(position.id);
    order += 10;
  }

  if (APPLY) line = (await loadLines(factoryId)).find((item) => item.id === line.id);
  for (const position of line.positions) {
    const isDuplicateDesired = desiredNames.has(positionName(position))
      && keeperPositionIds.size > 0
      && !keeperPositionIds.has(position.id);
    if (position.isActive && !position.deletedAt && (!desiredNames.has(positionName(position)) || isDuplicateDesired)) {
      await applyOrPlan(`«${definition.name}»: отключить старую позицию «${positionName(position)}»`, () => request(
        `/admin/lines/${line.id}/positions/${position.id}`,
        { method: 'PATCH', factoryId, body: { isActive: false, reason: REASON } },
      ));
    }
  }

  if (!APPLY) {
    const approved = line.staffingTemplates.find((item) => item.name === 'Утверждённый состав' && !item.deletedAt);
    plan.push(`«${definition.name}»: ${approved ? 'обновить' : 'создать'} утверждённый шаблон`);
    for (const template of line.staffingTemplates) {
      if (template.isActive && !template.deletedAt && template.name !== 'Утверждённый состав') {
        plan.push(`«${definition.name}»: отключить старый шаблон «${template.name}»`);
      }
    }
    return;
  }

  if (APPLY) line = (await loadLines(factoryId)).find((item) => item.id === line.id);
  const positionByName = new Map(
    line.positions
      .filter((item) => item.isActive && !item.deletedAt)
      .map((item) => [positionName(item), item]),
  );
  const items = definition.positions.map(([name, min, max, extra = false], index) => {
    const position = positionByName.get(name);
    if (!position) throw new Error(`Позиция «${name}» линии «${definition.name}» не создана`);
    return {
      positionId: position.id,
      requiredCount: min,
      minRequired: min,
      defaultPlanned: min,
      plannedCount: min,
      maxRequired: max,
      isFlexible: min !== max,
      isExtraSlot: extra,
      doesNotAffectShortage: extra,
      sortOrder: (index + 1) * 10,
    };
  });
  const approved = line.staffingTemplates.find((item) => item.name === 'Утверждённый состав' && !item.deletedAt);
  if (approved) {
    await applyOrPlan(`«${definition.name}»: обновить утверждённый шаблон`, () => request(
      `/admin/lines/${line.id}/staffing-templates/${approved.id}`,
      { method: 'PATCH', factoryId, body: { name: 'Утверждённый состав', items, isActive: true, reason: REASON } },
    ));
  } else {
    await applyOrPlan(`«${definition.name}»: создать утверждённый шаблон`, () => request(
      `/admin/lines/${line.id}/staffing-templates`,
      { method: 'POST', factoryId, body: { name: 'Утверждённый состав', items, reason: REASON } },
    ));
  }

  if (APPLY) line = (await loadLines(factoryId)).find((item) => item.id === line.id);
  for (const template of line.staffingTemplates) {
    if (template.isActive && !template.deletedAt && template.name !== 'Утверждённый состав') {
      await applyOrPlan(`«${definition.name}»: отключить старый шаблон «${template.name}»`, () => request(
        `/admin/lines/${line.id}/staffing-templates/${template.id}`,
        { method: 'PATCH', factoryId, body: { isActive: false, reason: REASON } },
      ));
    }
  }
}

function verifyUiConfiguredLine(line, definition) {
  const activeNames = line.positions
    .filter((item) => item.isActive && !item.deletedAt)
    .map(positionName)
    .sort((left, right) => left.localeCompare(right, 'ru'));
  const expectedNames = definition.positions
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right, 'ru'));
  if (JSON.stringify(activeNames) !== JSON.stringify(expectedNames)) {
    throw new Error('Пицца Цезарь не соответствует результату UI-настройки');
  }
  const activeTemplates = line.staffingTemplates.filter((item) => item.isActive && !item.deletedAt);
  if (activeTemplates.length !== 1 || activeTemplates[0].name !== 'Утверждённый состав') {
    throw new Error('Пицца Цезарь должна иметь один утверждённый шаблон');
  }
  if (activeTemplates[0].items.length !== definition.positions.length) {
    throw new Error(`Шаблон линии «${definition.name}» содержит неверное число позиций`);
  }
  for (const [name, min, max, extra = false] of definition.positions) {
    const item = activeTemplates[0].items.find((entry) => entry.positionName === name);
    if (
      !item
      || item.minRequired !== min
      || item.defaultPlanned !== min
      || item.maxRequired !== max
      || Boolean(item.isExtraSlot) !== Boolean(extra)
      || Boolean(item.doesNotAffectShortage) !== Boolean(extra)
    ) {
      throw new Error(`Параметры позиции «${name}» линии «${definition.name}» не совпадают с утверждёнными`);
    }
  }
  plan.push(`${definition.name}: утверждённая структура подтверждена`);
}

async function ensureTimeworkers(factoryId) {
  let areas = await request(`/admin/work-areas?factoryId=${factoryId}`, { factoryId });
  let area = areas.find((item) => item.name === 'Повременщики' && item.isActive !== false);
  if (!area) {
    area = await applyOrPlan('Создать рабочую зону «Повременщики»', () => request(
      '/admin/work-areas',
      {
        method: 'POST',
        factoryId,
        body: { factoryId, name: 'Повременщики', assignmentKind: 'TIME', reason: REASON },
      },
    ));
  } else {
    await applyOrPlan('Закрепить «Повременщики» как TIME-зону', () => request(
      `/admin/work-areas/${area.id}`,
      { method: 'PATCH', factoryId, body: { assignmentKind: 'TIME', isActive: true, reason: REASON } },
    ));
  }
  if (!APPLY) return;

  areas = await request(`/admin/work-areas?factoryId=${factoryId}`, { factoryId });
  area = areas.find((item) => item.name === 'Повременщики' && item.isActive !== false);
  if (!area) throw new Error('Рабочая зона «Повременщики» не создана');

  const desiredNames = new Set(timeworkerPositions.map(([name]) => name));
  const keeperPositionIds = new Set();
  let order = 10;
  for (const [name, min, max, extra = false, aliases = []] of timeworkerPositions) {
    let position = area.positions.find((item) => item.title === name && !item.deletedAt);
    if (!position) position = area.positions.find((item) => aliases.includes(item.title) && !item.deletedAt);
    const body = {
      title: name,
      minRequired: min,
      maxRequired: max,
      defaultPlanned: min,
      plannedCount: min,
      isFlexible: min !== max,
      isExtraSlot: extra,
      doesNotAffectShortage: extra,
      sortOrder: order,
      isActive: true,
      reason: REASON,
    };
    if (position) {
      await request(`/admin/work-areas/${area.id}/positions/${position.id}`, {
        method: 'PATCH',
        factoryId,
        body,
      });
    } else {
      position = await request(`/admin/work-areas/${area.id}/positions`, {
        method: 'POST',
        factoryId,
        body,
      });
    }
    if (position?.id) keeperPositionIds.add(position.id);
    plan.push(`«Повременщики»: ${position ? 'обновить' : 'создать'} позицию «${name}»`);
    order += 10;
  }

  area = (await request(`/admin/work-areas?factoryId=${factoryId}`, { factoryId }))
    .find((item) => item.id === area.id);
  for (const position of area.positions) {
    const isDuplicateDesired = desiredNames.has(position.title) && !keeperPositionIds.has(position.id);
    if (position.isActive && !position.deletedAt && (!desiredNames.has(position.title) || isDuplicateDesired)) {
      await request(`/admin/work-areas/${area.id}/positions/${position.id}`, {
        method: 'PATCH',
        factoryId,
        body: { isActive: false, reason: REASON },
      });
      plan.push(`«Повременщики»: отключить старую позицию «${position.title}»`);
    }
  }
}

async function verify(factoryId) {
  const configured = await loadLines(factoryId);
  for (const definition of lines) {
    const line = configured.find((item) => item.name === definition.name && !item.deletedAt);
    if (!line) throw new Error(`Не найдена утверждённая линия «${definition.name}»`);
    verifyUiConfiguredLine(line, definition);
  }
  const area = (await request(`/admin/work-areas?factoryId=${factoryId}`, { factoryId }))
    .find((item) => item.name === 'Повременщики' && item.isActive !== false);
  if (!area || area.assignmentKind !== 'TIME') throw new Error('Повременщики не настроены как TIME-зона');
  const activeNames = area.positions
    .filter((item) => item.isActive && !item.deletedAt)
    .map((item) => item.title)
    .sort((left, right) => left.localeCompare(right, 'ru'));
  const expectedNames = timeworkerPositions
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right, 'ru'));
  if (JSON.stringify(activeNames) !== JSON.stringify(expectedNames)) {
    throw new Error('Состав рабочей зоны «Повременщики» не соответствует утверждённому');
  }
  for (const [name, min, max, extra = false] of timeworkerPositions) {
    const position = area.positions.find((item) => item.title === name && item.isActive && !item.deletedAt);
    if (
      !position
      || position.minRequired !== min
      || position.defaultPlanned !== min
      || position.maxRequired !== max
      || Boolean(position.isExtraSlot) !== Boolean(extra)
      || Boolean(position.doesNotAffectShortage) !== Boolean(extra)
    ) {
      throw new Error(`Параметры позиции «${name}» рабочей зоны «Повременщики» не совпадают с утверждёнными`);
    }
  }
  const approvedNames = new Set(lines.map((item) => item.name));
  const unexpected = configured.filter((item) => !item.deletedAt && !approvedNames.has(item.name));
  if (unexpected.length) {
    throw new Error(`В активном списке остались лишние линии: ${unexpected.map((item) => item.name).join(', ')}`);
  }
}

async function deactivateUnapprovedLines(factoryId) {
  const approvedNames = new Set(lines.map((item) => item.name));
  const configured = await loadLines(factoryId);
  for (const line of configured) {
    if (!line.deletedAt && !approvedNames.has(line.name)) {
      await applyOrPlan(`Отключить лишнюю линию «${line.name}»`, () => request(
        `/admin/lines/${line.id}`,
        {
          method: 'PATCH',
          factoryId,
          body: {
            isActive: false,
            reason: 'Не входит в утверждённую структуру Завода 4; история сохранена',
          },
        },
      ));
    }
  }
}

async function main() {
  const login = await request('/auth/dev-login', {
    method: 'POST',
    body: { userId: ADMIN_USER_ID },
  });
  const factory = login.availableFactories?.find((item) => item.code === 'factory-4');
  if (!factory?.id) throw new Error('Завод 4 не найден');

  if (VERIFY_ONLY) {
    await verify(factory.id);
    console.log(JSON.stringify({
      mode: 'verify',
      factory: factory.name,
      approvedLines: lines.length,
      result: 'configured-and-verified',
    }, null, 2));
    return;
  }

  for (const definition of lines) await ensureLine(factory.id, definition);
  await ensureTimeworkers(factory.id);
  await deactivateUnapprovedLines(factory.id);
  if (APPLY) await verify(factory.id);

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    factory: factory.name,
    approvedLines: lines.length,
    plannedActions: plan.length,
    actions: plan,
    result: APPLY ? 'configured-and-verified' : 'no-data-changed',
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
