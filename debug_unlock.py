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
              state.field.player.x = 1;
              state.field.player.y = 10;
              state.field.player.fromX = 1;
              state.field.player.fromY = 10;
              state.field.player.toX = 1;
              state.field.player.toY = 10;
              state.field.player.moving = false;
              state.field.player.progress = 0;
            })""")
            
        await page.evaluate("""() => window.MonsterPrototype.runtime.store.update((state) => {
              const duration = window.MonsterPrototype.config.game.story.preparationDurationMs;
              state.progress.prepElapsedMs = duration - 40;
              state.progress.prepGateUnlocked = false;
              state.progress.prepGateAnnounced = false;
              state.field.message = "";
            })""")
        
        await page.wait_for_function("() => window.MonsterPrototype.runtime.store.snapshot().progress.prepGateUnlocked === true")
        
        state = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"Unlocked: prepGateUnlocked={state['progress']['prepGateUnlocked']}, message='{state['field']['message']}'")
        
        # Press Enter to clear the message "5分が経過しました。次のマップへの道が開きました。"
        await press(page, "Enter", 0.1)
        
        state2 = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"After Enter: message='{state2['field']['message']}'")
        
        # Press ArrowLeft to move to x=0
        await press(page, "ArrowLeft", 0.4)
        
        state3 = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"After ArrowLeft: mapId='{state3['field']['mapId']}', x={state3['field']['player']['x']}, y={state3['field']['player']['y']}, message='{state3['field']['message']}'")
        
        await browser.close()

asyncio.run(main())
