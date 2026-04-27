import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        
        filepath = "file://" + os.path.abspath("index.html")
        await page.goto(filepath)
        
        # wait for app to load
        await asyncio.sleep(0.5)
        
        # simulate click on "はじめる" button
        await page.click('button:has-text("はじめる")')
        await asyncio.sleep(0.5)
        
        # update player pos
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
            
        await page.keyboard.press("ArrowLeft")
        await asyncio.sleep(0.5)
        state = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"After ArrowLeft 1, player at: {state['field']['player']['x']}, {state['field']['player']['y']}, moving: {state['field']['player']['moving']}")
        
        await browser.close()

asyncio.run(main())
