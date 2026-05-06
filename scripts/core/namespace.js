// 2026年4月27日時点の開発者向け保守メモ:
// 全ファイルがこの単一グローバル名前空間へ機能を追加する。script順が崩れるとApp参照が未定義になる。
(() => {
  const app = window.MonsterPrototype || {};

  app.config = app.config || {};
  app.data = app.data || {};
  app.core = app.core || {};
  app.scenes = app.scenes || {};
  app.runtime = app.runtime || {};

  window.MonsterPrototype = app;
})();
