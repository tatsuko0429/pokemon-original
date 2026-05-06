# 2026年4月27日時点の開発者向け保守メモ:
# 初期ルート左出口のロック解除後ワープをfile://で追うデバッグ用。
# 入力タイミングに依存するため、失敗時は本体不具合か待機不足かを切り分ける。
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
        
        # skip intro
        await asyncio.sleep(0.5)
        await page.evaluate('() => document.querySelector("#modal-actions button").click()')
        await asyncio.sleep(0.5)
        
        # move to gate
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
            
        for _ in range(10):
            await page.keyboard.press("ArrowLeft")
            await asyncio.sleep(0.05)
            
        await asyncio.sleep(0.5)
        state = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"Before unlock, player at: {state['field']['player']['x']}, {state['field']['player']['y']}, map: {state['field']['mapId']}, message: {state['field']['message']}")
        
        await page.evaluate("""() => window.MonsterPrototype.runtime.store.update((state) => {
              const duration = window.MonsterPrototype.config.game.story.preparationDurationMs;
              state.progress.prepElapsedMs = duration - 40;
              state.progress.prepGateUnlocked = false;
              state.progress.prepGateAnnounced = false;
              state.field.message = "";
            })""")
            
        await asyncio.sleep(1.0)
        await page.keyboard.press("Enter") # dismiss 5 min passed msg
        await asyncio.sleep(0.5)
        
        await page.keyboard.press("ArrowLeft")
        await asyncio.sleep(0.5)
        
        state2 = await page.evaluate("() => window.MonsterPrototype.runtime.store.snapshot()")
        print(f"After unlock and move, player at: {state2['field']['player']['x']}, {state2['field']['player']['y']}, map: {state2['field']['mapId']}")
        print(f"Message: {state2['field']['message']}")
        
        await browser.close()

asyncio.run(main())
