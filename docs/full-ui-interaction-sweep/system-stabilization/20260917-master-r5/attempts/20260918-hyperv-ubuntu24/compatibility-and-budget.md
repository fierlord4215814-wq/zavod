# R5 stage2 — Hyper-V + Ubuntu Server24.04LTS/x64

Единственный путь, явно выбранный пользователем18.09.2026. Это продолжение R5, не Stage68. Старые Sandbox scripts/receipt/ZIP сохранены без изменения. Новая UAC authority относится к Hyper-V; competing Docker/WSL/VirtualBox не устанавливаются. Проверки ниже выполнены **до нового UAC**; пригодность платформы не выдаётся за уже работающий guest stack.

## Host и лицензии

`host-inventory.json`: Windows10Pro22H2/build19045.6456/x64; i7-6700K4cores/8threads; firmware virtualization, SLAT, VM Monitor Mode и DEP available=true; DEP policy2. Все7 Hyper-V optional features InstallState2 (disabled), hypervisorPresent=false. Реального administrator token у Codex нет. [Microsoft requirements](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/host-hardware-requirements) поддерживают эту редакцию/архитектуру и требуют указанные capabilities; [Ubuntu24.04 on Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/supported-ubuntu-virtual-machines-on-hyper-v) перечислена с built-in integration и Gen2.

Hyper-V — штатная возможность имеющейся Windows Pro; не новая платная VM-подписка и не Windows guest license. Сохранённое лицензионное наблюдение17.09 Windows Professional LicenseStatus1 остаётся reference, ключи не читаются. [Canonical policy](https://canonical.com/legal/intellectual-property-policy) допускает бесплатное внутреннее использование Ubuntu организацией; Ubuntu Pro/ESU/support не покупаются. Windows10 EOL — сохранённое ограничение host; ОС не обновляется, защита не выключается.

## Pinned guest toolchain

| Owner/version | Проверка совместимости; что ещё нужно реально выполнить |
|---|---|
| Ubuntu Server24.04.5 amd64 | [Официальный release](https://releases.ubuntu.com/24.04/) ISO, не Azure VHD. `image-metadata-verification.json`: подпись SHA256SUMS проверена OpenPGP6.2.2 с independently pinned full Ubuntu signing fingerprint843938DF228D22F7B3742BC0D94AA3F0EFE21092; ISO HEAD200/4,080,486,400bytes. Сам ISO ещё не скачан и не booted; перед boot обязательны полный download/hash match. |
| Node24.15.0 | Текущий host `node --version`; [tagged requirements](https://raw.githubusercontent.com/nodejs/node/v24.15.0/BUILDING.md): Linuxx64 kernel≥4.18/glibc≥2.28. Ubuntu24.04 baseline удовлетворяет; официальный linux-x64 archive/checksum найден. Guest binary/actual libc ещё проверить. |
| Prisma + client6.0.0 | Lock и installed package metadata совпадают, engines node≥18.18. [Код именно6.0.0](https://raw.githubusercontent.com/prisma/prisma/6.0.0/packages/get-platform/src/getPlatform.ts) и current installed chunks поддерживают Ubuntu→debian/OpenSSL3.0.x; target `debian-openssl-3.0.x` присутствует. Это не сертификация всей парыNode24/Postgres18: guest engine load/generate/validate и actual SQL gates обязательны. Не копировать Windows generated engine и не менять schema для равенства Windows hash. |
| PostgreSQL18.3 | Версия взята из сохранённого R4 inventory, не из рабочей службы/файлов. [Официальный источник18.3](https://www.postgresql.org/ftp/source/v18.3/) и SHA256 доступны; [PG Ubuntu support](https://www.postgresql.org/download/linux/ubuntu/) включает noble/amd64. Подготовить18.3 из pinned official source в guest (build prerequisites через signed Ubuntu apt); не обновлять версию произвольно и не читать host PostgreSQL. Это отдельный test binary/новая empty DB, не работающая БД. [PostgreSQL License](https://www.postgresql.org/about/licence/) не требует платной подписки. |
| Playwright1.60.0 | Lock/installed metadata unchanged. [Tagged requirements](https://raw.githubusercontent.com/microsoft/playwright/v1.60.0/docs/src/intro-js.md) прямо включают Ubuntu24.04; [nativeDeps](https://raw.githubusercontent.com/microsoft/playwright/v1.60.0/packages/playwright-core/src/server/registry/nativeDeps.ts) имеют отдельный24.04-x64 набор. Браузер/его binaries устанавливаются и выполняются внутри Linux, не Windows10. Native UI actual proof ещё NOT_RUN. |

Подготовка npm — lockfile unchanged, сначала `npm ci --ignore-scripts` в чистой guest copy, потом только reviewed необходимые engine/native setup steps. Не запускать seed/старые generators/postinstall вслепую. App/test/browser — отдельный непривилегированный Linux user, без sudo/host management keys; Chromium sandbox включён. Если guest sandbox требует дополнительной scoped setup — доказать её, не root/--no-sandbox/отключение AppArmor ради PASS.

## Практический бюджет

Свежий inventory18.09: RAM17,137,594,368bytes, свободно8,527,692KiB (около8.13GiB); disk42,097,651,712bytes (около39.21GiB). Одна VM, **2vCPU /4GiB fixed RAM /16GiB dynamic VHDX cap**, checkpoints off, AutomaticStartAction Nothing и AutomaticStopAction ShutDown. Увеличение только по наблюдаемой необходимости и новому расчёту. Свободная память при start должна оставлять≥2GiB сверх4GiB гостя.

| Host disk allocation | Верхняя плановая граница |
|---|---:|
| ISO (фактический HEAD) |3.800GiB|
| Hyper-V component payload reserve |2GiB|
| Один guest VHDX, жёсткий cap |16GiB|
| VM configuration/runtime-state reserve |4GiB|
| Чистый source package/metadata/host tools |0.25GiB|
| Exported evidence/review ZIP reserve |1GiB|
| Всего дополнительных |около27.05GiB|
| Остаётся host headroom по текущему inventory |около12.16GiB|

**Floor10GiB свободного C:** проверять после component enable/reboot, до image download/VMcreate/deps, перед каждым тяжёлым прогоном и при росте evidence. Не считать dynamic disk бесплатным. Guest16GiB: ориентир OS4.5 + dependencies/native libs3 + runtimes/browser1.5 + PostgreSQL/build1 + fixtures/files0.5 + evidence1.5 + caches/swap1 =13GiB; оставшиеся3GiB — guest margin. Это оценка, не измеренная installed usage. При нехватке остановить конкретную операцию и назвать deficit; не удалять чужие/старые файлы или evidence, не заполнять диск ради тестов.

## Управление, автоматизация и экспорт — выбранный реализуемый маршрут

1. **Guest install.** Gen2 VM с MicrosoftUEFICertificateAuthority secure-boot template и единственным own VHDX. Original official ISO readonly плюс маленький NoCloud `cidata` seed ISO, создаваемый встроенным Windows IMAPI2FS. COM availability реально проверена. [Canonical autoinstall](https://canonical-subiquity.readthedocs-hosted.com/en/latest/howto/autoinstall-quickstart.html) поддерживает seed/user-data/meta-data и kernel `autoinstall`. Boot parameter передаётся только own VM через [Msvm_Keyboard](https://learn.microsoft.com/en-us/windows/win32/hyperv_v2/typetext-msvm-keyboard), не через смену BIOS хоста. Storage matcher обязан совпасть с единственным новым диском, host disks не подключать.
2. **Preparation/control.** Native Windows OpenSSH/scp/ssh-keygen реально доступны. Управление Ubuntu — SSH с новым dedicated key и strict host key pin, не [PowerShell Direct](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/powershell-direct), рассчитанный на Windows guest. Только own INTERNAL switch/узкая private link subnet, после проверки конфликтов; не External/Default switch. Ни NAT/global routing, ни bridge к LAN. Для подготовки — ограниченный trusted host proxy только на own internal interface/guest address с allowlist официальных Ubuntu/Node/Postgres/npm/Prisma/Playwright download hosts; не открытый прокси. Необходимое rule только own interface/endpoint, существующие правила не менять.
3. **Clean transfer.** Allowlisted source/config/schema/tests tar+manifest, без.env/uploads/.git/credentials/dumps/protected snapshots/reparse/node_modules. SSH/scp передаёт конкретный пакет, не host mount. Внутренние ключи/пароли только own private area, не отчёты/ZIP. Подготовить smoke loop: host canary→guest mutation→export→SHA readback **до длительных tests**.
4. **Closed execution.** Reviewed one-shot guest launcher ждёт закрытия сети. Host выполняет [Disconnect-VMNetworkAdapter](https://learn.microsoft.com/en-us/powershell/module/hyper-v/disconnect-vmnetworkadapter?view=windowsserver2025-ps) для exact VMid. Независимые host actual adapter state и guest carrier/routes/mounts/DMI/toolchain наблюдения + provision/target/manifest/env/default-deny negatives до app/fixtures. Ничего не подключать к working PostgreSQL даже для отрицательного probe. App/DB/frontend/browser общаются только guest localhost. Никаких host management privileges у app/test account.
5. **Completion/export.** Конечный контролирующий guest job останавливает только собственные app/test/PG processes и штатно выключает ЭТУ VM после flush results. Host наблюдает фактический Off (все guest processes прекращены), затем подключает только management internal link и boot для SSH export; app/DB/tests не имеют autostart, proxy OFF, маршрута в интернет нет. Проверить отсутствие app processes/listeners, получить только dedicated results allowlist, проверить все bytes/SHA. Persistent VHDX/VM сохранить. Никаких hidden Windows startup tasks, автоматического Windows reboot или остановки чужих VM.

Это осуществимый план на поддерживаемых API, **не уже проверенный VM round-trip/isolation**. Runtime-dependent proof остаётся отдельным обязательным gate после включения Hyper-V; guest provisioning/bootstrap не маскировать утверждением о готовности хоста.

## Exact install scope

Один visible elevated PowerShell helper, actual admin token/self-hash/preflight-hash, fresh resource/DEP checks, immutable before/after states/changed features/result. Команда: `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V,Microsoft-Hyper-V-Management-PowerShell -All -NoRestart`. [Microsoft installation](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/Install-Hyper-V), [NoRestart/All semantics](https://learn.microsoft.com/en-us/powershell/module/dism/enable-windowsoptionalfeature?view=windowsserver2025-ps). Только platform и PowerShell management + necessary parents; Sandbox/WSL/VirtualMachinePlatform отдельно не включать. Codex целиком elevated не запускается.

Если RestartNeeded/EnablePending — checkpoint и STOP перед ручной перезагрузкой; не делать VMcreate/installguest до нового boot. Если UAC cancel — сохранить точный error/не повторять циклом. Никаких power/security/BIOS/VPN/clock/OS upgrade/reinstall/paid acceptance.

## Сохранённые preparation failures

`image-metadata-error.json` — первая Node HTTPS fetch failure после npm verifier download; `-2` — connect timeout официального keyserver, уже полученные SHA/signature bytes сохранены. Curl IPv4 HTTPS получил тот же public key без системных сетевых изменений. `-3` — verifier harness неверно передал ASCII-armored detached signature как binary. Исправлен только формат parsing по фактическому заголовку, проверка signature/fingerprint не ослаблялась. Итог `image-metadata-verification.json` проверил подпись; ни один failure не считается live/product case. GPG executable не найден, поэтому pinned OpenPGP6.2.2 с npm SHA512 integrity/LGPL license использован только как локальный verifier, без изменения product dependencies.
