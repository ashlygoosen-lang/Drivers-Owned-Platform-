# DROP brand identity — Ride Smart. Go Further.

Live guidelines: **`/brand`** on the website (logo downloads, colour, type, icons, UI, applications).
Source files: `brand/svg`, `brand/png`; the generator lives in `brand/tools/make_logos.py`.

## Logo system
| File | Use |
|---|---|
| `drop-logo-primary-{light,dark}` | Stacked: symbol, speed lines, wordmark, tagline. Hero and cover use. |
| `drop-logo-horizontal-{light,dark}` | Website header, documents, apps. |
| `drop-logo-horizontal-tagline-{light,dark}` | Letterheads, adverts, footers. |
| `drop-symbol-*` | Pin + car. Map markers, stickers, small spaces. |
| `drop-wordmark-*` | When the symbol already appears nearby. |
| `*-mono-navy`, `*-mono-white` | One-colour print, vinyl cut, embossing. |
| `drop-app-icon`, `drop-driver-app-icon` | Store icons (1024 px PNG + SVG). |
| `favicon.svg/.ico/.png` | Pin only; the car is unreadable below 24 px. |

`light` = for white backgrounds; `dark` and `mono-white` = white artwork on transparent, for navy or photos.
All lettering is converted to outlines, so no font is needed to display the logos.

**Changes from the original concept:** flat colours instead of gradients (prints and scales cleanly); a simplified car that stays legible at app-icon size; the road swoosh became a separate supporting graphic (the orange "route line"), so the logo stays compact; the wordmark is italicised Manrope ExtraBold for forward motion, keeping the pin inside the O; the "E-HAILING" badge was dropped from the logo (it can sit beside it as a label).

## Colour
Midnight Navy `#071B3A` (primary) · Dynamic Orange `#FF6B00` (accent) · Pure White `#FFFFFF` · Light Grey `#F5F7FA`.
Support: Navy 600 `#0D2A57`, Orange 700 `#E65F00`, Slate `#5B6B82`, Line `#E3E8EF`, Success `#1E8E5A`, Alert `#D93636`.
Accessibility: white on orange is 2.9:1 (fails AA), so orange buttons use navy text (6.4:1).

## Typography
Manrope 700/800 for headlines and numbers; Inter 400–600 for text and UI. Both are free on Google Fonts (SIL OFL).

## Regenerating assets
```bash
cd brand/tools
npm i @fontsource/manrope && pip install fonttools brotli playwright && python -m playwright install chromium
python make_logos.py   # writes out/svg
python png.py          # writes out/png (transparent PNGs, icon sizes)
```
