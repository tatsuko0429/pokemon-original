(() => {
  const App = window.MonsterPrototype;

  App.data.quests = [
    {
      id: "first_observation",
      progressKey: "observationQuestState",
      initialState: "not_started",
      primary: true,
      completionRequirement: {
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
