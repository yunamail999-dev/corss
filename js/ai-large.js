/**
 * Yunamail的棋盤 - 大盤傳統象棋 AI 決策引擎 (js/ai-large.js)
 * 深度強化版：實作防自殺檢測 (Blunder Filter)、靜態交換安全評估 (SEE)、
 * 5 級自適應 Alpha-Beta 剪枝深算、葉節點靜態搜尋 (Quiescence)、
 * 無根子威脅排查與正統大師開局庫。
 */

import { SIDE, PIECE_INFO, LARGE_POSITION_SCORES, AI_DIFFICULTY } from './constants.js';

export class LargeAI {
  constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
    this.difficulty = difficulty;
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  // 檢查某個棋盤座標 (r, c) 是否正遭受 attackerSide 任何棋子的火力攻擊
  getAttackers(board, r, c, attackerSide) {
    const attackers = [];
    for (let ar = 0; ar < board.rows; ar++) {
      for (let ac = 0; ac < board.cols; ac++) {
        const piece = board.grid[ar][ac];
        if (piece && piece.side === attackerSide) {
          const pseudo = board.getPseudoMoves(ar, ac);
          for (const m of pseudo) {
            if (m.toR === r && m.toC === c) {
              attackers.push({ piece, r: ar, c: ac });
              break;
            }
          }
        }
      }
    }
    return attackers;
  }

  // 走步安全性快速檢測（防自殺步核心）
  // 回傳該步走法的安全增量分數（負分代表送子/虧損交換；正分代表成功逃跑/吃得利益）
  evaluateMoveSafety(board, move, aiSide) {
    const opponentSide = aiSide === SIDE.RED ? SIDE.BLACK : SIDE.RED;
    const movingPiece = board.grid[move.fromR][move.fromC];
    if (!movingPiece) return 0;

    let safetyDelta = 0;
    const pieceVal = movingPiece.value;

    // 1. 移動前：原位置是否正遭受攻擊？
    const currentAttackers = this.getAttackers(board, move.fromR, move.fromC, opponentSide);
    const wasUnderAttack = currentAttackers.length > 0;

    // 2. 試探性走這步
    board.makeMove(move);

    // 3. 移動後：目標格點 (toR, toC) 是否落入敵方火力範圍？
    const destAttackers = this.getAttackers(board, move.toR, move.toC, opponentSide);
    // 檢查己方是否有其他棋子護著目標格點（有根子）
    const destDefenders = this.getAttackers(board, move.toR, move.toC, aiSide);

    board.undoMove();

    // 成功避險：原本處於受捉險境，現在安全脫困或吃掉威脅子
    if (wasUnderAttack && destAttackers.length === 0) {
      safetyDelta += pieceVal * 0.85;
    }

    // 走入敵陣火力：評估是否送子
    if (destAttackers.length > 0) {
      const minAttackerVal = Math.min(...destAttackers.map(a => a.piece.value));
      const capturedVal = move.captured ? move.captured.value : 0;

      if (destDefenders.length === 0) {
        // 【無根子白送自殺】：極為嚴重的致命錯誤！
        if (capturedVal < pieceVal) {
          safetyDelta -= (pieceVal - capturedVal) * 1.8;
        }
      } else {
        // 【有根子但遭廉價子兌換】：例如用車 (900) 換對手的兵 (100) 或馬 (450)
        if (minAttackerVal < pieceVal) {
          if (capturedVal < pieceVal) {
            safetyDelta -= (pieceVal - minAttackerVal - capturedVal) * 1.3;
          }
        }
      }
    }

    return safetyDelta;
  }

  // 評估棋盤目前局勢分值（以 side 視角：正分表示 side 有利，負分表示對手有利）
  evaluate(board, side) {
    let score = 0;
    const opponent = side === SIDE.RED ? SIDE.BLACK : SIDE.RED;

    // 1. 遍歷盤面子力價值與位置權重
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const piece = board.grid[r][c];
        if (!piece) continue;

        let pieceVal = piece.value;
        let posVal = 0;

        const isRed = piece.side === SIDE.RED;
        const mappedRow = isRed ? r : (9 - r); // 黑方垂直鏡像對稱查表

        if (piece.id.includes('PAWN')) {
          posVal = LARGE_POSITION_SCORES.PAWN[mappedRow][c] || 0;
          // 過河卒逼近敵方九宮加權
          const crossed = isRed ? r <= 4 : r >= 5;
          if (crossed) {
            posVal += 40;
            // 進入九宮格兩翼直接威脅將帥
            if (c >= 2 && c <= 6 && (isRed ? r <= 2 : r >= 7)) {
              posVal += 60;
            }
          }
        } else if (piece.id.includes('ROOK')) {
          posVal = LARGE_POSITION_SCORES.ROOK[mappedRow][c] || 0;
          // 巡河車（紅 r=5, 黑 r=4）與壓入敵方騎河（紅 r=4, 黑 r=5）戰略價值高
          if (isRed && (r === 4 || r === 5)) posVal += 30;
          if (!isRed && (r === 4 || r === 5)) posVal += 30;
        } else if (piece.id.includes('KNIGHT')) {
          posVal = LARGE_POSITION_SCORES.KNIGHT[mappedRow][c] || 0;
          // 臥槽馬、掛角馬殺法要津加權
          if (isRed && (r === 2 || r === 1) && (c === 2 || c === 6)) posVal += 50;
          if (!isRed && (r === 7 || r === 8) && (c === 2 || c === 6)) posVal += 50;
        } else if (piece.id.includes('CANNON')) {
          posVal = LARGE_POSITION_SCORES.CANNON[mappedRow][c] || 0;
          // 開局前 12 步防止孤炮深入敵陣底線換馬俗手
          if (board.moveHistory.length <= 12) {
            if (piece.side === SIDE.BLACK && r >= 8) posVal -= 160;
            else if (piece.side === SIDE.RED && r <= 1) posVal -= 160;
          }
        } else if (piece.id.includes('ADVISOR')) {
          // 士守衛中宮老將
          posVal = 15;
        } else if (piece.id.includes('BISHOP')) {
          // 象守衛聯絡
          posVal = 15;
        }

        const totalVal = pieceVal + posVal;

        if (piece.side === side) {
          score += totalVal;
        } else {
          score -= totalVal;
        }
      }
    }

    // 2. 將帥九宮安全度（仕象雙全防守鞏固，殘破受威脅扣分）
    const myKingPos = board.findKing(side);
    const oppKingPos = board.findKing(opponent);

    if (myKingPos) {
      if (board.isKingInCheck(side)) {
        score -= 90; // 被將軍警戒
      }
    }
    if (oppKingPos) {
      if (board.isKingInCheck(opponent)) {
        score += 90; // 威脅對手將帥得分
      }
    }

    return score;
  }

  // 走法排序（Move Ordering：吃大子、升格、將軍步排在前，大幅提升剪枝效率）
  orderMoves(moves) {
    return moves.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // 1. 吃子加權 (MVV-LVA：被吃子價值 * 10 - 攻擊子價值)
      if (a.captured) {
        scoreA += a.captured.value * 10 - a.piece.value;
      }
      if (b.captured) {
        scoreB += b.captured.value * 10 - b.piece.value;
      }

      // 2. 兵卒前進加權
      if (a.piece.id.includes('PAWN')) scoreA += 5;
      if (b.piece.id.includes('PAWN')) scoreB += 5;

      return scoreB - scoreA;
    });
  }

  // 中國象棋正統大師開局庫
  getOpeningMove(board, aiSide) {
    if (aiSide !== SIDE.BLACK) return null;
    const history = board.moveHistory;
    const legalMoves = board.getAllLegalMoves(aiSide);
    if (legalMoves.length === 0) return null;

    const findLegal = (fromR, fromC, toR, toC) => {
      return legalMoves.find(m => m.fromR === fromR && m.fromC === fromC && m.toR === toR && m.toC === toC);
    };

    const pickRandom = (arr) => {
      const valid = arr.filter(Boolean);
      if (valid.length === 0) return null;
      return valid[Math.floor(Math.random() * valid.length)];
    };

    // 1. 黑方第 1 步應手（history.length === 1）
    if (history.length === 1) {
      const redMove = history[0];

      // (A) 紅方當頭炮（中炮：toC === 4）
      if (redMove.piece?.name === '炮' && redMove.toC === 4) {
        const candidateOpenings = [
          findLegal(0, 1, 2, 2), // 屏風馬（馬 8 進 7）
          findLegal(0, 1, 2, 2), // 雙倍權重屏風馬
          findLegal(0, 7, 2, 6), // 屏風馬（馬 2 進 3）
          findLegal(2, 7, 2, 4), // 順手炮（炮 2 平 5）
          findLegal(2, 1, 2, 4), // 列手炮（炮 8 平 5）
          findLegal(2, 1, 2, 3), // 反宮馬（炮 8 平 6）
          findLegal(3, 2, 4, 2)  // 挺卒制馬（卒 7 進 1）
        ];
        const chosen = pickRandom(candidateOpenings);
        if (chosen) return chosen;
      }

      // (B) 紅方起正馬
      if (redMove.piece?.name === '傌') {
        const candidateOpenings = [
          findLegal(3, 2, 4, 2), // 挺卒制馬（卒 7 進 1）
          findLegal(3, 6, 4, 6), // 挺卒制馬（卒 3 進 1）
          findLegal(0, 1, 2, 2), // 對起馬（馬 8 進 7）
          findLegal(2, 7, 2, 4), // 中炮局（炮 2 平 5）
          findLegal(2, 1, 2, 4)  // 中炮局（炮 8 平 5）
        ];
        const chosen = pickRandom(candidateOpenings);
        if (chosen) return chosen;
      }

      // (C) 紅方飛相局
      if (redMove.piece?.name === '相') {
        const candidateOpenings = [
          findLegal(2, 1, 2, 4), // 左中炮（炮 8 平 5）
          findLegal(3, 2, 4, 2), // 進卒局（卒 7 進 1）
          findLegal(0, 1, 2, 2), // 起正馬（馬 8 進 7）
          findLegal(2, 7, 2, 4)  // 右中炮（炮 2 平 5）
        ];
        const chosen = pickRandom(candidateOpenings);
        if (chosen) return chosen;
      }

      // (D) 紅方挺兵局
      if (redMove.piece?.name === '兵') {
        const candidateOpenings = [
          findLegal(2, 7, 2, 6), // 卒底炮（炮 2 平 3）
          findLegal(3, 2, 4, 2), // 對挺卒（卒 7 進 1）
          findLegal(0, 7, 2, 6), // 起正馬（馬 2 進 3）
          findLegal(2, 1, 2, 4)  // 中炮局（炮 8 平 5）
        ];
        const chosen = pickRandom(candidateOpenings);
        if (chosen) return chosen;
      }

      // (E) 其他走法
      const genericCandidates = [
        findLegal(0, 1, 2, 2), // 起馬（馬 8 進 7）
        findLegal(0, 7, 2, 6), // 起馬（馬 2 進 3）
        findLegal(3, 2, 4, 2), // 挺卒（卒 7 進 1）
        findLegal(2, 7, 2, 4), // 中炮（炮 2 平 5）
        findLegal(2, 1, 2, 3)  // 士角炮（炮 8 平 6）
      ];
      const chosen = pickRandom(genericCandidates);
      if (chosen) return chosen;
    }

    // 2. 黑方第 2 步應手（history.length === 3）
    if (history.length === 3) {
      const followUpCandidates = [
        findLegal(0, 1, 2, 2), // 雙馬齊出（馬 8 進 7）
        findLegal(0, 7, 2, 6), // 雙馬齊出（馬 2 進 3）
        findLegal(3, 2, 4, 2), // 挺卒（卒 7 進 1）
        findLegal(3, 6, 4, 6), // 挺卒（卒 3 進 1）
        findLegal(0, 0, 0, 1), // 出直車（車 9 平 8）
        findLegal(0, 8, 0, 7), // 出直車（車 1 平 2）
        findLegal(2, 1, 2, 4)  // 架中炮（炮 8 平 5）
      ];
      const chosen = pickRandom(followUpCandidates);
      if (chosen) return chosen;
    }

    return null;
  }

  // 靜態搜尋（Quiescence Search）：葉節點只深入搜尋吃子交換，徹底消除地平線盲點
  quiescence(board, alpha, beta, aiSide, currentTurn, depthLimit = 2) {
    const standPat = this.evaluate(board, aiSide);
    if (depthLimit <= 0) return standPat;

    const isMaximizing = currentTurn === aiSide;

    if (isMaximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;

      const legalMoves = board.getAllLegalMoves(currentTurn);
      const captureMoves = this.orderMoves(legalMoves.filter(m => m.captured !== null));
      if (captureMoves.length === 0) return standPat;

      for (const move of captureMoves) {
        board.makeMove(move);
        const score = this.quiescence(board, alpha, beta, aiSide, board.currentTurn, depthLimit - 1);
        board.undoMove();

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;

      const legalMoves = board.getAllLegalMoves(currentTurn);
      const captureMoves = this.orderMoves(legalMoves.filter(m => m.captured !== null));
      if (captureMoves.length === 0) return standPat;

      for (const move of captureMoves) {
        board.makeMove(move);
        const score = this.quiescence(board, alpha, beta, aiSide, board.currentTurn, depthLimit - 1);
        board.undoMove();

        if (score <= alpha) return alpha;
        if (score < beta) beta = score;
      }
      return beta;
    }
  }

  // Alpha-Beta 剪枝核心遞迴搜尋
  alphaBeta(board, depth, alpha, beta, aiSide, currentTurn, useQuiescence = false) {
    const status = board.checkGameStatus();
    if (status.isGameOver) {
      if (status.winner === aiSide) return 50000 + depth; // 越快絕殺越優
      if (status.winner !== null) return -50000 - depth;
      return 0; // 和局
    }

    if (depth <= 0) {
      if (useQuiescence) {
        return this.quiescence(board, alpha, beta, aiSide, currentTurn, 2);
      }
      return this.evaluate(board, aiSide);
    }

    const legalMoves = this.orderMoves(board.getAllLegalMoves(currentTurn));
    if (legalMoves.length === 0) {
      return board.isKingInCheck(currentTurn) ? -50000 - depth : 0;
    }

    const isMaximizing = currentTurn === aiSide;

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of legalMoves) {
        board.makeMove(move);
        const evalScore = this.alphaBeta(board, depth - 1, alpha, beta, aiSide, board.currentTurn, useQuiescence);
        board.undoMove();

        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break; // Beta 剪枝截斷
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of legalMoves) {
        board.makeMove(move);
        const evalScore = this.alphaBeta(board, depth - 1, alpha, beta, aiSide, board.currentTurn, useQuiescence);
        board.undoMove();

        minEval = Math.min(minEval, evalScore);
        beta = Math.min(beta, evalScore);
        if (beta <= alpha) break; // Alpha 剪枝截斷
      }
      return minEval;
    }
  }

  // 取得最佳走步（依據 5 個難度維度智慧決策）
  getBestMove(board, aiSide) {
    const legalMoves = board.getAllLegalMoves(aiSide);
    if (legalMoves.length === 0) return null;

    // 0. 優先調用正統大師開局庫（多樣體系）
    const openingMove = this.getOpeningMove(board, aiSide);
    if (openingMove) {
      return openingMove;
    }

    // 依據難度設定算力參數：
    // - EASY: 深度 2（看自己走步與對手回應）+ 內建嚴密防自殺保護，絕不白送大子
    // - AMATEUR: 深度 2 + 安全交換檢驗
    // - MEDIUM: 深度 3 + 靜態搜尋 (Quiescence)
    // - HARD: 深度 4 + 靜態搜尋
    // - GRANDMASTER: 深度 4~5 + 深入靜態搜尋
    let searchDepth = 2;
    let useQuiescence = false;
    let allowMinorRandom = false;

    switch (this.difficulty) {
      case AI_DIFFICULTY.EASY:
        searchDepth = 2;
        useQuiescence = false;
        allowMinorRandom = true; // 初學者有微弱擾動，但受安全過濾保護
        break;
      case AI_DIFFICULTY.AMATEUR:
        searchDepth = 2;
        useQuiescence = true;
        allowMinorRandom = false;
        break;
      case AI_DIFFICULTY.MEDIUM:
        searchDepth = 3;
        useQuiescence = true;
        allowMinorRandom = false;
        break;
      case AI_DIFFICULTY.HARD:
        searchDepth = 4;
        useQuiescence = true;
        allowMinorRandom = false;
        break;
      case AI_DIFFICULTY.GRANDMASTER:
        // 在棋子減少的殘局可加深至 5 層
        searchDepth = (legalMoves.length <= 18) ? 5 : 4;
        useQuiescence = true;
        allowMinorRandom = false;
        break;
      default:
        searchDepth = 3;
        useQuiescence = true;
    }

    const orderedMoves = this.orderMoves(legalMoves);
    const scoredMoves = [];

    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of orderedMoves) {
      // 1. 安全防自殺即時判定（針對白送大子給予沉重懲罰）
      const safetyDelta = this.evaluateMoveSafety(board, move, aiSide);

      // 2. 深度搜尋
      board.makeMove(move);
      let score = this.alphaBeta(board, searchDepth - 1, alpha, beta, aiSide, board.currentTurn, useQuiescence);
      board.undoMove();

      // 綜合安全補正
      score += safetyDelta;

      if (allowMinorRandom) {
        score += (Math.random() * 24 - 12);
      }

      scoredMoves.push({ move, score, safetyDelta });

      if (score > bestScore) {
        bestScore = score;
      }
      alpha = Math.max(alpha, bestScore);
    }

    // 依據分數由高到低排序
    scoredMoves.sort((a, b) => b.score - a.score);

    // 嚴格過濾自殺步：若有非自殺走步，絕對排除 safetyDelta < -400 的自殺步
    const safeMoves = scoredMoves.filter(item => item.safetyDelta > -400);
    const candidatePool = safeMoves.length > 0 ? safeMoves : scoredMoves;

    // 在最高分與次優解極度接近（分差 <= 6 分）的步數中隨機挑選，保持棋風多樣
    const highestScore = candidatePool[0].score;
    const topCandidates = candidatePool.filter(item => (highestScore - item.score) <= 6);

    const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    return picked.move;
  }
}
