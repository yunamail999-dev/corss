/**
 * Yunamail的棋盤 - 大盤傳統象棋 AI 決策引擎 (js/ai-large.js)
 * 實作正統大師開局庫、Alpha-Beta 剪枝搜尋、MVV-LVA 走法排序、位置權重表 (PST) 與多樣性隨機採樣
 */

import { SIDE, PIECE_INFO, LARGE_POSITION_SCORES, AI_DIFFICULTY } from './constants.js';

export class LargeAI {
  constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
    this.difficulty = difficulty;
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  // 評估棋盤目前局勢分值（以 side 視角：正分表示 side 有利，負分表示對手有利）
  evaluate(board, side) {
    let score = 0;
    const opponent = side === SIDE.RED ? SIDE.BLACK : SIDE.RED;

    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const piece = board.grid[r][c];
        if (!piece) continue;

        let pieceVal = piece.value;
        let posVal = 0;

        // 位置加權分數
        const isRed = piece.side === SIDE.RED;
        const mappedRow = isRed ? r : (9 - r); // 黑方垂直鏡像對稱查表

        if (piece.id.includes('PAWN')) {
          posVal = LARGE_POSITION_SCORES.PAWN[mappedRow][c] || 0;
        } else if (piece.id.includes('ROOK')) {
          posVal = LARGE_POSITION_SCORES.ROOK[mappedRow][c] || 0;
        } else if (piece.id.includes('KNIGHT')) {
          posVal = LARGE_POSITION_SCORES.KNIGHT[mappedRow][c] || 0;
        } else if (piece.id.includes('CANNON')) {
          posVal = LARGE_POSITION_SCORES.CANNON[mappedRow][c] || 0;

          // 戰略防護：開局階段（前 12 步）若將炮冒進至敵方底線 (r >= 8 或 r <= 1) 企圖換馬，
          // 屬於典型俗手（失炮失勢），給予嚴厲扣分，杜絕無謂包打馬
          if (board.moveHistory.length <= 12) {
            if (piece.side === SIDE.BLACK && r >= 8) {
              posVal -= 150;
            } else if (piece.side === SIDE.RED && r <= 1) {
              posVal -= 150;
            }
          }
        }

        const totalVal = pieceVal + posVal;

        if (piece.side === side) {
          score += totalVal;
        } else {
          score -= totalVal;
        }
      }
    }

    return score;
  }

  // 走法排序（Move Ordering：先搜尋吃大子與將軍走步，大幅提高 Alpha-Beta 剪枝效率）
  orderMoves(moves) {
    return moves.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // 吃子加權 (MVV-LVA)
      if (a.captured) {
        scoreA = a.captured.value * 10;
      }
      if (b.captured) {
        scoreB = b.captured.value * 10;
      }

      return scoreB - scoreA;
    });
  }

  // 中國象棋正統大師開局庫（包含屏風馬、順手炮、挺卒局、反宮馬、卒底炮等多樣體系）
  getOpeningMove(board, aiSide) {
    if (aiSide !== SIDE.BLACK) return null; // 目前 AI 固定執黑後手
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

    // 1. 黑方第一步應手（紅方剛走完第 1 步，history.length === 1）
    if (history.length === 1) {
      const redMove = history[0];

      // (A) 紅方走當頭炮（中炮：炮二平五 或 炮八平五，toC === 4）
      if (redMove.piece?.name === '炮' && redMove.toC === 4) {
        const candidateOpenings = [
          findLegal(0, 1, 2, 2), // 屏風馬（馬 8 進 7）
          findLegal(0, 1, 2, 2), // 權重加強屏風馬
          findLegal(0, 7, 2, 6), // 屏風馬（馬 2 進 3）
          findLegal(2, 7, 2, 4), // 順手炮（炮 2 平 5）
          findLegal(2, 1, 2, 4), // 列手炮（炮 8 平 5）
          findLegal(2, 1, 2, 3), // 反宮馬（士角炮，炮 8 平 6）
          findLegal(3, 2, 4, 2)  // 挺卒局（卒 7 進 1）
        ];
        const chosen = pickRandom(candidateOpenings);
        if (chosen) return chosen;
      }

      // (B) 紅方走起馬局（馬二進三 或 馬八進七）
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

      // (C) 紅方走飛相局（相三進五 或 相七進五）
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

      // (D) 紅方走挺兵局（進七兵 或 進三兵）
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

      // (E) 紅方其他任意開局：從主流大師招法中隨機挑選
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

    // 2. 黑方第二步應手（history.length === 3）
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

  // 靜態搜尋（Quiescence Search）：在大師難度用於葉節點繼續搜尋吃子走步，消弭地平線效應
  quiescence(board, alpha, beta, aiSide, currentTurn, depthLimit = 2) {
    const standPat = this.evaluate(board, aiSide);
    if (depthLimit <= 0) return standPat;

    const isMaximizing = currentTurn === aiSide;

    if (isMaximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;

      const legalMoves = board.getAllLegalMoves(currentTurn);
      const captureMoves = this.orderMoves(legalMoves.filter(m => m.captured !== null));

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

  // Alpha-Beta 剪枝核心搜尋
  alphaBeta(board, depth, alpha, beta, aiSide, currentTurn, useQuiescence = false) {
    const status = board.checkGameStatus();
    if (status.isGameOver) {
      if (status.winner === aiSide) return 50000 + depth; // 越快將死越好
      if (status.winner !== null) return -50000 - depth;
      return 0; // 和棋
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
        if (beta <= alpha) break; // Beta 剪枝
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
        if (beta <= alpha) break; // Alpha 剪枝
      }
      return minEval;
    }
  }

  // 取得最佳走步
  getBestMove(board, aiSide) {
    const legalMoves = board.getAllLegalMoves(aiSide);
    if (legalMoves.length === 0) return null;

    // 0. 優先調用正統大師開局庫（多樣化開局，徹底解決每次機械式下同一著的問題）
    const openingMove = this.getOpeningMove(board, aiSide);
    if (openingMove) {
      return openingMove;
    }

    // 1. 初學難度 (Easy)：1 層評估 + 適當隨機性（偶爾犯小錯）
    if (this.difficulty === AI_DIFFICULTY.EASY) {
      const scoredMoves = legalMoves.map(move => {
        board.makeMove(move);
        const score = this.evaluate(board, aiSide) + (Math.random() * 40 - 20);
        board.undoMove();
        return { move, score };
      });

      scoredMoves.sort((a, b) => b.score - a.score);
      // 從前 3 名中隨機取一個，自然呈現初學者走法
      const topCandidates = scoredMoves.slice(0, Math.min(3, scoredMoves.length));
      const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
      return picked.move;
    }

    // 2. 進階難度 (Medium)：深度 2 搜尋
    // 3. 大師難度 (Hard)：深度 3 + 靜態搜尋
    const depth = this.difficulty === AI_DIFFICULTY.HARD ? 3 : 2;
    const useQuiescence = this.difficulty === AI_DIFFICULTY.HARD;

    let bestScore = -Infinity;
    let alpha = -Infinity;
    let beta = Infinity;

    const orderedMoves = this.orderMoves(legalMoves);
    const scoredMoves = [];

    for (const move of orderedMoves) {
      board.makeMove(move);
      const score = this.alphaBeta(board, depth - 1, alpha, beta, aiSide, board.currentTurn, useQuiescence);
      board.undoMove();

      scoredMoves.push({ move, score });

      if (score > bestScore) {
        bestScore = score;
      }
      alpha = Math.max(alpha, bestScore);
    }

    // 找出所有評分接近最優解的候選步（避免每一局都走一模一樣的第一個走步）
    const tolerance = this.difficulty === AI_DIFFICULTY.HARD ? 12 : 25;
    const candidateMoves = scoredMoves.filter(item => (bestScore - item.score) <= tolerance);

    if (candidateMoves.length > 0) {
      // 在近乎同等優異的著法中隨機抽取，棋風生動多變！
      const picked = candidateMoves[Math.floor(Math.random() * candidateMoves.length)];
      return picked.move;
    }

    return orderedMoves[0];
  }
}
