(() => {
  const App = window.MonsterPrototype;

  function createModalController(elements, store, audio) {
    const root = elements.root;
    const title = elements.title;
    const body = elements.body;
    const actionsRoot = elements.actionsRoot || elements.confirm.parentElement;
    const actionHandlers = new Map();
    const battlePixelArt = (App.data.pixelArt && App.data.pixelArt.battle) || {};
    let lastRenderKey = "";

    function createSpriteCanvas(spriteId, scaleMultiplier) {
      const sprite = battlePixelArt[spriteId];
      if (!sprite || !sprite.rows || sprite.rows.length === 0) {
        return null;
      }

      const scale = (sprite.scale || 1) * (scaleMultiplier || 3);
      const canvas = document.createElement("canvas");
      canvas.width = sprite.rows[0].length * scale;
      canvas.height = sprite.rows.length * scale;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;

      sprite.rows.forEach((row, rowIndex) => {
        row.split("").forEach((key, columnIndex) => {
          if (key === ".") {
            return;
          }

          ctx.fillStyle = sprite.palette[key];
          ctx.fillRect(columnIndex * scale, rowIndex * scale, scale, scale);
        });
      });

      return canvas;
    }

    function renderSection(section) {
      if (!section || !section.kind) {
        return null;
      }

      if (section.kind === "saveMeta") {
        const meta = document.createElement("div");
        meta.className = "modal-section modal-save-meta";
        meta.textContent = section.text || "";
        return meta;
      }

      if (section.kind === "ruleBox") {
        const wrapper = document.createElement("div");
        wrapper.className = "modal-section";

        const box = document.createElement("div");
        box.className = "modal-rule-box";
        const list = document.createElement("ul");
        list.className = "modal-rule-list";
        (section.items || []).forEach((item) => {
          const entry = document.createElement("li");
          entry.textContent = item;
          list.appendChild(entry);
        });
        box.appendChild(list);
        wrapper.appendChild(box);

        if (section.footer) {
          const footer = document.createElement("p");
          footer.className = "modal-rule-footer";
          footer.textContent = section.footer;
          wrapper.appendChild(footer);
        }

        return wrapper;
      }

      if (section.kind === "monsterPreview") {
        const wrapper = document.createElement("div");
        wrapper.className = "modal-section modal-monster-preview";

        const frame = document.createElement("div");
        frame.className = "modal-monster-frame";
        if (section.backgroundColor) {
          frame.style.background = [
            "radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.78), transparent 44%)",
            `linear-gradient(180deg, rgba(255, 255, 255, 0.84), ${section.backgroundColor})`,
          ].join(",");
        }
        const canvas = createSpriteCanvas(section.spriteId, section.scaleMultiplier);
        if (canvas) {
          frame.appendChild(canvas);
        }
        wrapper.appendChild(frame);

        if (section.caption) {
          const caption = document.createElement("div");
          caption.className = "modal-monster-caption";
          caption.textContent = section.caption;
          wrapper.appendChild(caption);
        }

        return wrapper;
      }

      return null;
    }

    function getActions(modal) {
      if (modal.actions && modal.actions.length > 0) {
        return modal.actions;
      }

      return [
        {
          id: "close",
          label: modal.buttonLabel || "閉じる",
          variant: "",
        },
      ];
    }

    function render() {
      const state = store.getState();
      const modal = state.modal;
      const isOpen = Boolean(modal && modal.open);
      const renderKey = JSON.stringify({
        open: isOpen,
        title: isOpen ? modal.title : "",
        lines: isOpen ? modal.lines : [],
        sections: isOpen ? modal.sections : [],
        buttonLabel: isOpen ? modal.buttonLabel : "",
        actions: isOpen ? getActions(modal) : [],
        dismissible: isOpen ? modal.dismissible : true,
      });

      root.classList.toggle("is-hidden", !isOpen);
      root.setAttribute("aria-hidden", String(!isOpen));

      if (renderKey === lastRenderKey) {
        return;
      }
      lastRenderKey = renderKey;

      if (!isOpen) {
        title.textContent = "";
        body.innerHTML = "";
        actionsRoot.innerHTML = "";
        actionsRoot.classList.remove("is-multiple");
        return;
      }

      title.textContent = modal.title;
      title.classList.toggle("is-hidden", !modal.title);
      body.innerHTML = "";
      actionsRoot.innerHTML = "";
      actionsRoot.classList.toggle("is-multiple", getActions(modal).length > 1);

      modal.lines.forEach((line) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        body.appendChild(paragraph);
      });

      (modal.sections || []).forEach((section) => {
        const element = renderSection(section);
        if (element) {
          body.appendChild(element);
        }
      });

      getActions(modal).forEach((action) => {
        const button = document.createElement("button");
        let handledByPointer = false;
        button.type = "button";
        button.className = `modal-button ${action.variant || ""}`.trim();
        button.textContent = action.label;
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          button.classList.add("is-active");
          if (button.setPointerCapture && event.pointerId !== undefined) {
            button.setPointerCapture(event.pointerId);
          }
        });
        button.addEventListener("pointerup", (event) => {
          event.preventDefault();
          button.classList.remove("is-active");
          handledByPointer = true;
          selectAction(action.id);
        });
        button.addEventListener("pointerleave", () => {
          button.classList.remove("is-active");
        });
        button.addEventListener("pointercancel", () => {
          button.classList.remove("is-active");
        });
        button.addEventListener("click", (event) => {
          if (handledByPointer) {
            handledByPointer = false;
            event.preventDefault();
            return;
          }
          selectAction(action.id);
        });
        actionsRoot.appendChild(button);
      });
    }

    function openModal(payload) {
      actionHandlers.clear();
      const actions = (payload.actions || []).map((action, index) => {
        const id = action.id || `action_${index}`;
        if (typeof action.onSelect === "function") {
          actionHandlers.set(id, action.onSelect);
        }
        return {
          id,
          label: action.label,
          variant: action.variant || "",
        };
      });

      store.update((state) => {
        state.modal = {
          open: true,
          title: payload.title,
          lines: (payload.lines || []).slice(),
          sections: (payload.sections || []).map((section) => ({ ...section })),
          buttonLabel: payload.buttonLabel || "閉じる",
          actions,
          dismissible: payload.dismissible !== false,
        };
      });
    }

    function closeModal(options) {
      if (!store.getState().modal.open) {
        return;
      }

      const shouldForce = options && options.force;
      if (!shouldForce && store.getState().modal.dismissible === false) {
        return;
      }

      actionHandlers.clear();
      store.update((state) => {
        state.modal = {
          open: false,
          title: "",
          lines: [],
          sections: [],
          buttonLabel: "閉じる",
          actions: [],
          dismissible: true,
        };
      });
      if (audio && !(options && options.silent)) {
        audio.playSe("cancel");
      }
    }

    function selectAction(actionId) {
      const modal = store.getState().modal;
      if (!modal.open) {
        return;
      }

      const handler = actionHandlers.get(actionId);
      if (handler) {
        handler();
        return;
      }

      closeModal();
    }

    function confirmPrimary() {
      const modal = store.getState().modal;
      if (!modal.open) {
        return;
      }

      selectAction(getActions(modal)[0].id);
    }

    function cancelModal() {
      closeModal();
    }

    root.addEventListener("click", (event) => {
      if (event.target === root || event.target.classList.contains("modal-backdrop")) {
        closeModal();
      }
    });

    return {
      render,
      openModal,
      closeModal,
      confirmPrimary,
      cancelModal,
      isOpen() {
        return store.getState().modal.open;
      },
    };
  }

  App.core.createModalController = createModalController;
})();
