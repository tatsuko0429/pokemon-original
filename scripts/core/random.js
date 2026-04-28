(() => {
  const App = window.MonsterPrototype;

  function normalizeSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) {
      return seed >>> 0;
    }

    const text = String(seed || "prototype-seed");
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function createRandomController(config) {
    const initialSeed = normalizeSeed(config && config.seed);
    const logLimit = Math.max(8, (config && config.logLimit) || 32);
    let state = initialSeed;
    let calls = 0;
    const log = [];

    function record(label, value) {
      log.push({
        call: calls,
        label: label || "",
        value: Number(value.toFixed(8)),
      });

      if (log.length > logLimit) {
        log.shift();
      }
    }

    function next(label) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      calls += 1;
      const value = state / 4294967296;
      record(label, value);
      return value;
    }

    function chance(probability, label) {
      return next(label) < probability;
    }

    function percent(percentValue, label) {
      return next(label) * 100 < percentValue;
    }

    function range(min, max, label) {
      return min + (max - min) * next(label);
    }

    function integer(min, maxInclusive, label) {
      return min + Math.floor(next(label) * (maxInclusive - min + 1));
    }

    function token(length, label) {
      let result = "";
      for (let index = 0; index < length; index += 1) {
        result += integer(0, 35, label).toString(36);
      }
      return result;
    }

    function snapshot() {
      return {
        initialSeed,
        currentSeed: state >>> 0,
        calls,
        log: log.slice(),
      };
    }

    return {
      next,
      chance,
      percent,
      range,
      integer,
      token,
      snapshot,
    };
  }

  App.core.createRandomController = createRandomController;
})();
