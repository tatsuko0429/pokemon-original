(() => {
  const app = window.MonsterPrototype || {};

  app.config = app.config || {};
  app.data = app.data || {};
  app.core = app.core || {};
  app.scenes = app.scenes || {};
  app.runtime = app.runtime || {};

  window.MonsterPrototype = app;
})();
