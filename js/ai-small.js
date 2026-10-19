/**
 * 東方御弈 - 小盤暗棋（半盤 4x8）AI 決策引擎 (js/ai-small.js)
 * 5 級強化版：翻棋機率評估、嚴格防送死保護、砲架威脅警戒、連吃期望值優化
 */

import { SIDE, AI_DIFFICULTY } from './constants.js';

export class SmallAI {
  constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
    this.difficulty = difficulty;
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  // 取得暗棋每階級基準估值
  getRankValue(rank, id) {
    if (id === 'R_KING' || id === 'B_KING') return 1200;      // 帥/將
    if (id === 'R_ADVISOR' || id === 'B_ADVISOR') return 400; // 仕/士
    if (id === 'R_BISHOP' || id === 'B_BISHOP') return 300;   // 相/象
    if (id === 'R_ROOK' || id === 'B_ROOK') return 250;       // 俥/車
    if (id === 'R_KNIGHT' || id === 'B_KNIGHT') return 180;   // 傌/馬
    if (id === 'R_CANNON' || id === 'B_CANNON') return 350;   // 炮/包（翻山殺傷力極大）
    if (id === 'R_PAWN' || id === 'B_PAWN') return 120;       // 兵/卒（能殺帥將）
    return 50;
  }

  // 檢查某個格子是否正被敵方明棋直接瞄準（處於危險）
  isTileUnderAttack(board, r, c, defenderPiece, enemySide) {
    for (let er = 0; er < board.rows; er++) {
      for (let ec = 0; ec < board.cols; ec++) {
        const attacker = board.grid[er][ec];
        if (attacker && attacker.isRevealed && attacker.side === enemySide) {
          const enemyMoves = board.getLegalMovesForPiece(er, ec);
          for (const m of enemyMoves) {
            if (m.toR === r && m.toC === c) {
              return { underAttack: true, attacker };
            }
          }
        }
      }
    }
    return { underAttack: false, attacker: null };
  }

  // 評估最佳行動（回傳 { action: 'flip' | 'move', ... }）
  getBestAction(board, aiSide) {
    const unrevealedTiles = board.getUnrevealedTiles();
    const legalMoves = board.getAllLegalMoves(aiSide);
    const enemySide = aiSide === SIDE.RED ? SIDE.BLACK : SIDE.RED;

    // 開局首翻或無明棋時
    if (!aiSide || (legalMoves.length === 0 && unrevealedTiles.length > 0)) {
      const picked = unrevealedTiles[Math.floor(Math.random() * unrevealedTiles.length)];
      return { action: 'flip', r: picked.r, c: picked.c };
    }

    let candidateActions = [];

    // (A) 分析所有合法走步（移動與吃子）
    for (const move of legalMoves) {
      const { fromR, fromC, toR, toC, captured } = move;
      const piece = board.grid[fromR][fromC];
      let score = 0;

      // 檢查移動前是否身處險境
      const currentThreat = this.isTileUnderAttack(board, fromR, fromC, piece, enemySide);

      // 1. 吃子收益
      if (captured) {
        const victimVal = this.getRankValue(captured.rank, captured.id);
        const myVal = this.getRankValue(piece.rank, piece.id);
        score += victimVal * 2.2; // 吃子基本收益

        // 若是炮隔子跳吃，給予額外戰術獎勵
        if (move.isCannonShot) {
          score += 120;
        }

        // 吃子後是否會被對手反吃？
        board.makeMove(move);
        const destThreat = this.isTileUnderAttack(board, toR, toC, piece, enemySide);
        board.undoLastAction();

        if (destThreat.underAttack) {
          const tradeBalance = victimVal - myVal;
          if (tradeBalance < 0) {
            // 用大子去吃有保護的小子（不良交換，重重扣分）
            score -= (myVal - victimVal) * 2.0;
          } else {
            // 平價或高收益交換
            score += 15;
          }
        }
      } else {
        // 2. 普通走步：逃生或安全前進
        board.makeMove(move);
        const destThreat = this.isTileUnderAttack(board, toR, toC, piece, enemySide);
        board.undoLastAction();

        if (currentThreat.underAttack && !destThreat.underAttack) {
          // 成功脫險！依棋子價值給予極高避險獎勵
          score += this.getRankValue(piece.rank, piece.id) * 1.8;
        } else if (destThreat.underAttack) {
          // 自投羅網白白送死（大子絕對禁止）！
          score -= this.getRankValue(piece.rank, piece.id) * 2.5;
        } else {
          // 安全位移
          score += 8;
        }
      }

      candidateActions.push({
        action: 'move',
        move,
        score
      });
    }

    // (B) 分析翻棋動作（評估翻哪顆暗棋最安全）
    for (const tile of unrevealedTiles) {
      let flipScore = 0;
      const { r, c } = tile;

      // 檢查該暗棋是否正處於敵方炮的跳殺射程上
      let inCannonFire = false;
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        let step = 1;
        let hurdle = 0;
        while (true) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= board.rows || nc < 0 || nc >= board.cols) break;
          const piece = board.grid[nr][nc];
          if (piece !== null) {
            hurdle++;
            if (hurdle === 2) {
              if (piece.isRevealed && piece.side === enemySide && (piece.id === 'R_CANNON' || piece.id === 'B_CANNON')) {
                inCannonFire = true;
              }
              break;
            }
          }
          step++;
        }
      }

      if (inCannonFire) {
        flipScore -= 240; // 處在敵炮射程，極危險
      }

      // 周圍相鄰格子評估
      let adjacentEnemies = 0;
      let adjacentFriends = 0;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < board.rows && nc >= 0 && nc < board.cols) {
          const p = board.grid[nr][nc];
          if (p && p.isRevealed) {
            if (p.side === enemySide) adjacentEnemies++;
            else adjacentFriends++;
          }
        }
      }

      // 若周遭有敵方大棋，翻棋容易被貼臉吃
      flipScore -= adjacentEnemies * 45;
      flipScore += adjacentFriends * 25;

      // 翻棋基礎分
      flipScore += 18;

      candidateActions.push({
        action: 'flip',
        r, c,
        score: flipScore
      });
    }

    if (candidateActions.length === 0) return null;

    // 依分數高低排序
    candidateActions.sort((a, b) => b.score - a.score);

    // 嚴格過濾負極端分（嚴禁送死）
    const safeActions = candidateActions.filter(item => item.score > -200);
    const pool = safeActions.length > 0 ? safeActions : candidateActions;

    // 依據難度選擇動作
    switch (this.difficulty) {
      case AI_DIFFICULTY.EASY: {
        // 初學：前 2~3 個安全步隨機挑選
        const top = pool.slice(0, Math.min(3, pool.length));
        return top[Math.floor(Math.random() * top.length)];
      }
      case AI_DIFFICULTY.AMATEUR: {
        // 業餘：前 2 名挑選
        const top = pool.slice(0, Math.min(2, pool.length));
        return top[Math.floor(Math.random() * top.length)];
      }
      case AI_DIFFICULTY.MEDIUM:
      case AI_DIFFICULTY.HARD:
      case AI_DIFFICULTY.GRANDMASTER:
      default:
        // 高手、大師、特大：嚴格執行最高評分最優行動
        return pool[0];
    }
  }

  // 評估特定位置明棋的最佳「連吃」目標走步（包含明棋與暗棋翻吃）
  getBestConsecutiveCapture(board, r, c, aiSide) {
    const captures = board.getConsecutiveCaptures(r, c);
    if (!captures || captures.length === 0) return null;

    const enemySide = aiSide === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    const piece = board.grid[r][c];
    if (!piece) return null;

    let evaluated = [];
    for (const move of captures) {
      if (move.type === 'capture') {
        const victim = move.captured;
        let score = this.getRankValue(victim.rank, victim.id) * 2.2;

        // 檢查吃了之後在目標格是否會被反吃
        board.makeMove(move, false);
        const destThreat = this.isTileUnderAttack(board, move.toR, move.toC, piece, enemySide);
        board.undoLastAction();

        if (destThreat.underAttack) {
          const victimVal = this.getRankValue(victim.rank, victim.id);
          const myVal = this.getRankValue(piece.rank, piece.id);
          if (myVal > victimVal) {
            score -= (myVal - victimVal) * 1.8;
          }
        }
        evaluated.push({ move, score });
      } else if (move.type === 'dark_capture') {
        // 暗棋翻吃評估：根據自身位階計算期望勝率
        let darkScore = 0;
        if (piece.id === 'R_KING' || piece.id === 'B_KING') {
          darkScore = 280; // 帥將極強
        } else if (piece.id === 'R_ADVISOR' || piece.id === 'B_ADVISOR') {
          darkScore = 220; // 士仕
        } else if (piece.id === 'R_BISHOP' || piece.id === 'B_BISHOP') {
          darkScore = 170; // 象相
        } else if (piece.id === 'R_ROOK' || piece.id === 'B_ROOK') {
          darkScore = 150; // 車
        } else if (piece.id === 'R_CANNON' || piece.id === 'B_CANNON') {
          darkScore = 200; // 炮
        } else if (piece.id === 'R_KNIGHT' || piece.id === 'B_KNIGHT') {
          darkScore = 60;  // 馬
        } else {
          darkScore = -60; // 兵卒翻暗棋風險大
        }

        if (darkScore > 0) {
          evaluated.push({ move, score: darkScore });
        }
      }
    }

    if (evaluated.length === 0) return null;

    evaluated.sort((a, b) => b.score - a.score);
    const safeEvaluated = evaluated.filter(e => e.score > 0);
    if (safeEvaluated.length === 0) return null; // 若連吃會送死，果斷結束連吃

    return safeEvaluated[0].move;
  }
}
