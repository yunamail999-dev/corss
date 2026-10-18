/**
 * 東方御弈 - 小盤暗棋（半盤 4x8）規則與洗牌引擎 (js/board-small.js)
 * 規格：4x8 棋盤，隨機覆蓋洗牌，階級位階制，兵吃帥，包隔子跳吃
 */

import { SIDE, PIECE_INFO } from './constants.js';

export class SmallBoard {
  constructor() {
    this.rows = 4;
    this.cols = 8;
    this.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    this.currentTurn = SIDE.RED; // 翻出第一子決定顏色
    this.playerSide = null;      // 玩家陣營（由首翻決定）
    this.aiSide = null;          // AI 陣營
    this.moveHistory = [];
    this.capturedPieces = { red: [], black: [] };
    this.unrevealedCount = 32;
    this.initBoard();
  }

  // 初始化並隨機洗牌 32 顆暗棋
  initBoard() {
    this.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    this.currentTurn = null; // 首翻前不預設誰走，首翻者翻出決定
    this.playerSide = null;
    this.aiSide = null;
    this.moveHistory = [];
    this.capturedPieces = { red: [], black: [] };
    this.unrevealedCount = 32;

    // 收集所有 32 顆棋子
    const piecesPool = [];
    for (const key in PIECE_INFO) {
      const p = PIECE_INFO[key];
      for (let i = 0; i < p.count; i++) {
        piecesPool.push({
          id: p.id,
          name: p.name,
          side: p.side,
          rank: p.rank,
          isRevealed: false // 預設背面覆蓋
        });
      }
    }

    // Fisher-Yates 現代洗牌演算法
    for (let i = piecesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [piecesPool[i], piecesPool[j]] = [piecesPool[j], piecesPool[i]];
    }

    // 鋪入 4x8 棋盤
    let index = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = piecesPool[index++];
      }
    }
  }

  // 複製小盤狀態（用於 AI 評估）
  clone() {
    const cloneBoard = new SmallBoard();
    cloneBoard.currentTurn = this.currentTurn;
    cloneBoard.playerSide = this.playerSide;
    cloneBoard.aiSide = this.aiSide;
    cloneBoard.unrevealedCount = this.unrevealedCount;
    cloneBoard.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) {
          cloneBoard.grid[r][c] = { ...this.grid[r][c] };
        }
      }
    }

    cloneBoard.moveHistory = [...this.moveHistory];
    cloneBoard.capturedPieces = {
      red: [...this.capturedPieces.red],
      black: [...this.capturedPieces.black]
    };
    return cloneBoard;
  }

  // 取得格子棋子
  getPiece(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.grid[r][c];
  }

  // 首翻棋子判定陣營
  assignSideByFirstFlip(flippedSide, whoFlipped) {
    // whoFlipped: 'player' | 'ai'
    if (whoFlipped === 'player') {
      this.playerSide = flippedSide;
      this.aiSide = flippedSide === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    } else {
      this.aiSide = flippedSide;
      this.playerSide = flippedSide === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    }
  }

  // 翻開指定格子的暗棋
  flipPiece(r, c, whoFlipped = 'player') {
    const piece = this.grid[r][c];
    if (!piece || piece.isRevealed) return null;

    piece.isRevealed = true;
    this.unrevealedCount--;

    // 若為第一顆翻開的棋子，綁定陣營
    if (!this.playerSide) {
      this.assignSideByFirstFlip(piece.side, whoFlipped);
      this.currentTurn = whoFlipped === 'player' ? this.aiSide : this.playerSide;
    } else {
      // 換手
      this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    }

    this.moveHistory.push({
      type: 'flip',
      r, c,
      piece: { ...piece }
    });

    return piece;
  }

  // 判定 A 棋子是否能吃 B 棋子（一般吃子位階）
  canCaptureNormal(attacker, defender) {
    if (!attacker.isRevealed || !defender.isRevealed) return false;
    if (attacker.side === defender.side) return false;

    // 特殊規則：兵/卒（rank 1）可吃 帥/將（rank 7）
    if (attacker.rank === 1 && defender.rank === 7) {
      return true;
    }
    // 特殊規則：帥/將（rank 7）不能吃 兵/卒（rank 1）
    if (attacker.rank === 7 && defender.rank === 1) {
      return false;
    }
    // 一般規則：大階級吃小階級，同階級互吃
    return attacker.rank >= defender.rank;
  }

  // 取得某顆已翻開明棋的合法移動或吃子手（包含空格移動、明棋吃子、以及暗棋翻吃）
  getLegalMovesForPiece(r, c, includeDark = true) {
    const piece = this.grid[r][c];
    if (!piece || !piece.isRevealed) return [];
    if (this.currentTurn && piece.side !== this.currentTurn) return [];

    const moves = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 1. 炮 / 包 走法（隔子跳吃敵明棋或翻吃暗棋，或單純走相鄰空格）
    if (piece.id === 'R_CANNON' || piece.id === 'B_CANNON') {
      // A. 單純移動到相鄰四格空格（不能吃相鄰子）
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
          if (this.grid[nr][nc] === null) {
            moves.push({ type: 'move', fromR: r, fromC: c, toR: nr, toC: nc, captured: null, piece });
          }
        }
      }

      // B. 隔子跳吃（上下左右四方向直線搜尋）
      for (const [dr, dc] of dirs) {
        let step = 1;
        let hurdleFound = false;

        while (true) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;
          const target = this.grid[nr][nc];

          if (!hurdleFound) {
            // 尋找砲架（明棋暗棋皆可做砲架）
            if (target !== null) {
              hurdleFound = true;
            }
          } else {
            // 已經有砲架，看下一個非空格子
            if (target !== null) {
              if (target.isRevealed) {
                if (target.side !== piece.side) {
                  moves.push({
                    type: 'capture',
                    fromR: r, fromC: c,
                    toR: nr, toC: nc,
                    captured: target,
                    isCannonShot: true,
                    piece
                  });
                }
              } else if (includeDark) {
                // 隔子跳吃未翻開暗棋！
                moves.push({
                  type: 'dark_capture',
                  fromR: r, fromC: c,
                  toR: nr, toC: nc,
                  isCannonShot: true,
                  piece
                });
              }
              break; // 遇到第二顆棋子無論如何中斷
            }
          }
          step++;
        }
      }
      return moves;
    }

    // 2. 其他六種棋子（帥/將、仕/士、相/象、俥/車、傌/馬、兵/卒）
    // 只能向相鄰四格移動、吃明棋或翻吃暗棋
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
        const target = this.grid[nr][nc];
        if (target === null) {
          // 移動到空格
          moves.push({ type: 'move', fromR: r, fromC: c, toR: nr, toC: nc, captured: null, piece });
        } else if (target.isRevealed) {
          if (this.canCaptureNormal(piece, target)) {
            // 吃敵方明棋
            moves.push({ type: 'capture', fromR: r, fromC: c, toR: nr, toC: nc, captured: target, piece });
          }
        } else if (includeDark) {
          // 相鄰翻吃未翻開暗棋！
          moves.push({
            type: 'dark_capture',
            fromR: r, fromC: c,
            toR: nr, toC: nc,
            piece
          });
        }
      }
    }

    return moves;
  }

  // 取得特定位置明棋的「連吃目標」（包含敵方明棋與可翻吃的暗棋）
  getConsecutiveCaptures(r, c) {
    const piece = this.grid[r][c];
    if (!piece || !piece.isRevealed) return [];

    const captures = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // 1. 炮 / 包
    if (piece.id === 'R_CANNON' || piece.id === 'B_CANNON') {
      for (const [dr, dc] of dirs) {
        let step = 1;
        let hurdleFound = false;

        while (true) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;
          const target = this.grid[nr][nc];

          if (!hurdleFound) {
            if (target !== null) {
              hurdleFound = true;
            }
          } else {
            if (target !== null) {
              if (target.isRevealed) {
                // 已翻開的敵方明棋
                if (target.side !== piece.side) {
                  captures.push({
                    type: 'capture',
                    fromR: r, fromC: c,
                    toR: nr, toC: nc,
                    captured: target,
                    isCannonShot: true,
                    piece
                  });
                }
              } else {
                // 未翻開的暗棋（可隔子翻吃冒險！）
                captures.push({
                  type: 'dark_capture',
                  fromR: r, fromC: c,
                  toR: nr, toC: nc,
                  isCannonShot: true,
                  piece
                });
              }
              break; // 遇到第二顆棋子無論如何中斷
            }
          }
          step++;
        }
      }
      return captures;
    }

    // 2. 其他六種棋子（帥/將、仕/士、相/象、俥/車、傌/馬、兵/卒）
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
        const target = this.grid[nr][nc];
        if (target !== null) {
          if (target.isRevealed) {
            // 已翻開的明棋（需位階符合）
            if (this.canCaptureNormal(piece, target)) {
              captures.push({
                type: 'capture',
                fromR: r, fromC: c,
                toR: nr, toC: nc,
                captured: target,
                piece
              });
            }
          } else {
            // 未翻開的暗棋（可相鄰翻吃冒險！）
            captures.push({
              type: 'dark_capture',
              fromR: r, fromC: c,
              toR: nr, toC: nc,
              piece
            });
          }
        }
      }
    }

    return captures;
  }

  // 嘗試吃暗棋（翻開並依位階判定是否吃下）
  attemptDarkCapture(fromR, fromC, toR, toC) {
    const attacker = this.grid[fromR][fromC];
    const target = this.grid[toR][toC];
    if (!attacker || !target || target.isRevealed) {
      return { success: false, reason: 'invalid' };
    }

    // 1. 將該暗棋翻開
    target.isRevealed = true;
    this.unrevealedCount--;

    // 2. 判定能否吃下
    let canEat = false;
    if (target.side !== attacker.side) {
      if (attacker.id === 'R_CANNON' || attacker.id === 'B_CANNON') {
        // 炮翻出敵棋，不受位階限制即可吃下
        canEat = true;
      } else {
        canEat = this.canCaptureNormal(attacker, target);
      }
    }

    if (canEat) {
      // 吃子成功！攻擊者移動過去吃掉該棋子
      this.grid[toR][toC] = attacker;
      this.grid[fromR][fromC] = null;
      this.capturedPieces[target.side].push(target);

      this.moveHistory.push({
        type: 'move',
        fromR, fromC, toR, toC,
        piece: attacker,
        captured: target,
        isDarkCapture: true,
        isCombo: true
      });

      return {
        success: true,
        captured: target
      };
    } else {
      // 吃子失敗判定
      if (target.side !== attacker.side) {
        // 翻出敵方大棋（或帥翻出小卒）：攻擊者自投羅網，攻擊者當場陣亡（被反吃離場）！
        this.grid[fromR][fromC] = null; // 攻擊者死亡離場
        this.capturedPieces[attacker.side].push(attacker);

        this.moveHistory.push({
          type: 'attacker_killed',
          fromR, fromC, toR, toC,
          piece: attacker,
          revealed: target,
          reason: 'killed_by_enemy'
        });

        return {
          success: false,
          attackerKilled: true,
          attacker: attacker,
          revealed: target,
          reason: 'killed_by_enemy'
        };
      } else {
        // 翻出己方陣營棋子（自己人）：不能相殘，攻擊者停留在原地，連吃中斷
        this.moveHistory.push({
          type: 'flip_fail',
          fromR, fromC, toR, toC,
          piece: attacker,
          revealed: target,
          reason: 'friendly'
        });

        return {
          success: false,
          attackerKilled: false,
          attacker: attacker,
          revealed: target,
          reason: 'friendly'
        };
      }
    }
  }

  // 手動結束回合（連吃完畢或主動停手時使用）
  endTurn() {
    this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
  }

  // 執行移動或吃子（switchTurn 控制是否立即輪到對手，連吃時可暫緩切換）
  makeMove(move, switchTurn = true) {
    const { fromR, fromC, toR, toC } = move;
    const movingPiece = this.grid[fromR][fromC];
    const capturedPiece = this.grid[toR][toC];

    this.grid[toR][toC] = movingPiece;
    this.grid[fromR][fromC] = null;

    if (capturedPiece) {
      this.capturedPieces[capturedPiece.side].push(capturedPiece);
    }

    this.moveHistory.push({
      type: 'move',
      fromR, fromC, toR, toC,
      piece: movingPiece,
      captured: capturedPiece,
      isCombo: !switchTurn
    });

    if (switchTurn) {
      this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    }
    return capturedPiece;
  }

  // 悔棋
  undoLastAction() {
    if (this.moveHistory.length === 0) return null;
    const lastAction = this.moveHistory.pop();

    if (lastAction.type === 'flip') {
      const { r, c } = lastAction;
      this.grid[r][c].isRevealed = false;
      this.unrevealedCount++;
      // 若是唯一一手，重設陣營
      if (this.moveHistory.length === 0) {
        this.playerSide = null;
        this.aiSide = null;
        this.currentTurn = null;
      } else {
        this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
      }
      return lastAction;
    }

    if (lastAction.type === 'move') {
      const { fromR, fromC, toR, toC, piece, captured, isCombo } = lastAction;
      this.grid[fromR][fromC] = piece;
      this.grid[toR][toC] = captured;

      if (captured) {
        this.capturedPieces[captured.side].pop();
      }

      if (!isCombo) {
        this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
      }
      return lastAction;
    }

    if (lastAction.type === 'flip_fail') {
      const { toR, toC } = lastAction;
      this.grid[toR][toC].isRevealed = false;
      this.unrevealedCount++;
      return lastAction;
    }

    if (lastAction.type === 'attacker_killed') {
      const { fromR, fromC, toR, toC, piece } = lastAction;
      this.grid[fromR][fromC] = piece;
      this.grid[toR][toC].isRevealed = false;
      this.unrevealedCount++;
      this.capturedPieces[piece.side].pop();
      return lastAction;
    }

    return null;
  }

  // 取得場上所有可翻棋的格子
  getUnrevealedTiles() {
    const list = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const piece = this.grid[r][c];
        if (piece && !piece.isRevealed) {
          list.push({ r, c });
        }
      }
    }
    return list;
  }

  // 取得當前輪到方的所有合法明棋走法
  getAllLegalMoves(side = this.currentTurn) {
    if (!side) return [];
    const moves = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const piece = this.grid[r][c];
        if (piece && piece.isRevealed && piece.side === side) {
          moves.push(...this.getLegalMovesForPiece(r, c));
        }
      }
    }
    return moves;
  }

  // 檢查小盤勝負狀態
  checkGameStatus() {
    // 若陣營尚未確定，對局繼續
    if (!this.playerSide) {
      return { isGameOver: false, winner: null, reason: '' };
    }

    // 計算雙方剩餘子力（場上未翻 + 場上已翻）
    let redAlive = 16 - this.capturedPieces.red.length;
    let blackAlive = 16 - this.capturedPieces.black.length;

    if (redAlive === 0) {
      return { isGameOver: true, winner: SIDE.BLACK, reason: '紅方棋子全滅！黑方獲勝！' };
    }
    if (blackAlive === 0) {
      return { isGameOver: true, winner: SIDE.RED, reason: '黑方棋子全滅！紅方獲勝！' };
    }

    // 若全場無暗棋，且當前輪到方無任何合法走步（困斃）
    const unrevealed = this.getUnrevealedTiles();
    const currentMoves = this.getAllLegalMoves(this.currentTurn);

    if (unrevealed.length === 0 && currentMoves.length === 0) {
      const winner = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
      return {
        isGameOver: true,
        winner: winner,
        reason: `${this.currentTurn === SIDE.RED ? '紅方' : '黑方'}無路可走（困斃）！${winner === SIDE.RED ? '紅方' : '黑方'}獲勝！`
      };
    }

    return { isGameOver: false, winner: null, reason: '' };
  }
}
