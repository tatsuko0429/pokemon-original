# 2026年4月27日時点の開発者向け保守メモ:
# Playwrightでindex.htmlをfile://起動し、console/pageerrorだけを見る最小デバッグ用。
# 仕様保証用ではなく、起動直後の例外切り分けに使う。
import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"ERROR: {exc}"))
        
        filepath = "file://" + os.path.abspath("index.html")
        await page.goto(filepath)
        await asyncio.sleep(2)
        await browser.close()

asyncio.run(main())
