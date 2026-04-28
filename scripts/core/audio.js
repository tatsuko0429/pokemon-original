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
    const activeBgmNodes = new Set();

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
      const audioContext = ensureContext();
      if (!audioContext) {
        return false;
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      unlocked = true;
      if (desiredBgmId && desiredBgmId !== currentBgmId) {
        stopBgmPlayback();
        scheduleBgmLoop(desiredBgmId, bgmLoopToken);
      }
      return true;
    }

    function bindUserGesture(target) {
      const root = target || window;
      const handler = () => {
        unlock();
        root.removeEventListener("pointerdown", handler);
        root.removeEventListener("keydown", handler);
        root.removeEventListener("touchstart", handler);
      };

      root.addEventListener("pointerdown", handler, { passive: true });
      root.addEventListener("keydown", handler);
      root.addEventListener("touchstart", handler, { passive: true });
    }

    function playBgm(id) {
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
      scheduleBgmLoop(desiredBgmId, bgmLoopToken);
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
