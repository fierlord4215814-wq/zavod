# MASTER R5 — command_3: source-first diagnosis, 20.09.2026

MASTER_R5_STATUS=WAITING_GUEST_READ_ONLY_DIAGNOSTICS. GOAL_ACCEPTANCE=NOT_ACCEPTED. MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED. Same VM, same R5, no new sweep.

## Confirmed result and limits

The original provisioning generator contains a reproducible PowerShell array/concatenation defect in late command index 3. It constructs **five arguments**, not the intended three. The script passed to `sh -c` ends in an unmatched double quote. An exact host-side reconstruction, checked with **`sh -n -c` (parse only)**, exits 2 with an unmatched-quote diagnostic. A parenthesized candidate constructs three arguments and passes the same syntax-only check, exit 0.

This is a confirmed **environment/provisioning source defect**, consistent with the user's observed `Late/run/command_3` exit 2. It is NOT yet a direct reading of the failed guest's `/autoinstall.yaml`, stderr, target filesystem, or crash report. The shell used for the syntax check is the already-installed Git Bash `sh` on Windows, **not Ubuntu's guest `/bin/sh`**. No target command was executed, including `install`, `printf`, or redirection.

The existing source, seed ISO/config, VM/VHDX and product remain unchanged. The candidate is recorded in `source-diagnosis.json`, **NOT applied**, NOT regenerated into media, NOT run in the guest. Reinstallation has not been justified.

## Exact source and provenance

- Generator: `../20260920-vm-control/create-seed-media.ps1`, **line 50**.
- Generator SHA256: `3964a3d034f5e97f3cd9d0c621699519ed5de4da9a73f099973e7121a9104a9a`. A before-copy is `references/create-seed-media.ps1`; its hash matches the retained prior package manifest. The four existing package files also match their prior SHA256 values.
- Own VM input: `../20260920-vm-control/vm-created.json`, `vmId=99a158da-c247-422c-ae11-109485a92b1f`. This is the only interpolated value in command 3.
- Generated NoCloud path according to that source: `C:/Users/79164/Documents/work/.r5-runtime/master-r5-ubuntu24/private/seed-config/user-data`. Its format is `#cloud-config` followed by the JSON serialization of `{autoinstall: ...}`. `meta-data` contains the same instance ID and guest hostname.
- Media: own `private/seed.iso`, CIDATA, 59,392 bytes, SHA256 `4bfdf5debe2b2d3f966946358e546d1d08d98419218e991a6d8f305ce3396ea7`, from the retained creation receipt. The prior observer confirmed this media attached to the exact VM. **No current private media/config readback was obtained:** Windows denied the specific user-data read. This was not treated as file absence; no ACL, privilege, alternative-media or security workaround was attempted.
- The generator also reads its owned VM/image receipts, the official ISO's `casper/install-sources.yaml`, and its own public SSH key while preparing the complete config. None of those additional inputs is expanded into command 3. Private SSH key, working `.env`, DB, uploads and protected history are not diagnosis inputs.

Original expression, verbatim:

```powershell
@('sh','-c','install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "'+$r5Vm.vmId+'\n" > /target/etc/r5-provision-instance')
```

Actual reconstructed argv (JSON escaping shown, not an extra shell-quoting layer):

```json
[
  "sh",
  "-c",
  "install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf \"",
  "99a158da-c247-422c-ae11-109485a92b1f",
  "\\n\" > /target/etc/r5-provision-instance"
]
```

PowerShell constructs the comma-separated array before the unparenthesized additions; those additions append the GUID and suffix as two more elements. In `sh -c`, argv[2] is the entire program; the two later elements become `$0` and `$1`, not more program text. Therefore the quote following `printf` never closes. Host syntax-check stderr:

```text
99a158da-c247-422c-ae11-109485a92b1f: -c: line 1: unexpected EOF while looking for matching `"'
```

The minimal candidate adds parentheses around the concatenation. Its entire third argument becomes:

```sh
install -m 0644 /run/r5-new-disk-proof /target/var/log/r5-new-disk-proof; printf "99a158da-c247-422c-ae11-109485a92b1f\n" > /target/etc/r5-provision-instance
```

**Do not execute this line as a recovery instruction.** It lacks fail-fast handling between the copy and `printf`; a copy failure could be masked by the final success. A guest recovery, if warranted, must first verify the existing proof file, exact `/target` mount and identity, target directories, and both final file contents/modes. No new disk-proof marker may be fabricated to replace missing historical evidence.

## Runtime inputs and the preceding commands

| Index / input | Exact source action or role | Evidence now | Still required from guest |
|---|---|---|---|
| 0 | `curtin in-target --target=/target -- useradd --create-home --shell /bin/bash r5app` | User observed completion; source confirmed | Target passwd/group/home ownership; no sudo membership. Do not rerun useradd blindly. |
| 1 | `curtin in-target --target=/target -- useradd --create-home --shell /usr/sbin/nologin r5pg` | User observed completion; source confirmed | Target passwd/group/home ownership and nologin shell. No PostgreSQL installation follows from this account alone. |
| 2 | `sh -c 'install -m 0440 /dev/null /target/etc/sudoers.d/90-r5ops; printf "r5ops ALL=(ALL) NOPASSWD:ALL\n" > /target/etc/sudoers.d/90-r5ops'` | User observed completion; source confirmed | Exact target file content/mode/owner; safe syntax validation later. Semicolon also means a successful final printf alone would not prove the first install succeeded. |
| 3 input | `/run/r5-new-disk-proof` in the live installer | The early-command source writes `R5_NEW_OWN_16G_DISK_ONLY` only after Microsoft VM identity, one disk, 17,179,869,184-byte `/dev/sda`, and no blkid signature checks | Actual current existence/content; copy in target. This is a historical pre-partition check, **not permission to rerun it on the now-populated disk**. |
| 3 target | Mounted installed root `/target`, `/target/var/log`, `/target/etc` | User observed late-stage installation; source assumes these paths | Actual mount source, partition topology and sole owned VHDX identity, directory existence, both output files. Partial effects are not asserted absent. |
| 3 executables | `sh`, `install`, shell `printf` from installer environment | Source requirement | Guest `/bin/sh` identity and exact error line, without executing the defective command. |

The user reports post-install/final system configuration, successful OpenSSH/cloud-init and late commands 0–2, followed by command 3 failure and `install_fail` in `/var/crash/`. This is saved as **USER_OBSERVED**, not an agent-captured screenshot or guest-file inspection. Canonical documents that late commands run after installation/packages, with the target mounted under `/target`; after failure the available target and logs remain inspectable. That supports investigating **in-place completion first**, but does not itself prove this particular VHDX is bootable. [Canonical autoinstall reference](https://canonical-subiquity.readthedocs-hosted.com/en/latest/reference/autoinstall-reference.html#late-commands)

## Minimal safe recovery decision

No reboot, shutdown, Force/TurnOff, VM/VHDX recreation, detach/mount of the VHDX, media replacement or installation retry was performed. Do not perform them from this checkpoint.

1. **Next and only requested manual action:** in the already-open VMConnect window for `Zavod-Master-R5-Ubuntu24`, select the Ubuntu installer's **Help → Enter shell** and send a screenshot of the resulting prompt only. Enter no command yet; do not select retry/reboot. This is the documented diagnostic-shell entry, not a rerun of installation. [Canonical installer operation](https://canonical-subiquity.readthedocs-hosted.com/en/latest/tutorial/operate-server-installer.html#switching-to-a-shell-prompt)
2. After observing the actual prompt, establish a bounded read-only diagnostic command/transport. Read only the selected `late-commands[3]` value and matching stderr from guest config/logs, mount/disk identity, the named proof/instance files and commands 0–2's target effects. Also check target Ubuntu release, dpkg package state, kernel/initrd, EFI/GRUB and installer finalization state. Do not dump full user-data, cloud-init or crash bundles; they may contain credentials/key material. No shell-history/target changes, broad log exports, network/service changes, or workaround authentication.
3. If only the final marker/copy is missing and the installed base is consistent, prefer a guarded repair of those owned files plus the **documented, version-matched** way to finish/exit the installer. That method is **not yet selected or authorized for execution**. Source has `shutdown: poweroff`: blindly making installation succeed could cause automatic poweroff, which conflicts with the user's current hold instruction.
4. If the installer cannot be safely completed in place, stop before reinstall; retain the failed guest/evidence, prove why retry is necessary, review only the own seed/helper correction, and freshly prove the sole exact owned VHDX. No destructive fallback is approved by this diagnosis.

After guest completion and a safe return to the original contract: actual isolation proof → separate PostgreSQL → actual stack → all five live gates → related 32 journeys → original UI-063 → one final regression/report/review ZIP. None of these downstream stages ran in this diagnostic continuation.

## Old helper: new receipts supersede the earlier wait

`000006.result.json` appeared with `COMPLETED` at **18:03:32+03**, but its VM state is **2 / Running**. This envelope is not an Off receipt. `vm-control-terminal.json` followed at **18:03:33+03**, `EXITED_VM_AND_EVIDENCE_PRESERVED`, `deadlineReached=true`, PID9056, same VM and sole own VHDX. PID9056 is absent in the current host observation. EXIT request000007 remains with no result; do not describe it as processed. The old helper is no longer alive, but fresh Hyper-V jobs/operation reconciliation has **not** been performed; do not infer it from old receipts. No second helper/UAC or VM command was started.

## Retention, scope and evidence

`baseline.json` preserves the 15 current document owners before this continuation and verifies frozen **215 product/config, 132 build, 72 harness files**, six parent matrices and four prior ZIPs unchanged. There are **zero product fixes, app builds/tests/live cases, fixtures, guest inputs or guest writes**. The two host shell subprocesses are explicitly syntax-only diagnostics, not product tests; both exited normally.

Main coverage remains historical **954/957 semantic controls**, 3 failures original UI-063, open P0/P1/P2 **0/1/10**; no new PASS or reacceptance. Five live gates remain NOT_RUN. Physical work remains PENDING. Working PostgreSQL/service/env/uploads/business data/protected history were not inspected or changed. Working runtime/cleanup remains UNKNOWN_NOT_INSPECTED; own application DB/fixtures have not been created.

Evidence in this directory: `source-diagnosis.json` (exact argv, both parse outcomes, versions/PIDs), `baseline.json`, original-source before-copy and runtime receipts under `references/`, `runtime-observation.json`, and this report. Source proof is independently repeatable from its inert expression but **do not rerun the artifact writer or provisioning scripts over existing files**. No valid new guest screenshot was obtained. All old screenshots/evidence/packages are retained; no new package overwrites an old one. A later R5 final review package must include this diagnosis and the eventual guest observations.
