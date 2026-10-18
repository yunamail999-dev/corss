/**
 * 東方御弈 - 大盤傳統象棋規則與棋局引擎 (js/board-large.js)
 * 規格：9x10 棋盤，完整實現中國象棋正式競賽規則
 */

import { SIDE, PIECE_INFO } from './constants.js';

export class LargeBoard {
  constructor() {
    this.rows = 10;
    this.cols = 9;
    this.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    this.currentTurn = SIDE.RED; // 紅方先行
    this.moveHistory = [];       // 歷史步法，供悔棋與復盤
    this.capturedPieces = { red: [], black: [] }; // 被吃棋子記錄
    this.initBoard();
  }

  // 初始化標準象棋開局
  initBoard() {
    this.grid = Array(this.rows).fill(null).map(() => Array(this.cols).fill(null));
    this.currentTurn = SIDE.RED;
    this.moveHistory = [];
    this.capturedPieces = { red: [], black: [] };

    // 黑方排布（row 0~3）
    const blackBackRank = [
      'B_ROOK', 'B_KNIGHT', 'B_BISHOP', 'B_ADVISOR', 'B_KING',
      'B_ADVISOR', 'B_BISHOP', 'B_KNIGHT', 'B_ROOK'
    ];
    for (let c = 0; c < 9; c++) {
      this.grid[0][c] = { ...PIECE_INFO[blackBackRank[c]] };
    }
    this.grid[2][1] = { ...PIECE_INFO.B_CANNON };
    this.grid[2][7] = { ...PIECE_INFO.B_CANNON };
    for (let c = 0; c < 9; c += 2) {
      this.grid[3][c] = { ...PIECE_INFO.B_PAWN };
    }

    // 紅方排布（row 6~9）
    for (let c = 0; c < 9; c += 2) {
      this.grid[6][c] = { ...PIECE_INFO.R_PAWN };
    }
    this.grid[7][1] = { ...PIECE_INFO.R_CANNON };
    this.grid[7][7] = { ...PIECE_INFO.R_CANNON };
    const redBackRank = [
      'R_ROOK', 'R_KNIGHT', 'R_BISHOP', 'R_ADVISOR', 'R_KING',
      'R_ADVISOR', 'R_BISHOP', 'R_KNIGHT', 'R_ROOK'
    ];
    for (let c = 0; c < 9; c++) {
      this.grid[9][c] = { ...PIECE_INFO[redBackRank[c]] };
    }
  }

  // 取得指定位置的棋子
  getPiece(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.grid[r][c];
  }

  // 複製棋盤狀態（用於 AI 搜尋與預演）
  clone() {
    const cloneBoard = new LargeBoard();
    cloneBoard.currentTurn = this.currentTurn;
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

  // 尋找特定陣營的將帥位置
  findKing(side) {
    const kingId = side === SIDE.RED ? 'R_KING' : 'B_KING';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const piece = this.grid[r][c];
        if (piece && piece.id === kingId) {
          return { r, c };
        }
      }
    }
    return null;
  }

  // 檢驗將帥是否照面（飛將對臉，中間無棋子遮擋）
  isKingsFacing() {
    const redKing = this.findKing(SIDE.RED);
    const blackKing = this.findKing(SIDE.BLACK);
    if (!redKing || !blackKing) return false;
    if (redKing.c !== blackKing.c) return false;

    const col = redKing.c;
    const startRow = Math.min(redKing.r, blackKing.r) + 1;
    const endRow = Math.max(redKing.r, blackKing.r);
    for (let r = startRow; r < endRow; r++) {
      if (this.grid[r][col] !== null) {
        return false; // 有棋子阻擋
      }
    }
    return true; // 中間全空，照面！
  }

  // 產生單一棋子的「基礎幾何走法」（不考慮是否令己方被將軍）
  getPseudoMoves(fromR, fromC) {
    const piece = this.grid[fromR][fromC];
    if (!piece) return [];
    const moves = [];
    const side = piece.side;

    const addMove = (toR, toC) => {
      if (toR < 0 || toR >= this.rows || toC < 0 || toC >= this.cols) return;
      const target = this.grid[toR][toC];
      if (!target || target.side !== side) {
        moves.push({ fromR, fromC, toR, toC, captured: target, piece });
      }
    };

    switch (piece.id) {
      // 帥 / 將：九宮格內橫直一步
      case 'R_KING':
      case 'B_KING': {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const minR = side === SIDE.RED ? 7 : 0;
        const maxR = side === SIDE.RED ? 9 : 2;
        const minC = 3, maxC = 5;

        for (const [dr, dc] of dirs) {
          const nr = fromR + dr;
          const nc = fromC + dc;
          if (nr >= minR && nr <= maxR && nc >= minC && nc <= maxC) {
            addMove(nr, nc);
          }
        }
        break;
      }

      // 仕 / 士：九宮格內斜走一步
      case 'R_ADVISOR':
      case 'B_ADVISOR': {
        const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        const minR = side === SIDE.RED ? 7 : 0;
        const maxR = side === SIDE.RED ? 9 : 2;
        const minC = 3, maxC = 5;

        for (const [dr, dc] of dirs) {
          const nr = fromR + dr;
          const nc = fromC + dc;
          if (nr >= minR && nr <= maxR && nc >= minC && nc <= maxC) {
            addMove(nr, nc);
          }
        }
        break;
      }

      // 相 / 象：田字走法，不能過河，防塞象眼
      case 'R_BISHOP':
      case 'B_BISHOP': {
        const bishopSteps = [
          { dr: -2, dc: -2, eyeR: -1, eyeC: -1 },
          { dr: -2, dc: 2,  eyeR: -1, eyeC: 1 },
          { dr: 2,  dc: -2, eyeR: 1,  eyeC: -1 },
          { dr: 2,  dc: 2,  eyeR: 1,  eyeC: 1 }
        ];
        const minR = side === SIDE.RED ? 5 : 0;
        const maxR = side === SIDE.RED ? 9 : 4;

        for (const step of bishopSteps) {
          const nr = fromR + step.dr;
          const nc = fromC + step.dc;
          const er = fromR + step.eyeR;
          const ec = fromC + step.eyeC;

          if (nr >= minR && nr <= maxR && nc >= 0 && nc <= 8) {
            // 檢查象眼是否被塞
            if (this.grid[er][ec] === null) {
              addMove(nr, nc);
            }
          }
        }
        break;
      }

      // 俥 / 車：直走橫走任意無阻擋步數
      case 'R_ROOK':
      case 'B_ROOK': {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          let step = 1;
          while (true) {
            const nr = fromR + dr * step;
            const nc = fromC + dc * step;
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;
            const target = this.grid[nr][nc];
            if (target === null) {
              moves.push({ fromR, fromC, toR: nr, toC: nc, captured: null, piece });
            } else {
              if (target.side !== side) {
                moves.push({ fromR, fromC, toR: nr, toC: nc, captured: target, piece });
              }
              break; // 撞到棋子就停
            }
            step++;
          }
        }
        break;
      }

      // 傌 / 馬：日字走法，防拐馬腳
      case 'R_KNIGHT':
      case 'B_KNIGHT': {
        const knightSteps = [
          { dr: -2, dc: -1, legR: -1, legC: 0 },
          { dr: -2, dc: 1,  legR: -1, legC: 0 },
          { dr: 2,  dc: -1, legR: 1,  legC: 0 },
          { dr: 2,  dc: 1,  legR: 1,  legC: 0 },
          { dr: -1, dc: -2, legR: 0,  legC: -1 },
          { dr: 1,  dc: -2, legR: 0,  legC: -1 },
          { dr: -1, dc: 2,  legR: 0,  legC: 1 },
          { dr: 1,  dc: 2,  legR: 0,  legC: 1 }
        ];

        for (const step of knightSteps) {
          const nr = fromR + step.dr;
          const nc = fromC + step.dc;
          const lr = fromR + step.legR;
          const lc = fromC + step.legC;

          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
            // 檢查馬腳是否有棋子阻礙
            if (this.grid[lr][lc] === null) {
              addMove(nr, nc);
            }
          }
        }
        break;
      }

      // 炮 / 砲：不吃子同車，吃子必須翻山跳過一子
      case 'R_CANNON':
      case 'B_CANNON': {
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          let step = 1;
          let screenFound = false;

          while (true) {
            const nr = fromR + dr * step;
            const nc = fromC + dc * step;
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;
            const target = this.grid[nr][nc];

            if (!screenFound) {
              if (target === null) {
                moves.push({ fromR, fromC, toR: nr, toC: nc, captured: null, piece });
              } else {
                screenFound = true; // 找到第一個棋子（炮架）
              }
            } else {
              if (target !== null) {
                if (target.side !== side) {
                  moves.push({ fromR, fromC, toR: nr, toC: nc, captured: target, piece }); // 隔子吃敵子
                }
                break; // 吃完或撞到自方子均結束
              }
            }
            step++;
          }
        }
        break;
      }

      // 兵 / 卒：過河前只進不退，過河後可左右進
      case 'R_PAWN': {
        // 紅兵往上 (r 減少)
        const forwardR = fromR - 1;
        if (forwardR >= 0) {
          addMove(forwardR, fromC);
        }
        // 若已過楚河漢界 (fromR <= 4)
        if (fromR <= 4) {
          if (fromC - 1 >= 0) addMove(fromR, fromC - 1);
          if (fromC + 1 <= 8) addMove(fromR, fromC + 1);
        }
        break;
      }

      case 'B_PAWN': {
        // 黑卒往下 (r 增加)
        const forwardR = fromR + 1;
        if (forwardR < this.rows) {
          addMove(forwardR, fromC);
        }
        // 若已過楚河漢界 (fromR >= 5)
        if (fromR >= 5) {
          if (fromC - 1 >= 0) addMove(fromR, fromC - 1);
          if (fromC + 1 <= 8) addMove(fromR, fromC + 1);
        }
        break;
      }
    }

    return moves;
  }

  // 判斷某一方的將帥是否受到將軍
  isKingInCheck(side) {
    const kingPos = this.findKing(side);
    if (!kingPos) return true; // 將帥不見了即失勢

    const opponentSide = side === SIDE.RED ? SIDE.BLACK : SIDE.RED;

    // 遍歷所有敵方棋子，看是否有攻擊到將帥的走法
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const piece = this.grid[r][c];
        if (piece && piece.side === opponentSide) {
          const enemyMoves = this.getPseudoMoves(r, c);
          for (const m of enemyMoves) {
            if (m.toR === kingPos.r && m.toC === kingPos.c) {
              return true; // 被將軍！
            }
          }
        }
      }
    }
    return false;
  }

  // 執行試探性走步
  makeMove(move) {
    const { fromR, fromC, toR, toC } = move;
    const movingPiece = this.grid[fromR][fromC];
    const capturedPiece = this.grid[toR][toC];

    this.grid[toR][toC] = movingPiece;
    this.grid[fromR][fromC] = null;

    if (capturedPiece) {
      this.capturedPieces[capturedPiece.side].push(capturedPiece);
    }

    this.moveHistory.push({
      fromR, fromC, toR, toC,
      piece: movingPiece,
      captured: capturedPiece
    });

    this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    return capturedPiece;
  }

  // 悔棋撤銷走步
  undoMove() {
    if (this.moveHistory.length === 0) return null;
    const lastMove = this.moveHistory.pop();
    const { fromR, fromC, toR, toC, piece, captured } = lastMove;

    this.grid[fromR][fromC] = piece;
    this.grid[toR][toC] = captured;

    if (captured) {
      const list = this.capturedPieces[captured.side];
      list.pop();
    }

    this.currentTurn = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    return lastMove;
  }

  // 取得某格棋子的真正合法走法（過濾自殺與照面）
  getLegalMovesForPiece(r, c) {
    const piece = this.grid[r][c];
    if (!piece || piece.side !== this.currentTurn) return [];

    const pseudoMoves = this.getPseudoMoves(r, c);
    const legalMoves = [];

    for (const move of pseudoMoves) {
      // 模擬走步
      this.makeMove(move);
      // 判斷走完後，己方（剛走完的方）是否被將軍，或是否將帥對臉
      const movedSide = piece.side;
      const inCheck = this.isKingInCheck(movedSide);
      const facing = this.isKingsFacing();

      this.undoMove();

      if (!inCheck && !facing) {
        legalMoves.push(move);
      }
    }

    return legalMoves;
  }

  // 取得當前輪到方所有的合法走法
  getAllLegalMoves(side = this.currentTurn) {
    const allMoves = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const piece = this.grid[r][c];
        if (piece && piece.side === side) {
          const moves = this.getLegalMovesForPiece(r, c);
          allMoves.push(...moves);
        }
      }
    }
    return allMoves;
  }

  // 檢查遊戲勝負狀態
  // 回傳：{ isGameOver: boolean, winner: 'red' | 'black' | 'draw' | null, reason: string }
  checkGameStatus() {
    const legalMoves = this.getAllLegalMoves(this.currentTurn);

    if (legalMoves.length === 0) {
      // 無步可走：若正處於被將軍狀態則為「將死（Checkmate）」；否則為「困斃（Stalemate）」
      const inCheck = this.isKingInCheck(this.currentTurn);
      const winner = this.currentTurn === SIDE.RED ? SIDE.BLACK : SIDE.RED;
      return {
        isGameOver: true,
        winner: winner,
        reason: inCheck ? (winner === SIDE.RED ? '紅方將死黑方！' : '黑方將死紅方！') : '無合法步可走（困斃）！'
      };
    }

    return { isGameOver: false, winner: null, reason: '' };
  }
}
