# 2026年4月27日時点の開発者向け保守メモ:
# 手動でプレイヤー位置を固定し、左移動の座標変化を確認する一時デバッグ用。
# storeの内部座標を直接書き換えるため、通常のユーザー操作再現にはtests/smoke_test.pyを優先する。
import asyncio
from playwright.async_api import async_playwright
import os

async def press(page, key: str, duration: float = 0.25):
    await page.keyboard.down(key)
    await asyncio.sleep(duration)
    await page.keyboard.up(key)
    await asyncio.sleep(0.05)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        filepath = "file://" + os.path.abspath("index.html")
        await page.goto(filepath)
        
        await asyncio.sleep(0.5)
        await page.click('button:has-text("はじめる")')
        await asyncio.sleep(0.5)
        
        await page.evaluate("""() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 10;
              state.field.player.y = 10;
              state.field.player.fromX = 10;
              state.field.player.fromY = 10;
              state.field.player.toX = 10;
              state.field.player.toY = 10;
              state.field.player.moving = false;
              state.field.player.progress = 0;
            })""")
            
        for i in range(1, 11):
            await press(page, "ArrowLeft", 0.25)
            state = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
            print(f"Step {i}: x={state['field']['player']['x']}, message='{state['field']['message']}'")
            
        await browser.close()

asyncio.run(main())
