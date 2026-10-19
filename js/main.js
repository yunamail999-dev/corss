/**
 * 東方御弈 - 遊戲主控制器 (js/main.js)
 * 統一管理大盤/小盤切換、AI 思考排程、棋局狀態、音效與 DOM 互動
 */

import { SIDE, GAME_MODE, AI_DIFFICULTY } from './constants.js';
import { sound } from './audio.js';
import { LargeBoard } from './board-large.js';
import { SmallBoard } from './board-small.js';
import { LargeAI } from './ai-large.js';
import { SmallAI } from './ai-small.js';

class XiangqiGameApp {
  constructor() {
    this.currentMode = GAME_MODE.LARGE; // 預設大盤模式
    this.difficulty = AI_DIFFICULTY.MEDIUM; // 預設進階難度
    this.playerSide = SIDE.RED; // 大盤預設玩家執紅先行
    this.aiSide = SIDE.BLACK;
    this.isAiThinking = false;
    this.isMuted = false;

    // 棋局實例與 AI
    this.largeBoard = new LargeBoard();
    this.smallBoard = new SmallBoard();
    this.largeAI = new LargeAI(this.difficulty);
    this.smallAI = new SmallAI(this.difficulty);

    // 互動狀態
    this.selectedSquare = null; // 當前選取的格子 { r, c }
    this.availableMoves = [];    // 當前可走步列表

    // 暗棋連吃玩法狀態
    this.isComboMode = true;     // 是否啟用連吃玩法（預設開啟）
    this.isComboActive = false;   // 當前是否處於連續吃子進擊中
    this.comboPieceCoord = null; // 正處於連吃進擊中的棋子座標 { r, c }
    this.comboCount = 0;         // 本回合連擊計數

    // 計時器
    this.timerInterval = null;
    this.playerSeconds = 0;
    this.aiSeconds = 0;

    // DOM 元素引用
    this.initDOMElements();
    // 偏好設定與戰績持久化
    this.stats = this.loadStats();
    this.loadUserPreferences();
    this.renderStats();
    this.bindEvents();
    this.startNewGame();
  }

  // 快取 DOM 元素
  initDOMElements() {
    this.dom = {
      modeLargeBtn: document.getElementById('mode-large-btn'),
      modeSmallBtn: document.getElementById('mode-small-btn'),
      difficultySelect: document.getElementById('difficulty-select'),
      playerSideSelect: document.getElementById('player-side-select'),
      muteBtn: document.getElementById('mute-btn'),
      undoBtn: document.getElementById('undo-btn'),
      restartBtn: document.getElementById('restart-btn'),
      boardContainer: document.getElementById('board-container'),
      historyList: document.getElementById('history-list'),
      playerCard: document.getElementById('player-card'),
      aiCard: document.getElementById('ai-card'),
      playerTimer: document.getElementById('player-timer'),
      aiTimer: document.getElementById('ai-timer'),
      playerCaptured: document.getElementById('player-captured'),
      aiCaptured: document.getElementById('ai-captured'),
      playerSideTag: document.getElementById('player-side-tag'),
      aiSideTag: document.getElementById('ai-side-tag'),
      thinkingIndicator: document.getElementById('thinking-indicator'),
      checkBanner: document.getElementById('check-banner'),
      gameoverModal: document.getElementById('gameover-modal'),
      gameoverTitle: document.getElementById('gameover-title'),
      gameoverReason: document.getElementById('gameover-reason'),
      modalRestartBtn: document.getElementById('modal-restart-btn'),
      modeDescription: document.getElementById('mode-description'),
      tipsContent: document.getElementById('tips-content'),
      // 連吃專屬元素
      comboSettingBox: document.getElementById('combo-setting-box'),
      comboModeToggle: document.getElementById('combo-mode-toggle'),
      comboStatusBanner: document.getElementById('combo-status-banner'),
      comboStatusText: document.getElementById('combo-status-text'),
      endComboBtn: document.getElementById('end-combo-btn'),
      comboPopupContainer: document.getElementById('combo-popup-container'),
      // 對弈生涯戰報統計元素
      statWins: document.getElementById('stat-wins'),
      statLosses: document.getElementById('stat-losses'),
      statDraws: document.getElementById('stat-draws'),
      statMaxCombo: document.getElementById('stat-max-combo'),
      resetStatsBtn: document.getElementById('reset-stats-btn')
    };
  }

  // 讀取累計戰績（本地 LocalStorage）
  loadStats() {
    try {
      const data = localStorage.getItem('yunamail_stats');
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('讀取戰績失敗:', e);
    }
    return { wins: 0, losses: 0, draws: 0, maxCombo: 0 };
  }

  // 儲存累計戰績
  saveStats() {
    try {
      localStorage.setItem('yunamail_stats', JSON.stringify(this.stats));
    } catch (e) {
      console.warn('儲存戰績失敗:', e);
    }
  }

  // 渲染戰績顯示
  renderStats() {
    if (!this.dom.statWins) return;
    this.dom.statWins.textContent = this.stats.wins;
    this.dom.statLosses.textContent = this.stats.losses;
    this.dom.statDraws.textContent = this.stats.draws;
    this.dom.statMaxCombo.textContent = this.stats.maxCombo;
  }

  // 重置累計戰績
  resetStats() {
    this.stats = { wins: 0, losses: 0, draws: 0, maxCombo: 0 };
    this.saveStats();
    this.renderStats();
  }

  // 讀取使用者自訂偏好（難度、連吃開關、音效）
  loadUserPreferences() {
    try {
      const savedDiff = localStorage.getItem('yunamail_difficulty');
      if (savedDiff && ['easy', 'amateur', 'medium', 'hard', 'grandmaster'].includes(savedDiff)) {
        this.difficulty = savedDiff;
        if (this.dom.difficultySelect) this.dom.difficultySelect.value = savedDiff;
        this.largeAI.setDifficulty(savedDiff);
        this.smallAI.setDifficulty(savedDiff);
      }

      const savedCombo = localStorage.getItem('yunamail_combo_mode');
      if (savedCombo !== null) {
        this.isComboMode = savedCombo === 'true';
        if (this.dom.comboModeToggle) this.dom.comboModeToggle.checked = this.isComboMode;
      }

      const savedMute = localStorage.getItem('yunamail_muted');
      if (savedMute !== null) {
        this.isMuted = savedMute === 'true';
        sound.setMuted(this.isMuted);
        if (this.dom.muteBtn) this.dom.muteBtn.innerHTML = this.isMuted ? '🔇' : '🔊';
      }
    } catch (e) {
      console.warn('讀取偏好設定失敗:', e);
    }
  }

  // 儲存偏好設定
  saveUserPreferences() {
    try {
      localStorage.setItem('yunamail_difficulty', this.difficulty);
      localStorage.setItem('yunamail_combo_mode', this.isComboMode ? 'true' : 'false');
      localStorage.setItem('yunamail_muted', this.isMuted ? 'true' : 'false');
    } catch (e) {
      console.warn('儲存偏好設定失敗:', e);
    }
  }

  // 綁定各項控制項事件
  bindEvents() {
    // 模式切換
    this.dom.modeLargeBtn.addEventListener('click', () => {
      if (this.currentMode !== GAME_MODE.LARGE) {
        sound.playClick();
        this.currentMode = GAME_MODE.LARGE;
        this.dom.modeLargeBtn.classList.add('active');
        this.dom.modeSmallBtn.classList.remove('active');
        this.dom.modeDescription.textContent = '【大盤模式】標準楚河漢界 9x10，將帥、士象、車馬炮卒競賽規則（玩家先手執紅）';
        if (this.dom.tipsContent) {
          this.dom.tipsContent.textContent = '大盤重在佈陣開拓，車佔要津、馬躍奔槽、炮倚山勢；謹慎防守九宮，避免將帥暴露。';
        }
        if (this.dom.comboSettingBox) {
          this.dom.comboSettingBox.classList.add('hidden');
        }
        this.resetComboState();
        this.startNewGame();
      }
    });

    this.dom.modeSmallBtn.addEventListener('click', () => {
      if (this.currentMode !== GAME_MODE.SMALL) {
        sound.playClick();
        this.currentMode = GAME_MODE.SMALL;
        this.dom.modeSmallBtn.classList.add('active');
        this.dom.modeLargeBtn.classList.remove('active');
        this.dom.modeDescription.textContent = '【小盤暗棋 - 連吃玩法】4x8 半盤隨機洗牌，首手玩家翻棋。支援「連吃」：吃子後四周若有可吃敵棋，可連續進擊！隨時可收手結束回合。';
        if (this.dom.tipsContent) {
          this.dom.tipsContent.textContent = '小盤連吃心法：乘勝追擊、隔山連打；吃子後周遭有可吃子可連續進擊，若前有陷阱亦可主動【結束連吃】見好就收。';
        }
        if (this.dom.comboSettingBox) {
          this.dom.comboSettingBox.classList.remove('hidden');
        }
        this.resetComboState();
        this.startNewGame();
      }
    });

    // 連吃開關切換
    if (this.dom.comboModeToggle) {
      this.dom.comboModeToggle.addEventListener('change', (e) => {
        this.isComboMode = e.target.checked;
        this.saveUserPreferences();
        sound.playClick();
        if (!this.isComboMode && this.isComboActive) {
          this.finishComboTurn('player');
        }
      });
    }

    // 手動結束連吃按鈕
    if (this.dom.endComboBtn) {
      this.dom.endComboBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isComboActive) {
          sound.playClick();
          this.finishComboTurn('player');
        }
      });
    }

    // 難度切換
    this.dom.difficultySelect.addEventListener('change', (e) => {
      this.difficulty = e.target.value;
      this.largeAI.setDifficulty(this.difficulty);
      this.smallAI.setDifficulty(this.difficulty);
      this.saveUserPreferences();
      sound.playClick();
    });

    // 音效切換
    this.dom.muteBtn.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      sound.setMuted(this.isMuted);
      this.dom.muteBtn.innerHTML = this.isMuted ? '🔇' : '🔊';
      this.saveUserPreferences();
      sound.playClick();
    });

    // 重置戰績按鈕
    if (this.dom.resetStatsBtn) {
      this.dom.resetStatsBtn.addEventListener('click', () => {
        if (confirm('確定要清空所有累積對弈戰績嗎？')) {
          sound.playClick();
          this.resetStats();
        }
      });
    }

    // 悔棋
    this.dom.undoBtn.addEventListener('click', () => {
      this.handleUndo();
    });

    // 重新開始
    this.dom.restartBtn.addEventListener('click', () => {
      sound.playClick();
      this.startNewGame();
    });

    this.dom.modalRestartBtn.addEventListener('click', () => {
      sound.playClick();
      this.dom.gameoverModal.classList.remove('show');
      this.startNewGame();
    });
  }

  // 開始新局
  startNewGame() {
    clearInterval(this.timerInterval);
    this.playerSeconds = 0;
    this.aiSeconds = 0;
    this.updateTimerDisplay();
    this.isAiThinking = false;
    this.resetComboState();
    this.selectedSquare = null;
    this.availableMoves = [];
    this.dom.historyList.innerHTML = '';
    this.dom.playerCaptured.innerHTML = '';
    this.dom.aiCaptured.innerHTML = '';
    this.dom.gameoverModal.classList.remove('show');
    this.dom.thinkingIndicator.classList.remove('active');

    if (this.currentMode === GAME_MODE.LARGE) {
      this.largeBoard.initBoard();
      this.updatePlayerSideTags(this.playerSide, this.aiSide);
      if (this.dom.comboSettingBox) {
        this.dom.comboSettingBox.classList.add('hidden');
      }
    } else {
      this.smallBoard.initBoard();
      this.updatePlayerSideTags('未定', '未定');
      if (this.dom.comboSettingBox) {
        this.dom.comboSettingBox.classList.remove('hidden');
      }
    }

    this.renderBoard();
    this.startTimer();

    // 規則鎖定：大盤與小盤永遠由玩家第一手先下
    this.playerSide = SIDE.RED;
    this.aiSide = SIDE.BLACK;
  }

  // 更新身分標籤
  updatePlayerSideTags(playerColor, aiColor) {
    const formatTag = (val) => {
      if (val === SIDE.RED) return { text: '執紅', cls: 'red' };
      if (val === SIDE.BLACK) return { text: '執黑', cls: 'black' };
      return { text: '陣營未定', cls: '' };
    };

    const p = formatTag(playerColor);
    const a = formatTag(aiColor);

    this.dom.playerSideTag.textContent = p.text;
    this.dom.playerSideTag.className = `side-tag ${p.cls}`;

    this.dom.aiSideTag.textContent = a.text;
    this.dom.aiSideTag.className = `side-tag ${a.cls}`;
  }

  // 渲染棋盤（依模式分派）
  renderBoard() {
    if (this.currentMode === GAME_MODE.LARGE) {
      this.renderLargeBoard();
    } else {
      this.renderSmallBoard();
    }
    this.updateStatusCards();
  }

  // 渲染大盤 (9x10)
  renderLargeBoard() {
    const board = this.largeBoard;
    let html = `
      <div class="board-wrapper">
        <div class="large-board" id="large-board-grid">
          <!-- SVG 棋盤格線 -->
          <svg class="board-svg-grid" viewBox="0 0 800 900" preserveAspectRatio="none">
            <!-- 外框深色粗線 -->
            <rect x="0" y="0" width="800" height="900" fill="none" class="outer-border-line" />
            <!-- 橫線 (10 條) -->
            ${Array.from({ length: 10 }).map((_, i) => `
              <line x1="0" y1="${i * 100}" x2="800" y2="${i * 100}" class="grid-line" />
            `).join('')}
            <!-- 縱線 (楚河漢界上下切開) -->
            ${Array.from({ length: 9 }).map((_, i) => {
              const x = i * 100;
              return `
                <line x1="${x}" y1="0" x2="${x}" y2="400" class="grid-line" />
                <line x1="${x}" y1="500" x2="${x}" y2="900" class="grid-line" />
              `;
            }).join('')}
            <!-- 兩側外圍縱線直接貫穿楚河 -->
            <line x1="0" y1="400" x2="0" y2="500" class="grid-line" />
            <line x1="800" y1="400" x2="800" y2="500" class="grid-line" />
            <!-- 九宮斜線 (黑方頂部) -->
            <line x1="300" y1="0" x2="500" y2="200" class="diagonal-line" />
            <line x1="500" y1="0" x2="300" y2="200" class="diagonal-line" />
            <!-- 九宮斜線 (紅方底部) -->
            <line x1="300" y1="700" x2="500" y2="900" class="diagonal-line" />
            <line x1="500" y1="700" x2="300" y2="900" class="diagonal-line" />
          </svg>

          <!-- 楚河漢界字樣與古典硃砂篆刻印章 -->
          <div class="river-banner">
            <span class="river-seal seal-chu">楚</span>
            <span class="river-text-left">楚河</span>
            <span class="river-divider">❖</span>
            <span class="river-text-right">漢界</span>
            <span class="river-seal seal-han">漢</span>
          </div>

          <!-- 動態金絲走步軌跡層 -->
          <svg class="board-trajectory-svg" id="large-trajectory-svg" viewBox="0 0 800 900">
            <defs>
              <linearGradient id="goldTrailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fff4c2" stop-opacity="0.95" />
                <stop offset="50%" stop-color="#d4af37" stop-opacity="1" />
                <stop offset="100%" stop-color="#966a1e" stop-opacity="0.4" />
              </linearGradient>
            </defs>
          </svg>

          <!-- 棋子與提示層 -->
          <div class="pieces-layer" id="large-pieces-layer"></div>
        </div>
      </div>
    `;

    this.dom.boardContainer.innerHTML = html;
    const layer = document.getElementById('large-pieces-layer');

    // 檢查兩方是否有將帥處於被將軍狀態
    const isRedChecked = board.isKingInCheck(SIDE.RED);
    const isBlackChecked = board.isKingInCheck(SIDE.BLACK);

    // 擺放棋子
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const piece = board.grid[r][c];
        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = `chess-piece side-${piece.side}`;
          pieceEl.style.top = `${r * 11.111}%`;
          pieceEl.style.left = `${c * 12.5}%`;

          if (this.selectedSquare && this.selectedSquare.r === r && this.selectedSquare.c === c) {
            pieceEl.classList.add('selected');
          }

          // 將帥被將軍時自身危險警報光環
          if ((piece.type === 'k' || piece.name === '帥' || piece.name === '將') &&
              ((piece.side === SIDE.RED && isRedChecked) || (piece.side === SIDE.BLACK && isBlackChecked))) {
            pieceEl.classList.add('king-in-check');
          }

          pieceEl.innerHTML = `<div class="piece-inner">${piece.name}</div>`;
          pieceEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleLargePieceClick(r, c);
          });
          layer.appendChild(pieceEl);
        }
      }
    }

    // 繪製最後一步落子標記與動態金絲流光軌跡
    if (board.moveHistory.length > 0) {
      const last = board.moveHistory[board.moveHistory.length - 1];

      // 落子目標點外圈旋轉金色光環
      const marker = document.createElement('div');
      marker.className = 'last-move-marker';
      marker.style.top = `${last.toR * 11.111}%`;
      marker.style.left = `${last.toC * 12.5}%`;
      layer.appendChild(marker);

      // 起始點淡雅金絲微光光環
      const srcMarker = document.createElement('div');
      srcMarker.className = 'last-move-source-marker';
      srcMarker.style.top = `${last.fromR * 11.111}%`;
      srcMarker.style.left = `${last.fromC * 12.5}%`;
      layer.appendChild(srcMarker);

      // 動態金絲走步軌跡線（以 SVG 二次貝茲曲線繪製流光）
      const trajectorySvg = document.getElementById('large-trajectory-svg');
      if (trajectorySvg) {
        const x1 = last.fromC * 100;
        const y1 = last.toC === last.fromC ? last.fromR * 100 : last.fromR * 100;
        const x2 = last.toC * 100;
        const y2 = last.toR * 100;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);

        if (dist > 5) {
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          // 向法向量方向適度微拱弧度
          const curveOffset = Math.min(28, Math.max(12, dist * 0.12));
          const cx = midX - (dy / dist) * curveOffset;
          const cy = midY + (dx / dist) * curveOffset;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
          path.setAttribute('class', 'trajectory-path');
          trajectorySvg.appendChild(path);
        }
      }
    }

    // 繪製合法走步提示指示點
    for (const move of this.availableMoves) {
      const isCapture = move.captured !== null;
      const indicator = document.createElement('div');
      indicator.className = isCapture ? 'capture-dest-indicator' : 'move-dest-indicator';
      indicator.style.top = `${move.toR * 11.111}%`;
      indicator.style.left = `${move.toC * 12.5}%`;

      indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        this.executeLargeMove(move);
      });

      layer.appendChild(indicator);
    }
  }

  // 渲染小盤暗棋 (4x8)
  renderSmallBoard() {
    const board = this.smallBoard;
    let html = `
      <div class="board-wrapper">
        <div class="small-board" id="small-board-grid"></div>
      </div>
    `;

    this.dom.boardContainer.innerHTML = html;
    const gridEl = document.getElementById('small-board-grid');

    // 取得小盤最後一手動態資訊（翻牌或移動落子點）
    const lastAction = board.moveHistory.length > 0 ? board.moveHistory[board.moveHistory.length - 1] : null;

    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const slot = document.createElement('div');
        slot.className = 'small-cell-slot';

        if (this.selectedSquare && this.selectedSquare.r === r && this.selectedSquare.c === c) {
          slot.classList.add('highlight-source');
        }

        // 標記小盤最後一手動向（翻牌或落子目標點金色高亮）
        if (lastAction) {
          if (lastAction.type === 'flip' && lastAction.r === r && lastAction.c === c) {
            slot.classList.add('last-action-target');
          } else if (lastAction.type === 'move' || lastAction.type === 'attacker_killed') {
            const toR = lastAction.toR ?? lastAction.move?.toR;
            const toC = lastAction.toC ?? lastAction.move?.toC;
            const fromR = lastAction.fromR ?? lastAction.move?.fromR;
            const fromC = lastAction.fromC ?? lastAction.move?.fromC;
            if (r === toR && c === toC) {
              slot.classList.add('last-action-target');
            } else if (r === fromR && c === fromC) {
              slot.classList.add('last-action-source');
            }
          }
        }

        const piece = board.grid[r][c];

        if (piece) {
          const card = document.createElement('div');
          card.className = `dark-piece-card ${piece.isRevealed ? 'is-revealed' : 'is-hidden'}`;

          // 正面（明棋）
          const front = document.createElement('div');
          front.className = `dark-card-face dark-card-front chess-piece side-${piece.side}`;
          front.innerHTML = `<div class="piece-inner">${piece.name}</div>`;

          // 背面（暗棋）
          const back = document.createElement('div');
          back.className = 'dark-card-face dark-card-back';

          card.appendChild(front);
          card.appendChild(back);
          slot.appendChild(card);

          slot.addEventListener('click', () => {
            this.handleSmallSlotClick(r, c);
          });
        } else {
          // 空槽點選（移動至此處）
          slot.addEventListener('click', () => {
            this.handleSmallSlotClick(r, c);
          });
        }

        // 走步提示指示點
        const targetMove = this.availableMoves.find(m => m.toR === r && m.toC === c);
        if (targetMove) {
          const indicator = document.createElement('div');
          if (targetMove.type === 'dark_capture') {
            indicator.className = 'dark-capture-dest-indicator';
            indicator.innerHTML = '⚡';
            indicator.title = '點擊翻吃暗棋冒險！';
          } else if (targetMove.type === 'capture') {
            indicator.className = 'capture-dest-indicator';
          } else {
            indicator.className = 'move-dest-indicator';
          }
          indicator.style.top = '50%';
          indicator.style.left = '50%';
          slot.appendChild(indicator);
        }

        gridEl.appendChild(slot);
      }
    }
  }

  // 觸發落子或翻棋時的優雅水墨光環漣漪
  triggerInkRipple(r, c, isSmall = false) {
    if (isSmall) {
      const gridEl = document.getElementById('small-board-grid');
      if (gridEl) {
        const slot = gridEl.children[r * 8 + c];
        if (slot) {
          const ripple = document.createElement('div');
          ripple.className = 'ink-ripple';
          slot.appendChild(ripple);
          setTimeout(() => ripple.remove(), 450);
        }
      }
    } else {
      const layer = document.getElementById('large-pieces-layer');
      if (layer) {
        const ripple = document.createElement('div');
        ripple.className = 'ink-ripple';
        ripple.style.top = `${r * 11.111}%`;
        ripple.style.left = `${c * 12.5}%`;
        layer.appendChild(ripple);
        setTimeout(() => ripple.remove(), 450);
      }
    }
  }

  // 大盤點選棋子處理
  handleLargePieceClick(r, c) {
    if (this.isAiThinking) return;
    const board = this.largeBoard;
    const piece = board.grid[r][c];

    // 若點擊目標是現有合法走步中的敵子（吃子）
    const targetMove = this.availableMoves.find(m => m.toR === r && m.toC === c);
    if (targetMove) {
      this.executeLargeMove(targetMove);
      return;
    }

    // 必須是當前輪到的方且是玩家執子
    if (!piece || piece.side !== board.currentTurn || piece.side !== this.playerSide) {
      this.selectedSquare = null;
      this.availableMoves = [];
      this.renderBoard();
      return;
    }

    sound.playClick();
    this.selectedSquare = { r, c };
    this.availableMoves = board.getLegalMovesForPiece(r, c);
    this.renderBoard();
  }

  // 大盤執行走步
  executeLargeMove(move) {
    const board = this.largeBoard;
    const captured = board.makeMove(move);

    if (captured) {
      sound.playCapture();
    } else {
      sound.playMove();
    }

    this.selectedSquare = null;
    this.availableMoves = [];

    // 記錄棋譜
    this.recordMoveHistory(move, captured);

    // 檢查將軍狀態
    const enemyInCheck = board.isKingInCheck(board.currentTurn);
    if (enemyInCheck) {
      sound.playCheck();
      this.showCheckAlert();
    }

    // 檢查終局
    const status = board.checkGameStatus();
    this.renderBoard();
    this.triggerInkRipple(move.toR, move.toC, false);

    if (status.isGameOver) {
      this.handleGameOver(status);
      return;
    }

    // 若換到 AI 走棋
    if (board.currentTurn === this.aiSide) {
      this.triggerAiTurn();
    }
  }

  // 重設連吃狀態
  resetComboState() {
    this.isComboActive = false;
    this.comboPieceCoord = null;
    this.comboCount = 0;
    this.hideComboBanner();
  }

  // 顯示連吃進擊狀態橫幅（精緻懸浮膠囊，文字簡短典雅）
  showComboBanner(count, who = 'player', lastCaptured = null) {
    if (!this.dom.comboStatusBanner) return;
    if (who === 'player') {
      this.dom.comboStatusText.textContent = `⚡ 連吃進擊中 (已連吃 ${count})：`;
      if (this.dom.endComboBtn) this.dom.endComboBtn.style.display = 'inline-block';
    } else {
      this.dom.comboStatusText.textContent = `⚡ 智腦連吃進擊中...`;
      if (this.dom.endComboBtn) this.dom.endComboBtn.style.display = 'none';
    }
    this.dom.comboStatusBanner.classList.remove('hidden');
  }

  // 隱藏連吃橫幅
  hideComboBanner() {
    if (this.dom.comboStatusBanner) {
      this.dom.comboStatusBanner.classList.add('hidden');
    }
  }

  // 棋盤吃子特效：保持純粹雅致，不再出現突兀的幽靈大字與飄字
  triggerPieceCaptureEffect(r, c, capturedPiece) {
    // 徹底移除突兀的幽靈浮誇字樣，保留極簡純粹的實木對弈體驗
    return;
  }

  // 觸發連吃爆發特效（嚴格過濾 count <= 1，絕不彈出突兀的「連吃 1」！）
  triggerComboPopup(count, capturedPiece = null) {
    // 單次吃子屬於正常落子，絕對不彈出任何「連吃 1」！
    if (count <= 1) return;
    if (!this.dom.comboPopupContainer) return;

    sound.playCombo(count);

    // 戰績最高連吃紀錄即時更新
    if (count > this.stats.maxCombo) {
      this.stats.maxCombo = count;
      this.saveStats();
      this.renderStats();
    }

    const box = document.createElement('div');
    box.className = 'combo-popup-box';
    const badgeText = `⚡ 連吃 x${count}！`;

    box.innerHTML = `
      <div class="combo-badge">${badgeText}</div>
    `;

    this.dom.comboPopupContainer.appendChild(box);

    setTimeout(() => {
      box.remove();
    }, 900);
  }

  // 結束連吃回合（玩家主動收手或無子可吃時使用）
  finishComboTurn(who = 'player') {
    this.resetComboState();
    this.selectedSquare = null;
    this.availableMoves = [];

    // 切換回合至對手
    this.smallBoard.endTurn();
    this.renderBoard();

    // 檢查勝負狀態
    const status = this.smallBoard.checkGameStatus();
    if (status.isGameOver) {
      this.handleGameOver(status);
      return;
    }

    // 若換到 AI 回合
    if (this.smallBoard.currentTurn === this.aiSide) {
      this.triggerAiTurn();
    }
  }

  // 小盤暗棋點選處理
  handleSmallSlotClick(r, c) {
    if (this.isAiThinking) return;
    const board = this.smallBoard;
    const piece = board.grid[r][c];

    // ==========================================
    // A. 處於連吃進擊狀態中的點擊處理
    // ==========================================
    if (this.isComboActive) {
      // 尋找目標是否為當前可連吃的敵方明棋或可翻吃的暗棋
      const targetMove = this.availableMoves.find(m => m.toR === r && m.toC === c);
      
      // 1. 連吃敵方已翻開明棋
      if (targetMove && targetMove.type === 'capture') {
        const captured = board.makeMove(targetMove, false);
        this.comboCount++;

        this.recordSmallHistory({
          type: 'move',
          move: targetMove,
          captured,
          who: '玩家',
          comboCount: this.comboCount
        });

        // 檢查勝負
        const status = board.checkGameStatus();
        if (status.isGameOver) {
          this.resetComboState();
          this.renderBoard();
          this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
          this.triggerComboPopup(this.comboCount, captured);
          this.handleGameOver(status);
          return;
        }

        // 檢查新位置是否還有下一波連吃目標（包含明棋與暗棋）
        const nextCaptures = board.getConsecutiveCaptures(targetMove.toR, targetMove.toC);
        if (nextCaptures.length > 0) {
          this.comboPieceCoord = { r: targetMove.toR, c: targetMove.toC };
          this.selectedSquare = { r: targetMove.toR, c: targetMove.toC };
          this.availableMoves = nextCaptures;
          this.showComboBanner(this.comboCount, 'player', captured);
          this.renderBoard();
          this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
          this.triggerComboPopup(this.comboCount, captured);
        } else {
          // 周圍已無任何明棋或暗棋可吃，自動結束連吃回合！
          this.renderBoard();
          this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
          this.triggerComboPopup(this.comboCount, captured);
          this.finishComboTurn('player');
        }
        return;
      }

      // 2. 連吃未翻開的暗棋（翻吃冒險！）
      if (targetMove && targetMove.type === 'dark_capture') {
        sound.playFlip();
        const res = board.attemptDarkCapture(this.comboPieceCoord.r, this.comboPieceCoord.c, r, c);

        if (res.success) {
          // 翻出敵方小棋，吃子成功！
          this.comboCount++;

          this.recordSmallHistory({
            type: 'move',
            move: { fromR: this.comboPieceCoord.r, fromC: this.comboPieceCoord.c, toR: r, toC: c, isCannonShot: targetMove.isCannonShot },
            captured: res.captured,
            who: '玩家',
            comboCount: this.comboCount,
            isDarkCapture: true
          });

          // 檢查勝負
          const status = board.checkGameStatus();
          if (status.isGameOver) {
            this.resetComboState();
            this.renderBoard();
            this.triggerPieceCaptureEffect(r, c, res.captured);
            this.triggerComboPopup(this.comboCount, res.captured);
            this.handleGameOver(status);
            return;
          }

          // 檢查新位置是否還有下一波連吃目標（明棋或暗棋）
          const nextCaptures = board.getConsecutiveCaptures(r, c);
          if (nextCaptures.length > 0) {
            this.comboPieceCoord = { r, c };
            this.selectedSquare = { r, c };
            this.availableMoves = nextCaptures;
            this.showComboBanner(this.comboCount, 'player', res.captured);
            this.renderBoard();
            this.triggerPieceCaptureEffect(r, c, res.captured);
            this.triggerComboPopup(this.comboCount, res.captured);
          } else {
            this.renderBoard();
            this.triggerPieceCaptureEffect(r, c, res.captured);
            this.triggerComboPopup(this.comboCount, res.captured);
            this.finishComboTurn('player');
          }
        } else {
          // 吃子失敗（翻出己方子，或踩雷翻出敵方大棋）
          if (res.attackerKilled) {
            sound.playCapture();
            this.recordSmallHistory({
              type: 'attacker_killed',
              who: '玩家',
              attacker: res.attacker,
              revealed: res.revealed
            });
            this.dom.comboStatusText.textContent = `💥 翻出【${res.revealed.name}】，${res.attacker.name} 踩雷陣亡！`;
          } else {
            sound.playMove();
            this.recordSmallHistory({
              type: 'flip_fail',
              who: '玩家',
              r, c,
              piece: res.revealed,
              reasonText: '己方陣營'
            });
            this.dom.comboStatusText.textContent = `💥 翻出【${res.revealed.name}】(己方子)，不可吃，連吃中斷！`;
          }

          this.renderBoard();
          const status = board.checkGameStatus();
          if (status.isGameOver) {
            this.resetComboState();
            this.handleGameOver(status);
            return;
          }

          setTimeout(() => {
            this.finishComboTurn('player');
          }, 850);
        }
        return;
      }

      // 玩家點選其他無效位置：視為主動收手結束連吃
      sound.playClick();
      this.finishComboTurn('player');
      return;
    }

    // ==========================================
    // B. 常規點擊處理（非連吃中）
    // ==========================================

    // 1. 若當前已有選中棋子，且點擊的目標為合法走步（走空格、吃明棋、翻吃暗棋）
    // 【極重要】：必須最優先判斷，避免暗棋吃子手被當成單純翻棋而換手！
    const targetMove = this.availableMoves.find(m => m.toR === r && m.toC === c);
    if (targetMove) {
      // (1) 吃已翻開的敵方明棋
      if (targetMove.type === 'capture') {
        if (this.isComboMode) {
          const captured = board.makeMove(targetMove, false);
          sound.playCapture();

          const status = board.checkGameStatus();
          if (status.isGameOver) {
            this.renderBoard();
            this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
            this.triggerComboPopup(1, captured);
            this.handleGameOver(status);
            return;
          }

          // 檢查新位置周遭是否有連吃目標（包含明棋與暗棋）
          const nextCaptures = board.getConsecutiveCaptures(targetMove.toR, targetMove.toC);
          if (nextCaptures.length > 0) {
            this.isComboActive = true;
            this.comboCount = 1;
            this.comboPieceCoord = { r: targetMove.toR, c: targetMove.toC };
            this.selectedSquare = { r: targetMove.toR, c: targetMove.toC };
            this.availableMoves = nextCaptures;
            this.showComboBanner(1, 'player', captured);

            this.recordSmallHistory({
              type: 'move',
              move: targetMove,
              captured,
              who: '玩家'
            });

            this.renderBoard();
            this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
            this.triggerComboPopup(1, captured);
            return; // 進入連吃狀態，等待玩家繼續吃！絕對不換電腦！
          } else {
            board.endTurn();
            this.selectedSquare = null;
            this.availableMoves = [];

            this.recordSmallHistory({
              type: 'move',
              move: targetMove,
              captured,
              who: '玩家'
            });

            this.renderBoard();
            this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
            this.triggerComboPopup(1, captured);
            if (board.currentTurn === this.aiSide) {
              this.triggerAiTurn();
            }
            return;
          }
        } else {
          // 一般無連吃模式
          const captured = board.makeMove(targetMove, true);
          sound.playCapture();
          this.selectedSquare = null;
          this.availableMoves = [];

          this.recordSmallHistory({
            type: 'move',
            move: targetMove,
            captured,
            who: '玩家'
          });

          this.renderBoard();
          this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, captured);
          const status = board.checkGameStatus();
          if (status.isGameOver) {
            this.handleGameOver(status);
            return;
          }
          if (board.currentTurn === this.aiSide) {
            this.triggerAiTurn();
          }
          return;
        }
      }

      // (2) 翻吃未翻開的暗棋（翻吃冒險！）
      if (targetMove.type === 'dark_capture') {
        sound.playFlip();
        const res = board.attemptDarkCapture(targetMove.fromR, targetMove.fromC, targetMove.toR, targetMove.toC);

        if (res.success) {
          // 翻出敵方小棋，吃子成功！
          if (this.isComboMode) {
            this.comboCount = 1;

            this.recordSmallHistory({
              type: 'move',
              move: targetMove,
              captured: res.captured,
              who: '玩家',
              comboCount: 1,
              isDarkCapture: true
            });

            const status = board.checkGameStatus();
            if (status.isGameOver) {
              this.renderBoard();
              this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, res.captured);
              this.triggerComboPopup(1, res.captured);
              this.handleGameOver(status);
              return;
            }

            // 檢查新位置周遭是否有下一波連吃目標（包含明棋與暗棋）
            const nextCaptures = board.getConsecutiveCaptures(targetMove.toR, targetMove.toC);
            if (nextCaptures.length > 0) {
              this.isComboActive = true;
              this.comboPieceCoord = { r: targetMove.toR, c: targetMove.toC };
              this.selectedSquare = { r: targetMove.toR, c: targetMove.toC };
              this.availableMoves = nextCaptures;
              this.showComboBanner(1, 'player', res.captured);
              this.renderBoard();
              this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, res.captured);
              this.triggerComboPopup(1, res.captured);
              return; // 立即進入連吃狀態，等待玩家繼續吃！絕對不換電腦！
            } else {
              board.endTurn();
              this.selectedSquare = null;
              this.availableMoves = [];
              this.renderBoard();
              this.triggerPieceCaptureEffect(targetMove.toR, targetMove.toC, res.captured);
              this.triggerComboPopup(1, res.captured);
              if (board.currentTurn === this.aiSide) {
                this.triggerAiTurn();
              }
              return;
            }
          } else {
            // 無連吃模式下單吃暗棋
            board.endTurn();
            this.selectedSquare = null;
            this.availableMoves = [];
            this.recordSmallHistory({
              type: 'move',
              move: targetMove,
              captured: res.captured,
              who: '玩家',
              isDarkCapture: true
            });
            this.renderBoard();
            const status = board.checkGameStatus();
            if (status.isGameOver) {
              this.handleGameOver(status);
              return;
            }
            if (board.currentTurn === this.aiSide) {
              this.triggerAiTurn();
            }
            return;
          }
        } else {
          // 翻出己方子或踩雷翻出敵方大棋
          if (res.attackerKilled) {
            sound.playCapture();
            this.recordSmallHistory({
              type: 'attacker_killed',
              who: '玩家',
              attacker: res.attacker,
              revealed: res.revealed
            });
          } else {
            sound.playMove();
            this.recordSmallHistory({
              type: 'flip_fail',
              who: '玩家',
              r: targetMove.toR,
              c: targetMove.toC,
              piece: res.revealed,
              reasonText: '己方陣營'
            });
          }

          board.endTurn();
          this.selectedSquare = null;
          this.availableMoves = [];
          this.renderBoard();

          const status = board.checkGameStatus();
          if (status.isGameOver) {
            this.handleGameOver(status);
            return;
          }

          if (board.currentTurn === this.aiSide) {
            this.triggerAiTurn();
          }
          return;
        }
      }

      // (3) 普通移動到空格
      if (targetMove.type === 'move') {
        board.makeMove(targetMove, true);
        sound.playMove();

        this.selectedSquare = null;
        this.availableMoves = [];

        this.recordSmallHistory({
          type: 'move',
          move: targetMove,
          captured: null,
          who: '玩家'
        });

        this.renderBoard();
        const status = board.checkGameStatus();
        if (status.isGameOver) {
          this.handleGameOver(status);
          return;
        }
        if (board.currentTurn === this.aiSide) {
          this.triggerAiTurn();
        }
        return;
      }
    }

    // 2. 若點選的是己方的已翻開明棋，且屬於當前輪到方：選取該棋子
    if (piece && piece.isRevealed && piece.side === board.currentTurn && piece.side === this.playerSide) {
      sound.playClick();
      this.selectedSquare = { r, c };
      // 包含暗棋翻吃！
      this.availableMoves = board.getLegalMovesForPiece(r, c, true);
      this.renderBoard();
      return;
    }

    // 3. 若點選未翻開的暗棋（且未處於吃暗棋動作中）：執行普通翻棋
    if (piece && !piece.isRevealed) {
      if (!board.playerSide || board.currentTurn === this.playerSide) {
        const flippedPiece = board.flipPiece(r, c, 'player');
        sound.playFlip();

        this.selectedSquare = null;
        this.availableMoves = [];

        // 若是首翻，更新身分
        if (this.playerSide !== board.playerSide) {
          this.playerSide = board.playerSide;
          this.aiSide = board.aiSide;
          this.updatePlayerSideTags(this.playerSide, this.aiSide);
        }

        this.recordSmallHistory({ type: 'flip', r, c, piece: flippedPiece, who: '玩家' });
        this.renderBoard();

        // 檢查勝負
        const status = board.checkGameStatus();
        if (status.isGameOver) {
          this.handleGameOver(status);
          return;
        }

        // 換 AI 行動
        if (board.currentTurn === this.aiSide) {
          this.triggerAiTurn();
        }
        return;
      }
    }

    // 4. 點選其他空白或無效處：取消選取
    this.selectedSquare = null;
    this.availableMoves = [];
    this.renderBoard();
  }

  // 觸發 AI 行動（排程非同步執行，維持畫面動效流暢）
  triggerAiTurn() {
    this.isAiThinking = true;
    this.dom.thinkingIndicator.classList.add('active');

    const thinkDelay = this.difficulty === AI_DIFFICULTY.HARD ? 450 : 350;

    setTimeout(() => {
      if (this.currentMode === GAME_MODE.LARGE) {
        const bestMove = this.largeAI.getBestMove(this.largeBoard, this.aiSide);
        if (bestMove) {
          const captured = this.largeBoard.makeMove(bestMove);
          if (captured) {
            sound.playCapture();
          } else {
            sound.playMove();
          }
          this.recordMoveHistory(bestMove, captured);

          // 檢查將軍
          if (this.largeBoard.isKingInCheck(this.playerSide)) {
            sound.playCheck();
            this.showCheckAlert();
          }
        }
        this.isAiThinking = false;
        this.dom.thinkingIndicator.classList.remove('active');
        this.renderBoard();

        const status = this.largeBoard.checkGameStatus();
        if (status.isGameOver) {
          this.handleGameOver(status);
        }
      } else {
        // 小盤暗棋 AI
        const bestAction = this.smallAI.getBestAction(this.smallBoard, this.aiSide);
        if (bestAction) {
          if (bestAction.action === 'flip') {
            const flipped = this.smallBoard.flipPiece(bestAction.r, bestAction.c, 'ai');
            sound.playFlip();

            // 若 AI 首翻決定陣營
            if (this.playerSide !== this.smallBoard.playerSide) {
              this.playerSide = this.smallBoard.playerSide;
              this.aiSide = this.smallBoard.aiSide;
              this.updatePlayerSideTags(this.playerSide, this.aiSide);
            }

            this.recordSmallHistory({ type: 'flip', r: bestAction.r, c: bestAction.c, piece: flipped, who: '電腦' });
            
            this.isAiThinking = false;
            this.dom.thinkingIndicator.classList.remove('active');
            this.renderBoard();

            const status = this.smallBoard.checkGameStatus();
            if (status.isGameOver) {
              this.handleGameOver(status);
            }
          } else if (bestAction.action === 'move') {
            const isCapture = bestAction.move.type === 'capture' && bestAction.move.captured !== null;

            if (isCapture && this.isComboMode) {
              // AI 吃子第一步（暫不切換回合）
              const captured = this.smallBoard.makeMove(bestAction.move, false);
              sound.playCapture();
              this.recordSmallHistory({ type: 'move', move: bestAction.move, captured, who: '電腦' });
              this.renderBoard();

              const status = this.smallBoard.checkGameStatus();
              if (status.isGameOver) {
                this.isAiThinking = false;
                this.dom.thinkingIndicator.classList.remove('active');
                this.handleGameOver(status);
                return;
              }

              // 檢查 AI 是否有連吃目標
              const nextCap = this.smallAI.getBestConsecutiveCapture(
                this.smallBoard,
                bestAction.move.toR,
                bestAction.move.toC,
                this.aiSide
              );

              if (nextCap) {
                // AI 啟動連擊循序進擊！
                this.executeAiCombo(bestAction.move.toR, bestAction.move.toC, 2);
              } else {
                // 無連吃目標，結束 AI 回合
                this.smallBoard.endTurn();
                this.isAiThinking = false;
                this.dom.thinkingIndicator.classList.remove('active');
                this.renderBoard();
              }
            } else {
              // 普通移動或未開啟連吃
              const captured = this.smallBoard.makeMove(bestAction.move, true);
              if (captured) {
                sound.playCapture();
              } else {
                sound.playMove();
              }
              this.recordSmallHistory({ type: 'move', move: bestAction.move, captured, who: '電腦' });

              this.isAiThinking = false;
              this.dom.thinkingIndicator.classList.remove('active');
              this.renderBoard();

              const status = this.smallBoard.checkGameStatus();
              if (status.isGameOver) {
                this.handleGameOver(status);
              }
            }
          }
        } else {
          this.isAiThinking = false;
          this.dom.thinkingIndicator.classList.remove('active');
        }
      }
    }, thinkDelay);
  }

  // AI 循序連吃處理（依序吃子，呈現動態打擊感與音效）
  executeAiCombo(curR, curC, comboStep) {
    this.showComboBanner(comboStep, 'ai');

    setTimeout(() => {
      const nextCap = this.smallAI.getBestConsecutiveCapture(
        this.smallBoard,
        curR,
        curC,
        this.aiSide
      );

      if (nextCap) {
        if (nextCap.type === 'capture') {
          const captured = this.smallBoard.makeMove(nextCap, false);

          this.recordSmallHistory({
            type: 'move',
            move: nextCap,
            captured,
            who: '電腦',
            comboCount: comboStep
          });

          this.renderBoard();
          this.triggerPieceCaptureEffect(nextCap.toR, nextCap.toC, captured);
          this.triggerComboPopup(comboStep, captured);
          this.showComboBanner(comboStep, 'ai', captured);

          const status = this.smallBoard.checkGameStatus();
          if (status.isGameOver) {
            this.hideComboBanner();
            this.isAiThinking = false;
            this.dom.thinkingIndicator.classList.remove('active');
            this.handleGameOver(status);
            return;
          }

          // 繼續檢查是否還有下一擊
          this.executeAiCombo(nextCap.toR, nextCap.toC, comboStep + 1);
        } else if (nextCap.type === 'dark_capture') {
          // AI 發動連吃翻暗棋
          sound.playFlip();
          const res = this.smallBoard.attemptDarkCapture(curR, curC, nextCap.toR, nextCap.toC);

          if (res.success) {
            this.recordSmallHistory({
              type: 'move',
              move: { fromR: curR, fromC: curC, toR: nextCap.toR, toC: nextCap.toC, isCannonShot: nextCap.isCannonShot },
              captured: res.captured,
              who: '電腦',
              comboCount: comboStep,
              isDarkCapture: true
            });

            this.renderBoard();
            this.triggerPieceCaptureEffect(nextCap.toR, nextCap.toC, res.captured);
            this.triggerComboPopup(comboStep, res.captured);
            this.showComboBanner(comboStep, 'ai', res.captured);

            const status = this.smallBoard.checkGameStatus();
            if (status.isGameOver) {
              this.hideComboBanner();
              this.isAiThinking = false;
              this.dom.thinkingIndicator.classList.remove('active');
              this.handleGameOver(status);
              return;
            }

            this.executeAiCombo(nextCap.toR, nextCap.toC, comboStep + 1);
          } else {
            // AI 翻出己方子或大於自己的敵棋，翻吃失敗，連吃中斷！
            if (res.attackerKilled) {
              sound.playCapture();
              this.recordSmallHistory({
                type: 'attacker_killed',
                who: '電腦',
                attacker: res.attacker,
                revealed: res.revealed
              });
              this.dom.comboStatusText.textContent = `💥 電腦翻出【${res.revealed.name}】，${res.attacker.name} 踩雷陣亡！`;
            } else {
              sound.playMove();
              const reasonText = res.reason === 'friendly' ? '己方陣營' : '敵方大棋';
              this.recordSmallHistory({
                type: 'flip_fail',
                who: '電腦',
                r: nextCap.toR,
                c: nextCap.toC,
                piece: res.revealed,
                reasonText
              });
              this.dom.comboStatusText.textContent = `💥 電腦翻出【${res.revealed.name}】(${reasonText})，連吃中斷！`;
            }

            this.renderBoard();

            const status = this.smallBoard.checkGameStatus();
            if (status.isGameOver) {
              this.hideComboBanner();
              this.isAiThinking = false;
              this.dom.thinkingIndicator.classList.remove('active');
              this.handleGameOver(status);
              return;
            }

            setTimeout(() => {
              this.hideComboBanner();
              this.smallBoard.endTurn();
              this.isAiThinking = false;
              this.dom.thinkingIndicator.classList.remove('active');
              this.renderBoard();
            }, 850);
          }
        }
      } else {
        // AI 連吃完畢，結束回合交給玩家
        this.hideComboBanner();
        this.smallBoard.endTurn();
        this.isAiThinking = false;
        this.dom.thinkingIndicator.classList.remove('active');
        this.renderBoard();
      }
    }, 450);
  }

  // 處理悔棋
  handleUndo() {
    if (this.isAiThinking) return;
    sound.playClick();

    if (this.currentMode === GAME_MODE.LARGE) {
      const board = this.largeBoard;
      if (board.moveHistory.length === 0) return;

      // 撤銷電腦的一步與玩家的一步（兩步）
      board.undoMove();
      if (board.moveHistory.length > 0 && board.currentTurn === this.aiSide) {
        board.undoMove();
      }
    } else {
      const board = this.smallBoard;
      if (board.moveHistory.length === 0) return;

      board.undoLastAction();
      if (board.moveHistory.length > 0 && board.currentTurn === this.aiSide) {
        board.undoLastAction();
      }
      this.playerSide = board.playerSide;
      this.aiSide = board.aiSide;
      this.updatePlayerSideTags(this.playerSide || '未定', this.aiSide || '未定');
    }

    this.selectedSquare = null;
    this.availableMoves = [];
    this.renderBoard();
  }

  // 將軍震撼特效提示
  showCheckAlert() {
    this.dom.checkBanner.classList.add('show');
    setTimeout(() => {
      this.dom.checkBanner.classList.remove('show');
    }, 1100);
  }

  // 處理遊戲結束
  handleGameOver(status) {
    clearInterval(this.timerInterval);

    if (status.winner === this.playerSide) {
      sound.playWin();
      this.dom.gameoverTitle.textContent = '🎉 大獲全勝！';
      this.stats.wins++;
    } else if (status.winner === this.aiSide) {
      this.dom.gameoverTitle.textContent = '⚔️ 棋差一著';
      this.stats.losses++;
    } else {
      this.dom.gameoverTitle.textContent = '🤝 雙方言和';
      this.stats.draws++;
    }

    this.saveStats();
    this.renderStats();

    this.dom.gameoverReason.textContent = status.reason;
    this.dom.gameoverModal.classList.add('show');
  }

  // 更新兩側玩家狀態卡（包含被吃棋子托盤）
  updateStatusCards() {
    const currentBoard = this.currentMode === GAME_MODE.LARGE ? this.largeBoard : this.smallBoard;
    const isPlayerTurn = currentBoard.currentTurn === this.playerSide;

    if (isPlayerTurn) {
      this.dom.playerCard.classList.add('active-turn');
      this.dom.aiCard.classList.remove('active-turn');
    } else {
      this.dom.aiCard.classList.add('active-turn');
      this.dom.playerCard.classList.remove('active-turn');
    }

    // 更新吃子展示托盤
    const renderMiniPieces = (capturedList, containerEl) => {
      containerEl.innerHTML = '';
      capturedList.forEach((p, idx) => {
        const mini = document.createElement('div');
        const isLatest = idx === capturedList.length - 1;
        mini.className = `mini-captured-piece ${p.side}${isLatest ? ' just-captured' : ''}`;
        mini.textContent = p.name;
        containerEl.appendChild(mini);
      });
    };

    // 玩家吃掉的敵子（在玩家托盤顯示）
    const playerCapturedList = this.playerSide === SIDE.RED ? currentBoard.capturedPieces.black : currentBoard.capturedPieces.red;
    const aiCapturedList = this.aiSide === SIDE.RED ? currentBoard.capturedPieces.black : currentBoard.capturedPieces.red;

    renderMiniPieces(playerCapturedList, this.dom.playerCaptured);
    renderMiniPieces(aiCapturedList, this.dom.aiCaptured);
  }

  // 大盤走步歷史記錄
  recordMoveHistory(move, captured) {
    const piece = move.piece || this.largeBoard.grid[move.toR][move.toC] || (captured ? captured : null);
    const side = (piece && piece.side) ? piece.side : (this.largeBoard.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED);
    const pieceName = (piece && piece.name) ? piece.name : '棋子';
    const sideName = side === SIDE.RED ? '紅方' : '黑方';
    const sideClass = `side-${side}`;
    const captureText = captured ? ` 吃 ${captured.name}` : '';
    const text = `${sideName} ${pieceName} (${move.fromR},${move.fromC}) ➔ (${move.toR},${move.toC})${captureText}`;

    this.appendHistoryItem(text, sideClass);
  }

  // 小盤暗棋歷史記錄
  recordSmallHistory(info) {
    if (!info) return;
    if (info.type === 'flip') {
      const p = info.piece;
      const pName = p?.name || '棋子';
      const pSide = p?.side || 'none';
      const text = `${info.who || '弈者'} 翻開 (${info.r},${info.c}) 出【${pName}】`;
      this.appendHistoryItem(text, `side-${pSide}`);
    } else if (info.type === 'flip_fail') {
      const p = info.piece;
      const pName = p?.name || '棋子';
      const pSide = p?.side || 'none';
      const text = `${info.who || '弈者'} 翻開 (${info.r},${info.c}) 出【${pName}】(${info.reasonText || '不可吃'})，連吃中斷！`;
      this.appendHistoryItem(text, `side-${pSide}`);
    } else if (info.type === 'move') {
      const { move, captured, who, comboCount, isDarkCapture } = info;
      const piece = move?.piece || (move ? this.smallBoard.grid[move.toR]?.[move.toC] : null) || captured || null;
      const pieceName = piece?.name || '棋子';
      const pieceSide = piece?.side || (this.smallBoard.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED);
      const isShot = move?.isCannonShot ? '【隔山打子】' : '';
      const darkTag = isDarkCapture ? '【翻吃暗棋】' : '';
      const captureText = captured?.name ? ` 吃 ${captured.name}` : '';
      const comboText = comboCount ? ` 🔥(連吃 x${comboCount})` : '';
      const fromCoord = move ? `(${move.fromR},${move.fromC})` : '';
      const toCoord = move ? `(${move.toR},${move.toC})` : '';
      const text = `${who || '弈者'} ${darkTag}${pieceName} ${fromCoord} ➔ ${toCoord} ${isShot}${captureText}${comboText}`;
      this.appendHistoryItem(text, `side-${pieceSide}`);
    }
  }

  appendHistoryItem(text, sideClass) {
    const item = document.createElement('div');
    item.className = `history-item ${sideClass}`;
    item.textContent = text;
    this.dom.historyList.prepend(item);
  }

  // 對局計時器
  startTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const currentBoard = this.currentMode === GAME_MODE.LARGE ? this.largeBoard : this.smallBoard;
      if (currentBoard.currentTurn === this.playerSide) {
        this.playerSeconds++;
      } else if (currentBoard.currentTurn === this.aiSide) {
        this.aiSeconds++;
      }
      this.updateTimerDisplay();
    }, 1000);
  }

  updateTimerDisplay() {
    const format = (sec) => {
      const m = Math.floor(sec / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };
    this.dom.playerTimer.textContent = format(this.playerSeconds);
    this.dom.aiTimer.textContent = format(this.aiSeconds);
  }
}

// 當 DOM 加載完畢初始化遊戲
document.addEventListener('DOMContentLoaded', () => {
  window.xiangqiGame = new XiangqiGameApp();
});
