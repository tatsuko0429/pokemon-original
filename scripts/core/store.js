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
        const clonedState = deepClone(nextState);
        Object.keys(state).forEach((key) => {
          delete state[key];
        });
        Object.assign(state, clonedState);
      },
      reset() {
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
