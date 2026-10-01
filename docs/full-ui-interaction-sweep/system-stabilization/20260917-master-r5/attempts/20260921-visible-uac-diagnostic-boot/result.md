# MASTER R5 — одна visible-UAC attempt,21.09.2026

MASTER_R5_STATUS=BLOCKED_DVD_READBACK_GUARD_NEW_UAC_REQUIRED. GOAL_ACCEPTANCE=NOT_ACCEPTED. MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED. PHYSICAL_PHONE=PENDING. FINAL_STOP=STOP.

## Новая дельта, отдельно от прежней истории

Пользователь явно разрешил одну новую nativeUAC и попросил видимое окно. Точная authority сохранена в `continuation-request.txt`. Новый именованный attempt, старые request/failure/ZIP/dirtyworktree не перезаписаны. Current final/resume/attempt прочитаны. `baseline.json`/before сохраняют16owners,215product/config132build72harness,6parentmatrices,7previousZIP. Correctedcommand3/10hostPASS сохранён без повторения; это не новая проверка и не guestrepair.

Подготовленный ранее guardedhelper перенесён в этуattempt: изменения только visiblelauncher, отдельные invoked/tokenreceipts, видимые progressmessages и краткое ожидание acknowledgement для проверки ancestry. Original executedhelper SHA256 `1ff03c9f9cdae1861abe9da02543e1649db21bcf8722771bd586ae121ae4feed` сохранён, после исполнения не изменён. Source candidate ниже отделён.

## Успешный UAC и fresh preflight

Microsoft-signed PowerShell7, nativeRunAs/WindowStyleNormal. UACstart23:11:05.5248481+03, helper11600invoked23:11:05.9722321; **actualadministrator=true23:11:06.0083435**. Не отмена/не отсутствиеtoken. Sourcehashguard пройден. Caller2548/session34078exit0; другой scopedcontroller не обнаружен, jobs=[]; oldqueue/PID9056 не трогались.

VMbefore23:11:11.2069365: exactGUID99a158da-c247-422c-ae11-109485a92b1f, nameZavod-Master-R5-Ubuntu24, Gen2, BIOSD00FD8A4-6628-433C-BD34-00A7CB7DD174, **Off**. Единственный диск `C:/Users/79164/Documents/work/.r5-runtime/master-r5-ubuntu24/vm/ubuntu24.vhdx`,16GiB, dynamicVHDX, filesize3,829,399,552bytes, noParent/noPhysicalDisk. Присутствует Ubuntu NVRAM fileentry `/EFI/ubuntu/shimx64.efi`, но это не доказательство завершённой/bootableUbuntu. Никаких рабочих/чужихдисков внастройках этойVM.

Hostboot21.09 22:12:54.5+03, Hypervisor/DEPtrue, свободноRAM10,269,270,016bytes/disk39,737,823,232bytes. DISM/hostreboot не выполнялись. Internal switchafaaea6b-1d7e-4ec7-beb2-5c7bf8750beb, ownMAC025A56051901, host10.243.53.1/30/interface25, foreignendpoint/localIPcollision/wrongneighbor0. LANscan/networkchanges0. Это preparationlink, **не isolationproof**.

Freshredactedseedmetadata: прежнийseedSHA4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7, r5ops, intendedhostnamezavod-r5-ubuntu24, SSHserverrequested/passwordauthOFF, guest10.243.53.2/30, ownclientprivatekeyexists (байты не экспортировались), publicfingerprintсовпал. Ownknownhostspaths=[], serverhostkeyдоверенно не закреплён. Installedguest applicability UNVERIFIED. Working.env/DB/service/uploads не читались.

## Реальные config actions и защитная остановка

Offветвь вызвала Set-VMDvdDrive -VMDvdDrive <own0:1/0:2> -Path null и Set-VMFirmware -FirstBootDevice <existingVHDX>. Возврат без exception сам по себе не postconditionPASS. Firmwareafter23:11:11.8698417 действительно показывает существующий VHDX первым, прежнююUbuntuentry и прочиеentry сохранёнными. Все шесть non-boot-orderfields (SecureBoot/template/templateId/networkprotocol/console/pausebehavior) совпали; ISOфайлы сохранены.

Но Get-VMDvdDrive -VM <ранееполученныйVMobject> повторно показал дваoriginalISOpaths. Guard остановил helper23:11:11.8835008: **No-media/VHDX-first readback failed; no boot issued**. `mutations[]` вrawreceipt — completedcmdletcalls, НЕ подтверждениеeject. ActualfreshproviderDVDstate послеоперации UNKNOWN. Start-VM0, boot-request отсутствует, никакихguest powercommands. Отчёт не утверждает, что ISO точноосталисьподключены, либо чтоизвлечены: обеинтерпретации требуютнезависимогоридбэка.

Readonlysource-first inspection установленного Microsoftcmdlet без VMcalls/DLLpatch выявил: explicitnull Path поддержан; -VMresolver возвращаетпереданныйобъект; localUpdateThreshold5s. Это поддерживаетcachedreadhypothesis, не закрываетactualcause. `dvd-readback-diagnosis.md` и3metadataJSON сохраняют границы. Ошибки собственногоILinspector и егоадреснаякоррекция сохранены в `inspection-errors.json`; они не продуктовыетесты и не повтор администраторскогоhelper.

`diagnostic-boot-fresh-readback.candidate.ps1` подготовлен, parser0, **NOT_EXECUTED**. СначалаfreshCIMexactstorage; alreadyemptyнепереизвлекать; приremainingownISO толькоадресныйnativeeject, затемboundedfreshCIM(no-media/soleVHDX/Off), firmwareguard иединственныйStart. Guardнеослаблен. Исполненныйhelper/source/receipts не правились; кандидатне считаетсяPASS. Подробности/официальныеисточники вDVDdiagnosis.

## Что НЕ выполнено

| Контур | Новое доказательство |
|---|---|
| Diagnosticboot |0Start-VM, NOT_RUN_GUARD_STOPPED|
| SSHtransport/serverkey/auth |0attempts, NOT_RUN_BOOT_NOT_REACHED; historicalWSAEACCES не новыйрезультат|
| Guestrepair/Linuxfunctionalparity |NOT_RUN|
| Isolation/ownPG/migrations/fixtures/actualstack |NOT_RUN|
| MI-SEC-01 |0live, NOT_RUN_DVD_READBACK_BOOT_GUARD|
| MI-PUB-01 |0live, NOT_RUN_DVD_READBACK_BOOT_GUARD|
| MI-R2-ORD-01 |0live, NOT_RUN_DVD_READBACK_BOOT_GUARD|
| MI-R2-CHAT-ATT-01 |0live, NOT_RUN_DVD_READBACK_BOOT_GUARD|
| UI-SWEEP-036 |0live, NOT_RUN_DVD_READBACK_BOOT_GUARD|
| Journeys |0newreal/32;1407inheritededges retained|
| Original063 |OPEN/UNKNOWN1286→1213|
| Final types/builds/Prisma/regression/visuals |NOT_RUN;549/177historicalнеприсваиваютсяR5|

Productfixes0; новыеproduct/schema/dependency/testedpolicychanges0.036ordinary≠immutablehandover/archivepermissions не причина063.014/050/replay/publication decisions сохраняются, автоматическийOKK→Task отсутствует. Main6matricesнеизменны:954/957semanticcontrols/P0/P1/P2=0/1/10 retainedhistory, не новаяприёмка. Physicalpending; captures0/старыеscreenshotpacksсохранены.

## Runtime, следующая операция и сохранность

Helper11600 завершился наguard, последующийPIDlookupпустой; caller2548 завершён. Вновьсозданныхbackend/frontend/PG/browser/proxy/listeners/guestwriters0. VMпоследнимнаблюдаласьOff23:11:11; это не непрерывныймониторингпослевыходаhelper. ФактическоеDVDstateнеподтверждено; firmwareVHDXfirstпроверено. ISO/VHDX/seed/privatekeysсохранены, никакихformat/wipe/reinstall/Force/TurnOff/Reset/Windowsreboot. No service/env/uploads/businessdata/protectedhistoryaccess. WorkingcleanupUNKNOWN_NOT_INSPECTED; ownappfixtures0; прежниехостовыесинтетическиефайлыretained.

ОднаразрешённаяUACпопытка использована успешно. Helperвышел; дальнейшеепривилегированноечтение/продолжениетребует **новогоявногосогласиянаодинscopedUAC**. Необходитьэторазрешениедругимпроцессом/каналом. Минимальныйследующийшаг: новыйnamedattempt/candidate/sourcehash → freshCIMactualstorage/VM; затемтолько недостающаяконфигурация иоднаразрешённаяdiagnosticboot. Не начинатьвсёзаново/неповторятьcapture/неотменятьguard. ПриRunningневыключать/не менятьmedia.

Послеэтойграницы сохраняется весьR5: SSH/trustedhostkey→actualguestlogs/users/packages/boot/nondestructiverepair→canary/cleanpayload/deps/closeprep→isolation→ownPG/actualstack→5fullgates→applicable32journeys→original063→finalregression/review. Не остановитьсянаfirstsuccess. Library/accountmemoryNOT_WRITTEN, SOURCE_SYNC=REPO_LOCAL_ONLY. Before/after/diffs/finalidentities/package хранить вэтойattempt;7предыдущихZIPнеизменны. НовыйединыйZIP `../../zavod-master-r5-visible-uac-20260921.zip`, fullreadback/SHA/размер в `package-receipt.json`. FINAL_STOP=STOP.
