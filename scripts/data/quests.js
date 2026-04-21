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
          "目的: 最初の観察報告は完了しました。広場や道を歩いて手触りを確認してください。",
      },
      messages: {
        start:
          "ちょうどよかった。ながめのみちの草むらで、野生の相手を1体観察してきてください。\\nつかまえられたら、この広場へ戻って報告してください。",
        active:
          "まずは草むらで野生の相手を1体つかまえてみましょう。\\n道へ出るときは、右の出口から戻れます。",
        report:
          "戻りましたね。捕獲の記録も確認できました。\\nこれで、道と広場を往復する最初の流れは成立しています。",
        complete:
          "最初の観察報告は完了しています。\\nあとは歩き心地や戦闘の間を、何度か確かめてみてください。",
      },
    },
  ];
})();
