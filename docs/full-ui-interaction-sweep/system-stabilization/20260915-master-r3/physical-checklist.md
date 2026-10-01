# Один маршрут ручной приёмки телефона — НЕ выполнен

PHYSICAL_PWA_MEDIA_ANDROID_BACK=PENDING. Позже — отдельно разрешённый стенд и synthetic пользователь/данные. Записать device/Android/browser/version, build, theme, viewport, шаг/ожидание/результат/кадр. DENIED/CANCEL не заменять flags. Не записывать пароли/cookies/tokens.

1. Из входа установить PWA штатным системным действием; cold standalone, вход, выбор завода. Проверить установку/информацию в Настройках и отсутствие ложного «установлено». Возврат после сворачивания/завершения standalone системой.
2. Изменённая форма:0/false/пустой комментарий/обычный текст. Update при dirty не теряет draft; Stay сохраняет, confirmed discard закрывает нужный слой. Cold launch новой версии, корректная авторизация; не auto-update посреди submit.
3. People shift/service/search → профиль с ненулевой прокруткой → точная заявка вне board300 → media. Android Back:media→task→profile→People, target/filter/scroll сохранён при той же геометрии. Отдельно focus-first снимает focus/клавиатуру, следующий закрывает pristine; changed→Stay/discard. Busy без double submit.
4. Камера/микрофон/галерея:success/cancel/deny/retry/revoke разрешения ОС при открытом UI/прерывание файла. Preview без broken image, audio/codec/конец записи/native chooser. После membership/context revoke нет новой выдачи; уже скачанные внешние байты не обещаем отозвать.
5. Offline до команды, потеря ответа после отправки, reconnect/WS fallback. Честный pending/retry, same-key только same attempt, без дубля. Не объявлять dormant queue поддержанной. A→B→A и logout/login не возвращают старый ответ/ресурс/уведомление.
6. Dark/Gray/Light;360/390, низкая высота, portrait/landscape. Нижняя навигация/More/профиль/Ops/labels/история смен. Readable text, доступный touch-target и последнее действие после обычного scroll; клавиатура/панели не скрывают submit. Dark сохраняется.
7. Archive036: передача и обычный комментарий сверены каждый с собственным источником; различие не означает потерю данных. Archive-only читает разрешённое без write; Back сохраняет фильтр/контекст.

Итог отдельно PASS/FAIL/NOT_RUN по группам, native before/failure/after без перезаписи. PhysicalFAIL не перекрывается browserPASS. Реальные fixtures/cleanup — только факты, без автоматического удаления.
