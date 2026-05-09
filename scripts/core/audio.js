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
    let bgmGain = null;
    let seGain = null;
    let unlocked = false;
    let desiredBgmId = "";
    let currentBgmId = "";
    let bgmLoopToken = 0;
    let bgmTimeoutId = null;
    let activeBgmElement = null;
    let unlockPromise = null;
    let fadeIntervalId = null;
    const activeBgmNodes = new Set();
    const bgmAudioElements = new Map();

    function clearFadeInterval() {
      if (fadeIntervalId) {
        window.clearInterval(fadeIntervalId);
        fadeIntervalId = null;
      }
    }

    function transitionBgm(newId, durationMs) {
      clearFadeInterval();
      const steps = 10;
      const stepMs = durationMs / steps;
      let currentStep = 0;

      const startElementVol = activeBgmElement ? activeBgmElement.volume : 0;
      const startSynthVol = bgmGain ? bgmGain.gain.value : 1.0;

      if (durationMs <= 0) {
        stopBgmPlayback();
        if (newId) {
          startBgmPlayback(newId).then((started) => {
            if (started) {
              const pattern = bgmPatterns[newId];
              if (activeBgmElement) {
                activeBgmElement.volume = Math.max(0, Math.min(1, pattern && pattern.volume !== undefined ? pattern.volume : masterVolume));
              }
              if (bgmGain) bgmGain.gain.value = 1.0;
            }
          });
        }
        return;
      }

      fadeIntervalId = window.setInterval(() => {
        currentStep += 1;
        const ratio = 1 - (currentStep / steps);

        if (activeBgmElement) {
          activeBgmElement.volume = Math.max(0, startElementVol * ratio);
        }
        if (bgmGain) {
          bgmGain.gain.value = Math.max(0, startSynthVol * ratio);
        }

        if (currentStep >= steps) {
          clearFadeInterval();
          stopBgmPlayback();

          if (newId) {
            const pattern = bgmPatterns[newId];
            if (pattern && pattern.src) {
              const el = getBgmAudioElement(newId, pattern);
              el.volume = 0;
            }
            if (bgmGain) bgmGain.gain.value = 0;

            startBgmPlayback(newId).then((started) => {
              if (started) fadeInBgm(newId, durationMs);
            });
          }
        }
      }, stepMs);
    }

    function fadeInBgm(id, durationMs) {
      clearFadeInterval();
      const pattern = bgmPatterns[id];
      const targetVol = Math.max(0, Math.min(1, pattern && pattern.volume !== undefined ? pattern.volume : masterVolume));
      const steps = 10;
      const stepMs = durationMs / steps;
      let currentStep = 0;

      if (activeBgmElement) activeBgmElement.volume = 0;
      if (bgmGain) bgmGain.gain.value = 0;

      fadeIntervalId = window.setInterval(() => {
        if (desiredBgmId !== id) {
          clearFadeInterval();
          return;
        }

        currentStep += 1;
        const ratio = currentStep / steps;

        if (activeBgmElement) {
          activeBgmElement.volume = Math.min(targetVol, targetVol * ratio);
        }
        if (bgmGain) {
          bgmGain.gain.value = Math.min(1.0, 1.0 * ratio);
        }

        if (currentStep >= steps) {
          clearFadeInterval();
        }
      }, stepMs);
    }

    function ensureContext() {
      if (!AudioContextCtor) {
        return null;
      }

      if (!context) {
        context = new AudioContextCtor();
        masterGain = context.createGain();
        masterGain.gain.value = masterVolume;
        masterGain.connect(context.destination);

        bgmGain = context.createGain();
        bgmGain.gain.value = 1.0;
        bgmGain.connect(masterGain);

        seGain = context.createGain();
        seGain.gain.value = 1.0;
        seGain.connect(masterGain);
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

      const isBgm = collection === activeBgmNodes;
      const targetGain = isBgm ? bgmGain : seGain;

      oscillator.connect(gain);
      gain.connect(targetGain || masterGain);
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
        if (desiredBgmId !== id) {
          element.pause();
          element.currentTime = 0;
          if (activeBgmElement === element) activeBgmElement = null;
          return false;
        }
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
          playBgm(desiredBgmId);
          return true;
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
        transitionBgm("", 200);
        return;
      }

      if (!unlocked) {
        return;
      }

      if (currentBgmId === desiredBgmId) {
        return;
      }

      // 現在何も再生されていない場合はフェードアウト処理を挟まず遅延なく再生する
      if (!currentBgmId) {
        transitionBgm(desiredBgmId, 0);
        return;
      }

      transitionBgm(desiredBgmId, 200);
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
