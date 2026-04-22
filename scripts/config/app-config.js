(() => {
  const App = window.MonsterPrototype;

  App.config.game = {
    screen: {
      width: 160,
      height: 144,
      tileSize: 8,
    },
    timing: {
      moveDurationMs: 140,
      runMoveDurationMs: 86,
      encounterCooldownSteps: 2,
      blockedFeedbackCooldownMs: 420,
    },
    battle: {
      messageAutoAdvanceMs: 650,
    },
    field: {
      startMapId: "camera_route",
    },
    battleLayout: {
      groundY: 88,
      groundHeight: 22,
      enemy: {
        monsterX: 42,
        monsterY: 52,
        shadowX: 39,
        shadowY: 66,
        shadowWidth: 29,
        shadowHeight: 8,
      },
      player: {
        monsterX: 120,
        monsterY: 84,
        shadowX: 119,
        shadowY: 100,
        shadowWidth: 35,
        shadowHeight: 10,
      },
    },
    random: {
      seed: 19960427,
      logLimit: 48,
    },
    save: {
      schemaVersion: 1,
      storageKey: "monster_prototype_save_v1",
      autoSaveIntervalMs: 600,
    },
    story: {
      preparationDurationMs: 300000,
      introTitle: "ルール説明",
      introLines: [
        "このマップの草むらで、5分間モンスターを育てましょう。",
        "気に入ったモンスターは捕まえることができますが、手持ちモンスターは常に1体までなので、入れ替えが必要です。",
        "レベルを上げることはシンプルに強くなることに直結しますが、必ずしもこの5分間でレベル上げだけをすることが目的ではありません。",
        "いろいろとご自身で試してみてください。",
        "5分間が経過すると、次のマップへの道が開きます。",
        "移動して次のステージへ進み、四天王に挑んでください。全員倒すとクリアです。",
        "ルールは大丈夫でしょうか？",
      ],
      lockedGateMessage: "5分後に解放されます。",
      unlockedGateMessage: "5分が経過しました。次のマップへの道が開きました。",
    },
    animation: {
      wildEncounterTransitionMs: 430,
      field: {
        grassStepDurationMs: 220,
        bumpDurationMs: 160,
      },
      damage: {
        durationMs: 420,
        wiggleDurationMs: 180,
        flashIntervalMs: 40,
      },
      ball: {
        durationMs: 520,
        throwDurationMs: 540,
        shakeDurationMs: 520,
        releaseDurationMs: 420,
        startX: 120,
        startY: 96,
        endX: 42,
        endY: 52,
        curveY: 24,
        absorbAt: 0.62,
        shakePixels: 4,
        shakeCycles: 4,
        releaseHideAt: 0.55,
      },
    },
    ui: {
      fieldHint:
        "左の出口で広場へ入り、拾える物や会話を見たあとに草むら遭遇も確かめてください。",
    },
    audio: {
      masterVolume: 0.07,
      bgm: {
        field: {
          wave: "square",
          beatMs: 230,
          notes: [
            { freq: 392, beats: 1 },
            { freq: 494, beats: 1 },
            { freq: 523.25, beats: 1 },
            { freq: 494, beats: 1 },
            { freq: 440, beats: 1 },
            { freq: 392, beats: 1 },
            { beats: 0.5 },
            { freq: 440, beats: 0.5 },
            { freq: 494, beats: 1 },
            { freq: 440, beats: 1 },
            { freq: 392, beats: 1 },
            { beats: 1 },
          ],
        },
        battle: {
          wave: "square",
          beatMs: 200,
          notes: [
            { freq: 392, beats: 0.5 },
            { freq: 392, beats: 0.5 },
            { freq: 523.25, beats: 0.5 },
            { freq: 587.33, beats: 0.5 },
            { freq: 523.25, beats: 0.5 },
            { freq: 659.25, beats: 0.5 },
            { freq: 587.33, beats: 1 },
            { beats: 0.5 },
            { freq: 523.25, beats: 0.5 },
            { freq: 587.33, beats: 0.5 },
            { freq: 698.46, beats: 0.5 },
            { freq: 659.25, beats: 1 },
            { beats: 0.5 },
          ],
        },
      },
      se: {
        confirm: [
          { freq: 659.25, ms: 60 },
          { freq: 783.99, ms: 80 },
        ],
        cancel: [
          { freq: 523.25, ms: 70 },
          { freq: 392, ms: 90 },
        ],
        menu: [
          { freq: 587.33, ms: 60 },
          { freq: 739.99, ms: 100 },
        ],
        encounter: [
          { freq: 196, ms: 70 },
          { freq: 261.63, ms: 70 },
          { freq: 329.63, ms: 110 },
        ],
        step: [
          { freq: 130.81, ms: 34, wave: "triangle", volume: 0.45 },
        ],
        grass_step: [
          { freq: 174.61, ms: 34, wave: "triangle", volume: 0.55 },
          { freq: 146.83, ms: 42, wave: "triangle", volume: 0.45 },
        ],
        bump: [
          { freq: 110, ms: 44, wave: "triangle", volume: 0.55 },
        ],
        move: [
          { freq: 523.25, ms: 45 },
          { freq: 659.25, ms: 45 },
          { freq: 783.99, ms: 70 },
        ],
        hit: [
          { freq: 220, ms: 35, wave: "sawtooth" },
          { freq: 160, ms: 90, wave: "triangle" },
        ],
        ball: [
          { freq: 440, ms: 50 },
          { freq: 659.25, ms: 60 },
        ],
        shake: [
          { freq: 196, ms: 45, wave: "triangle" },
          { freq: 174.61, ms: 55, wave: "triangle" },
        ],
        capture: [
          { freq: 523.25, ms: 70 },
          { freq: 659.25, ms: 70 },
          { freq: 783.99, ms: 120 },
        ],
        run: [
          { freq: 440, ms: 50 },
          { freq: 329.63, ms: 90 },
        ],
        error: [
          { freq: 261.63, ms: 60, wave: "triangle" },
          { freq: 220, ms: 110, wave: "triangle" },
        ],
      },
    },
    palette: {
      light: "#ded7bf",
      midLight: "#cfc394",
      mid: "#8c8567",
      dark: "#4a4d3d",
      deepest: "#20221b",
      warning: "#9a2e24",
      white: "#f8f4d7",
      captureRed: "#b34431",
      captureYellow: "#d8b546",
      battleBg: "#ded7bf",
      battleGround: "#c3b27a",
      battleShadow: "#7b7f62",
    },
    fieldTiles: {
      ".": {
        label: "土",
        passable: true,
        color: "#c9c08e",
      },
      "=": {
        label: "道",
        passable: true,
        color: "#d8bd73",
      },
      "g": {
        label: "草むら",
        passable: true,
        color: "#718751",
        overlay: "#566d3a",
      },
      "#": {
        label: "林",
        passable: false,
        color: "#42493a",
      },
      "~": {
        label: "水辺",
        passable: false,
        color: "#6f8d91",
      },
    },
    typeChart: {
      ノーマル: {
        ノーマル: 1,
        くさ: 1,
        ほのお: 1,
        みず: 1,
      },
      くさ: {
        ノーマル: 1,
        くさ: 0.5,
        ほのお: 0.5,
        みず: 2,
      },
      ほのお: {
        ノーマル: 1,
        くさ: 2,
        ほのお: 0.5,
        みず: 0.5,
      },
      みず: {
        ノーマル: 1,
        くさ: 0.5,
        ほのお: 2,
        みず: 0.5,
      },
    },
  };
})();
