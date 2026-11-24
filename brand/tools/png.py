import asyncio, os, re
from playwright.async_api import async_playwright
SIZES = {'drop-app-icon': [1024, 512, 192, 180], 'drop-app-icon-orange': [1024], 'drop-driver-app-icon': [1024, 512, 192], 'favicon': [512, 192, 48, 32, 16]}
os.makedirs('out/png', exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        for f in sorted(os.listdir('out/svg')):
            name = f[:-4]; src = open('out/svg/' + f).read()
            vw, vh = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', src).groups())
            widths = SIZES.get(name, [int(vw * 2)])
            for w in widths:
                h = round(w * vh / vw)
                await pg.set_viewport_size({'width': w, 'height': h})
                await pg.set_content(f'<html><body style="margin:0;background:transparent">{src.replace(f"width=\"{int(vw)}\" height=\"{int(vh)}\"", "width=\"100%\" height=\"100%\"")}</body></html>')
                suffix = '' if name not in SIZES else f'-{w}'
                await pg.screenshot(path=f'out/png/{name}{suffix}.png', omit_background=True, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
        await b.close()
asyncio.run(main())
