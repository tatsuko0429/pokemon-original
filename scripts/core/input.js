(() => {
  const App = window.MonsterPrototype;

  function createInputController() {
    const keyboardDirections = new Set();
    const deliveredDirections = new Set();
    const directionQueue = [];
    const actionQueue = [];
    const activeHolds = new Set();
    const directionOrder = ["up", "right", "down", "left"];
    let activePointerDirection = "";
    let lastHapticAt = -Infinity;
    let actionsLocked = false;

    function queueAction(type, payload) {
      if (actionsLocked) {
        return;
      }

      actionQueue.push({
        type,
        payload: payload || null,
      });
    }

    function queueDirection(direction) {
      if (actionsLocked) {
        return;
      }

      directionQueue.push(direction);
    }

    function clearActions(types) {
      if (!types) {
        actionQueue.length = 0;
        return;
      }

      const filters = new Set(Array.isArray(types) ? types : [types]);
      for (let index = actionQueue.length - 1; index >= 0; index -= 1) {
        if (filters.has(actionQueue[index].type)) {
          actionQueue.splice(index, 1);
        }
      }
    }

    function clearDirections() {
      keyboardDirections.clear();
      activePointerDirection = "";
      deliveredDirections.clear();
      directionQueue.length = 0;
    }

    function clearHolds() {
      activeHolds.clear();
    }

    function setActionLock(locked, options) {
      actionsLocked = Boolean(locked);
      if (options && options.clearQueue) {
        clearActions();
        clearDirections();
        clearHolds();
      }
    }

    function handleKeyDown(event) {
      if (isTextEditingTarget(event.target)) {
        return;
      }

      const key = event.key;

      if (["ArrowUp", "w", "W"].includes(key)) {
        keyboardDirections.add("up");
        event.preventDefault();
      } else if (["ArrowRight", "d", "D"].includes(key)) {
        keyboardDirections.add("right");
        event.preventDefault();
      } else if (["ArrowDown", "s", "S"].includes(key)) {
        keyboardDirections.add("down");
        event.preventDefault();
      } else if (["ArrowLeft", "a", "A"].includes(key)) {
        keyboardDirections.add("left");
        event.preventDefault();
      } else if (["z", "Z", " ", "Enter"].includes(key)) {
        if (event.repeat) {
          return;
        }
        queueAction("confirm");
        event.preventDefault();
      } else if (["x", "X"].includes(key)) {
        activeHolds.add("run");
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        queueAction("cancel");
        event.preventDefault();
      } else if (["Backspace", "Escape"].includes(key)) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        queueAction("cancel");
        event.preventDefault();
      } else if (["m", "M"].includes(key)) {
        if (event.repeat) {
          return;
        }
        queueAction("menu");
        event.preventDefault();
      }
    }

    function handleKeyUp(event) {
      if (isTextEditingTarget(event.target)) {
        return;
      }

      const key = event.key;
      if (["ArrowUp", "w", "W"].includes(key)) {
        keyboardDirections.delete("up");
        deliveredDirections.delete("up");
      } else if (["ArrowRight", "d", "D"].includes(key)) {
        keyboardDirections.delete("right");
        deliveredDirections.delete("right");
      } else if (["ArrowDown", "s", "S"].includes(key)) {
        keyboardDirections.delete("down");
        deliveredDirections.delete("down");
      } else if (["ArrowLeft", "a", "A"].includes(key)) {
        keyboardDirections.delete("left");
        deliveredDirections.delete("left");
      } else if (["x", "X"].includes(key)) {
        activeHolds.delete("run");
      }
    }

    function triggerHaptic() {
      if (!navigator.vibrate) {
        return;
      }

      const now = performance.now();
      if (now - lastHapticAt < 70) {
        return;
      }

      lastHapticAt = now;
      try {
        navigator.vibrate(8);
      } catch (error) {
        // 端末やブラウザ側で拒否された場合は、入力そのものを止めない。
      }
    }

    function hasActiveDirection(direction) {
      return keyboardDirections.has(direction) || activePointerDirection === direction;
    }

    function setPointerDirection(direction, buttons) {
      if (!direction || actionsLocked) {
        return;
      }

      if (activePointerDirection === direction) {
        return;
      }

      if (activePointerDirection) {
        deliveredDirections.delete(activePointerDirection);
      }
      activePointerDirection = direction;
      deliveredDirections.delete(direction);
      triggerHaptic();

      if (buttons) {
        Object.keys(buttons).forEach((key) => {
          buttons[key].classList.toggle("is-active", key === direction);
        });
      }
    }

    function clearPointerDirection(buttons) {
      if (buttons) {
        Object.keys(buttons).forEach((key) => {
          buttons[key].classList.remove("is-active");
        });
      }
      if (activePointerDirection) {
        deliveredDirections.delete(activePointerDirection);
      }
      activePointerDirection = "";
    }

    function getDirectionFromPadPoint(container, event) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const deadZone = Math.min(rect.width, rect.height) * 0.11;

      if (Math.abs(dx) < deadZone && Math.abs(dy) < deadZone) {
        return activePointerDirection || "";
      }

      if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0 ? "right" : "left";
      }

      return dy > 0 ? "down" : "up";
    }

    function isTextEditingTarget(target) {
      return Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
      );
    }

    function isWithinAppShell(target) {
      return Boolean(target && typeof target.closest === "function" && target.closest(".app-shell"));
    }

    function suppressTextGesture(event) {
      if (isWithinAppShell(event.target) && !isTextEditingTarget(event.target)) {
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("selectstart", suppressTextGesture);
    document.addEventListener("dragstart", suppressTextGesture);
    document.addEventListener("contextmenu", suppressTextGesture);

    return {
      consumeAction(expectedAction) {
        return Boolean(this.consumeCommand(expectedAction));
      },
      consumeCommand(expectedAction) {
        const index = actionQueue.findIndex((entry) => entry.type === expectedAction);
        if (index < 0) {
          return null;
        }
        return actionQueue.splice(index, 1)[0];
      },
      getDirection() {
        const queuedDirection = directionQueue.shift();
        if (queuedDirection) {
          return queuedDirection;
        }

        for (const direction of directionOrder) {
          if (hasActiveDirection(direction)) {
            deliveredDirections.add(direction);
            return direction;
          }
        }
        return null;
      },
      attachDirectionButton(button, direction) {
        const activate = (event) => {
          event.preventDefault();
          setPointerDirection(direction, { [direction]: button });
        };
        const deactivate = (event) => {
          const shouldQueueClickMove =
            event && event.type === "pointerup" && !deliveredDirections.has(direction);
          if (shouldQueueClickMove) {
            queueDirection(direction);
          }
          clearPointerDirection({ [direction]: button });
        };

        button.addEventListener("pointerdown", activate);
        button.addEventListener("pointerup", deactivate);
        button.addEventListener("pointerleave", deactivate);
        button.addEventListener("pointercancel", deactivate);
      },
      attachDirectionalPad(container, buttons) {
        const updateDirection = (event) => {
          const direction = getDirectionFromPadPoint(container, event);
          if (direction) {
            setPointerDirection(direction, buttons);
          }
        };
        const release = (event) => {
          if (event) {
            event.preventDefault();
          }
          const direction = activePointerDirection;
          if (direction && !deliveredDirections.has(direction)) {
            queueDirection(direction);
          }
          clearPointerDirection(buttons);
        };

        container.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          if (container.setPointerCapture && event.pointerId !== undefined) {
            container.setPointerCapture(event.pointerId);
          }
          updateDirection(event);
        });
        container.addEventListener("pointermove", (event) => {
          event.preventDefault();
          updateDirection(event);
        });
        container.addEventListener("pointerup", release);
        container.addEventListener("pointerleave", release);
        container.addEventListener("pointercancel", release);
      },
      attachActionButton(button, action, payload) {
        let handledByPointer = false;
        const activate = (event) => {
          event.preventDefault();
          button.classList.add("is-active");
          triggerHaptic();
          if (button.setPointerCapture && event.pointerId !== undefined) {
            button.setPointerCapture(event.pointerId);
          }
        };
        const release = (event) => {
          event.preventDefault();
          button.classList.remove("is-active");
          handledByPointer = true;
          queueAction(action, payload);
        };
        const cancel = () => {
          button.classList.remove("is-active");
        };

        button.addEventListener("pointerdown", activate);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointerleave", cancel);
        button.addEventListener("pointercancel", cancel);
        button.addEventListener("click", (event) => {
          if (handledByPointer) {
            handledByPointer = false;
            event.preventDefault();
            return;
          }
          queueAction(action, payload);
        });
      },
      attachHoldButton(button, holdName) {
        const activate = (event) => {
          event.preventDefault();
          activeHolds.add(holdName);
          button.classList.add("is-active");
          triggerHaptic();
          if (button.setPointerCapture && event.pointerId !== undefined) {
            button.setPointerCapture(event.pointerId);
          }
        };
        const release = (event) => {
          if (event) {
            event.preventDefault();
          }
          activeHolds.delete(holdName);
          button.classList.remove("is-active");
        };

        button.addEventListener("pointerdown", activate);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointerleave", release);
        button.addEventListener("pointercancel", release);
      },
      clearActions,
      setActionLock,
      isActionLocked() {
        return actionsLocked;
      },
      isHoldActive(holdName) {
        return activeHolds.has(holdName);
      },
      clearDirections,
    };
  }

  App.core.createInputController = createInputController;
})();
