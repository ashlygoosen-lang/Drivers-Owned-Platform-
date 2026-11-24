"""DROP logo system generator: writes SVGs with all text converted to outlines."""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

NAVY, ORANGE, WHITE, GREY = '#071B3A', '#FF6B00', '#FFFFFF', '#F5F7FA'
OUT = 'out/svg'
os.makedirs(OUT, exist_ok=True)
FONTS = {w: TTFont(f'node_modules/@fontsource/manrope/files/manrope-latin-{w}-normal.woff') for w in (700, 800)}


def text_path(text, size, x=0, baseline=0, weight=800, tracking=0.0, skew=0.0):
    """Return (svg path d, advance width) for text at `size` px, origin at (x, baseline)."""
    font = FONTS[weight]
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs)
    cx = 0.0
    for ch in text:
        name = cmap.get(ord(ch))
        if not name:
            cx += size * 0.3
            continue
        # y flipped; skew (italic) shears x by y
        t = (s, 0, skew * s, -s, x + cx, baseline)
        gs[name].draw(TransformPen(pen, t))
        cx += gs[name].width * s + tracking * size
    return pen.getCommands(), cx - tracking * size


def glyph_box(ch, size, weight=800):
    font = FONTS[weight]
    from fontTools.pens.boundsPen import BoundsPen
    gs = font.getGlyphSet(); bp = BoundsPen(gs); gs[font.getBestCmap()[ord(ch)]].draw(bp)
    s = size / font['head'].unitsPerEm
    return [v * s for v in bp.bounds], gs[font.getBestCmap()[ord(ch)]].width * s


def pin_path(cx, cy, r):
    """Location pin: circle of radius r centred at (cx, cy), tip 1.9r below the centre."""
    tip = cy + r * 1.9
    k = r * 0.55
    return (f'M{cx} {tip:.1f} C{cx - k:.1f} {tip - r * 0.55:.1f} {cx - r:.1f} {cy + r * 0.62:.1f} {cx - r:.1f} {cy:.1f} '
            f'A{r} {r} 0 0 1 {cx + r:.1f} {cy:.1f} C{cx + r:.1f} {cy + r * 0.62:.1f} {cx + k:.1f} {tip - r * 0.55:.1f} {cx} {tip:.1f}Z')


def car(cx, cy, w, body, cut):
    """Front-view car icon centred on (cx, cy), width w. `cut` is the colour of windows/lights."""
    u = w / 120
    def X(v): return cx + v * u
    def Y(v): return cy + v * u
    return f'''<g>
  <path d="M{X(-40)} {Y(-8)} L{X(-30)} {Y(-34)} Q{X(-28)} {Y(-40)} {X(-21)} {Y(-40)} L{X(21)} {Y(-40)} Q{X(28)} {Y(-40)} {X(30)} {Y(-34)} L{X(40)} {Y(-8)} L{X(50)} {Y(-8)} Q{X(58)} {Y(-8)} {X(58)} {Y(0)} L{X(58)} {Y(22)} Q{X(58)} {Y(28)} {X(52)} {Y(28)} L{X(-52)} {Y(28)} Q{X(-58)} {Y(28)} {X(-58)} {Y(22)} L{X(-58)} {Y(0)} Q{X(-58)} {Y(-8)} {X(-50)} {Y(-8)} Z" fill="{body}"/>
  <path d="M{X(-28)} {Y(-11)} L{X(-21)} {Y(-31)} L{X(21)} {Y(-31)} L{X(28)} {Y(-11)} Z" fill="{cut}"/>
  <rect x="{X(-50)}" y="{Y(2)}" width="{20 * u}" height="{9 * u}" rx="{4.5 * u}" fill="{cut}"/>
  <rect x="{X(30)}" y="{Y(2)}" width="{20 * u}" height="{9 * u}" rx="{4.5 * u}" fill="{cut}"/>
  <rect x="{X(-18)}" y="{Y(14)}" width="{36 * u}" height="{5 * u}" rx="{2.5 * u}" fill="{cut}"/>
  <rect x="{X(-52)}" y="{Y(24)}" width="{20 * u}" height="{16 * u}" rx="{5 * u}" fill="{body}"/>
  <rect x="{X(32)}" y="{Y(24)}" width="{20 * u}" height="{16 * u}" rx="{5 * u}" fill="{body}"/>
</g>'''


def mark(cx, cy, r, pin=ORANGE, inner=WHITE, body=NAVY, cut=WHITE):
    """The DROP symbol: a location pin carrying a car."""
    return f'''<path d="{pin_path(cx, cy, r)}" fill="{pin}"/>
<circle cx="{cx}" cy="{cy}" r="{r * 0.68:.1f}" fill="{inner}"/>
{car(cx, cy + r * 0.04, r * 1.0, body, cut)}'''


def mini_pin(cx, cy, r, fill, hole):
    return f'<path d="{pin_path(cx, cy, r)}" fill="{fill}"/><circle cx="{cx}" cy="{cy}" r="{r * 0.42:.2f}" fill="{hole}"/>'


def wordmark(x, baseline, size, ink, accent, hole):
    """DROP in Manrope ExtraBold, italicised for motion, with a pin inside the O."""
    skew = 0.18
    tracking = -0.035
    parts, cx = [], x
    o_center = None
    for ch in 'DROP':
        d, adv = text_path(ch, size, cx, baseline, 800, 0, skew)
        parts.append(d)
        if ch == 'O':
            (x0, y0, x1, y1), _ = glyph_box('O', size)
            mid_y = baseline - (y0 + y1) / 2
            o_center = (cx + (x0 + x1) / 2 + skew * (baseline - mid_y) * 1, mid_y)
        cx += adv + tracking * size
    d = ' '.join(parts)
    ox, oy = o_center
    pr = size * 0.105
    pin = mini_pin(round(ox, 1), round(oy - pr * 0.35, 1), round(pr, 1), accent, hole)
    return f'<path d="{d}" fill="{ink}" fill-rule="nonzero"/>{pin}', cx - tracking * size - x


def speed_lines(x_right, y_mid, size, color):
    """Three tapered motion lines ending at x_right, vertically centred on y_mid."""
    out = []
    for i, (ln, dy) in enumerate([(0.62, -0.17), (0.78, 0), (0.5, 0.17)]):
        L = size * ln; h = size * 0.045; y = y_mid + dy * size
        out.append(f'<path d="M{x_right - L:.1f} {y:.1f} L{x_right:.1f} {y - h / 2:.1f} L{x_right - size * 0.03:.1f} {y + h / 2:.1f} Z" fill="{color}"/>')
    return ''.join(out)


def svg(w, h, body, title, bg=None):
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}"><title>{title}</title>{rect}{body}</svg>\n'


def write(name, content):
    open(f'{OUT}/{name}.svg', 'w').write(content)


THEMES = {
    'light': dict(ink=NAVY, accent=ORANGE, hole=WHITE, pin=ORANGE, inner=WHITE, body=NAVY, cut=WHITE, tag=NAVY, bg=None),
    'dark': dict(ink=WHITE, accent=ORANGE, hole=NAVY, pin=ORANGE, inner=WHITE, body=NAVY, cut=WHITE, tag='#C9D3E3', bg=None),
    'mono-navy': dict(ink=NAVY, accent=NAVY, hole=WHITE, pin=NAVY, inner=WHITE, body=NAVY, cut=WHITE, tag=NAVY, bg=None),
    'mono-white': dict(ink=WHITE, accent=WHITE, hole=NAVY, pin=WHITE, inner=NAVY, body=WHITE, cut=NAVY, tag=WHITE, bg=None),
}

TAG = 'Ride Smart. Go Further.'

for theme, t in THEMES.items():
    m = lambda cx, cy, r: mark(cx, cy, r, t['pin'], t['inner'], t['body'], t['cut'])
    # Symbol only
    write(f'drop-symbol-{theme}', svg(512, 512, m(256, 200, 150), 'DROP symbol', t['bg']))
    # Wordmark only
    wm, ww = wordmark(30, 220, 260, t['ink'], t['accent'], t['hole'])
    write(f'drop-wordmark-{theme}', svg(int(ww + 90), 260, wm, 'DROP', t['bg']))
    # Primary (stacked) logo: symbol, speed lines + wordmark, tagline
    W = 1200
    wm, ww = wordmark(0, 0, 260, t['ink'], t['accent'], t['hole'])
    wx = (W - ww) / 2 + 30
    tag_d, tag_w = text_path(TAG, 56, 0, 0, 700, 0.005)
    body = (m(W / 2, 150, 112)
            + speed_lines(wx - 10, 590 - 95, 300, t['accent'])
            + wordmark(wx, 590, 260, t['ink'], t['accent'], t['hole'])[0]
            + f'<path d="{text_path(TAG, 56, (W - tag_w) / 2, 700, 700, 0.005)[0]}" fill="{t["tag"]}"/>'
            + f'<rect x="{(W - tag_w) / 2 - 150}" y="678" width="110" height="5" rx="2.5" fill="{t["accent"]}"/>'
            + f'<rect x="{(W + tag_w) / 2 + 40}" y="678" width="110" height="5" rx="2.5" fill="{t["accent"]}"/>')
    write(f'drop-logo-primary-{theme}', svg(W, 770, body, 'DROP — Ride Smart. Go Further.', t['bg']))
    # Horizontal logo: symbol left, wordmark right (+ optional tagline)
    wm, ww = wordmark(250, 205, 200, t['ink'], t['accent'], t['hole'])
    write(f'drop-logo-horizontal-{theme}', svg(int(250 + ww + 50), 290, m(118, 112, 84) + wm, 'DROP', t['bg']))
    wm, ww = wordmark(250, 180, 190, t['ink'], t['accent'], t['hole'])
    tag = text_path(TAG, 40, 262, 248, 700, 0.01)[0]
    write(f'drop-logo-horizontal-tagline-{theme}', svg(int(250 + ww + 50), 290, m(118, 112, 84) + wm + f'<path d="{tag}" fill="{t["tag"]}"/>', 'DROP — Ride Smart. Go Further.', t['bg']))

# App icon: navy rounded square with the symbol
icon = f'<rect width="1024" height="1024" rx="228" fill="{NAVY}"/>' + mark(512, 400, 260, ORANGE, WHITE, NAVY, WHITE)
write('drop-app-icon', svg(1024, 1024, icon, 'DROP app icon'))
icon_o = f'<rect width="1024" height="1024" rx="228" fill="{ORANGE}"/>' + mark(512, 400, 260, WHITE, NAVY, WHITE, NAVY)
write('drop-app-icon-orange', svg(1024, 1024, icon_o, 'DROP app icon (orange)'))
# Driver app icon: same symbol, orange square with navy ring marker to distinguish
drv = f'<rect width="1024" height="1024" rx="228" fill="{NAVY}"/>' + mark(512, 380, 240, ORANGE, WHITE, NAVY, WHITE) + \
      f'<path d="{text_path("DRIVER", 92, 0, 0, 800, 0.08)[0]}" fill="none"/>'
dw = text_path('DRIVER', 92, 0, 0, 800, 0.08)[1]
drv += f'<rect x="{512 - dw / 2 - 40}" y="820" width="{dw + 80}" height="130" rx="65" fill="{ORANGE}"/><path d="{text_path("DRIVER", 92, 512 - dw / 2, 918, 800, 0.08)[0]}" fill="{WHITE}"/>'
write('drop-driver-app-icon', svg(1024, 1024, drv, 'DROP Driver app icon'))
# Favicon: simplified pin (car detail is unreadable at 16px)
fav = f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>' + mini_pin(32, 25, 17, ORANGE, WHITE)
write('favicon', svg(64, 64, fav, 'DROP'))
print('written', len(os.listdir(OUT)), 'svgs')
