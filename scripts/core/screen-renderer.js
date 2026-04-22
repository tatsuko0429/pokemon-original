(() => {
  const App = window.MonsterPrototype;

  function createScreenRenderer(canvas, messageElement, captionElement, dataRegistry) {
    const ctx = canvas.getContext("2d");
    const { screen, palette, fieldTiles, animation } = App.config.game;
    const damageAnimation = animation.damage;
    const fieldPixelArt = App.data.pixelArt.field;
    const battlePixelArt = App.data.pixelArt.battle || {};
    const directionVectors = {
      up: { x: 0, y: -1 },
      right: { x: 1, y: 0 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
    };
    ctx.imageSmoothingEnabled = false;

    function clear(color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, screen.width, screen.height);
    }

    function drawPatternSprite(sprite, x, y) {
      const baseX = Math.round(x);
      const baseY = Math.round(y);
      const scale = sprite.scale || 1;

      sprite.rows.forEach((row, rowIndex) => {
        row.split("").forEach((key, columnIndex) => {
          if (key === ".") {
            return;
          }
          ctx.fillStyle = sprite.palette[key];
          ctx.fillRect(baseX + columnIndex * scale, baseY + rowIndex * scale, scale, scale);
        });
      });
    }

    function drawCenteredPatternSprite(sprite, centerX, centerY) {
      const scale = sprite.scale || 1;
      const width = sprite.rows[0].length * scale;
      const height = sprite.rows.length * scale;
      drawPatternSprite(sprite, centerX - width / 2, centerY - height / 2);
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function drawTileAt(left, top, tileCode) {
      const tile = fieldTiles[tileCode] || fieldTiles["."];

      ctx.fillStyle = tile.color;
      ctx.fillRect(left, top, screen.tileSize, screen.tileSize);

      if (tileCode === "#") {
        ctx.fillStyle = palette.deepest;
        ctx.fillRect(left, top, screen.tileSize, 2);
        ctx.fillRect(left, top + 3, screen.tileSize, 1);
      } else if (tileCode === "~") {
        ctx.fillStyle = "#d8e0cf";
        ctx.fillRect(left, top + 1, screen.tileSize, 1);
        ctx.fillRect(left + 1, top + 4, screen.tileSize - 2, 1);
        ctx.fillStyle = "#526f75";
        ctx.fillRect(left, top + 6, screen.tileSize, 1);
      } else if (tileCode === "=") {
        ctx.fillStyle = "#c8a75e";
        ctx.fillRect(left, top + 1, screen.tileSize, 1);
        ctx.fillStyle = "#aa8d4b";
        ctx.fillRect(left, top + 6, screen.tileSize, 1);
      } else if (tileCode === "g") {
        ctx.fillStyle = "#566d3a";
        ctx.fillRect(left, top + 2, screen.tileSize, 4);
        ctx.fillStyle = "#d6c478";
        ctx.fillRect(left + 1, top + 1, 1, 1);
        ctx.fillRect(left + 4, top + 1, 1, 1);
        ctx.fillRect(left + 6, top + 3, 1, 1);
        ctx.fillStyle = "#819158";
        ctx.fillRect(left + 1, top + 4, 1, 3);
        ctx.fillRect(left + 3, top + 3, 1, 4);
        ctx.fillRect(left + 5, top + 4, 1, 3);
      }
    }

    function drawGrassOverlayAt(left, top) {
      ctx.fillStyle = "#455f31";
      ctx.fillRect(left, top + 4, screen.tileSize, 4);
      ctx.fillStyle = "#d1ba65";
      ctx.fillRect(left + 1, top + 4, 1, 1);
      ctx.fillRect(left + 3, top + 5, 1, 1);
      ctx.fillRect(left + 5, top + 4, 1, 1);
      ctx.fillRect(left + 6, top + 6, 1, 1);
    }

    function getBumpOffset(effect) {
      if (!effect || effect.kind !== "bump") {
        return { x: 0, y: 0 };
      }

      const vector = directionVectors[effect.direction] || { x: 0, y: 0 };
      const progress = Math.min(1, effect.elapsedMs / effect.durationMs);
      const amount = Math.sin(progress * Math.PI) * 1.25;
      return {
        x: vector.x * amount,
        y: vector.y * amount,
      };
    }

    function getInterpolatedPosition(player, bumpEffect) {
      const bump = getBumpOffset(bumpEffect);
      if (!player.moving) {
        return {
          x: player.x * screen.tileSize + bump.x,
          y: player.y * screen.tileSize + bump.y,
        };
      }

      const deltaX = player.toX - player.fromX;
      const deltaY = player.toY - player.fromY;
      return {
        x: (player.fromX + deltaX * player.progress) * screen.tileSize + bump.x,
        y: (player.fromY + deltaY * player.progress) * screen.tileSize + bump.y,
      };
    }

    function drawGrassStepEffect(effect, camera) {
      if (!effect || effect.kind !== "grass") {
        return;
      }

      const progress = Math.min(1, effect.elapsedMs / effect.durationMs);
      const left = effect.x * screen.tileSize - camera.offsetX;
      const top = effect.y * screen.tileSize - camera.offsetY;
      const lift = Math.round(progress * 2);

      ctx.save();
      ctx.globalAlpha = 1 - progress * 0.55;
      ctx.fillStyle = palette.white;
      ctx.fillRect(left + 1, top + 3 - lift, 1, 2);
      ctx.fillRect(left + 6, top + 3 - lift, 1, 2);
      ctx.fillStyle = "#455f31";
      ctx.fillRect(left + 2, top + 5 - lift, 1, 2);
      ctx.fillRect(left + 4, top + 4 - lift, 1, 3);
      ctx.fillRect(left + 6, top + 5 - lift, 1, 2);
      ctx.restore();
    }

    function getFieldCamera(mapDef, playerPosition) {
      const mapWidth = mapDef.rows[0].length * screen.tileSize;
      const mapHeight = mapDef.rows.length * screen.tileSize;
      const offsetX = clamp(
        playerPosition.x + screen.tileSize / 2 - screen.width / 2,
        0,
        Math.max(0, mapWidth - screen.width)
      );
      const offsetY = clamp(
        playerPosition.y + screen.tileSize / 2 - screen.height / 2,
        0,
        Math.max(0, mapHeight - screen.height)
      );

      return {
        offsetX,
        offsetY,
        startTileX: Math.floor(offsetX / screen.tileSize),
        startTileY: Math.floor(offsetY / screen.tileSize),
        endTileX: Math.min(
          mapDef.rows[0].length,
          Math.ceil((offsetX + screen.width) / screen.tileSize) + 1
        ),
        endTileY: Math.min(
          mapDef.rows.length,
          Math.ceil((offsetY + screen.height) / screen.tileSize) + 1
        ),
      };
    }

    function isVisible(x, y) {
      return (
        x >= -screen.tileSize &&
        y >= -screen.tileSize &&
        x <= screen.width &&
        y <= screen.height
      );
    }

    function getVisibleFieldEvents(state, mapDef) {
      const resolvedIds = new Set((state.progress && state.progress.resolvedEventIds) || []);
      return (mapDef.events || [])
        .filter((event) => event.sprite && !resolvedIds.has(event.id))
        .sort((left, right) => left.y - right.y || left.x - right.x);
    }

    function drawField(state) {
      clear(palette.light);
      const mapDef = dataRegistry.getMap(state.field.mapId);
      const playerPos = getInterpolatedPosition(state.field.player, state.field.bumpEffect);
      const camera = getFieldCamera(mapDef, playerPos);

      for (let rowIndex = camera.startTileY; rowIndex < camera.endTileY; rowIndex += 1) {
        const row = mapDef.rows[rowIndex];
        for (let columnIndex = camera.startTileX; columnIndex < camera.endTileX; columnIndex += 1) {
          drawTileAt(
            columnIndex * screen.tileSize - camera.offsetX,
            rowIndex * screen.tileSize - camera.offsetY,
            row[columnIndex]
          );
        }
      }

      getVisibleFieldEvents(state, mapDef).forEach((event) => {
        const x = event.x * screen.tileSize - camera.offsetX;
        const y = event.y * screen.tileSize - camera.offsetY;
        const sprite = fieldPixelArt[event.sprite];
        if (sprite && isVisible(x, y)) {
          drawPatternSprite(sprite, x, y);
        }
      });

      drawPatternSprite(fieldPixelArt.player, playerPos.x - camera.offsetX, playerPos.y - camera.offsetY);

      for (let rowIndex = camera.startTileY; rowIndex < camera.endTileY; rowIndex += 1) {
        const row = mapDef.rows[rowIndex];
        for (let columnIndex = camera.startTileX; columnIndex < camera.endTileX; columnIndex += 1) {
          if (row[columnIndex] === "g") {
            drawGrassOverlayAt(
              columnIndex * screen.tileSize - camera.offsetX,
              rowIndex * screen.tileSize - camera.offsetY
            );
          }
        }
      }

      drawGrassStepEffect(state.field.stepEffect, camera);
    }

    function getBattleAnimation(state, target) {
      if (
        !state.battle ||
        !state.battle.animation ||
        state.battle.animation.kind !== "damage" ||
        state.battle.animation.target !== target
      ) {
        return null;
      }

      return state.battle.animation;
    }

    function getMonsterOffset(state, target) {
      const animation = getBattleAnimation(state, target);
      if (!animation) {
        return { x: 0, y: 0 };
      }

      const progress = Math.min(1, animation.elapsedMs / damageAnimation.wiggleDurationMs);
      const wiggle = Math.sin(progress * Math.PI * 5) * (1 - progress) * 4;
      return {
        x: target === "enemy" ? wiggle : -wiggle,
        y: 0,
      };
    }

    function shouldHideMonster(state, target) {
      if (
        target === "enemy" &&
        state.battle &&
        state.battle.captureBall &&
        state.battle.captureBall.hideEnemy
      ) {
        return true;
      }

      const animation = getBattleAnimation(state, target);
      if (!animation || animation.elapsedMs > damageAnimation.wiggleDurationMs) {
        return false;
      }

      return Math.floor(animation.elapsedMs / damageAnimation.flashIntervalMs) % 2 === 1;
    }

    function drawBattleMonster(position, species, view) {
      const spriteKey = view === "back" ? "battleBack" : "battleFront";
      const spriteId = species.spriteIds && species.spriteIds[spriteKey];
      const sprite = spriteId ? battlePixelArt[spriteId] : null;

      if (sprite) {
        drawCenteredPatternSprite(sprite, position.x, position.y);
        return;
      }

      ctx.fillStyle = species.palette.secondary;
      ctx.beginPath();
      ctx.ellipse(position.x, position.y, 18, 12, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = species.palette.primary;
      if (species.shape === "bud") {
        ctx.beginPath();
        ctx.ellipse(position.x, position.y, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(position.x - 2, position.y - 14, 4, 8);
      } else if (species.shape === "flare") {
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - 14);
        ctx.lineTo(position.x + 14, position.y + 10);
        ctx.lineTo(position.x - 14, position.y + 10);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - 14);
        ctx.quadraticCurveTo(position.x + 16, position.y - 2, position.x, position.y + 14);
        ctx.quadraticCurveTo(position.x - 16, position.y - 2, position.x, position.y - 14);
        ctx.fill();
      }

      ctx.fillStyle = palette.deepest;
      ctx.fillRect(position.x - 3, position.y - 3, 2, 2);
      ctx.fillRect(position.x + 1, position.y - 3, 2, 2);
    }

    function drawBallSprite(ballState) {
      const x = Math.round(ballState.x);
      const y = Math.round(ballState.y);
      const open = ballState.open || 0;
      const shellLift = ballState.phase === "release" ? Math.floor(open * 4) : 0;

      ctx.fillStyle = "rgba(31, 35, 24, 0.22)";
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      if (ballState.phase === "release" && open > 0.2) {
        ctx.fillStyle = `rgba(248, 244, 215, ${Math.max(0, 0.45 - open * 0.3)})`;
        ctx.beginPath();
        ctx.ellipse(x, y - 2, 16 + open * 8, 12 + open * 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = palette.white;
      ctx.beginPath();
      ctx.arc(x, y + shellLift, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.captureRed || "#b14933";
      ctx.beginPath();
      ctx.arc(x, y - 1 - shellLift, 5, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.deepest;
      ctx.fillRect(x - 5, y - 1, 10, 1);
      ctx.fillRect(x - 1, y - 2, 2, 2);

      ctx.fillStyle = palette.captureYellow || "#d8b546";
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    function drawCaptureBall(state) {
      if (!state.battle || !state.battle.captureBall) {
        return;
      }

      drawBallSprite(state.battle.captureBall);
    }

    function getBattleLayout() {
      return App.config.game.battleLayout || {
        groundY: 86,
        groundHeight: 18,
        enemy: {
          monsterX: 40,
          monsterY: 49,
          shadowX: 38,
          shadowY: 62,
          shadowWidth: 28,
          shadowHeight: 8,
        },
        player: {
          monsterX: 118,
          monsterY: 78,
          shadowX: 118,
          shadowY: 92,
          shadowWidth: 34,
          shadowHeight: 10,
        },
      };
    }

    function drawBattleShadow(position) {
      ctx.beginPath();
      ctx.ellipse(
        position.shadowX,
        position.shadowY,
        position.shadowWidth,
        position.shadowHeight,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    function drawBattle(state) {
      const layout = getBattleLayout();
      clear(palette.battleBg || "#ded7bf");
      ctx.fillStyle = palette.battleGround || "#c3b27a";
      ctx.fillRect(0, layout.groundY, screen.width, layout.groundHeight);
      ctx.fillStyle = palette.battleShadow || "#7b7f62";
      drawBattleShadow(layout.enemy);
      drawBattleShadow(layout.player);

      const playerMonster = state.party[0];
      const enemyMonster = state.battle.enemy;
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
      const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);
      const enemyOffset = getMonsterOffset(state, "enemy");
      const playerOffset = getMonsterOffset(state, "player");

      if (!shouldHideMonster(state, "enemy")) {
        drawBattleMonster(
          {
            x: layout.enemy.monsterX + enemyOffset.x,
            y: layout.enemy.monsterY + enemyOffset.y,
          },
          enemySpecies,
          "front"
        );
      }

      if (!shouldHideMonster(state, "player")) {
        drawBattleMonster(
          {
            x: layout.player.monsterX + playerOffset.x,
            y: layout.player.monsterY + playerOffset.y,
          },
          playerSpecies,
          "back"
        );
      }

      drawCaptureBall(state);
    }

    function drawTransitionOverlay(state) {
      if (!state.transition.active) {
        return;
      }

      if (state.transition.kind === "wild-encounter") {
        const progress = Math.min(1, state.transition.elapsedMs / state.transition.durationMs);
        const barWidth = Math.ceil(screen.width * progress);

        for (let index = 0; index < 12; index += 1) {
          const top = index * 12;
          const fromLeft = index % 2 === 0;
          ctx.fillStyle = index % 3 === 0 ? palette.white : palette.deepest;
          if (fromLeft) {
            ctx.fillRect(0, top, barWidth, 8);
          } else {
            ctx.fillRect(screen.width - barWidth, top, barWidth, 8);
          }
        }

        ctx.fillStyle = `rgba(248, 249, 238, ${progress * 0.35})`;
        ctx.fillRect(0, 0, screen.width, screen.height);
      }
    }

    function renderMessage(state, dataRegistryInstance) {
      let message = "";
      let caption = "";

      if (state.scene === "field") {
        message = state.field.message || "";
        caption = dataRegistryInstance.getMap(state.field.mapId).name;
      } else if (state.scene === "battle" && state.battle) {
        message = state.battle.currentMessage || "";
        caption = "やせいとの戦い";
      } else if (state.transition.active) {
        caption = dataRegistryInstance.getMap(state.field.mapId).name;
      }

      messageElement.textContent = message.replace(/\\n/g, "\n");
      messageElement.classList.toggle("is-hidden", message.length === 0);
      captionElement.textContent = caption;
      captionElement.classList.toggle("is-battle", state.scene === "battle");
    }

    function render(state) {
      if (state.scene === "field") {
        drawField(state);
      } else if (state.scene === "battle") {
        drawBattle(state);
      }

      drawTransitionOverlay(state);
      renderMessage(state, dataRegistry);
    }

    return {
      render,
    };
  }

  App.core.createScreenRenderer = createScreenRenderer;
})();
