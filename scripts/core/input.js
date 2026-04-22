(() => {
  const App = window.MonsterPrototype;

  function createInputController() {
    const activeDirections = new Set();
    const deliveredDirections = new Set();
    const directionQueue = [];
    const actionQueue = [];
    const directionOrder = ["up", "right", "down", "left"];
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
      activeDirections.clear();
      deliveredDirections.clear();
      directionQueue.length = 0;
    }

    function setActionLock(locked, options) {
      actionsLocked = Boolean(locked);
      if (options && options.clearQueue) {
        clearActions();
        clearDirections();
      }
    }

    function handleKeyDown(event) {
      const key = event.key;

      if (["ArrowUp", "w", "W"].includes(key)) {
        activeDirections.add("up");
        event.preventDefault();
      } else if (["ArrowRight", "d", "D"].includes(key)) {
        activeDirections.add("right");
        event.preventDefault();
      } else if (["ArrowDown", "s", "S"].includes(key)) {
        activeDirections.add("down");
        event.preventDefault();
      } else if (["ArrowLeft", "a", "A"].includes(key)) {
        activeDirections.add("left");
        event.preventDefault();
      } else if (["z", "Z", " ", "Enter"].includes(key)) {
        if (event.repeat) {
          return;
        }
        queueAction("confirm");
        event.preventDefault();
      } else if (["x", "X", "Backspace", "Escape"].includes(key)) {
        if (event.repeat) {
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
      const key = event.key;
      if (["ArrowUp", "w", "W"].includes(key)) {
        activeDirections.delete("up");
        deliveredDirections.delete("up");
      } else if (["ArrowRight", "d", "D"].includes(key)) {
        activeDirections.delete("right");
        deliveredDirections.delete("right");
      } else if (["ArrowDown", "s", "S"].includes(key)) {
        activeDirections.delete("down");
        deliveredDirections.delete("down");
      } else if (["ArrowLeft", "a", "A"].includes(key)) {
        activeDirections.delete("left");
        deliveredDirections.delete("left");
      }
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

    function suppressTextGesture(event) {
      if (!isTextEditingTarget(event.target)) {
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
          if (activeDirections.has(direction)) {
            deliveredDirections.add(direction);
            return direction;
          }
        }
        return null;
      },
      attachDirectionButton(button, direction) {
        const activate = (event) => {
          event.preventDefault();
          activeDirections.add(direction);
          deliveredDirections.delete(direction);
          button.classList.add("is-active");
        };
        const deactivate = (event) => {
          const shouldQueueClickMove =
            event && event.type === "pointerup" && !deliveredDirections.has(direction);
          activeDirections.delete(direction);
          deliveredDirections.delete(direction);
          button.classList.remove("is-active");
          if (shouldQueueClickMove) {
            queueDirection(direction);
          }
        };

        button.addEventListener("pointerdown", activate);
        button.addEventListener("pointerup", deactivate);
        button.addEventListener("pointerleave", deactivate);
        button.addEventListener("pointercancel", deactivate);
      },
      attachActionButton(button, action, payload) {
        button.addEventListener("click", () => {
          queueAction(action, payload);
        });
      },
      clearActions,
      setActionLock,
      isActionLocked() {
        return actionsLocked;
      },
      clearDirections,
    };
  }

  App.core.createInputController = createInputController;
})();
