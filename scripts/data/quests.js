// 2026年4月27日時点の開発者向け保守メモ:
// 依頼データ。progressKeyは保存データに残るため、名称変更は既存進行の破壊になる。
// field-scene.jsは会話イベントのquestIdからここを参照し、data-registry.jsが目的文と報告文を解決する。
(() => {
  const App = window.MonsterPrototype;

  App.data.quests = [
    {
      id: "first_observation",
      progressKey: "observationQuestState",
      initialState: "not_started",
      primary: true,
      completionRequirement: {
        // 現時点でdata-registry.jsが対応する達成条件はcaptured_count_at_leastのみ。
        kind: "captured_count_at_least",
        count: 1,
      },
      objectives: {
        not_started: {
          default: "目的: 左の出口からしずかなひろばへ行き、案内人に話を聞く。",
          ready: "目的: しずかなひろばの案内人に、捕獲した相手を見せに行く。",
        },
        active: {
          default: "目的: ながめのみちの草むらで、野生の相手を1体つかまえる。",
          ready: "目的: しずかなひろばの案内人へ、捕獲の観察結果を報告する。",
        },
        reported:
          "目的: 最初の報告は終わった。残り時間で、さらに準備を進めよう。",
      },
      messages: {
        start:
          "ちょうどよかった。ながめのみちの草むらで、野生の相手を1体つかまえてきてください。\\nつかまえたら、この広場へ戻って報告してください。",
        active:
          "まずは草むらで野生の相手を1体つかまえてみましょう。\\n道へ出るときは、右の出口から戻れます。",
        report:
          "戻りましたね。捕まえた相手の記録も確認できました。\\nこの調子で、次の相手に備えましょう。",
        complete:
          "最初の報告は終わっています。\\n残り時間で、さらに準備を進めてください。",
      },
    },
  ];
})();
