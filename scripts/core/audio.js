// 2026年4月27日時点の開発者向け保守メモ:
// Web Audioの生成音とHTMLAudioElementのBGMを扱う。ブラウザ制約により初回ユーザー操作まで音は鳴らせない。
// 音が鳴らない不具合を追う時は、playBgmより先にbindUserGesture/unlockの状態を確認する。
(() => {
  const App = window.MonsterPrototype;

  function createAudioManager(config) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const bgmPatterns = (config && config.bgm) || {};
    const sePatterns = (config && config.se) || {};
    const masterVolume = config && config.masterVolume ? config.masterVolume : 0.07;
    let context = null;
    let masterGain = null;
    let unlocked = false;
    let desiredBgmId = "";
    let currentBgmId = "";
    let bgmLoopToken = 0;
    let bgmTimeoutId = null;
    let activeBgmElement = null;
    let unlockPromise = null;
    const activeBgmNodes = new Set();
    const bgmAudioElements = new Map();

    function ensureContext() {
      if (!AudioContextCtor) {
        return null;
      }

      if (!context) {
        context = new AudioContextCtor();
        masterGain = context.createGain();
        masterGain.gain.value = masterVolume;
        masterGain.connect(context.destination);
      }

      return context;
    }

    function forgetNode(collection, oscillator) {
      collection.delete(oscillator);
    }

    function stopCollection(collection) {
      collection.forEach((oscillator) => {
        try {
          oscillator.stop();
        } catch (error) {
          // stop 済みのノードはそのまま無視する。
        }
      });
      collection.clear();
    }

    function playTone(note, startTime, durationSeconds, defaultWave, collection) {
      const audioContext = ensureContext();
      if (!audioContext || !masterGain || !note.freq) {
        return;
      }

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const peak = Math.max(0.0001, 0.14 * (note.volume || 1));
      const endTime = startTime + durationSeconds;

      oscillator.type = note.wave || defaultWave || "square";
      oscillator.frequency.setValueAtTime(note.freq, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peak, startTime + Math.min(0.015, durationSeconds / 4));
      gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(startTime + 0.02, endTime - 0.015));

      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.onended = () => {
        forgetNode(collection, oscillator);
        gain.disconnect();
      };

      collection.add(oscillator);
      oscillator.start(startTime);
      oscillator.stop(endTime);
    }

    function schedulePattern(pattern, startDelaySeconds, collection) {
      const audioContext = ensureContext();
      if (!audioContext || !pattern) {
        return 0;
      }

      const beatSeconds = (pattern.beatMs || 160) / 1000;
      let cursor = audioContext.currentTime + startDelaySeconds;

      pattern.notes.forEach((note) => {
        const durationSeconds = beatSeconds * (note.beats || 1);
        playTone(note, cursor, durationSeconds, pattern.wave, collection);
        cursor += durationSeconds;
      });

      return cursor - (audioContext.currentTime + startDelaySeconds);
    }

    function stopBgmPlayback() {
      bgmLoopToken += 1;
      currentBgmId = "";
      if (bgmTimeoutId) {
        window.clearTimeout(bgmTimeoutId);
        bgmTimeoutId = null;
      }
      stopCollection(activeBgmNodes);
      if (activeBgmElement) {
        activeBgmElement.pause();
        activeBgmElement.currentTime = 0;
        activeBgmElement = null;
      }
    }

    function getBgmAudioElement(id, pattern) {
      let element = bgmAudioElements.get(id);
      if (!element) {
        element = new Audio(pattern.src);
        element.preload = "auto";
        element.playsInline = true;
        element.setAttribute("playsinline", "");
        bgmAudioElements.set(id, element);
      }

      element.loop = pattern.loop !== false;
      element.volume = Math.max(0, Math.min(1, pattern.volume === undefined ? masterVolume : pattern.volume));
      return element;
    }

    async function playFileBgm(id, pattern) {
      const element = getBgmAudioElement(id, pattern);
      activeBgmElement = element;
      currentBgmId = id;

      try {
        await element.play();
        return true;
      } catch (error) {
        if (desiredBgmId === id) {
          currentBgmId = "";
          activeBgmElement = null;
          unlocked = false;
        }
        return false;
      }
    }

    async function startBgmPlayback(id) {
      const pattern = bgmPatterns[id];
      if (!pattern) {
        currentBgmId = "";
        return false;
      }

      if (pattern.src) {
        return playFileBgm(id, pattern);
      }

      if (!ensureContext()) {
        currentBgmId = "";
        return false;
      }

      currentBgmId = id;
      scheduleBgmLoop(id, bgmLoopToken);
      return true;
    }

    function scheduleBgmLoop(id, token) {
      if (!unlocked || token !== bgmLoopToken || desiredBgmId !== id) {
        return;
      }

      const pattern = bgmPatterns[id];
      if (!pattern) {
        currentBgmId = "";
        return;
      }

      currentBgmId = id;
      const durationSeconds = schedulePattern(pattern, 0.03, activeBgmNodes);
      bgmTimeoutId = window.setTimeout(() => {
        scheduleBgmLoop(id, token);
      }, Math.max(120, Math.round(durationSeconds * 1000) - 30));
    }

    async function unlock() {
      if (unlockPromise) {
        return unlockPromise;
      }

      unlockPromise = (async () => {
        // iOS/Chromeの自動再生制限対策。ここを通るまでdesiredBgmIdだけを保持し、実再生は待機する。
        const audioContext = ensureContext();

        if (audioContext && audioContext.state === "suspended") {
          try {
            await audioContext.resume();
          } catch (error) {
            unlocked = false;
            return false;
          }
        }

        unlocked = true;
        if (desiredBgmId && desiredBgmId !== currentBgmId) {
          stopBgmPlayback();
          return startBgmPlayback(desiredBgmId);
        }
        return true;
      })();

      try {
        return await unlockPromise;
      } finally {
        unlockPromise = null;
      }
    }

    function bindUserGesture(target) {
      const root = target || window;
      const handler = () => {
        unlock().then((success) => {
          if (!success) {
            return;
          }
          root.removeEventListener("pointerdown", handler);
          root.removeEventListener("pointerup", handler);
          root.removeEventListener("click", handler);
          root.removeEventListener("keydown", handler);
          root.removeEventListener("touchstart", handler);
          root.removeEventListener("touchend", handler);
        });
      };

      root.addEventListener("pointerdown", handler, { passive: true });
      root.addEventListener("pointerup", handler, { passive: true });
      root.addEventListener("click", handler);
      root.addEventListener("keydown", handler);
      root.addEventListener("touchstart", handler, { passive: true });
      root.addEventListener("touchend", handler, { passive: true });
    }

    function playBgm(id) {
      // desiredBgmIdは未unlock時にも記録する。起動直後にplayBgm("field")しても、初回操作後に再開できる。
      desiredBgmId = id || "";
      if (!desiredBgmId) {
        stopBgmPlayback();
        return;
      }

      if (!unlocked) {
        return;
      }

      if (currentBgmId === desiredBgmId) {
        return;
      }

      stopBgmPlayback();
      startBgmPlayback(desiredBgmId);
    }

    function playSe(id) {
      const pattern = sePatterns[id];
      const audioContext = ensureContext();
      if (!pattern || !audioContext || !unlocked) {
        return;
      }

      let cursor = audioContext.currentTime + 0.01;
      pattern.forEach((note) => {
        const durationSeconds = (note.ms || 70) / 1000;
        playTone(note, cursor, durationSeconds, note.wave || "square", new Set());
        cursor += durationSeconds * 0.85;
      });
    }

    return {
      bindUserGesture,
      unlock,
      playBgm,
      playSe,
    };
  }

  App.core.createAudioManager = createAudioManager;
})();
