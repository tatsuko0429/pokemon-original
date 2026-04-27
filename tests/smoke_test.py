#!/usr/bin/env python3
"""
最小スモークテスト。

起動 -> 初期説明 -> 準備タイマー -> セーブ復元 -> 固定ルート移動 -> 野生戦導入、
ワープ、拾得物取得、捕獲演出、最初の依頼進行までを自動で確認する。

実行例:
  python3 tests/smoke_test.py

必要に応じて SMOKE_CHROME_BIN に Chrome / Chromium 系ブラウザの
実行ファイルパスを渡せる。
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import http.server
import os
import pathlib
import shutil
import subprocess
import threading
from typing import Optional

from pyppeteer import launch


ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED_START_CAPTION = "ながめのみち"
EXPECTED_SQUARE_CAPTION = "受付"
EXPECTED_BATTLE_CAPTION = "やせいとの戦い"


def expand_route(*segments):
    route = []
    for key, count in segments:
        route.extend([key] * count)
    return route


ROUTE_TO_SQUARE = expand_route(("ArrowLeft", 10))
ROUTE_BACK_TO_ROUTE = ["ArrowRight"]
ROUTE_TO_SQUARE_GUIDE = expand_route(("ArrowDown", 1), ("ArrowLeft", 13))
ROUTE_TO_PICKUP = expand_route(
    ("ArrowRight", 19),
    ("ArrowDown", 3),
    ("ArrowRight", 1),
    ("ArrowDown", 4),
    ("ArrowRight", 2),
)
ROUTE_TO_BATTLE = [
    "ArrowRight",
    "ArrowRight",
    "ArrowRight",
    "ArrowDown",
    "ArrowRight",
    "ArrowRight",
    "ArrowRight",
    "ArrowLeft",
]


def find_browser_executable() -> Optional[str]:
    explicit = os.environ.get("SMOKE_CHROME_BIN")
    if explicit:
        return explicit

    for command in (
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "chrome",
        "msedge",
    ):
        resolved = shutil.which(command)
        if resolved:
            return resolved

    for candidate in (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ):
        if os.path.exists(candidate):
            return candidate

    for bundle_id, executable in (
        ("com.google.Chrome", "Google Chrome"),
        ("org.chromium.Chromium", "Chromium"),
        ("com.microsoft.edgemac", "Microsoft Edge"),
    ):
        try:
            result = subprocess.run(
                ["mdfind", f'kMDItemCFBundleIdentifier == "{bundle_id}"'],
                capture_output=True,
                check=False,
                text=True,
            )
        except Exception:
            continue

        for app_path in result.stdout.splitlines():
            candidate = os.path.join(app_path, "Contents", "MacOS", executable)
            if os.path.exists(candidate):
                return candidate

    return None


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return


@contextlib.contextmanager
def run_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


async def press(page, key: str, hold: float = 0.06, gap: float = 0.18) -> None:
    await page.keyboard.down(key)
    await asyncio.sleep(hold)
    await page.keyboard.up(key)
    await asyncio.sleep(gap)


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def wait_for_caption(page, expected: str) -> None:
    await page.waitForFunction(
        """(caption) => {
          const appReady = window.MonsterPrototype
            && window.MonsterPrototype.runtime
            && window.MonsterPrototype.runtime.store;
          const captionElement = document.querySelector("#screen-caption");
          return Boolean(appReady && captionElement && captionElement.textContent === caption);
        }""",
        {"timeout": 4000},
        expected,
    )


async def load_fresh(page, base_url: str, accept_intro: bool = True) -> None:
    await page.goto(base_url, {"waitUntil": "networkidle0"})
    await page.evaluate(
        """() => {
          if (window.MonsterPrototype?.runtime?.save) {
            window.MonsterPrototype.runtime.save.clear(
              window.MonsterPrototype.runtime.store.getState()
            );
            return;
          }
          window.localStorage.clear();
        }"""
    )
    await page.goto(base_url, {"waitUntil": "networkidle0"})
    await wait_for_caption(page, EXPECTED_START_CAPTION)
    if accept_intro:
        await click_modal_button(page, "はじめる")
        await page.waitForFunction(
            """() => document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "true" """,
            {"timeout": 1200},
        )


async def unlock_preparation_gate(page) -> None:
    await page.evaluate(
        """() => {
          const runtime = window.MonsterPrototype.runtime;
          runtime.store.update((state) => {
            const duration = window.MonsterPrototype.config.game.story.preparationDurationMs;
            state.progress.storyIntroAccepted = true;
            state.progress.prepElapsedMs = duration;
            state.progress.prepGateUnlocked = true;
            state.progress.prepGateAnnounced = true;
            state.field.message = "";
          });
        }"""
    )


async def advance_battle_until_modal(page):
    await page.waitForFunction(
        """() => document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "false"
          && document.querySelector("#modal-title")?.textContent === "捕獲の記録" """,
        {"timeout": 10000},
    )
    return await read_field_state(page)


async def read_field_state(page):
    return await page.evaluate(
        """() => ({
          caption: document.querySelector("#screen-caption")?.textContent || "",
          message: document.querySelector("#screen-message")?.textContent || "",
          actions: [...document.querySelectorAll("#action-panel button")].map((el) => el.textContent),
          actionNotePresent: Boolean(document.querySelector("#action-panel .panel-note")),
          timerText: document.querySelector("#screen-timer")?.textContent || "",
          status: [...document.querySelectorAll(".status-pill")].map((el) => el.textContent),
          modalOpen: document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "false",
          modalTitle: document.querySelector("#modal-title")?.textContent || "",
          modalLines: [...document.querySelectorAll("#modal-body p")].map((el) => el.textContent),
          modalBodyText: document.querySelector("#modal-body")?.textContent?.replace(/\\s+/g, " ").trim() || "",
          modalPreviewCount: document.querySelectorAll("#modal-body .modal-monster-frame canvas, #modal-body .modal-monster-frame img").length,
          modalButtons: [...document.querySelectorAll("#modal-actions button")].map((el) => el.textContent),
          tapRippleCount: document.querySelectorAll(".tap-ripple").length,
          bodyText: document.body.textContent?.replace(/\\s+/g, " ").trim() || "",
          state: window.MonsterPrototype.runtime.store.snapshot()
        })"""
    )


async def click_modal_button(page, label: str) -> None:
    position = await page.evaluate(
        """(label) => {
          const button = [...document.querySelectorAll("#modal-actions button")]
            .find((entry) => entry.textContent === label);
          if (!button) {
            throw new Error(`${label} ボタンが見つかりません。`);
          }
          const rect = button.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }""",
        label,
    )
    await page.mouse.move(position["x"], position["y"])
    await page.mouse.down()
    await asyncio.sleep(0.06)
    await page.mouse.up()
    await asyncio.sleep(0.04)


async def run_smoke_test(base_url: str) -> None:
    browser_errors = []
    executable_path = find_browser_executable()
    launch_options = {
        "headless": True,
        "args": ["--no-sandbox"],
    }
    if executable_path:
        launch_options["executablePath"] = executable_path

    browser = await launch(**launch_options)
    try:
        page = await browser.newPage()
        page.on("pageerror", lambda err: browser_errors.append(f"pageerror: {err}"))
        page.on(
            "console",
            lambda msg: browser_errors.append(f"console:{msg.type}: {msg.text}")
            if msg.type == "error"
            else None,
        )

        await page.setViewport(
            {
                "width": 390,
                "height": 844,
                "isMobile": True,
                "deviceScaleFactor": 2,
                "hasTouch": True,
            }
        )
        await load_fresh(page, base_url, accept_intro=False)

        intro_state = await read_field_state(page)
        expect(intro_state["modalOpen"], "起動直後のルール説明が開いていません。")
        expect(intro_state["modalTitle"] == "ルール", "ルール説明の見出しが想定と違います。")
        expect(
            "この5分は、自由に準備する時間です。" in intro_state["modalBodyText"],
            "ルール説明の導入文が想定と違います。",
        )
        expect(
            "草むらで5分間、モンスターを育てられます" in intro_state["modalBodyText"],
            "ルール説明に草むら育成の要点がありません。",
        )
        expect(
            "手持ちは1体だけ。捕まえると入れ替わります" in intro_state["modalBodyText"],
            "ルール説明に手持ち入れ替えの要点がありません。",
        )
        expect(
            "5分後に道が開き、次のステージへ進めます" in intro_state["modalBodyText"],
            "ルール説明にゲート解放の要点がありません。",
        )
        expect("はじめる" in intro_state["modalButtons"], "ルール説明に開始ボタンがありません。")
        await click_modal_button(page, "はじめる")
        await page.waitForFunction(
            """() => document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "true" """,
            {"timeout": 1200},
        )

        initial_state = await read_field_state(page)

        expect(initial_state["caption"] == EXPECTED_START_CAPTION, "初期マップ名が想定と違います。")
        expect(not initial_state["modalOpen"], "起動直後にモーダルが開いています。")
        expect("メニュー" in initial_state["actions"], "フィールド操作ボタンが不足しています。")
        expect(len(initial_state["status"]) >= 1, "状態表示が描画されていません。")
        expect(initial_state["timerText"] == "5:00", "準備タイマーが画面右上に表示されていません。")
        expect(
            not any("つかまえた" in entry for entry in initial_state["status"]),
            "状態表示に捕獲数の表記が残っています。",
        )
        expect(not initial_state["actionNotePresent"], "常設の操作説明が画面に残っています。")
        expect("非公開試作" not in initial_state["bodyText"], "試作用の文言が画面に残っています。")
        expect("初代風モンスター試作" not in initial_state["bodyText"], "試作用タイトルが画面に残っています。")
        expect(
            "体験の芯を確認するための最小プレイアブルです" not in initial_state["bodyText"],
            "試作用の説明文が画面に残っています。",
        )

        await page.evaluate(
            """() => {
              window.__vibrationCount = 0;
              Object.defineProperty(navigator, "vibrate", {
                configurable: true,
                value: () => {
                  window.__vibrationCount += 1;
                  return true;
                }
              });
            }"""
        )
        await page.click(".dpad-button.is-right")
        await page.waitForFunction(
            """() => window.MonsterPrototype.runtime.store.snapshot().field.player.x === 11""",
            {"timeout": 1600},
        )
        await page.click(".dpad-button.is-left")
        await page.waitForFunction(
            """() => window.MonsterPrototype.runtime.store.snapshot().field.player.x === 10""",
            {"timeout": 1600},
        )
        dpad_points = await page.evaluate(
            """() => {
              const up = document.querySelector(".dpad-button.is-up").getBoundingClientRect();
              const right = document.querySelector(".dpad-button.is-right").getBoundingClientRect();
              return {
                up: { x: up.left + up.width / 2, y: up.top + up.height / 2 },
                right: { x: right.left + right.width / 2, y: right.top + right.height / 2 }
              };
            }"""
        )
        await page.mouse.move(dpad_points["up"]["x"], dpad_points["up"]["y"])
        await page.mouse.down()
        await asyncio.sleep(0.08)
        active_up_state = await page.evaluate(
            """() => document.querySelector(".dpad-button.is-up").classList.contains("is-active")"""
        )
        await page.mouse.move(dpad_points["right"]["x"], dpad_points["right"]["y"], {"steps": 8})
        await asyncio.sleep(0.08)
        active_slide_state = await page.evaluate(
            """() => ({
              up: document.querySelector(".dpad-button.is-up").classList.contains("is-active"),
              right: document.querySelector(".dpad-button.is-right").classList.contains("is-active"),
              vibrationCount: window.__vibrationCount || 0
            })"""
        )
        await page.mouse.up()
        expect(active_up_state, "十字キーを押し始めた方向がアクティブ表示になっていません。")
        expect(
            active_slide_state["right"] and not active_slide_state["up"],
            "十字キーを押したまま滑らせても方向が切り替わっていません。",
        )
        expect(active_slide_state["vibrationCount"] >= 2, "ボタン操作時の触覚フィードバックが呼び出されていません。")

        await page.evaluate(
            """() => {
              const shell = document.querySelector(".app-shell");
              const rect = shell.getBoundingClientRect();
              shell.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                pointerType: "touch",
                clientX: rect.left + rect.width * 0.5,
                clientY: rect.top + rect.height * 0.5
              }));
            }"""
        )
        await page.waitForFunction(
            """() => document.querySelectorAll(".tap-ripple").length > 0""",
            {"timeout": 400},
        )
        await page.waitForFunction(
            """() => document.querySelectorAll(".tap-ripple").length === 0""",
            {"timeout": 1200},
        )

        layout_state = await page.evaluate(
            """() => {
              const shell = document.querySelector(".app-shell").getBoundingClientRect();
              const screen = document.querySelector(".screen-card").getBoundingClientRect();
              const dpad = document.querySelector(".direction-pad").getBoundingClientRect();
              const faceButton = document.querySelector(".face-button").getBoundingClientRect();
              const menuButton = document.querySelector(".system-button").getBoundingClientRect();
              return {
                viewportHeight: window.innerHeight,
                scrollHeight: document.documentElement.scrollHeight,
                bodyScrollHeight: document.body.scrollHeight,
                shellTop: shell.top,
                shellBottom: shell.bottom,
                screenHeight: screen.height,
                dpadWidth: dpad.width,
                faceButtonWidth: faceButton.width,
                menuButtonHeight: menuButton.height
              };
            }"""
        )
        expect(layout_state["shellTop"] >= -1, "本体UIが画面上にはみ出しています。")
        expect(
            layout_state["shellBottom"] <= layout_state["viewportHeight"] + 1,
            "本体UIがスマホ画面内に収まっていません。",
        )
        expect(
            layout_state["scrollHeight"] <= layout_state["viewportHeight"] + 1
            and layout_state["bodyScrollHeight"] <= layout_state["viewportHeight"] + 1,
            "スマホ表示でページが縦スクロール可能になっています。",
        )
        expect(layout_state["screenHeight"] >= 320, "ゲーム画面が小さすぎます。")
        expect(layout_state["dpadWidth"] >= 130, "十字キーが小さすぎます。")
        expect(58 <= layout_state["faceButtonWidth"] <= 82, "A/Bボタンのサイズが想定範囲外です。")
        expect(layout_state["menuButtonHeight"] <= 30, "メニューボタンが大きすぎます。")

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 10;
              state.field.player.y = 10;
              state.field.player.fromX = 10;
              state.field.player.fromY = 10;
              state.field.player.toX = 10;
              state.field.player.toY = 10;
              state.field.player.moving = false;
              state.field.player.progress = 0;
              state.field.message = "";
            })"""
        )
        b_button_center = await page.evaluate(
            """() => {
              const rect = document.querySelector(".face-button.is-b").getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }"""
        )
        await page.mouse.move(b_button_center["x"], b_button_center["y"])
        await page.mouse.down()
        await page.keyboard.down("ArrowRight")
        await asyncio.sleep(0.11)
        run_state = await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.snapshot().field.player"""
        )
        await page.keyboard.up("ArrowRight")
        await page.mouse.up()
        expect(
            run_state["x"] >= 11,
            "Bボタンを押しながら移動しても走り状態の速度になっていません。",
        )
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 10;
              state.field.player.y = 10;
              state.field.player.fromX = 10;
              state.field.player.fromY = 10;
              state.field.player.toX = 10;
              state.field.player.toY = 10;
              state.field.player.moving = false;
              state.field.player.progress = 0;
            })"""
        )

        for key in ROUTE_TO_SQUARE:
            await press(page, key)
        await asyncio.sleep(0.25)
        locked_gate_state = await read_field_state(page)
        expect(locked_gate_state["caption"] == EXPECTED_START_CAPTION, "5分前に次マップへ移動しています。")
        expect("5分後に解放されます" in locked_gate_state["message"], "5分前ゲートの案内が表示されていません。")
        await press(page, "Enter")
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              const duration = window.MonsterPrototype.config.game.story.preparationDurationMs;
              state.progress.prepElapsedMs = duration - 40;
              state.progress.prepGateUnlocked = false;
              state.progress.prepGateAnnounced = false;
              state.field.message = "";
            })"""
        )
        await page.waitForFunction(
            """() => window.MonsterPrototype.runtime.store.snapshot().progress.prepGateUnlocked === true""",
            {"timeout": 1200},
        )
        unlocked_gate_state = await read_field_state(page)
        expect(unlocked_gate_state["timerText"] == "0:00", "5分経過後のタイマー表示が0:00になっていません。")
        expect("道が開きました" in unlocked_gate_state["message"], "5分経過後の解放メッセージが表示されていません。")
        await press(page, "Enter")
        await press(page, "ArrowLeft")
        await asyncio.sleep(0.35)
        opened_gate_state = await read_field_state(page)
        expect(opened_gate_state["caption"] == EXPECTED_SQUARE_CAPTION, "5分経過後に次マップへ移動できません。")

        await load_fresh(page, base_url)

        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                const restoredMonster = runtime.dataRegistry.createMonsterInstance("dummy_flare", 6);
                restoredMonster.currentHp = 13;
                state.field.mapId = "camera_route";
                state.field.player.x = 5;
                state.field.player.y = 4;
                state.field.player.fromX = 5;
                state.field.player.fromY = 4;
                state.field.player.toX = 5;
                state.field.player.toY = 4;
                state.field.player.direction = "down";
                state.field.player.moving = false;
                state.field.player.progress = 0;
                state.field.steps = 12;
                state.field.lastEncounterStep = 10;
                state.inventory.fullHealCount = 2;
                state.party = [restoredMonster];
                state.collection.capturedSpeciesIds = ["dummy_flare"];
                state.progress.resolvedEventIds = ["route_ball_pickup"];
                state.progress.observationQuestState = "reported";
              });
              runtime.save.persist(runtime.store.getState());
            }"""
        )
        await page.goto(base_url, {"waitUntil": "networkidle0"})
        await wait_for_caption(page, EXPECTED_START_CAPTION)
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#modal-actions button")]
              .some((button) => button.textContent === "つづきから")""",
            {"timeout": 1200},
        )
        saved_prompt_state = await read_field_state(page)
        expect(saved_prompt_state["modalOpen"], "保存データ選択ポップが開いていません。")
        expect(saved_prompt_state["modalTitle"] == "", "保存データ選択ポップの見出しが残っています。")
        expect("最新保存:" in saved_prompt_state["modalBodyText"], "保存日時が表示されていません。")
        expect(
            "保存された進行があります" not in saved_prompt_state["modalBodyText"],
            "保存データ選択ポップに不要な説明文が残っています。",
        )
        expect("つづきから" in saved_prompt_state["modalButtons"], "つづきからボタンが表示されていません。")
        expect("はじめから" in saved_prompt_state["modalButtons"], "はじめからボタンが表示されていません。")
        await click_modal_button(page, "つづきから")
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "true"
                && state.field.player.x === 5
                && state.field.player.y === 4;
            }""",
            {"timeout": 1200},
        )
        restored_state = await read_field_state(page)
        expect(restored_state["state"]["field"]["player"]["x"] == 5, "保存した横位置が復元されていません。")
        expect(restored_state["state"]["field"]["player"]["y"] == 4, "保存した縦位置が復元されていません。")
        expect(restored_state["state"]["field"]["player"]["direction"] == "down", "保存した向きが復元されていません。")
        expect(restored_state["state"]["inventory"]["fullHealCount"] == 2, "保存した回復薬数が復元されていません。")
        expect(
            restored_state["state"]["party"][0]["speciesId"] == "dummy_flare",
            "保存した手持ちモンスターが復元されていません。",
        )
        expect(
            restored_state["state"]["collection"]["capturedSpeciesIds"] == ["dummy_flare"],
            "保存した捕獲記録が復元されていません。",
        )
        expect(
            restored_state["state"]["progress"]["observationQuestState"] == "reported",
            "保存した依頼進行が復元されていません。",
        )
        expect(
            "route_ball_pickup" in restored_state["state"]["progress"]["resolvedEventIds"],
            "保存した拾得済みイベントが復元されていません。",
        )

        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.field.player.x = 6;
                state.field.player.y = 4;
                state.field.player.fromX = 6;
                state.field.player.fromY = 4;
                state.field.player.toX = 6;
                state.field.player.toY = 4;
                state.collection.capturedSpeciesIds = ["dummy_flare"];
                state.progress.resolvedEventIds = ["route_ball_pickup"];
                state.progress.observationQuestState = "reported";
              });
              runtime.save.persist(runtime.store.getState());
            }"""
        )
        await page.goto(base_url, {"waitUntil": "networkidle0"})
        await wait_for_caption(page, EXPECTED_START_CAPTION)
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#modal-actions button")]
              .some((button) => button.textContent === "はじめから")""",
            {"timeout": 1200},
        )
        await click_modal_button(page, "はじめから")
        await page.waitForFunction(
            """() => document.querySelector("#modal-title")?.textContent === "ルール" """,
            {"timeout": 1200},
        )
        await click_modal_button(page, "はじめる")
        await page.waitForFunction(
            """() => document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "true" """,
            {"timeout": 1200},
        )
        new_game_state = await read_field_state(page)
        expect(new_game_state["state"]["field"]["player"]["x"] == 10, "はじめから選択後の横位置が初期値ではありません。")
        expect(new_game_state["state"]["field"]["player"]["y"] == 10, "はじめから選択後の縦位置が初期値ではありません。")
        expect(new_game_state["state"]["inventory"]["fullHealCount"] == 0, "はじめから選択後に回復薬数が初期化されていません。")
        expect(
            new_game_state["state"]["party"][0]["speciesId"] == "nejimakidori",
            "はじめから選択後に手持ちモンスターが初期化されていません。",
        )
        expect(not new_game_state["state"]["collection"]["capturedSpeciesIds"], "はじめから選択後に捕獲記録が残っています。")
        expect(
            new_game_state["state"]["progress"]["observationQuestState"] == "not_started",
            "はじめから選択後に依頼進行が残っています。",
        )
        expect(
            new_game_state["state"]["progress"]["storyIntroAccepted"],
            "はじめから選択後にルール説明の確認状態が記録されていません。",
        )
        await load_fresh(page, base_url)

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 1;
              state.field.player.y = 1;
              state.field.player.fromX = 1;
              state.field.player.fromY = 1;
              state.field.player.toX = 1;
              state.field.player.toY = 1;
              state.field.player.moving = false;
              state.field.player.progress = 0;
              state.field.bumpEffect = null;
              state.field.stepEffect = null;
              state.field.blockedFeedbackCooldownMs = 0;
            })"""
        )
        await page.keyboard.down("ArrowLeft")
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.field.bumpEffect && state.field.bumpEffect.kind === "bump");
            }""",
            {"timeout": 1200},
        )
        bump_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                player: state.field.player,
                bumpEffect: state.field.bumpEffect,
              };
            }"""
        )
        await page.keyboard.up("ArrowLeft")
        await asyncio.sleep(0.03)
        expect(bump_state["player"]["x"] == 1, "通行不可タイルへ移動してしまっています。")
        expect(
            bump_state["bumpEffect"] and bump_state["bumpEffect"]["kind"] == "bump",
            "壁衝突の短い反応が記録されていません。",
        )

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 1;
              state.field.player.y = 2;
              state.field.player.fromX = 1;
              state.field.player.fromY = 2;
              state.field.player.toX = 1;
              state.field.player.toY = 2;
              state.field.player.moving = false;
              state.field.player.progress = 0;
              state.field.steps = 0;
              state.field.lastEncounterStep = 999;
              state.field.bumpEffect = null;
              state.field.stepEffect = null;
              state.field.blockedFeedbackCooldownMs = 0;
            })"""
        )
        await page.keyboard.down("ArrowRight")
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return state.field.player.x === 2
                && state.field.stepEffect
                && state.field.stepEffect.kind === "grass";
            }""",
            {"timeout": 1200},
        )
        await page.keyboard.up("ArrowRight")
        grass_step_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                player: state.field.player,
                stepEffect: state.field.stepEffect,
                transitionActive: state.transition.active,
              };
            }"""
        )
        expect(grass_step_state["player"]["x"] == 2, "草むらへの移動が完了していません。")
        expect(not grass_step_state["transitionActive"], "草むらフィードバック確認中に遭遇へ入っています。")
        expect(
            grass_step_state["stepEffect"] and grass_step_state["stepEffect"]["kind"] == "grass",
            "草むら歩行の短い反応が記録されていません。",
        )

        await load_fresh(page, base_url)

        await press(page, "m")
        await asyncio.sleep(0.2)
        menu_state = await read_field_state(page)
        expect(menu_state["modalOpen"], "メニューポップが開きません。")
        expect(menu_state["modalTitle"] == "メニュー", "メニューポップの見出しが想定と違います。")
        expect("手持ち" in menu_state["modalButtons"], "メニューに手持ちボタンがありません。")
        expect("アイテム" in menu_state["modalButtons"], "メニューにアイテムボタンがありません。")
        expect("図鑑" in menu_state["modalButtons"], "メニューに図鑑ボタンがありません。")
        expect("やり直す" in menu_state["modalButtons"], "メニューにやり直すボタンがありません。")
        expect("目的" in menu_state["modalButtons"], "メニューに目的ボタンがありません。")
        expect("閉じる" in menu_state["modalButtons"], "メニューに閉じるボタンがありません。")
        await click_modal_button(page, "手持ち")
        await asyncio.sleep(0.2)
        party_state = await read_field_state(page)
        expect(party_state["modalTitle"] == "手持ち", "手持ち画面に切り替わっていません。")
        expect(party_state["modalPreviewCount"] >= 1, "手持ち画面にモンスター画像が表示されていません。")
        expect(any("HP" in line for line in party_state["modalLines"]), "手持ち画面にHPが表示されていません。")
        expect(any("PP" in line for line in party_state["modalLines"]), "手持ち画面に技PPが表示されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "目的")
        await asyncio.sleep(0.2)
        objective_state = await read_field_state(page)
        expect(objective_state["modalTitle"] == "目的", "目的画面に切り替わっていません。")
        expect(
            any("草むらで5分間準備" in line for line in objective_state["modalLines"]),
            "目的画面に現在の目的が表示されていません。",
        )
        expect("現在地: ながめのみち" in objective_state["modalLines"], "目的画面に現在地が表示されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "アイテム")
        await asyncio.sleep(0.2)
        inventory_state = await read_field_state(page)
        expect(inventory_state["modalTitle"] == "アイテム", "アイテム画面に切り替わっていません。")
        expect("モンスターボール: 使い放題" in inventory_state["modalLines"], "アイテム画面にボール使い放題の説明が表示されていません。")
        expect("回復薬: 0 個" in inventory_state["modalLines"], "アイテム画面に回復薬数が表示されていません。")
        expect("拾ったもの: 0/1" in inventory_state["modalLines"], "アイテム画面に拾得記録が表示されていません。")
        expect("回復薬を使う" not in inventory_state["modalButtons"], "回復薬がないのに使用ボタンが表示されています。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "図鑑")
        await asyncio.sleep(0.2)
        observation_state = await read_field_state(page)
        expect(observation_state["modalTitle"] == "図鑑", "図鑑画面に切り替わっていません。")
        expect(
            any("まだ図鑑には記録がありません" in line for line in observation_state["modalLines"]),
            "空の図鑑メッセージが表示されていません。",
        )
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.collection.capturedSpeciesIds = ["dummy_flare"];
            })"""
        )
        await click_modal_button(page, "図鑑")
        await asyncio.sleep(0.2)
        recorded_observation_state = await read_field_state(page)
        expect("ダンゴマル" in recorded_observation_state["modalButtons"], "図鑑一覧に種族ボタンが表示されていません。")
        await click_modal_button(page, "ダンゴマル")
        await asyncio.sleep(0.2)
        observation_detail_state = await read_field_state(page)
        expect(observation_detail_state["modalTitle"] == "ダンゴマル", "図鑑詳細画面が開いていません。")
        expect(observation_detail_state["modalPreviewCount"] >= 1, "図鑑詳細にモンスター画像が表示されていません。")
        expect(any("タイプ:" in line for line in observation_detail_state["modalLines"]), "図鑑詳細にタイプが表示されていません。")
        await click_modal_button(page, "図鑑へ戻る")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "やり直す")
        await asyncio.sleep(0.2)
        restart_state = await read_field_state(page)
        expect(restart_state["modalTitle"] == "やり直しますか？", "やり直す確認画面に切り替わっていません。")
        expect(
            "最初からやり直す" in restart_state["modalButtons"],
            "やり直す確認画面に実行ボタンがありません。",
        )
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "閉じる")
        await asyncio.sleep(0.2)

        for key in ROUTE_TO_BATTLE:
            await press(page, key)
        await asyncio.sleep(0.9)

        battle_state = await page.evaluate(
            """() => ({
              caption: document.querySelector("#screen-caption")?.textContent || "",
              captionDisplay: getComputedStyle(document.querySelector("#screen-caption")).display,
              message: document.querySelector("#screen-message")?.textContent || "",
              battlePanelMessage: document.querySelector(".battle-message-panel")?.textContent || "",
              battleVisible: !document.querySelector("#battle-overlay")?.classList.contains("is-hidden"),
              actions: [...document.querySelectorAll("#action-panel button")].map((el) => el.textContent),
              hpFillBackground: getComputedStyle(document.querySelector(".battle-card.is-enemy .battle-hp-fill")).backgroundImage,
              shellBottom: document.querySelector(".app-shell").getBoundingClientRect().bottom,
              viewportHeight: window.innerHeight,
              scrollHeight: document.documentElement.scrollHeight,
              battlePoints: (() => {
                const screen = document.querySelector(".screen-wrap").getBoundingClientRect();
                const layout = window.MonsterPrototype.config.game.battleLayout;
                return {
                  enemyX: screen.left + screen.width * (layout.enemy.monsterX / 160),
                  enemyY: screen.top + screen.height * (layout.enemy.monsterY / 144),
                  playerX: screen.left + screen.width * (layout.player.monsterX / 160),
                  playerY: screen.top + screen.height * (layout.player.monsterY / 144)
                };
              })(),
              enemyCard: (() => {
                const rect = document.querySelector(".battle-card.is-enemy")?.getBoundingClientRect();
                return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
              })(),
              playerCard: (() => {
                const rect = document.querySelector(".battle-card.is-player")?.getBoundingClientRect();
                return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
              })()
            })"""
        )

        expect(battle_state["caption"] == EXPECTED_BATTLE_CAPTION, "戦闘画面へ遷移していません。")
        expect(battle_state["captionDisplay"] == "none", "バトル中の画面タイトルがHP表示と重なる状態です。")
        expect(not battle_state["message"], "バトルメッセージがゲーム画面内に残っています。")
        expect(battle_state["battlePanelMessage"], "バトルメッセージ枠が操作パネル側に出ていません。")
        expect(battle_state["battleVisible"], "戦闘オーバーレイが表示されていません。")
        expect("つづける" not in battle_state["actions"], "バトル中に不要なつづけるボタンが表示されています。")
        expect(
            all(label in battle_state["actions"] for label in ("たたかう", "ボール", "にげる", "アイテム")),
            "バトル中の基本コマンドが常時表示されていません。",
        )
        expect("メニュー" not in battle_state["actions"], "戦闘中にメニューコマンドが残っています。")
        expect(
            battle_state["shellBottom"] <= battle_state["viewportHeight"] + 1
            and battle_state["scrollHeight"] <= battle_state["viewportHeight"] + 1,
            "バトル画面でスマホ表示が縦スクロール可能になっています。",
        )
        expect(
            battle_state["enemyCard"] and battle_state["playerCard"]
            and battle_state["enemyCard"]["bottom"] < battle_state["playerCard"]["top"],
            "バトル画面のHP表示カード同士が重なっています。",
        )
        expect(
            battle_state["enemyCard"]["left"] > battle_state["battlePoints"]["enemyX"],
            "相手側HP表示が相手モンスターの右側に配置されていません。",
        )
        expect(
            battle_state["playerCard"]["right"] < battle_state["battlePoints"]["playerX"],
            "味方側HP表示が味方モンスターの左側に配置されていません。",
        )
        expect(
            "22, 101, 110" in battle_state["hpFillBackground"] or "32, 166, 179" in battle_state["hpFillBackground"],
            "通常HPゲージの色が高コントラストの青緑系に変わっていません。",
        )

        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleMessageAutoAdvanceMs = window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 99999;
              runtime.store.update((state) => {
                state.battle.enemy.moveIds.forEach((moveId) => {
                  const enemyMove = runtime.dataRegistry.getMove(moveId);
                  if (enemyMove) {
                    enemyMove.accuracy = 0;
                  }
                });
                state.inventory.fullHealCount = 1;
                state.party[0].currentHp = Math.max(1, state.party[0].currentHp - 6);
                state.battle.display.playerHp = state.party[0].currentHp;
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.animation = null;
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "アイテム" && !button.disabled)""",
            {"timeout": 1200},
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "アイテム").click()"""
        )
        await page.waitForFunction(
            """() => window.MonsterPrototype.runtime.store.snapshot().battle.currentMessage.includes("回復薬を つかった！")""",
            {"timeout": 1200},
        )
        battle_item_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                itemCount: state.inventory.fullHealCount,
                playerHp: state.party[0].currentHp,
                playerMaxHp: state.party[0].maxHp,
                message: state.battle.currentMessage
              };
            }"""
        )
        expect(battle_item_state["itemCount"] == 0, "戦闘中に回復薬数が減っていません。")
        expect(battle_item_state["playerHp"] == battle_item_state["playerMaxHp"], "戦闘中の回復薬でHPが全回復していません。")
        expect("回復薬を つかった！" in battle_item_state["message"], "戦闘中の回復薬メッセージが表示されていません。")
        await page.evaluate(
            """() => {
              if (typeof window.__battleMessageAutoAdvanceMs === "number") {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleMessageAutoAdvanceMs;
              }
            }"""
        )

        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "ボール" && !button.disabled)""",
            {"timeout": 4000},
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")].find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => document.querySelectorAll(".move-button .move-name").length > 0
              && document.querySelectorAll(".move-button .move-meta").length > 0""",
            {"timeout": 4000},
        )
        move_ui_state = await page.evaluate(
            """() => [...document.querySelectorAll(".move-button")].map((button) => ({
              name: button.querySelector(".move-name")?.textContent || "",
              meta: button.querySelector(".move-meta")?.textContent || "",
              label: button.getAttribute("aria-label") || ""
            }))"""
        )
        expect(any(entry["name"] for entry in move_ui_state), "技名が技ボタン内に表示されていません。")
        expect(any("PP" in entry["meta"] for entry in move_ui_state), "技ボタン内にPPが表示されていません。")
        expect(any("ノーマル" in entry["meta"] or "くさ" in entry["meta"] for entry in move_ui_state), "技ボタン内にタイプが表示されていません。")
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")].find((button) => button.textContent === "もどる").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")].some((button) => button.textContent === "ボール")""",
            {"timeout": 4000},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                const enemy = state.battle.enemy;
                const species = runtime.dataRegistry.getSpecies(enemy.speciesId);
                species.catchRate = 255;
                enemy.currentHp = 0;
                state.battle.display.enemyHp = 0;
              });
            }"""
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")].find((button) => button.textContent === "ボール").click()"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.captureBall && state.battle.captureBall.hideEnemy);
            }""",
            {"timeout": 4000},
        )
        capture_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                message: state.battle.currentMessage,
                enemySpeciesId: state.battle.enemy.speciesId,
                captureBall: state.battle.captureBall
              };
            }"""
        )
        expect("モンスターボールを なげた" in capture_state["message"], "捕獲の投球メッセージが表示されていません。")
        expect(capture_state["captureBall"]["hideEnemy"], "捕獲演出中に相手が隠れていません。")
        capture_record_state = await advance_battle_until_modal(page)
        expect(capture_record_state["modalOpen"], "捕獲後の記録ポップが開いていません。")
        expect(capture_record_state["modalTitle"] == "捕獲の記録", "捕獲記録ポップの見出しが想定と違います。")
        expect(
            any("Lv" in line for line in capture_record_state["modalLines"]),
            "捕獲記録ポップにレベルが表示されていません。",
        )
        expect(
            any("タイプ:" in line for line in capture_record_state["modalLines"]),
            "捕獲記録ポップにタイプが表示されていません。",
        )
        expect(
            len(capture_record_state["state"]["collection"]["capturedSpeciesIds"]) >= 1,
            "捕獲記録が内部状態に追加されていません。",
        )
        expect(
            capture_record_state["state"]["party"][0]["speciesId"] == capture_state["enemySpeciesId"],
            "捕獲後に手持ちモンスターが入れ替わっていません。",
        )

        await load_fresh(page, base_url)
        await unlock_preparation_gate(page)

        for key in ROUTE_TO_SQUARE:
            await press(page, key)
        await asyncio.sleep(0.4)
        square_state = await read_field_state(page)
        expect(square_state["caption"] == EXPECTED_SQUARE_CAPTION, "広場へのワープが確認できません。")
        expect(square_state["state"]["field"]["mapId"] == "quiet_square", "広場の内部マップ状態が想定と違います。")

        for key in ROUTE_TO_SQUARE_GUIDE:
            await press(page, key)
        await press(page, "Enter")
        await asyncio.sleep(0.2)
        quest_start_state = await read_field_state(page)
        expect("野生の相手を1体つかまえて" in quest_start_state["message"], "依頼開始メッセージが表示されていません。")
        expect(
            quest_start_state["state"]["progress"]["observationQuestState"] == "active",
            "依頼開始状態が記録されていません。",
        )

        await press(page, "Enter")
        await asyncio.sleep(0.2)
        quest_active_state = await read_field_state(page)
        expect(not quest_active_state["actionNotePresent"], "依頼中も常設の操作説明が残っています。")
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.collection.capturedSpeciesIds = ["dummy_flare"];
            })"""
        )
        await press(page, "Enter")
        await asyncio.sleep(0.2)
        quest_report_state = await read_field_state(page)
        expect("捕まえた相手の記録も確認できました" in quest_report_state["message"], "依頼報告メッセージが表示されていません。")
        expect(
            quest_report_state["state"]["progress"]["observationQuestState"] == "reported",
            "依頼報告完了状態が記録されていません。",
        )

        await press(page, "Enter")
        await asyncio.sleep(0.2)
        quest_done_state = await read_field_state(page)
        expect(not quest_done_state["actionNotePresent"], "依頼完了後も常設の操作説明が残っています。")

        await load_fresh(page, base_url)
        await unlock_preparation_gate(page)

        for key in ROUTE_TO_SQUARE:
            await press(page, key)
        await asyncio.sleep(0.4)

        for key in ROUTE_BACK_TO_ROUTE:
            await press(page, key)
        await asyncio.sleep(0.4)
        route_state = await read_field_state(page)
        expect(route_state["caption"] == EXPECTED_START_CAPTION, "広場から道へのワープが確認できません。")
        expect(route_state["state"]["field"]["mapId"] == "camera_route", "道の内部マップ状態が想定と違います。")

        await page.evaluate(
            """() => {
              window.MonsterPrototype.data.encounters[0].rate = 1;
              window.MonsterPrototype.runtime.store.update((state) => {
                state.field.player.x = 1;
                state.field.player.y = 2;
                state.field.player.fromX = 1;
                state.field.player.fromY = 2;
                state.field.player.toX = 1;
                state.field.player.toY = 2;
                state.field.player.moving = false;
                state.field.player.progress = 0;
                state.field.steps = 0;
                state.field.lastEncounterStep = -99;
                state.field.message = "";
              });
            }"""
        )
        await press(page, "ArrowRight")
        await asyncio.sleep(0.35)
        no_encounter_state = await read_field_state(page)
        expect(
            no_encounter_state["state"]["scene"] == "field"
            and not no_encounter_state["state"]["transition"]["active"],
            "5分経過後も初期ステージで野生遭遇が発生しています。",
        )

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.field.player.x = 24;
              state.field.player.y = 16;
              state.field.player.fromX = 24;
              state.field.player.fromY = 16;
              state.field.player.toX = 24;
              state.field.player.toY = 16;
              state.field.player.direction = "down";
              state.field.player.moving = false;
              state.field.player.progress = 0;
              state.field.message = "";
            })"""
        )

        heals_before_pickup = route_state["state"]["inventory"]["fullHealCount"]
        await press(page, "Enter")
        await asyncio.sleep(0.2)
        pickup_state = await read_field_state(page)
        expect("回復薬を みつけた！" in pickup_state["message"], "拾得物メッセージが表示されていません。")
        expect(
            pickup_state["state"]["inventory"]["fullHealCount"] == heals_before_pickup + 1,
            "拾得物で回復薬数が増えていません。",
        )
        expect(
            "route_ball_pickup" in pickup_state["state"]["progress"]["resolvedEventIds"],
            "拾得済みイベントが記録されていません。",
        )

        await press(page, "Enter")
        await asyncio.sleep(0.2)
        after_close_state = await read_field_state(page)
        expect(not after_close_state["message"], "拾得物メッセージを閉じられていません。")

        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "アイテム")
        await asyncio.sleep(0.2)
        pickup_menu_state = await read_field_state(page)
        expect("回復薬: 1 個" in pickup_menu_state["modalLines"], "アイテム画面の回復薬数が更新されていません。")
        expect("拾ったもの: 1/1" in pickup_menu_state["modalLines"], "アイテム画面の拾得記録が更新されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.party[0].currentHp = Math.max(1, state.party[0].currentHp - 5);
            })"""
        )
        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "アイテム")
        await asyncio.sleep(0.2)
        field_item_state = await read_field_state(page)
        expect("回復薬を使う" in field_item_state["modalButtons"], "フィールドのアイテム画面に回復薬使用ボタンがありません。")
        await click_modal_button(page, "回復薬を使う")
        await asyncio.sleep(0.25)
        after_field_heal_state = await read_field_state(page)
        expect("回復薬を つかった！" in after_field_heal_state["message"], "フィールドで回復薬使用メッセージが表示されていません。")
        expect(
            after_field_heal_state["state"]["inventory"]["fullHealCount"] == 0,
            "フィールドで回復薬を使っても所持数が減っていません。",
        )
        expect(
            after_field_heal_state["state"]["party"][0]["currentHp"]
            == after_field_heal_state["state"]["party"][0]["maxHp"],
            "フィールドで回復薬を使ってもHPが全回復していません。",
        )
        await press(page, "Enter")
        await asyncio.sleep(0.2)

        await press(page, "Enter")
        await asyncio.sleep(0.2)
        repeat_state = await read_field_state(page)
        expect(
            repeat_state["state"]["inventory"]["fullHealCount"] == 0,
            "取得済みの拾得物が再取得されています。",
        )
        expect(not browser_errors, "ブラウザエラーが発生しました: " + " / ".join(browser_errors))

        print("OK: 起動説明、画面右上タイマー、デスクトップクリック移動、ゲート解放、GBA風スマホレイアウト、ゲーム内メニュー、保存再開、移動反応、依頼進行、ワープ、拾得物、野生戦導入、技選択UI、捕獲演出、捕獲記録ポップまで確認しました。")
    finally:
        await browser.close()


def main() -> int:
    try:
        with run_server() as base_url:
            asyncio.run(run_smoke_test(base_url))
    except FileNotFoundError as error:
        print("FAIL:", error)
        print("SMOKE_CHROME_BIN に Chrome 実行ファイルを指定してください。")
        return 1
    except AssertionError as error:
        print("FAIL:", error)
        return 1
    except Exception as error:
        print("FAIL:", error)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
