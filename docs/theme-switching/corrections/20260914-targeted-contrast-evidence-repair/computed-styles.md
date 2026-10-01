# Computed foreground/background evidence

Raw per-case values are stored in every accepted `screenshots/*/runtime.json`; each PNG hash and its theme/width/state/role are in the adjacent `index.csv`. The table below shows representative 390 px values. Transparent backgrounds are reported exactly as computed; the containing theme surface remains visible in the native PNG.

| Case | Gray before → after | Light before → after |
| --- | --- | --- |
| Settings mobile title | `rgb(255,255,255)` → `rgb(17,23,28)` | `rgb(255,255,255)` → `rgb(21,18,14)` |
| Shared section heading | `rgb(255,255,255)` → `rgb(17,23,28)` | `rgb(255,255,255)` → `rgb(21,18,14)` |
| ShiftLog scope note | fg `rgba(236,240,245,.78)` / bg `rgba(214,161,58,.08)` → fg `rgb(32,40,47)` / bg `rgba(157,104,21,.13)` | fg `rgba(236,240,245,.78)` / bg `rgba(214,161,58,.08)` → fg `rgb(36,32,26)` / bg `rgba(166,107,18,.13)` |
| Admin inactive factory choice | fg `rgb(255,255,255)` / bg `rgba(15,23,42,.72)` → fg `rgb(32,40,47)` / bg `rgba(247,249,250,.97)` | fg `rgb(255,255,255)` / bg `rgba(15,23,42,.72)` → fg `rgb(36,32,26)` / bg `rgba(255,255,255,.96)` |
| Admin selected factory choice | fg `rgb(220,252,231)` / dark green gradient → fg `rgb(23,108,57)` / bg `rgba(23,108,57,.12)` | fg `rgb(220,252,231)` / dark green gradient → fg `rgb(29,122,63)` / bg `rgba(29,122,63,.12)` |
| Tasks create primary | dark gradient with theme text → `rgb(17,16,13)` on gold gradient | dark gradient with theme text → `rgb(17,16,13)` on gold gradient |
| Base live refresh pill | theme secondary text on dark graphite gradient → `rgb(70,82,92)` on `rgba(216,222,227,.96)` | theme secondary text on dark graphite gradient → `rgb(76,70,62)` on `rgba(245,240,231,.96)` |
| Announcements inactive tab | theme text on dark graphite gradient → `rgb(32,40,47)` on `rgba(247,249,250,.97)` | theme text on dark graphite gradient → `rgb(36,32,26)` on `rgba(255,255,255,.96)` |
| Announcements mobile header | theme text on `rgba(6,10,13,.96)` → theme text on Gray shell gradient | theme text on `rgba(6,10,13,.96)` → theme text on Light shell gradient |
| People/Orders segmented surface | `rgba(2,5,7,.82)` → `rgba(216,222,227,.96)` | `rgba(2,5,7,.82)` → `rgba(245,240,231,.96)` |
| Gallery / Chats checkbox label | `rgb(219,234,254)` → `rgb(32,40,47)` | `rgb(219,234,254)` → `rgb(36,32,26)` |
| Disabled `Войти` | `rgb(137,147,155)`, opacity `.58` → `rgb(32,40,47)`, opacity `.88`, `disabled=true` | `rgb(23,18,10)`, opacity `.58` → same fg, opacity `.88`, `disabled=true` |

## Contrast checks

Contrast estimates use the resolved semantic token pair; translucent surfaces are composited over the documented containing theme surface. They supplement, not replace, the native screenshot review.

| Pair | Gray | Light |
| --- | ---: | ---: |
| Strong heading / primary card surface | 15.77:1 | 18.39:1 |
| Main checkbox text / primary card surface | 13.05:1 | 15.95:1 |
| Main text / inactive control surface | 14.14:1 | 16.20:1 |
| Secondary live-pill text / subtle surface | 5.90:1 | 8.21:1 |
| Selected gold tab / composited warning surface | 5.18:1 | 5.38:1 |
| Selected factory success text / composited success surface | 5.15:1 | 4.56:1 |
| Tasks primary text / darkest gold gradient stop | 5.27:1 | 5.27:1 |
| Disabled primary, conservative middle-stop estimate after group opacity | 4.65:1 | 6.07:1 |

Dark computed values at 1440/390 retain the original defaults: white section/Admin headings, graphite controls, gold selected controls, `#dbeafe` checkbox label where that was the original owner, and disabled opacity `.58`. No full pixel-identity claim is made.
