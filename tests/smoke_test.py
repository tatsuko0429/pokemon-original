#!/usr/bin/env python3
# 2026年4月27日時点の開発者向け保守メモ:
# ブラウザで実際に静的アプリを起動し、初期表示、タイマー、保存復元、移動、メニュー、戦闘、捕獲、依頼をまとめて確認する主テスト。
# UI文言やDOM構造への期待が多いため、見た目だけの変更でも失敗する場合がある。失敗箇所は仕様変更か回帰かを確認してから期待値を更新する。
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
BATTLE_COMMAND_RETURN_TIMEOUT_MS = 9000


def expand_route(*segments):
    route = []
    for key, count in segments:
        route.extend([key] * count)
    return route


ROUTE_TO_SQUARE = expand_route(("ArrowLeft", 10))
# ルート定数はマップ座標と密結合。maps.jsのrows/spawn/warp座標を変えたら最初にここを見直す。
ROUTE_BACK_TO_ROUTE = ["ArrowRight"]
ROUTE_TO_SQUARE_GUIDE = expand_route(("ArrowDown", 1), ("ArrowLeft", 13))
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


async def read_recent_se_ids(page):
    return await page.evaluate(
        """() => window.MonsterPrototype.runtime.audio.getDebugState().recentSeIds || []"""
    )


async def clear_recent_se_ids(page) -> None:
    await page.evaluate(
        """() => window.MonsterPrototype.runtime.audio.clearDebugHistory()"""
    )


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


async def goto_app(page, base_url: str) -> None:
    await page.goto(base_url, {"waitUntil": "domcontentloaded"})
    await wait_for_caption(page, EXPECTED_START_CAPTION)


async def load_fresh(page, base_url: str, accept_intro: bool = True) -> None:
    # localStorageを消してから再読込する。保存再開テストの前提を汚さないため、通常起動確認は必ずここを通す。
    await goto_app(page, base_url)
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
    await goto_app(page, base_url)
    if accept_intro:
        await click_modal_button(page, "はじめる")
        await page.waitForFunction(
            """() => document.querySelector("#modal-root")?.getAttribute("aria-hidden") === "true" """,
            {"timeout": 1200},
        )


async def unlock_preparation_gate(page) -> None:
    # 5分待たずにゲート解放済み状態を作る。app.jsのタイマー仕様を変えた時は、この直接操作が妥当かも確認する。
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
        {"timeout": 14000},
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
          modalPreviewImages: [...document.querySelectorAll("#modal-body .modal-monster-frame img")]
            .map((el) => el.getAttribute("src") || ""),
          dexCards: [...document.querySelectorAll("#modal-body .modal-dex-card")].map((el) => ({
            text: el.textContent.replace(/\\s+/g, " ").trim(),
            unknown: el.classList.contains("is-unknown"),
            captured: el.classList.contains("is-captured"),
            thumbCount: el.querySelectorAll("img, canvas").length
          })),
          fieldMapCellCount: document.querySelectorAll("#modal-body .modal-field-map-cell").length,
          fieldMapPlayerCount: document.querySelectorAll("#modal-body .modal-field-map-cell.is-marker-player").length,
          fieldMapPickupCount: document.querySelectorAll("#modal-body .modal-field-map-cell.is-marker-pickup").length,
          fieldMapWarpCount: document.querySelectorAll("#modal-body .modal-field-map-cell.is-marker-warp").length,
          fieldMapNpcCount: document.querySelectorAll("#modal-body .modal-field-map-cell.is-marker-npc, #modal-body .modal-field-map-cell.is-marker-sign").length,
          fieldMapLegend: [...document.querySelectorAll("#modal-body .modal-field-map-legend-item")]
            .map((el) => el.textContent.replace(/\\s+/g, " ").trim()),
          silhouetteCount: document.querySelectorAll("#modal-body .is-silhouette, #modal-body .modal-dex-card.is-unknown").length,
          modalButtons: [...document.querySelectorAll("#modal-actions button")].map((el) => el.textContent),
          tapRippleCount: document.querySelectorAll(".tap-ripple").length,
          bodyText: document.body.textContent?.replace(/\\s+/g, " ").trim() || "",
          state: window.MonsterPrototype.runtime.store.snapshot()
        })"""
    )


async def place_player_next_to_pickup(page, event_id: str):
    return await page.evaluate(
        """(eventId) => {
          const App = window.MonsterPrototype;
          const runtime = App.runtime;
          let result = null;

          runtime.store.update((state) => {
            const mapDef = runtime.dataRegistry.getMap(state.field.mapId);
            const event = (mapDef.events || []).find((entry) => entry.id === eventId);
            if (!event) {
              throw new Error(`${eventId} が現在マップに見つかりません。`);
            }

            const position = App.core.resolveFieldEventPosition(state, event);
            const resolvedIds = new Set(state.progress.resolvedEventIds || []);
            const occupied = new Set(
              (mapDef.events || [])
                .filter((entry) => {
                  return entry.id !== event.id && entry.trigger === "interact" && !resolvedIds.has(entry.id);
                })
                .map((entry) => {
                  const entryPosition = App.core.resolveFieldEventPosition(state, entry);
                  return `${entryPosition.x},${entryPosition.y}`;
                })
            );
            const tileConfig = App.config.game.fieldTiles;
            const isPassable = (x, y) => {
              const row = mapDef.rows[y];
              const tile = row ? tileConfig[row[x]] : null;
              return Boolean(tile && tile.passable && !occupied.has(`${x},${y}`));
            };
            const neighbors = [
              { x: position.x, y: position.y - 1, direction: "down" },
              { x: position.x - 1, y: position.y, direction: "right" },
              { x: position.x + 1, y: position.y, direction: "left" },
              { x: position.x, y: position.y + 1, direction: "up" },
            ];
            const player = neighbors.find((entry) => isPassable(entry.x, entry.y));
            if (!player) {
              throw new Error(`${eventId} の隣に立てる場所がありません。`);
            }

            state.field.player.x = player.x;
            state.field.player.y = player.y;
            state.field.player.fromX = player.x;
            state.field.player.fromY = player.y;
            state.field.player.toX = player.x;
            state.field.player.toY = player.y;
            state.field.player.direction = player.direction;
            state.field.player.moving = false;
            state.field.player.progress = 0;
            state.field.message = "";
            result = {
              eventId,
              x: position.x,
              y: position.y,
              playerX: player.x,
              playerY: player.y,
              direction: player.direction,
            };
          });

          return result;
        }""",
        event_id,
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


async def click_dex_card(page, label: str) -> None:
    position = await page.evaluate(
        """(label) => {
          const card = [...document.querySelectorAll(".modal-dex-card")]
            .find((entry) => entry.textContent.includes(label));
          if (!card) {
            throw new Error(`${label} 図鑑カードが見つかりません。`);
          }
          const rect = card.getBoundingClientRect();
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
    # この関数はユーザーが触る主要導線を1本で流す。途中の状態注入は、長時間待機や乱数依存を避けるための検査用ショートカット。
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
        try:
            await load_fresh(page, base_url, accept_intro=False)
        except Exception as e:
            print(f"Exception during load_fresh: {e}")
            print(f"Browser errors: {browser_errors}")
            raise

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
        expect(any(entry.startswith("気配") for entry in initial_state["status"]), "拾得物レーダーが状態表示に出ていません。")
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

        critical_damage_state = await page.evaluate(
            """() => {
              const app = window.MonsterPrototype;
              const createRegistry = (critical) => {
                const labels = [];
                const random = {
                  integer(min, max, label) {
                    labels.push(label);
                    return Math.floor((min + max) / 2);
                  },
                  chance(probability, label) {
                    labels.push(label);
                    return critical;
                  },
                  range(min) {
                    return min;
                  },
                  token() {
                    return critical ? "criticaltest" : "normaltest";
                  }
                };
                return {
                  labels,
                  registry: app.core.createDataRegistry(random)
                };
              };
              const normal = createRegistry(false);
              const critical = createRegistry(true);
              const normalResult = normal.registry.computeDamage(
                normal.registry.createMonsterInstance("dummy_flare", 5),
                normal.registry.createMonsterInstance("aribou", 5),
                "punch"
              );
              const criticalResult = critical.registry.computeDamage(
                critical.registry.createMonsterInstance("dummy_flare", 5),
                critical.registry.createMonsterInstance("aribou", 5),
                "punch"
              );
              return {
                multiplier: app.config.game.battle.criticalDamageMultiplier,
                stylePoint: app.config.game.battle.styleCriticalPoint,
                maxComboPoint: app.config.game.battle.styleMaxComboPoint,
                counterPoint: app.config.game.battle.styleCounterPoint,
                dodgeGain: app.config.game.battle.rushDodgeGain,
                nearReadyRatio: app.config.game.battle.rushNearReadyRatio,
                finishPoint: app.config.game.battle.styleFinishPoint,
                finishHpRatio: app.config.game.battle.finishHpRatio,
                normalDamage: normalResult.damage,
                criticalDamage: criticalResult.damage,
                normalCritical: normalResult.isCritical,
                criticalCritical: criticalResult.isCritical,
                normalLabels: normal.labels,
                criticalLabels: critical.labels
              };
            }"""
        )
        expect(abs(critical_damage_state["multiplier"] - 1.5) < 0.0001, "急所ダメージ倍率が想定値ではありません。")
        expect(critical_damage_state["stylePoint"] == 2, "会心のSTYLE加点が想定値ではありません。")
        expect(critical_damage_state["maxComboPoint"] == 2, "最大コンボのSTYLE加点が想定値ではありません。")
        expect(critical_damage_state["counterPoint"] == 1, "反撃チャンスのSTYLE加点が想定値ではありません。")
        expect(critical_damage_state["dodgeGain"] == 24, "回避時のRUSH加算量が想定値ではありません。")
        expect(abs(critical_damage_state["nearReadyRatio"] - 0.7) < 0.0001, "RUSH接近表示のしきい値が想定値ではありません。")
        expect(critical_damage_state["finishPoint"] == 2, "フィニッシュのSTYLE加点が想定値ではありません。")
        expect(abs(critical_damage_state["finishHpRatio"] - 0.25) < 0.0001, "フィニッシュ判定HPが想定値ではありません。")
        expect(not critical_damage_state["normalCritical"], "通常ダメージが急所扱いになっています。")
        expect(critical_damage_state["criticalCritical"], "固定急所判定が急所結果へ反映されていません。")
        expect(
            critical_damage_state["criticalDamage"] > critical_damage_state["normalDamage"],
            "急所ダメージが通常ダメージより大きくなっていません。",
        )
        expect(
            critical_damage_state["normalLabels"] == ["damage_roll", "critical_roll"]
            and critical_damage_state["criticalLabels"] == ["damage_roll", "critical_roll"],
            "急所対応でダメージ乱数の呼び出し順が変わっています。",
        )

        audio_state = await page.evaluate(
            """async () => {
              const app = window.MonsterPrototype;
              const audio = app.runtime.audio;
              audio.playBgm("first_grass");
              audio.playSe("confirm");
              window.dispatchEvent(new Event("pageshow"));
              window.dispatchEvent(new Event("focus"));
              await new Promise((resolve) => setTimeout(resolve, 120));
              return {
                config: {
                  seVolumeMultiplier: app.config.game.audio.seVolumeMultiplier,
                  sePeakBase: app.config.game.audio.sePeakBase,
                  seNoteVolumeFloor: app.config.game.audio.seNoteVolumeFloor,
                  htmlSeVolume: app.config.game.audio.htmlSeVolume,
                  bgmOutputScale: app.config.game.audio.bgmOutputScale,
                  maxActiveSeTones: app.config.game.audio.maxActiveSeTones,
                  firstGrassVolume: app.config.game.audio.bgm.first_grass.volume,
                  fieldVolume: app.config.game.audio.bgm.field.volume,
                  battleVolume: app.config.game.audio.bgm.battle.volume
                },
                debug: audio.getDebugState()
              };
            }"""
        )
        expect(audio_state["config"]["seVolumeMultiplier"] == 28, "SE音量倍率が想定値ではありません。")
        expect(abs(audio_state["config"]["sePeakBase"] - 0.42) < 0.0001, "SEピーク音量が想定値ではありません。")
        expect(abs(audio_state["config"]["seNoteVolumeFloor"] - 0.75) < 0.0001, "SE個別音量下限が想定値ではありません。")
        expect(abs(audio_state["config"]["htmlSeVolume"] - 0.88) < 0.0001, "HTML SE音量が想定値ではありません。")
        expect(abs(audio_state["config"]["bgmOutputScale"] - 0.25) < 0.0001, "BGM最終出力倍率が想定値ではありません。")
        expect(audio_state["config"]["maxActiveSeTones"] == 18, "SE同時発音上限が想定値ではありません。")
        expect(abs(audio_state["config"]["firstGrassVolume"] - 0.004375) < 0.0001, "草むらBGM音量が想定値ではありません。")
        expect(abs(audio_state["config"]["fieldVolume"] - 0.004375) < 0.0001, "合成フィールドBGM音量が想定値ではありません。")
        expect(abs(audio_state["config"]["battleVolume"] - 0.007) < 0.0001, "戦闘BGM音量が想定値ではありません。")
        expect(audio_state["debug"]["unlocked"], "初回操作後に音声アンロック状態へ移行していません。")
        expect(audio_state["debug"]["desiredBgmId"] == "first_grass", "BGMの要求状態が初期マップBGMになっていません。")
        expect(abs(audio_state["debug"]["finalBgmVolume"] - 0.00109375) < 0.0001, "草むらBGMの実効音量が最終倍率込みになっていません。")
        expect("confirm" in audio_state["debug"]["recentSeIds"], "ボタン決定SEが再生履歴に残っていません。")
        expect(
            audio_state["debug"]["activeSeToneCount"] <= audio_state["config"]["maxActiveSeTones"],
            "SE同時発音上限が効いていません。",
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
                state.inventory.masterBallCount = 1;
                state.party = [restoredMonster];
                state.collection.capturedSpeciesIds = ["dummy_flare"];
                state.progress.resolvedEventIds = ["route_ball_pickup"];
                state.progress.observationQuestState = "reported";
              });
              runtime.save.persist(runtime.store.getState());
            }"""
        )
        saved_pickup_placements = await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.snapshot().field.pickupPlacements"""
        )
        await goto_app(page, base_url)
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
        expect(restored_state["state"]["inventory"]["masterBallCount"] == 1, "保存したパーフェクトボール数が復元されていません。")
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
        expect(
            restored_state["state"]["field"]["pickupPlacements"] == saved_pickup_placements,
            "保存した拾得物のランダム配置が復元されていません。",
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
        await goto_app(page, base_url)
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
        expect(new_game_state["state"]["inventory"]["masterBallCount"] == 0, "はじめから選択後にパーフェクトボール数が初期化されていません。")
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
        expect(
            "route_ball_pickup" in new_game_state["state"]["field"]["pickupPlacements"]
            and "route_heal_pickup" in new_game_state["state"]["field"]["pickupPlacements"],
            "はじめから選択後に拾得物のランダム配置が再生成されていません。",
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

        await asyncio.sleep(1.0)
        await press(page, "m")
        await asyncio.sleep(0.4)
        menu_state = await read_field_state(page)
        if not menu_state["modalOpen"]:
            print(f"Browser errors: {browser_errors}")
        expect(menu_state["modalOpen"], "メニューポップが開きません。")
        expect(menu_state["modalTitle"] == "メニュー", "メニューポップの見出しが想定と違います。")
        expect("手持ち" in menu_state["modalButtons"], "メニューに手持ちボタンがありません。")
        expect("アイテム" in menu_state["modalButtons"], "メニューにアイテムボタンがありません。")
        expect("マップ" in menu_state["modalButtons"], "メニューにマップボタンがありません。")
        expect("図鑑" in menu_state["modalButtons"], "メニューに図鑑ボタンがありません。")
        expect("冒険レポート" in menu_state["modalButtons"], "メニューに冒険レポートボタンがありません。")
        expect("やり直す" in menu_state["modalButtons"], "メニューにやり直すボタンがありません。")
        expect("目的" in menu_state["modalButtons"], "メニューに目的ボタンがありません。")
        expect("音設定" in menu_state["modalButtons"], "メニューに音設定ボタンがありません。")
        expect("閉じる" in menu_state["modalButtons"], "メニューに閉じるボタンがありません。")
        await click_modal_button(page, "手持ち")
        await asyncio.sleep(0.2)
        party_state = await read_field_state(page)
        expect(party_state["modalTitle"] == "手持ち", "手持ち画面に切り替わっていません。")
        expect(party_state["modalPreviewCount"] >= 1, "手持ち画面にモンスター画像が表示されていません。")
        expect(
            any("front" in image for image in party_state["modalPreviewImages"]),
            "手持ち画面のモンスター画像が正面表示になっていません。",
        )
        expect(any("HP" in line for line in party_state["modalLines"]), "手持ち画面にHPが表示されていません。")
        expect(any("PP" in line for line in party_state["modalLines"]), "手持ち画面に技PPが表示されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "マップ")
        await asyncio.sleep(0.2)
        field_map_state = await read_field_state(page)
        expect(field_map_state["modalTitle"] == "マップ", "マップ画面に切り替わっていません。")
        expect("現在地: ながめのみち" in field_map_state["modalLines"], "マップ画面に現在地が表示されていません。")
        expect(field_map_state["fieldMapCellCount"] > 0, "マップ画面に地形セルが表示されていません。")
        expect(field_map_state["fieldMapPlayerCount"] == 1, "マップ画面に現在地マーカーが1つ表示されていません。")
        expect(field_map_state["fieldMapPickupCount"] >= 1, "マップ画面に未取得アイテムが表示されていません。")
        expect(field_map_state["fieldMapWarpCount"] >= 1, "マップ画面に出口が表示されていません。")
        expect(field_map_state["fieldMapNpcCount"] >= 1, "マップ画面に人物または看板が表示されていません。")
        expect(any("現在地" in entry for entry in field_map_state["fieldMapLegend"]), "マップ凡例に現在地がありません。")
        expect(any("拾得物" in entry for entry in field_map_state["fieldMapLegend"]), "マップ凡例に拾得物がありません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "目的")
        await asyncio.sleep(0.2)
        objective_state = await read_field_state(page)
        expect(objective_state["modalTitle"] == "目的", "目的画面に切り替わっていません。")
        expect(
            any("草むらで5分準備" in line for line in objective_state["modalLines"]),
            "目的画面に現在の目的が表示されていません。",
        )
        expect("現在地: ながめのみち" in objective_state["modalLines"], "目的画面に現在地が表示されていません。")
        expect(any(line.startswith("近い拾得物:") for line in objective_state["modalLines"]), "目的画面に拾得物レーダーが表示されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "音設定")
        await asyncio.sleep(0.2)
        audio_menu_state = await read_field_state(page)
        expect(audio_menu_state["modalTitle"] == "音設定", "音設定画面に切り替わっていません。")
        expect("BGM: ON" in audio_menu_state["modalLines"], "音設定画面にBGM状態が表示されていません。")
        expect("効果音: ON" in audio_menu_state["modalLines"], "音設定画面に効果音状態が表示されていません。")
        expect(any(line.startswith("音声状態:") for line in audio_menu_state["modalLines"]), "音設定画面に音声状態が表示されていません。")
        expect(any(line.startswith("BGM出力:") for line in audio_menu_state["modalLines"]), "音設定画面にBGM出力値が表示されていません。")
        expect(any(line.startswith("SE経路:") for line in audio_menu_state["modalLines"]), "音設定画面にSE経路が表示されていません。")
        expect(any(line.startswith("直近SE:") for line in audio_menu_state["modalLines"]), "音設定画面に直近SEが表示されていません。")
        expect("BGM: ON" in audio_menu_state["modalButtons"], "音設定画面のBGM切替がON/OFF表記になっていません。")
        expect("SE: ON" in audio_menu_state["modalButtons"], "音設定画面のSE切替がON/OFF表記になっていません。")
        expect("効果音チェック" in audio_menu_state["modalButtons"], "音設定画面に効果音チェックボタンがありません。")
        await clear_recent_se_ids(page)
        await click_modal_button(page, "効果音チェック")
        await asyncio.sleep(0.35)
        audio_test_ids = await read_recent_se_ids(page)
        expect(
            all(sound_id in audio_test_ids for sound_id in ("confirm", "hit", "exp")),
            "音設定のSE診断音が一通り再生されていません。",
        )
        await click_modal_button(page, "BGM: ON")
        await asyncio.sleep(0.2)
        bgm_off_state = await read_field_state(page)
        bgm_off_debug = await page.evaluate(
            """() => window.MonsterPrototype.runtime.audio.getDebugState()"""
        )
        expect("BGM: OFF" in bgm_off_state["modalLines"], "BGM OFF状態が音設定画面に反映されていません。")
        expect("BGM: OFF" in bgm_off_state["modalButtons"], "BGM OFF状態がボタンへ反映されていません。")
        expect(bgm_off_debug["bgmEnabled"] is False, "BGM OFF状態が音声マネージャに反映されていません。")
        expect(bgm_off_debug["currentBgmId"] == "", "BGM OFFでも現在BGMが再生状態として残っています。")
        expect(bgm_off_debug["effectiveBgmVolume"] == 0, "BGM OFFでも有効音量が0になっていません。")
        await click_modal_button(page, "BGM: OFF")
        await asyncio.sleep(0.2)
        bgm_on_debug = await page.evaluate(
            """() => window.MonsterPrototype.runtime.audio.getDebugState()"""
        )
        expect(bgm_on_debug["bgmEnabled"] is True, "BGM ON状態が音声マネージャに戻っていません。")
        await click_modal_button(page, "SE: ON")
        await asyncio.sleep(0.2)
        se_off_state = await read_field_state(page)
        se_off_debug = await page.evaluate(
            """() => window.MonsterPrototype.runtime.audio.getDebugState()"""
        )
        expect("効果音: OFF" in se_off_state["modalLines"], "SE OFF状態が音設定画面に反映されていません。")
        expect("SE: OFF" in se_off_state["modalButtons"], "SE OFF状態がボタンへ反映されていません。")
        expect(se_off_debug["seEnabled"] is False, "SE OFF状態が音声マネージャに反映されていません。")
        expect(se_off_debug["activeSeToneCount"] == 0, "SE OFFでもWebAudio SEが残っています。")
        expect(se_off_debug["activeHtmlSeCount"] == 0, "SE OFFでもHTML SEが残っています。")
        await click_modal_button(page, "SE: OFF")
        await asyncio.sleep(0.2)
        se_on_debug = await page.evaluate(
            """() => window.MonsterPrototype.runtime.audio.getDebugState()"""
        )
        expect(se_on_debug["seEnabled"] is True, "SE ON状態が音声マネージャに戻っていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "アイテム")
        await asyncio.sleep(0.2)
        inventory_state = await read_field_state(page)
        expect(inventory_state["modalTitle"] == "アイテム", "アイテム画面に切り替わっていません。")
        expect("キャプチャーボール: 使い放題" in inventory_state["modalLines"], "アイテム画面にボール使い放題の説明が表示されていません。")
        expect("パーフェクトボール: 0 個" in inventory_state["modalLines"], "アイテム画面にパーフェクトボール数が表示されていません。")
        expect("回復薬: 0 個" in inventory_state["modalLines"], "アイテム画面に回復薬数が表示されていません。")
        expect("拾ったもの: 0/2" in inventory_state["modalLines"], "アイテム画面に拾得記録が表示されていません。")
        expect("回復薬を使う" not in inventory_state["modalButtons"], "回復薬がないのに使用ボタンが表示されています。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "図鑑")
        await asyncio.sleep(0.2)
        observation_state = await read_field_state(page)
        expect(observation_state["modalTitle"] == "図鑑", "図鑑画面に切り替わっていません。")
        expect("記録 0/8" in observation_state["modalLines"], "図鑑の記録数が表示されていません。")
        expect(len(observation_state["dexCards"]) == 8, "未捕獲でも全モンスターが図鑑に並んでいません。")
        expect(
            all(card["unknown"] and card["thumbCount"] >= 1 for card in observation_state["dexCards"]),
            "未捕獲モンスターがシルエット付きカードになっていません。",
        )
        expect("ダンゴマル" not in observation_state["modalBodyText"], "未捕獲の正式名が図鑑一覧に表示されています。")
        await click_dex_card(page, "No.04")
        await asyncio.sleep(0.2)
        unknown_detail_state = await read_field_state(page)
        expect(unknown_detail_state["modalTitle"] == "No.04 ？？？", "未捕獲詳細が未知表示になっていません。")
        expect(unknown_detail_state["modalPreviewCount"] >= 1, "未捕獲詳細にシルエット画像が表示されていません。")
        expect(unknown_detail_state["silhouetteCount"] >= 1, "未捕獲詳細にシルエット指定がありません。")
        expect(
            not any("タイプ:" in line or "初期技:" in line for line in unknown_detail_state["modalLines"]),
            "未捕獲詳細にタイプや技が表示されています。",
        )
        await click_modal_button(page, "図鑑へ戻る")
        await asyncio.sleep(0.2)
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
        expect("記録 1/8" in recorded_observation_state["modalLines"], "捕獲済み図鑑の記録数が更新されていません。")
        expect(len(recorded_observation_state["dexCards"]) == 8, "捕獲後も全モンスターが図鑑に並んでいません。")
        expect(
            any(card["captured"] and "ダンゴマル" in card["text"] for card in recorded_observation_state["dexCards"]),
            "捕獲済みモンスターが通常カードとして表示されていません。",
        )
        expect(
            any(card["unknown"] for card in recorded_observation_state["dexCards"]),
            "未捕獲モンスターのシルエットカードが残っていません。",
        )
        await click_dex_card(page, "ダンゴマル")
        await asyncio.sleep(0.2)
        observation_detail_state = await read_field_state(page)
        expect(observation_detail_state["modalTitle"] == "ダンゴマル", "図鑑詳細画面が開いていません。")
        expect(observation_detail_state["modalPreviewCount"] >= 1, "図鑑詳細にモンスター画像が表示されていません。")
        expect(observation_detail_state["silhouetteCount"] == 0, "捕獲済み図鑑詳細がシルエットのままです。")
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
              battleMessageTag: document.querySelector(".battle-message-tag")?.textContent || "",
              battleRushText: document.querySelector(".battle-rush-meter")?.textContent || "",
              battleRushReady: document.querySelector(".battle-rush-meter")?.classList.contains("is-ready") || false,
              battleRushNear: document.querySelector(".battle-rush-meter")?.classList.contains("is-near-ready") || false,
              battleRushAria: document.querySelector(".battle-rush-meter")?.getAttribute("aria-label") || "",
              battleFightHint: [...document.querySelectorAll("#action-panel button")]
                .find((button) => button.textContent === "たたかう")?.getAttribute("data-command-hint") || "",
              battleFightAria: [...document.querySelectorAll("#action-panel button")]
                .find((button) => button.textContent === "たたかう")?.getAttribute("aria-label") || "",
              battleComboText: document.querySelector(".battle-combo-badge")?.textContent || "",
              battleComboAria: document.querySelector(".battle-combo-badge")?.getAttribute("aria-label") || "",
              battleStyleText: document.querySelector(".battle-style-badge")?.textContent || "",
              battleStyleAria: document.querySelector(".battle-style-badge")?.getAttribute("aria-label") || "",
              battleCounterText: document.querySelector(".battle-counter-badge")?.textContent || "",
              battleCounterAria: document.querySelector(".battle-counter-badge")?.getAttribute("aria-label") || "",
              battleEnemyIntentText: document.querySelector(".battle-enemy-intent")?.textContent || "",
              battleEnemyIntentAria: document.querySelector(".battle-enemy-intent")?.getAttribute("aria-label") || "",
              enemyFinishCue: document.querySelector(".battle-card.is-enemy .battle-finish-cue")?.textContent || "",
              playerDangerCue: document.querySelector(".battle-card.is-player .battle-danger-cue")?.textContent || "",
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
        expect(battle_state["battleMessageTag"] in ("EVENT", "WAIT", "COMMAND"), "バトルメッセージ枠に状態タグが表示されていません。")
        expect("CHANCE" in battle_state["battleRushText"], "バトルのチャンスゲージが表示されていません。")
        expect(not battle_state["battleRushReady"], "戦闘開始直後からチャンスゲージがREADYになっています。")
        expect(not battle_state["battleRushNear"], "戦闘開始直後からRUSH接近表示になっています。")
        expect("チャンス" in battle_state["battleRushAria"], "チャンスゲージのアクセシブルラベルがありません。")
        expect(battle_state["battleFightHint"] == "技", "戦闘開始直後のたたかう補助ラベルが通常状態ではありません。")
        expect("技を選ぶ" in battle_state["battleFightAria"], "戦闘開始直後のたたかうアクセシブルラベルが通常状態ではありません。")
        expect("CHAIN" in battle_state["battleComboText"], "バトルのコンボ表示が出ていません。")
        expect("コンボ 0" in battle_state["battleComboAria"], "コンボ表示の初期状態が0になっていません。")
        expect("STYLE C" in battle_state["battleStyleText"], "バトルのSTYLE表示が出ていません。")
        expect("0pt" in battle_state["battleStyleText"], "STYLE表示の初期ポイントが0になっていません。")
        expect("次Bまで3" in battle_state["battleStyleText"], "STYLE表示に次ランクまでの残りポイントが出ていません。")
        expect("EXP+" not in battle_state["battleStyleText"], "STYLE初期状態から経験値ボーナス予告が表示されています。")
        expect("スタイル C 0ポイント" in battle_state["battleStyleAria"], "STYLE表示のアクセシブルラベルがありません。")
        expect("次のBまであと3ポイント" in battle_state["battleStyleAria"], "STYLE表示のアクセシブルラベルに次ランク情報がありません。")
        expect(not battle_state["battleCounterText"], "戦闘開始直後からCOUNTER表示が出ています。")
        expect(not battle_state["battleCounterAria"], "戦闘開始直後からCOUNTERアクセシブルラベルが出ています。")
        expect("NEXT" in battle_state["battleEnemyIntentText"], "相手の気配表示が出ていません。")
        expect("相手の気配" in battle_state["battleEnemyIntentAria"], "相手の気配表示のアクセシブルラベルがありません。")
        expect(not battle_state["enemyFinishCue"], "戦闘開始直後からFINISH表示が出ています。")
        expect(not battle_state["playerDangerCue"], "戦闘開始直後からDANGER表示が出ています。")
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
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.battle.rush = { gauge: 72, ready: false, lastDelta: 0 };
              state.battle.counterReady = false;
              state.battle.phase = "command";
              state.battle.currentMessage = "";
              state.battle.animation = null;
            })"""
        )
        await page.waitForFunction(
            """() => document.querySelector(".battle-rush-meter.is-near-ready")
              && [...document.querySelectorAll("#action-panel button")]
                .some((button) => button.textContent === "たたかう" && button.getAttribute("data-command-hint") === "あと少し")""",
            {"timeout": 1200},
        )
        near_rush_state = await page.evaluate(
            """() => {
              const meter = document.querySelector(".battle-rush-meter");
              const fight = [...document.querySelectorAll("#action-panel button")]
                .find((button) => button.textContent === "たたかう");
              return {
                text: meter?.textContent || "",
                aria: meter?.getAttribute("aria-label") || "",
                ready: meter?.classList.contains("is-ready") || false,
                near: meter?.classList.contains("is-near-ready") || false,
                hint: fight?.getAttribute("data-command-hint") || "",
                fightAria: fight?.getAttribute("aria-label") || ""
              };
            }"""
        )
        expect(near_rush_state["near"], "RUSHが7割を超えても接近表示になっていません。")
        expect(not near_rush_state["ready"], "RUSH接近表示がREADY扱いになっています。")
        expect("あと28" in near_rush_state["text"], "RUSH接近表示に残り量が表示されていません。")
        expect("あと28" in near_rush_state["aria"], "RUSH接近表示のアクセシブルラベルに残り量がありません。")
        expect(near_rush_state["hint"] == "あと少し", "RUSH接近時のたたかう補助ラベルが表示されていません。")
        expect("あと少し" in near_rush_state["fightAria"], "RUSH接近時のたたかうアクセシブルラベルがありません。")

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
                state.inventory.masterBallCount = 1;
                state.party[0].currentHp = Math.max(1, state.party[0].currentHp - 6);
                state.battle.display.playerHp = state.party[0].currentHp;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
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
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.battle.phase = "message";
                state.battle.currentMessage = "会心表示確認";
                state.battle.animation = {
                  kind: "damage",
                  target: "enemy",
                  fromHp: 24,
                  toHp: 8,
                  moveType: "ノーマル",
                  typeMultiplier: 1,
                  isCritical: true,
                  elapsedMs: 0,
                  durationMs: 520
                };
                state.battle.display.enemyHp = 24;
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".battle-feedback-badge.is-critical")]
              .some((badge) => badge.textContent.includes("-16") && badge.textContent.includes("CRIT"))""",
            {"timeout": 1200},
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && !state.battle.animation);
            }""",
            {"timeout": 4000},
        )
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.battle.phase = "command";
              state.battle.currentMessage = "";
              state.battle.display.enemyHp = state.battle.enemy.currentHp;
            })"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "アイテム" && !button.disabled)""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "アイテム").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "回復薬" && !button.disabled)""",
            {"timeout": 1200},
        )
        item_tag = await page.evaluate(
            """() => document.querySelector(".battle-message-tag")?.textContent || "" """
        )
        expect(item_tag == "ITEM", "戦闘アイテム選択中のメッセージタグがITEMになっていません。")
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "回復薬").click()"""
        )
        await page.waitForFunction(
            """() => window.MonsterPrototype.runtime.store.snapshot().battle.currentMessage.includes("回復薬を つかった！")""",
            {"timeout": 1200},
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".battle-feedback-badge")]
              .some((badge) => badge.textContent.includes("HEAL") && badge.textContent.includes("+"))""",
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
        heal_audio_ids = await read_recent_se_ids(page)
        expect("confirm" in heal_audio_ids, "戦闘アイテム操作のボタン決定SEが再生されていません。")
        expect("heal" in heal_audio_ids, "戦闘中の回復薬SEが再生されていません。")
        await page.evaluate(
            """() => {
              if (typeof window.__battleMessageAutoAdvanceMs === "number") {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleMessageAutoAdvanceMs;
              }
            }"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.currentMessage.includes("見切った"));
            }""",
            {"timeout": 7000},
        )
        dodge_rush_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                message: state.battle.currentMessage,
                rush: state.battle.rush,
                counterReady: Boolean(state.battle.counterReady),
                dodgeGain: window.MonsterPrototype.config.game.battle.rushDodgeGain,
                rushText: document.querySelector(".battle-rush-meter")?.textContent || "",
                rushDeltaText: document.querySelector(".battle-rush-delta")?.textContent || "",
                rushAria: document.querySelector(".battle-rush-meter")?.getAttribute("aria-label") || "",
                counterText: document.querySelector(".battle-counter-badge")?.textContent || "",
                counterAria: document.querySelector(".battle-counter-badge")?.getAttribute("aria-label") || ""
              };
            }"""
        )
        expect("見切った" in dodge_rush_state["message"], "敵攻撃回避時のRUSH予兆メッセージが表示されていません。")
        expect(dodge_rush_state["rush"]["gauge"] == dodge_rush_state["dodgeGain"], "敵攻撃回避時にRUSHゲージが加算されていません。")
        expect(dodge_rush_state["rush"]["lastDelta"] == dodge_rush_state["dodgeGain"], "敵攻撃回避時のRUSH増分が記録されていません。")
        expect(not dodge_rush_state["rush"]["ready"], "1回の回避でRUSH READYになっています。")
        expect(dodge_rush_state["counterReady"], "敵攻撃回避後に反撃チャンスが準備されていません。")
        expect("COUNTER" in dodge_rush_state["counterText"] and "待機" in dodge_rush_state["counterText"], "敵攻撃回避後にCOUNTER待機表示が出ていません。")
        expect("反撃チャンス" in dodge_rush_state["counterAria"], "COUNTER待機表示のアクセシブルラベルがありません。")
        expect(str(dodge_rush_state["dodgeGain"]) in dodge_rush_state["rushText"], "RUSHメーターに回避加算後の値が表示されていません。")
        expect(dodge_rush_state["rushDeltaText"] == f"+{dodge_rush_state['dodgeGain']}", "RUSHメーターに直近増分が表示されていません。")

        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "ボール" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        counter_command_hint = await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう")?.getAttribute("data-command-hint") || "" """
        )
        expect(counter_command_hint == "COUNTER", "反撃チャンス中のたたかうボタンにCOUNTERヒントが表示されていません。")
        no_direct_master_button = await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .every((button) => button.textContent !== "Pボール")"""
        )
        expect(
            no_direct_master_button,
            "パーフェクトボールがトップレベルの戦闘コマンドとして表示されています。",
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")].find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => document.querySelectorAll(".move-button .move-name").length > 0
              && document.querySelectorAll(".move-button .move-meta").length > 0
              && document.querySelectorAll(".move-button .move-advice-chip").length > 0""",
            {"timeout": 4000},
        )
        move_ui_state = await page.evaluate(
            """() => [...document.querySelectorAll(".move-button")].map((button) => ({
              name: button.querySelector(".move-name")?.textContent || "",
              meta: button.querySelector(".move-meta")?.textContent || "",
              advice: [...button.querySelectorAll(".move-advice-chip")].map((chip) => chip.textContent),
              label: button.getAttribute("aria-label") || ""
            }))"""
        )
        move_pick_message_state = await page.evaluate(
            """() => {
              const recommended = document.querySelector(".move-button.is-recommended:not(:disabled)");
              return {
                message: document.querySelector(".battle-message-text")?.textContent || "",
                recommendedName: recommended?.querySelector(".move-name")?.textContent || "",
                recommendedStyle: recommended?.querySelector(".move-style-preview")?.textContent || ""
              };
            }"""
        )
        expect(any(entry["name"] for entry in move_ui_state), "技名が技ボタン内に表示されていません。")
        expect(any("PP" in entry["meta"] for entry in move_ui_state), "技ボタン内にPPが表示されていません。")
        expect(any("ノーマル" in entry["meta"] or "くさ" in entry["meta"] for entry in move_ui_state), "技ボタン内にタイプが表示されていません。")
        advice_labels = [label for entry in move_ui_state for label in entry["advice"]]
        expect("補助" in advice_labels, "補助技の判断チップが表示されていません。")
        expect("高火力" in advice_labels, "高火力技の判断チップが表示されていません。")
        expect(advice_labels.count("PICK") == 1, "おすすめ技のPICKチップが1つだけ表示されていません。")
        expect("COUNTER" in advice_labels, "反撃チャンス中の技にCOUNTERチップが表示されていません。")
        expect(
            any("PICK" in entry["label"] for entry in move_ui_state),
            "PICKチップが技ボタンのラベルに反映されていません。",
        )
        expect(
            any("COUNTER" in entry["label"] for entry in move_ui_state),
            "COUNTERチップが技ボタンのラベルに反映されていません。",
        )
        expect("PICK:" in move_pick_message_state["message"], "技選択中におすすめ技の短い案内が表示されていません。")
        expect(
            move_pick_message_state["recommendedName"]
            and move_pick_message_state["recommendedName"] in move_pick_message_state["message"],
            "おすすめ技名が技選択メッセージに表示されていません。",
        )
        expect(
            any(reason in move_pick_message_state["message"] for reason in ("CHANCE", "反撃", "CHAIN", "弱点", "押し切り", "高火力", "補助")),
            "おすすめ技の理由が技選択メッセージに表示されていません。",
        )
        expect(
            any(label in move_pick_message_state["message"] for label in ("決定打", "大ダメ", "安定", "標準", "軽め", "補助")),
            "おすすめ技の手応えが技選択メッセージに表示されていません。",
        )
        if move_pick_message_state["recommendedStyle"]:
            expect(
                move_pick_message_state["recommendedStyle"] in move_pick_message_state["message"],
                "おすすめ技のSTYLE候補が技選択メッセージに表示されていません。",
            )
        expect("CHANCE" not in advice_labels, "準備前の技にCHANCEチップが表示されています。")
        move_tag = await page.evaluate(
            """() => document.querySelector(".battle-message-tag")?.textContent || "" """
        )
        expect(move_tag == "MOVE", "技選択中のメッセージタグがMOVEになっていません。")
        move_button_center = await page.evaluate(
            """() => {
              const button = document.querySelector(".move-button.is-recommended:not(:disabled)");
              if (!button) {
                throw new Error("おすすめ技ボタンが見つかりません。");
              }
              const rect = button.getBoundingClientRect();
              return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              };
            }"""
        )
        await page.mouse.move(move_button_center["x"], move_button_center["y"])
        await page.mouse.down()
        await asyncio.sleep(0.68)
        move_hold_state = await page.evaluate(
            """() => {
              const button = document.querySelector(".move-button.is-hold-preview");
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                previewed: Boolean(button),
                tipText: button?.querySelector(".move-hold-tip")?.textContent || "",
                label: button?.getAttribute("aria-label") || "",
                phase: state.battle?.phase || ""
              };
            }"""
        )
        expect(move_hold_state["previewed"], "技長押しで説明チップが表示されていません。")
        expect("PP" in move_hold_state["tipText"], "技長押し説明にPP情報が表示されていません。")
        expect(
            "威力" in move_hold_state["tipText"] or "補助" in move_hold_state["tipText"],
            "技長押し説明に効果情報が表示されていません。",
        )
        expect("手応え" in move_hold_state["tipText"], "技長押し説明に手応え情報が表示されていません。")
        expect("おすすめ:" in move_hold_state["tipText"], "おすすめ技の長押し説明にPICK理由が表示されていません。")
        expect("おすすめ理由" in move_hold_state["label"], "おすすめ技のラベルにPICK理由が反映されていません。")
        expect(move_hold_state["phase"] == "moveSelect", "技長押し中に技選択フェーズから外れています。")
        await page.mouse.up()
        await asyncio.sleep(0.2)
        move_hold_release_phase = await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.snapshot().battle?.phase || "" """
        )
        expect(move_hold_release_phase == "moveSelect", "技長押しを離しただけで技が発動しています。")
        await page.evaluate(
            """() => {
              window.__battleSoundMessageAutoAdvanceMs = window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 99999;
            }"""
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll(".move-button")]
                .find((candidate) => !candidate.disabled);
              if (!button) {
                throw new Error("使用可能な技ボタンが見つかりません。");
              }
              button.click();
            }"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.phase === "message" && state.battle.currentMessage.includes("の "));
            }""",
            {"timeout": 4000},
        )
        move_audio_ids = await read_recent_se_ids(page)
        expect(
            any(sound_id in move_audio_ids for sound_id in ("move", "grass_move", "water_move", "ice", "steel_move", "fire_move")),
            "技を出すSEが再生されていません。",
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              if (typeof window.__battleSoundMessageAutoAdvanceMs === "number") {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleSoundMessageAutoAdvanceMs;
              }
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "たたかう" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleCounterMessageAutoAdvance = {
                ms: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs,
                perChar: window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs,
                maxExtra: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs
              };
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 90;
              window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = 0;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = 0;
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = true;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, counters: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
                state.battle.enemy.currentHp = 1;
                state.battle.display.enemyHp = 1;
                state.party[0].moveIds = ["body_tap", "ice_wall"];
                state.party[0].currentPp = state.party[0].moveIds
                  .map((moveId) => runtime.dataRegistry.getMove(moveId).pp);
              });
            }"""
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".move-button")]
              .some((button) => button.textContent.includes("たいあたり")
                && button.querySelector(".move-advice-chip.is-counter")
                && !button.disabled)""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => [...document.querySelectorAll(".move-button")]
              .find((button) => button.textContent.includes("たいあたり")).click()"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.currentMessage.includes("カウンターチャンス"));
            }""",
            {"timeout": 4000},
        )
        counter_fire_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                message: state.battle.currentMessage,
                counterReady: Boolean(state.battle.counterReady),
                style: state.battle.style,
                counterPoint: window.MonsterPrototype.config.game.battle.styleCounterPoint,
                styleText: document.querySelector(".battle-style-badge")?.textContent || "",
                styleAria: document.querySelector(".battle-style-badge")?.getAttribute("aria-label") || "",
                enemyHp: state.battle.enemy.currentHp,
                enemyMaxHp: state.battle.enemy.maxHp
              };
            }"""
        )
        expect("カウンターチャンス" in counter_fire_state["message"], "反撃チャンス発動メッセージが表示されていません。")
        expect(not counter_fire_state["counterReady"], "反撃チャンスが攻撃後も消費されていません。")
        expect(counter_fire_state["style"]["counters"] == 1, "反撃チャンス回数がSTYLE状態へ記録されていません。")
        expect(
            counter_fire_state["style"]["points"] >= counter_fire_state["counterPoint"],
            "反撃チャンスのSTYLE点が加算されていません。",
        )
        expect("STYLE" in counter_fire_state["styleText"] and "pt" in counter_fire_state["styleText"], "反撃チャンス後のSTYLE表示が更新されていません。")
        expect("次" in counter_fire_state["styleText"] or "MAX" in counter_fire_state["styleText"], "反撃チャンス後のSTYLE表示に次ランク情報がありません。")
        expect("EXP+" in counter_fire_state["styleText"], "STYLE加点後の経験値ボーナス予告が表示されていません。")
        expect("経験値ボーナス" in counter_fire_state["styleAria"], "STYLE加点後の経験値ボーナスがアクセシブルラベルにありません。")
        expect("直近+" in counter_fire_state["styleAria"], "反撃チャンス後のSTYLEアクセシブルラベルに直近加点がありません。")
        expect(counter_fire_state["enemyHp"] < counter_fire_state["enemyMaxHp"], "反撃チャンス攻撃で相手HPが減っていません。")
        counter_audio_ids = await read_recent_se_ids(page)
        expect("combo" in counter_audio_ids, "反撃チャンスSEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              if (window.__battleCounterMessageAutoAdvance) {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleCounterMessageAutoAdvance.ms;
                window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = window.__battleCounterMessageAutoAdvance.perChar;
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = window.__battleCounterMessageAutoAdvance.maxExtra;
              }
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "たたかう" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleComboMessageAutoAdvance = {
                ms: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs,
                perChar: window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs,
                maxExtra: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs
              };
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 240;
              window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = 0;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = 0;
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 1, lastDelta: 1, lastMultiplier: 1 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
                state.battle.enemy.currentHp = state.battle.enemy.maxHp;
                state.battle.display.enemyHp = state.battle.enemy.maxHp;
                state.party[0].moveIds = ["body_tap", "ice_wall"];
                state.party[0].currentPp = state.party[0].moveIds
                  .map((moveId) => runtime.dataRegistry.getMove(moveId).pp);
              });
            }"""
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".move-button")]
              .some((button) => button.textContent.includes("たいあたり") && !button.disabled)""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => [...document.querySelectorAll(".move-button")]
              .find((button) => button.textContent.includes("たいあたり")).click()"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.currentMessage.includes("コンボ 2"));
            }""",
            {"timeout": 4000},
        )
        combo_fire_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                message: state.battle.currentMessage,
                combo: state.battle.combo,
                comboText: document.querySelector(".battle-combo-badge")?.textContent || "",
                enemyHp: state.battle.enemy.currentHp,
                enemyMaxHp: state.battle.enemy.maxHp
              };
            }"""
        )
        expect("コンボ 2" in combo_fire_state["message"], "コンボ発動メッセージが表示されていません。")
        expect(combo_fire_state["combo"]["count"] == 2, "コンボ数が2へ進んでいません。")
        expect(combo_fire_state["combo"]["lastMultiplier"] > 1, "コンボ倍率が反映されていません。")
        expect("CHAIN" in combo_fire_state["comboText"] and "x2" in combo_fire_state["comboText"], "コンボ表示がx2になっていません。")
        expect(combo_fire_state["enemyHp"] < combo_fire_state["enemyMaxHp"], "コンボ攻撃で相手HPが減っていません。")
        combo_audio_ids = await read_recent_se_ids(page)
        expect("combo" in combo_audio_ids, "コンボSEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 3, lastDelta: 1, lastMultiplier: 1.16 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
                state.battle.enemy.currentHp = state.battle.enemy.maxHp;
                state.battle.display.enemyHp = state.battle.enemy.maxHp;
                state.party[0].moveIds = ["body_tap", "ice_wall"];
                state.party[0].currentPp = state.party[0].moveIds
                  .map((moveId) => runtime.dataRegistry.getMove(moveId).pp);
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "たたかう" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".move-button")]
              .some((button) => button.textContent.includes("たいあたり") && !button.disabled)""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => [...document.querySelectorAll(".move-button")]
              .find((button) => button.textContent.includes("たいあたり")).click()"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.currentMessage.includes("MAXコンボ 4"));
            }""",
            {"timeout": 4000},
        )
        max_combo_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              const badge = document.querySelector(".battle-combo-badge");
              return {
                message: state.battle.currentMessage,
                combo: state.battle.combo,
                style: state.battle.style,
                comboText: badge?.textContent || "",
                comboAria: badge?.getAttribute("aria-label") || "",
                comboIsMax: badge?.classList.contains("is-max") || false,
                styleText: document.querySelector(".battle-style-badge")?.textContent || "",
                pendingMessages: (state.battle.steps || []).map((step) => step.text || "").join("\\n"),
                pendingSounds: (state.battle.steps || []).map((step) => step.soundId || ""),
                enemyHp: state.battle.enemy.currentHp,
                enemyMaxHp: state.battle.enemy.maxHp
              };
            }"""
        )
        expect("MAXコンボ 4" in max_combo_state["message"], "最大コンボ到達メッセージが表示されていません。")
        expect(max_combo_state["combo"]["count"] == 4, "コンボ数が最大値の4へ進んでいません。")
        expect(max_combo_state["comboIsMax"], "最大コンボ表示の強調クラスが付いていません。")
        expect("最大コンボ" in max_combo_state["comboAria"], "最大コンボ表示のアクセシブルラベルがありません。")
        expect(max_combo_state["style"]["maxCombos"] == 1, "最大コンボ回数がSTYLE状態へ記録されていません。")
        expect(max_combo_state["style"]["points"] >= 3, "最大コンボのSTYLE加点が反映されていません。")
        expect("STYLE" in max_combo_state["styleText"] and "pt" in max_combo_state["styleText"], "最大コンボ後のSTYLE表示が更新されていません。")
        expect(
            "STYLE B ランクアップ" in max_combo_state["message"] or "STYLE B ランクアップ" in max_combo_state["pendingMessages"],
            "STYLEランクアップの戦闘メッセージがキューに追加されていません。",
        )
        expect("style" in max_combo_state["pendingSounds"], "STYLEランクアップSEがキューに追加されていません。")
        max_combo_audio_ids = await read_recent_se_ids(page)
        expect("combo" in max_combo_audio_ids, "最大コンボSEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              if (window.__battleComboMessageAutoAdvance) {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleComboMessageAutoAdvance.ms;
                window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = window.__battleComboMessageAutoAdvance.perChar;
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = window.__battleComboMessageAutoAdvance.maxExtra;
              }
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "たたかう" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleRushMessageAutoAdvance = {
                ms: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs,
                perChar: window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs,
                maxExtra: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs
              };
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 90;
              window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = 0;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = 0;
              runtime.store.update((state) => {
                const maxGauge = window.MonsterPrototype.config.game.battle.rushGaugeMax || 100;
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: maxGauge, ready: true, lastDelta: maxGauge };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
                state.battle.enemy.currentHp = state.battle.enemy.maxHp;
                state.battle.display.enemyHp = state.battle.enemy.maxHp;
                state.party[0].moveIds.forEach((moveId, index) => {
                  if (moveId === "chilly_attack") {
                    state.party[0].currentPp[index] = runtime.dataRegistry.getMove(moveId).pp;
                  }
                });
              });
            }"""
        )
        await page.waitForFunction(
            """() => document.querySelector(".battle-rush-meter.is-ready")
              && [...document.querySelectorAll("#action-panel button")]
                .some((button) => button.textContent === "たたかう" && button.getAttribute("data-command-hint") === "CHANCE")""",
            {"timeout": 1200},
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".move-button .move-advice-chip.is-rush")]
              .some((chip) => chip.textContent === "CHANCE")""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll(".move-button")]
                .find((candidate) => candidate.querySelector(".move-advice-chip.is-rush"));
              if (!button) {
                throw new Error("チャンスラッシュ確認用の攻撃技が見つかりません。");
              }
              button.click();
            }"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && state.battle.currentMessage.includes("チャンスラッシュ"));
            }""",
            {"timeout": 4000},
        )
        rush_fire_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return {
                message: state.battle.currentMessage,
                rush: state.battle.rush,
                dodgeGain: window.MonsterPrototype.config.game.battle.rushDodgeGain,
                enemyHp: state.battle.enemy.currentHp,
                enemyMaxHp: state.battle.enemy.maxHp
              };
            }"""
        )
        expect("チャンスラッシュ" in rush_fire_state["message"], "チャンスラッシュ発動メッセージが表示されていません。")
        expect(rush_fire_state["rush"]["gauge"] <= rush_fire_state["dodgeGain"], "チャンスラッシュ発動後にゲージが消費されていません。")
        expect(not rush_fire_state["rush"]["ready"], "チャンスラッシュ発動後もREADY状態が残っています。")
        expect(rush_fire_state["enemyHp"] < rush_fire_state["enemyMaxHp"], "チャンスラッシュ攻撃で相手HPが減っていません。")
        rush_audio_ids = await read_recent_se_ids(page)
        expect("rush" in rush_audio_ids, "チャンスラッシュSEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              if (window.__battleRushMessageAutoAdvance) {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleRushMessageAutoAdvance.ms;
                window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = window.__battleRushMessageAutoAdvance.perChar;
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = window.__battleRushMessageAutoAdvance.maxExtra;
              }
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "たたかう" && !button.disabled)""",
            {"timeout": BATTLE_COMMAND_RETURN_TIMEOUT_MS},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleStyleMessageAutoAdvance = {
                ms: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs,
                perChar: window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs,
                maxExtra: window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs
              };
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = 90;
              window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = 0;
              window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = 0;
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 1, lastDelta: 1, lastMultiplier: 1 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
                state.battle.enemy.currentHp = 1;
                state.battle.display.enemyHp = 1;
                state.party[0].currentHp = 1;
                state.battle.display.playerHp = 1;
                state.party[0].moveIds = ["punch", "ice_wall"];
                state.party[0].currentPp = state.party[0].moveIds
                  .map((moveId) => runtime.dataRegistry.getMove(moveId).pp);
              });
            }"""
        )
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "たたかう").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".move-button")]
              .some((button) => button.textContent.includes("なぐる") && !button.disabled)""",
            {"timeout": 1200},
        )
        move_tactic_state = await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll(".move-button")]
                .find((candidate) => candidate.textContent.includes("なぐる"));
              return {
                text: button?.textContent || "",
                aria: button?.getAttribute("aria-label") || "",
                styleTip: button?.querySelector(".move-hold-tip")?.textContent || "",
                stylePill: button?.querySelector(".move-style-preview")?.textContent || "",
                finish: Boolean(button?.querySelector(".move-advice-chip.is-finish")),
                chain: Boolean(button?.querySelector(".move-advice-chip.is-chain")),
                finishCue: document.querySelector(".battle-card.is-enemy .battle-finish-cue")?.textContent || "",
                finishCard: document.querySelector(".battle-card.is-enemy")?.classList.contains("is-finish-ready") || false,
                finishAria: document.querySelector(".battle-card.is-enemy")?.getAttribute("aria-label") || "",
                dangerCue: document.querySelector(".battle-card.is-player .battle-danger-cue")?.textContent || "",
                dangerCard: document.querySelector(".battle-card.is-player")?.classList.contains("is-danger-ready") || false,
                dangerAria: document.querySelector(".battle-card.is-player")?.getAttribute("aria-label") || ""
              };
            }"""
        )
        expect(move_tactic_state["finish"], "敵HPが少ない時の押せるチップが表示されていません。")
        expect(move_tactic_state["chain"], "コンボ継続時のCHAINチップが表示されていません。")
        expect("押せる" in move_tactic_state["aria"], "押せるチップが技ボタンのラベルに反映されていません。")
        expect("STYLE候補" in move_tactic_state["styleTip"], "技長押し説明にSTYLE候補が表示されていません。")
        expect("CHAIN" in move_tactic_state["styleTip"] and "FINISH" in move_tactic_state["styleTip"], "技長押し説明にSTYLE候補の理由が表示されていません。")
        expect("STYLE候補" in move_tactic_state["aria"], "STYLE候補が技ボタンのアクセシブルラベルに反映されていません。")
        expect(move_tactic_state["stylePill"].startswith("STYLE+"), "技ボタンにSTYLE候補の数値表示がありません。")
        expect(move_tactic_state["finishCue"] == "FINISH", "敵HPが少ない時にFINISH表示が出ていません。")
        expect(move_tactic_state["finishCard"], "敵HPカードがフィニッシュ状態になっていません。")
        expect("フィニッシュチャンス" in move_tactic_state["finishAria"], "FINISH表示のアクセシブルラベルがありません。")
        expect(move_tactic_state["dangerCue"] == "DANGER", "味方HPが少ない時にDANGER表示が出ていません。")
        expect(move_tactic_state["dangerCard"], "味方HPカードがピンチ状態になっていません。")
        expect("ピンチ" in move_tactic_state["dangerAria"], "DANGER表示のアクセシブルラベルがありません。")
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.battle.display.enemyHp = 0;
              state.battle.display.playerHp = 0;
            })"""
        )
        await page.waitForFunction(
            """() => !document.querySelector(".battle-card.is-enemy .battle-finish-cue")
              && !document.querySelector(".battle-card.is-player .battle-danger-cue")""",
            {"timeout": 1200},
        )
        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.battle.display.enemyHp = 1;
              state.party[0].currentHp = state.party[0].maxHp;
              state.battle.display.playerHp = state.party[0].maxHp;
            })"""
        )
        await page.waitForFunction(
            """() => document.querySelector(".battle-card.is-enemy .battle-finish-cue")?.textContent === "FINISH"
              && !document.querySelector(".battle-card.is-player .battle-danger-cue")""",
            {"timeout": 1200},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              window.__battleStyleOriginalChance = runtime.random.chance;
              runtime.random.chance = (probability, label) =>
                label === "critical_roll"
                  ? true
                  : window.__battleStyleOriginalChance(probability, label);
              [...document.querySelectorAll(".move-button")]
                .find((button) => button.textContent.includes("なぐる")).click();
            }"""
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(
                state.battle
                && state.battle.currentMessage.includes("スタイルボーナス")
                && state.battle.style?.criticalHits === 1
                && state.battle.style?.finishes === 1
              );
            }""",
            {"timeout": 7000},
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.random.chance = window.__battleStyleOriginalChance;
              delete window.__battleStyleOriginalChance;
            }"""
        )
        style_bonus_state = await page.evaluate(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              const baseExp = state.battle.enemy.level * 15;
              return {
                message: state.battle.currentMessage,
                style: state.battle.style,
                styleText: document.querySelector(".battle-style-badge")?.textContent || "",
                styleAria: document.querySelector(".battle-style-badge")?.getAttribute("aria-label") || "",
                enemyIntentText: document.querySelector(".battle-enemy-intent")?.textContent || "",
                pendingExpGain: state.battle.pendingExpGain,
                pendingStyleBonusExp: state.battle.pendingStyleBonusExp,
                pendingStyleSummary: state.battle.pendingStyleSummary || "",
                baseExp
              };
            }"""
        )
        expect("STYLE" in style_bonus_state["message"], "スタイルボーナスのSTYLE表示がありません。")
        expect(style_bonus_state["style"]["points"] >= 5, "コンボ・会心・フィニッシュのSTYLE点が加算されていません。")
        expect(style_bonus_state["style"]["criticalHits"] == 1, "会心回数がSTYLE状態へ記録されていません。")
        expect(style_bonus_state["style"]["finishes"] == 1, "フィニッシュ回数がSTYLE状態へ記録されていません。")
        expect("STYLE" in style_bonus_state["styleText"] and "pt" in style_bonus_state["styleText"], "STYLEバッジが加点後のポイントを表示していません。")
        expect("次" in style_bonus_state["styleText"] or "MAX" in style_bonus_state["styleText"], "STYLEバッジに次ランク情報が表示されていません。")
        expect("+" in style_bonus_state["styleText"], "STYLEバッジに直近の加点が表示されていません。")
        expect("直近+" in style_bonus_state["styleAria"], "STYLEバッジの加点アクセシブルラベルがありません。")
        expect(not style_bonus_state["enemyIntentText"], "撃破後も敵の次行動予告が表示されています。")
        expect(style_bonus_state["pendingStyleBonusExp"] > 0, "スタイル経験値ボーナスが発生していません。")
        expect(
            style_bonus_state["pendingExpGain"] > style_bonus_state["baseExp"],
            "スタイルボーナスが獲得経験値へ加算されていません。",
        )
        expect("STYLE" in style_bonus_state["pendingStyleSummary"], "勝利サマリーにSTYLEランクが記録されていません。")
        expect("pt" in style_bonus_state["pendingStyleSummary"], "勝利サマリーにSTYLEポイントが記録されていません。")
        style_audio_ids = await read_recent_se_ids(page)
        expect("finish" in style_audio_ids, "フィニッシュSEが再生されていません。")
        expect("style" in style_audio_ids, "スタイルボーナスSEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              if (window.__battleStyleMessageAutoAdvance) {
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMs = window.__battleStyleMessageAutoAdvance.ms;
                window.MonsterPrototype.config.game.battle.messageAutoAdvancePerCharMs = window.__battleStyleMessageAutoAdvance.perChar;
                window.MonsterPrototype.config.game.battle.messageAutoAdvanceMaxExtraMs = window.__battleStyleMessageAutoAdvance.maxExtra;
              }
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
                state.battle.rush = { gauge: 0, ready: false, lastDelta: 0 };
                state.battle.counterReady = false;
                state.battle.combo = { count: 0, lastDelta: 0, lastMultiplier: 1 };
                state.battle.style = { points: 0, lastDelta: 0, bestCombo: 0, rushCount: 0, strongHits: 0, maxCombos: 0, criticalHits: 0, finishes: 0 };
                state.battle.pendingExpGain = 0;
                state.battle.pendingStyleBonusExp = 0;
                state.battle.pendingStyleSummary = "";
              });
            }"""
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.battle.phase = "message";
                state.battle.currentMessage = "HPサウンド確認";
                state.battle.animation = {
                  kind: "damage",
                  target: "player",
                  fromHp: 30,
                  toHp: 12,
                  elapsedMs: 0,
                  durationMs: 520
                };
                state.battle.display.playerHp = 30;
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".battle-feedback-badge")]
              .some((badge) => badge.textContent.includes("-18") && badge.textContent.includes("HIT"))""",
            {"timeout": 1200},
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && !state.battle.animation);
            }""",
            {"timeout": 4000},
        )
        hp_audio_ids = await read_recent_se_ids(page)
        expect("hp_down" in hp_audio_ids, "HPが減るSEが再生されていません。")
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.battle.phase = "message";
                state.battle.currentMessage = "経験値サウンド確認";
                state.battle.animation = {
                  kind: "exp",
                  fromExp: 0,
                  toExp: 45,
                  requiredExp: 100,
                  elapsedMs: 0,
                  durationMs: 520
                };
                state.battle.display.playerExp = 0;
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll(".battle-feedback-badge")]
              .some((badge) => badge.textContent.includes("EXP") && badge.textContent.includes("+45"))""",
            {"timeout": 1200},
        )
        await page.waitForFunction(
            """() => {
              const state = window.MonsterPrototype.runtime.store.snapshot();
              return Boolean(state.battle && !state.battle.animation);
            }""",
            {"timeout": 4000},
        )
        exp_audio_ids = await read_recent_se_ids(page)
        expect("exp_tick" in exp_audio_ids, "経験値バー増加SEが再生されていません。")
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                state.battle.phase = "command";
                state.battle.currentMessage = "";
                state.battle.steps = [];
                state.battle.nextPhase = "command";
                state.battle.animation = null;
                state.battle.captureBall = null;
              });
            }"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")].some((button) => button.textContent === "ボール")""",
            {"timeout": 4000},
        )
        await asyncio.sleep(0.2)
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
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "アイテム").click()"""
        )
        await page.waitForFunction(
            """() => [...document.querySelectorAll("#action-panel button")]
              .some((button) => button.textContent === "Pボール" && !button.disabled)""",
            {"timeout": 4000},
        )
        await clear_recent_se_ids(page)
        await page.evaluate(
            """() => [...document.querySelectorAll("#action-panel button")]
              .find((button) => button.textContent === "Pボール").click()"""
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
                captureBall: state.battle.captureBall,
                masterBallCount: state.inventory.masterBallCount
              };
            }"""
        )
        expect("パーフェクトボールを なげた" in capture_state["message"], "確定捕獲ボールの投球メッセージが表示されていません。")
        expect(capture_state["captureBall"]["hideEnemy"], "捕獲演出中に相手が隠れていません。")
        expect(capture_state["captureBall"]["ballType"] == "master", "確定捕獲ボールの演出種別が使われていません。")
        expect(capture_state["masterBallCount"] == 0, "確定捕獲ボールが消費されていません。")
        capture_audio_ids = await read_recent_se_ids(page)
        expect("confirm" in capture_audio_ids, "Pボール操作のボタン決定SEが再生されていません。")
        expect("ball" in capture_audio_ids, "ボール投球SEが再生されていません。")
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
        pickup_placements = route_state["state"]["field"]["pickupPlacements"]
        expect(
            "route_ball_pickup" in pickup_placements and "route_heal_pickup" in pickup_placements,
            "道の拾得物ランダム配置が生成されていません。",
        )
        expect(
            pickup_placements["route_ball_pickup"] != pickup_placements["route_heal_pickup"],
            "拾得物のランダム配置が重なっています。",
        )

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

        master_balls_before_pickup = route_state["state"]["inventory"]["masterBallCount"]
        await place_player_next_to_pickup(page, "route_ball_pickup")
        await press(page, "Enter")
        await asyncio.sleep(0.2)
        pickup_state = await read_field_state(page)
        expect("パーフェクトボールを みつけた！" in pickup_state["message"], "確定捕獲ボールの拾得メッセージが表示されていません。")
        expect(
            pickup_state["state"]["inventory"]["masterBallCount"] == master_balls_before_pickup + 1,
            "拾得物でパーフェクトボール数が増えていません。",
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
        expect("パーフェクトボール: 1 個" in pickup_menu_state["modalLines"], "アイテム画面のパーフェクトボール数が更新されていません。")
        expect("回復薬: 0 個" in pickup_menu_state["modalLines"], "拾得物で回復薬数が増えています。")
        expect("拾ったもの: 1/2" in pickup_menu_state["modalLines"], "アイテム画面の拾得記録が更新されていません。")
        expect(any(line.startswith("この場所: 1/2 次") for line in pickup_menu_state["modalLines"]), "アイテム画面に次の拾得物レーダーが表示されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "閉じる")
        await asyncio.sleep(0.2)

        full_heals_before_pickup = pickup_state["state"]["inventory"]["fullHealCount"]
        await place_player_next_to_pickup(page, "route_heal_pickup")
        await press(page, "Enter")
        await asyncio.sleep(0.2)
        heal_pickup_state = await read_field_state(page)
        expect("回復薬を みつけた！" in heal_pickup_state["message"], "回復薬の拾得メッセージが表示されていません。")
        expect(
            heal_pickup_state["state"]["inventory"]["fullHealCount"] == full_heals_before_pickup + 1,
            "拾得物で回復薬数が増えていません。",
        )
        expect(
            "route_heal_pickup" in heal_pickup_state["state"]["progress"]["resolvedEventIds"],
            "回復薬の拾得済みイベントが記録されていません。",
        )

        await press(page, "Enter")
        await asyncio.sleep(0.2)
        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "アイテム")
        await asyncio.sleep(0.2)
        both_pickup_menu_state = await read_field_state(page)
        expect("パーフェクトボール: 1 個" in both_pickup_menu_state["modalLines"], "アイテム画面のパーフェクトボール数が維持されていません。")
        expect("回復薬: 1 個" in both_pickup_menu_state["modalLines"], "アイテム画面の回復薬数が更新されていません。")
        expect("拾ったもの: 2/2" in both_pickup_menu_state["modalLines"], "2つの拾得記録が表示されていません。")
        expect("この場所の拾得物: 回収済み" in both_pickup_menu_state["modalLines"], "全回収後の拾得物レーダーが更新されていません。")
        await click_modal_button(page, "メニューへ")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "閉じる")
        await asyncio.sleep(0.2)

        await page.evaluate(
            """() => window.MonsterPrototype.runtime.store.update((state) => {
              state.party[0].currentHp = Math.max(1, state.party[0].currentHp - 5);
              state.inventory.fullHealCount = 1;
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
            repeat_state["state"]["inventory"]["masterBallCount"] == master_balls_before_pickup + 1,
            "取得済みの拾得物が再取得されています。",
        )

        await load_fresh(page, base_url)
        await page.evaluate(
            """() => {
              const reportKey = window.MonsterPrototype.config.game.save.reportStorageKey;
              window.localStorage.removeItem(reportKey);
            }"""
        )
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                const monster = runtime.dataRegistry.createMonsterInstance("dummy_flare", 9);
                monster.currentHp = monster.maxHp;
                state.party = [monster];
                state.collection.capturedSpeciesIds = ["dummy_flare", "tsolf"];
                state.inventory.fullHealCount = 1;
                state.inventory.masterBallCount = 1;
                state.progress.storyIntroAccepted = true;
                state.progress.battleCount = 7;
                state.progress.defeatCount = 1;
                state.progress.acquiredFullHealCount = 3;
                state.progress.acquiredMasterBallCount = 1;
                state.timeAttack.active = true;
                state.timeAttack.elapsedMs = 421000;
                state.progress.gameCleared = true;
              });
            }"""
        )
        await page.waitForFunction(
            """() => document.querySelector("#modal-title")?.textContent === "殿堂入り" """,
            {"timeout": 2000},
        )
        clear_modal_state = await read_field_state(page)
        expect("冒険レポートを保存しました。" in clear_modal_state["modalLines"], "クリア時に冒険レポート保存結果が表示されていません。")
        expect("称号: 切り札を使いこなす勝負師" in clear_modal_state["modalLines"], "クリアモーダルに冒険称号が表示されていません。")
        expect("ハイライト: ダンゴマルと7分1秒で殿堂入り。" in clear_modal_state["modalLines"], "クリアモーダルに冒険ハイライトが表示されていません。")
        expect("使用: ダンゴマル" in clear_modal_state["modalLines"], "クリアモーダルに使用モンスターが表示されていません。")
        expect("捕獲: 2 / 戦闘: 7" in clear_modal_state["modalLines"], "クリアモーダルに捕獲数と戦闘回数が表示されていません。")
        first_report = await page.evaluate(
            """() => window.MonsterPrototype.runtime.adventureReports.list()[0]"""
        )
        expect(first_report["capturedCount"] == 2, "冒険レポートに捕獲数が保存されていません。")
        expect(first_report["battleCount"] == 7, "冒険レポートに戦闘回数が保存されていません。")
        expect(first_report["defeatCount"] == 1, "冒険レポートに敗北回数が保存されていません。")
        expect(first_report["items"]["fullHeal"] == 3, "冒険レポートに取得回復薬数が保存されていません。")
        expect(first_report["items"]["masterBall"] == 1, "冒険レポートに取得パーフェクトボール数が保存されていません。")
        await click_modal_button(page, "タイトルへ")
        await page.waitForFunction(
            """() => document.querySelector("#modal-title")?.textContent === "ルール" """,
            {"timeout": 1200},
        )
        await click_modal_button(page, "はじめる")
        await asyncio.sleep(0.2)
        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "冒険レポート")
        await asyncio.sleep(0.2)
        report_menu_state = await read_field_state(page)
        expect(report_menu_state["modalTitle"] == "冒険レポート", "冒険レポート画面が開いていません。")
        expect("保存 1件" in report_menu_state["modalLines"], "冒険レポート一覧に保存件数が表示されていません。")
        expect("最新称号: 切り札を使いこなす勝負師" in report_menu_state["modalLines"], "冒険レポート一覧に最新称号が表示されていません。")
        expect("ベストタイム: 7分1秒 (ダンゴマル)" in report_menu_state["modalLines"], "冒険レポート一覧にベストタイムが表示されていません。")
        expect("最高ランク: A (切り札を使いこなす勝負師)" in report_menu_state["modalLines"], "冒険レポート一覧に最高ランクが表示されていません。")
        expect("冒険の足跡: 捕獲 2 / 戦闘 7 / 敗北 1" in report_menu_state["modalLines"], "冒険レポート一覧に累計サマリーが表示されていません。")
        expect("よく使った相棒: ダンゴマル (1回)" in report_menu_state["modalLines"], "冒険レポート一覧に相棒サマリーが表示されていません。")
        expect(any(line.startswith("最新パーティ: ダンゴマル Lv9") for line in report_menu_state["modalLines"]), "冒険レポート一覧に最新パーティが表示されていません。")
        expect("総合記録をコピー" in report_menu_state["modalButtons"], "冒険レポート一覧に総合記録コピー導線がありません。")
        first_report_button = await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll("#modal-actions button")]
                .find((entry) => entry.textContent.includes("R:"));
              return button ? button.textContent : "";
            }"""
        )
        expect(first_report_button, "冒険レポート一覧に履歴ボタンがありません。")
        expect("ダンゴマル" in first_report_button, "冒険レポート一覧の履歴ボタンに相棒名が表示されていません。")
        expect("最新" in first_report_button, "1件目の履歴ボタンに最新ラベルが表示されていません。")
        expect("最速" in first_report_button, "1件目の履歴ボタンに最速ラベルが表示されていません。")
        expect("最高ランク" in first_report_button, "1件目の履歴ボタンに最高ランクラベルが表示されていません。")
        await click_modal_button(page, first_report_button)
        await asyncio.sleep(0.2)
        report_detail_state = await read_field_state(page)
        expect("履歴: 1/1" in report_detail_state["modalLines"], "冒険レポート詳細に履歴位置が表示されていません。")
        expect("記録タグ: 最新 / 最速 / 最高ランク" in report_detail_state["modalLines"], "冒険レポート詳細に記録タグが表示されていません。")
        expect("称号: 切り札を使いこなす勝負師" in report_detail_state["modalLines"], "冒険レポート詳細に称号が表示されていません。")
        expect("ハイライト: ダンゴマルと7分1秒で殿堂入り。" in report_detail_state["modalLines"], "冒険レポート詳細にハイライトが表示されていません。")
        expect("プレイ時間: 7分1秒" in report_detail_state["modalLines"], "冒険レポート詳細にプレイ時間が表示されていません。")
        expect("使用モンスター: ダンゴマル" in report_detail_state["modalLines"], "冒険レポート詳細に使用モンスターが表示されていません。")
        expect("取得アイテム: 回復薬 3 / パーフェクトボール 1" in report_detail_state["modalLines"], "冒険レポート詳細に取得アイテムが表示されていません。")
        expect("共有文をコピー" in report_detail_state["modalButtons"], "冒険レポート詳細に共有文コピー導線がありません。")
        await page.evaluate(
            """() => {
              window.MonsterPrototype.runtime.clipboardWriter = (text) => {
                window.__copiedAdventureReportText = text;
                return true;
              };
            }"""
        )
        await click_modal_button(page, "共有文をコピー")
        await page.waitForFunction(
            """() => window.__copiedAdventureReportText
              && document.querySelector("#modal-body")?.textContent.includes("共有文をコピーしました。")""",
            {"timeout": 1200},
        )
        copied_report_text = await page.evaluate("""() => window.__copiedAdventureReportText || "" """)
        expect("初代風モンスター 冒険レポート" in copied_report_text, "コピー用共有文に見出しが入っていません。")
        expect("記録タグ: 最新 / 最速 / 最高ランク" in copied_report_text, "コピー用共有文に記録タグが入っていません。")
        expect("称号: 切り札を使いこなす勝負師" in copied_report_text, "コピー用共有文に称号が入っていません。")
        expect("最終パーティ: ダンゴマル Lv9" in copied_report_text, "コピー用共有文に最終パーティが入っていません。")

        await load_fresh(page, base_url)
        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "冒険レポート")
        await asyncio.sleep(0.2)
        report_after_reload_state = await read_field_state(page)
        expect("保存 1件" in report_after_reload_state["modalLines"], "再読み込み後に冒険レポート履歴が保持されていません。")
        await click_modal_button(page, "閉じる")
        await asyncio.sleep(0.2)
        await page.evaluate(
            """() => {
              const runtime = window.MonsterPrototype.runtime;
              runtime.store.update((state) => {
                const monster = runtime.dataRegistry.createMonsterInstance("tsolf", 12);
                monster.currentHp = monster.maxHp;
                state.party = [monster];
                state.collection.capturedSpeciesIds = ["dummy_flare", "tsolf", "dummy_drop"];
                state.progress.storyIntroAccepted = true;
                state.progress.battleCount = 11;
                state.progress.defeatCount = 0;
                state.progress.acquiredFullHealCount = 4;
                state.progress.acquiredMasterBallCount = 2;
                state.timeAttack.active = true;
                state.timeAttack.elapsedMs = 720000;
                state.progress.gameCleared = true;
              });
            }"""
        )
        await page.waitForFunction(
            """() => document.querySelector("#modal-title")?.textContent === "殿堂入り" """,
            {"timeout": 2000},
        )
        multi_report_state = await page.evaluate(
            """() => window.MonsterPrototype.runtime.adventureReports.list()"""
        )
        expect(len(multi_report_state) == 2, "冒険レポートが複数履歴として蓄積されていません。")
        expect(multi_report_state[-1]["usedMonsterName"] == "ツォルフ", "2件目の冒険レポートに最終パーティが保存されていません。")
        await click_modal_button(page, "タイトルへ")
        await page.waitForFunction(
            """() => document.querySelector("#modal-title")?.textContent === "ルール" """,
            {"timeout": 1200},
        )
        await click_modal_button(page, "はじめる")
        await asyncio.sleep(0.2)
        await press(page, "m")
        await asyncio.sleep(0.2)
        await click_modal_button(page, "冒険レポート")
        await asyncio.sleep(0.2)
        multi_report_menu_state = await read_field_state(page)
        expect("保存 2件" in multi_report_menu_state["modalLines"], "冒険レポート一覧に複数保存件数が表示されていません。")
        expect("最新称号: 図鑑を広げた冒険家" in multi_report_menu_state["modalLines"], "冒険レポート一覧に最新履歴の称号が表示されていません。")
        expect("ベストタイム: 7分1秒 (ダンゴマル)" in multi_report_menu_state["modalLines"], "複数履歴のベストタイムが表示されていません。")
        expect("最高ランク: A (切り札を使いこなす勝負師)" in multi_report_menu_state["modalLines"], "複数履歴の最高ランクが表示されていません。")
        expect("冒険の足跡: 捕獲 5 / 戦闘 18 / 敗北 1" in multi_report_menu_state["modalLines"], "複数履歴の累計サマリーが表示されていません。")
        expect("よく使った相棒: ツォルフ (1回)" in multi_report_menu_state["modalLines"], "複数履歴の相棒サマリーが表示されていません。")
        await page.evaluate(
            """() => {
              window.MonsterPrototype.runtime.clipboardWriter = (text) => {
                window.__copiedAdventureSummaryText = text;
                return true;
              };
            }"""
        )
        await click_modal_button(page, "総合記録をコピー")
        await page.waitForFunction(
            """() => window.__copiedAdventureSummaryText
              && document.querySelector("#modal-body")?.textContent.includes("総合記録をコピーしました。")""",
            {"timeout": 1200},
        )
        copied_summary_text = await page.evaluate("""() => window.__copiedAdventureSummaryText || "" """)
        expect("初代風モンスター 歴代冒険レポート" in copied_summary_text, "総合共有文に見出しが入っていません。")
        expect("クリア履歴: 2件" in copied_summary_text, "総合共有文に履歴件数が入っていません。")
        expect("ベストタイム: 7分1秒 (ダンゴマル)" in copied_summary_text, "総合共有文にベストタイムが入っていません。")
        expect("累計: 捕獲 5 / 戦闘 18 / 敗北 1" in copied_summary_text, "総合共有文に累計が入っていません。")
        expect("よく使った相棒: ツォルフ (1回)" in copied_summary_text, "総合共有文に相棒サマリーが入っていません。")
        latest_report_button = await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll("#modal-actions button")]
                .find((entry) => entry.textContent.includes("ツォルフ"));
              return button ? button.textContent : "";
            }"""
        )
        expect(latest_report_button, "冒険レポート一覧に最新履歴の相棒名が表示されていません。")
        expect("最新" in latest_report_button, "最新履歴ボタンに最新ラベルが表示されていません。")
        expect("最速" not in latest_report_button, "最新履歴ボタンに最速ラベルが誤表示されています。")
        older_best_report_button = await page.evaluate(
            """() => {
              const button = [...document.querySelectorAll("#modal-actions button")]
                .find((entry) => entry.textContent.includes("ダンゴマル"));
              return button ? button.textContent : "";
            }"""
        )
        expect(older_best_report_button, "冒険レポート一覧に最速履歴の相棒名が表示されていません。")
        expect("最速" in older_best_report_button, "最速履歴ボタンに最速ラベルが表示されていません。")
        expect("最高ランク" in older_best_report_button, "最高ランク履歴ボタンに最高ランクラベルが表示されていません。")
        expect("最新" not in older_best_report_button, "古い履歴ボタンに最新ラベルが誤表示されています。")
        await click_modal_button(page, latest_report_button)
        await asyncio.sleep(0.2)
        latest_detail_state = await read_field_state(page)
        expect("履歴: 1/2" in latest_detail_state["modalLines"], "最新冒険レポート詳細に履歴位置が表示されていません。")
        expect("記録タグ: 最新" in latest_detail_state["modalLines"], "最新冒険レポート詳細に最新タグが表示されていません。")
        expect("使用モンスター: ツォルフ" in latest_detail_state["modalLines"], "最新冒険レポート詳細に使用モンスターが表示されていません。")
        expect("古い記録" in latest_detail_state["modalButtons"], "最新冒険レポート詳細に古い記録への移動ボタンがありません。")
        await click_modal_button(page, "古い記録")
        await asyncio.sleep(0.2)
        older_detail_state = await read_field_state(page)
        expect("履歴: 2/2" in older_detail_state["modalLines"], "古い冒険レポート詳細に履歴位置が表示されていません。")
        expect("記録タグ: 最速 / 最高ランク" in older_detail_state["modalLines"], "古い冒険レポート詳細に最速・最高ランクタグが表示されていません。")
        expect("使用モンスター: ダンゴマル" in older_detail_state["modalLines"], "古い冒険レポート詳細へ移動できていません。")
        expect("新しい記録" in older_detail_state["modalButtons"], "古い冒険レポート詳細に新しい記録への移動ボタンがありません。")
        expect(not browser_errors, "ブラウザエラーが発生しました: " + " / ".join(browser_errors))

        print("OK: 起動説明、画面右上タイマー、デスクトップクリック移動、ゲート解放、GBA風スマホレイアウト、ゲーム内メニュー、保存再開、移動反応、依頼進行、ワープ、拾得物、野生戦導入、技選択UI、捕獲演出、捕獲記録ポップ、冒険レポート保存まで確認しました。")
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
