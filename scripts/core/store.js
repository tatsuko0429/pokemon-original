// 2026年4月27日時点の開発者向け保守メモ:
// アプリ全体の単一状態コンテナ。各sceneはgetStateで同じオブジェクトを読み、update内で直接ミューテートする前提。
(() => {
  const App = window.MonsterPrototype;

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStore(initialState) {
    const state = deepClone(initialState);

    return {
      getState() {
        return state;
      },
      update(mutator) {
        mutator(state);
      },
      snapshot() {
        return deepClone(state);
      },
      replace(nextState) {
        // stateオブジェクトの参照自体は維持する。runtime.store.getState()を握っている処理を壊さないため。
        const clonedState = deepClone(nextState);
        Object.keys(state).forEach((key) => {
          delete state[key];
        });
        Object.assign(state, clonedState);
      },
      reset() {
        // 初期化も参照維持で行う。保存クリアや開始説明の直後にUI/sceneが同じstate参照を見続ける。
        const nextState = deepClone(initialState);
        Object.keys(state).forEach((key) => {
          delete state[key];
        });
        Object.assign(state, nextState);
      },
    };
  }

  App.core.createStore = createStore;
})();
