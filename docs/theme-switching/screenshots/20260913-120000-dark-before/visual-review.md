# Dark-before — прямая визуальная проверка

- Batch: `20260913-120000-dark-before`
- Результат test runner: `PASS`, 16/16 оригинальных PNG созданы.
- Проверены напрямую все оригиналы: Settings, реальная форма «Сообщить об ошибке», shared-component gallery и modal overlay на 1440, 360, 390 и 430 px.
- Горизонтальное переполнение документа: 0 px во всех 16 состояниях по `runtime.json`.
- Dark palette, типографика, границы, тени, status colors и modal backdrop зафиксированы как визуальный baseline до реализации.
- Зафиксированные, но не исправляемые этим Goal особенности исходного состояния: fixed navigation перекрывает часть длинной формы; synthetic gallery наследует текущую плотную укладку статусов/таблицы. Они не считаются theme regression и не расширяют scope paused UI Sweep.
- Console содержит только недоступность Vite HMR WebSocket в browser sandbox; page errors, request failures и API writes отсутствуют. Product WebSocket `/ws` не подменялся.

