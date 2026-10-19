/**
 * Yunamail的棋盤 - 大盤傳統象棋 AI 決策引擎 (js/ai-large.js)
 *
 * 第三代重構版：
 * - 獨立高速一維陣列棋盤（Int8Array），不再呼叫 UI 棋盤的昂貴合法步檢查
 * - 迭代加深 (Iterative Deepening) + 時間控制，難度越高想得越深
 * - PVS 主變例 Alpha-Beta 剪枝、置換表 (Transposition Table)
 * - 殺手步 / 歷史啟發走法排序、將軍延伸、葉節點靜態搜尋 (Quiescence)
 * - 根節點「多主變」評分：只在真正接近最佳的走法中隨機，杜絕亂走送子
 * - 修正舊版致命缺陷：被剪枝的爛步分數被誤判為與最佳步同分而被隨機選中
 */

import { SIDE, LARGE_POSITION_SCORES, AI_DIFFICULTY } from './constants.js';

// ───────────────────────── 基本常數 ─────────────────────────
const ROWS = 10;
const COLS = 9;
const NSQ = ROWS * COLS;

// 棋子類型代碼（紅方為正，黑方為負）
const KING = 1, ADVISOR = 2, BISHOP = 3, KNIGHT = 4, ROOK = 5, CANNON = 6, PAWN = 7;
const TYPE_BY_NAME = { KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN };

// 子力基礎價值
const PIECE_VAL = [0, 0, 200, 200, 430, 900, 450, 100];

const MATE = 30000;
const INF = 1000000;

// 各難度設定：最大深度、思考時間（毫秒）、候選分差、隨機擾動
const LEVEL_CONFIG = {
  [AI_DIFFICULTY.EASY]:        { maxDepth: 2, time: 400,  margin: 70, noise: 35 },
  [AI_DIFFICULTY.AMATEUR]:     { maxDepth: 3, time: 700,  margin: 35, noise: 16 },
  [AI_DIFFICULTY.MEDIUM]:      { maxDepth: 4, time: 1200, margin: 16, noise: 8 },
  [AI_DIFFICULTY.HARD]:        { maxDepth: 6, time: 2000, margin: 8,  noise: 4 },
  [AI_DIFFICULTY.GRANDMASTER]: { maxDepth: 9, time: 3000, margin: 3,  noise: 0 }
};

// ───────────────────────── 預先計算走法表 ─────────────────────────
const RAYS = [];             // RAYS[sq] = [上, 下, 左, 右] 各方向格子序列
const ORTH1 = [];            // 相鄰直線一格
const DIAG1 = [];            // 相鄰斜線一格
const KNIGHT_MOVES = [];     // 馬的走法 { to, leg }
const KNIGHT_ATTACKERS = []; // 能攻擊該格的馬位置 { from, leg }
const BISHOP_MOVES = [];     // 象的走法 { to, eye }

(function precompute() {
  const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const sq = r * COLS + c;

      // 四方向射線
      const up = [], down = [], left = [], right = [];
      for (let rr = r - 1; rr >= 0; rr--) up.push(rr * COLS + c);
      for (let rr = r + 1; rr < ROWS; rr++) down.push(rr * COLS + c);
      for (let cc = c - 1; cc >= 0; cc--) left.push(r * COLS + cc);
      for (let cc = c + 1; cc < COLS; cc++) right.push(r * COLS + cc);
      RAYS[sq] = [up, down, left, right];

      // 一格直/斜
      ORTH1[sq] = [];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (inside(r + dr, c + dc)) ORTH1[sq].push((r + dr) * COLS + (c + dc));
      }
      DIAG1[sq] = [];
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        if (inside(r + dr, c + dc)) DIAG1[sq].push((r + dr) * COLS + (c + dc));
      }

      // 馬走日（含拐馬腳）
      KNIGHT_MOVES[sq] = [];
      for (const [dr, dc, lr, lc] of [
        [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]
      ]) {
        if (inside(r + dr, c + dc)) {
          KNIGHT_MOVES[sq].push({ to: (r + dr) * COLS + (c + dc), leg: (r + lr) * COLS + (c + lc) });
        }
      }

      // 反向：哪些位置的馬能踏到本格
      KNIGHT_ATTACKERS[sq] = [];
      for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) {
        const fr = r + dr, fc = c + dc;
        if (!inside(fr, fc)) continue;
        let legR, legC;
        if (Math.abs(dr) === 2) { legR = fr - Math.sign(dr); legC = fc; }
        else { legR = fr; legC = fc - Math.sign(dc); }
        KNIGHT_ATTACKERS[sq].push({ from: fr * COLS + fc, leg: legR * COLS + legC });
      }

      // 象走田（含塞象眼）
      BISHOP_MOVES[sq] = [];
      for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
        if (inside(r + dr, c + dc)) {
          BISHOP_MOVES[sq].push({ to: (r + dr) * COLS + (c + dc), eye: (r + dr / 2) * COLS + (c + dc / 2) });
        }
      }
    }
  }
})();

// 位置價值表：PST[陣營索引 0紅/1黑][類型][格子]
const PST = [[], []];
(function buildPst() {
  const tableOf = (t) => {
    if (t === PAWN) return LARGE_POSITION_SCORES.PAWN;
    if (t === ROOK) return LARGE_POSITION_SCORES.ROOK;
    if (t === KNIGHT) return LARGE_POSITION_SCORES.KNIGHT;
    if (t === CANNON) return LARGE_POSITION_SCORES.CANNON;
    return null;
  };
  for (let t = 1; t <= 7; t++) {
    PST[0][t] = new Int16Array(NSQ);
    PST[1][t] = new Int16Array(NSQ);
    const table = tableOf(t);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const sq = r * COLS + c;
        if (table) {
          PST[0][t][sq] = table[r][c] || 0;
          PST[1][t][sq] = table[9 - r][c] || 0; // 黑方垂直鏡像
        } else if (t === ADVISOR || t === BISHOP) {
          PST[0][t][sq] = 15;
          PST[1][t][sq] = 15;
        }
      }
    }
  }
})();

// Zobrist 雜湊亂數表（雙 32 位元降低碰撞）
const rand32 = () => (Math.random() * 4294967296) | 0;
const Z_LO = new Int32Array(15 * NSQ).map(rand32);
const Z_HI = new Int32Array(15 * NSQ).map(rand32);
const Z_SIDE_LO = rand32();
const Z_SIDE_HI = rand32();

// 棋子代碼轉雜湊索引（紅 1~7，黑 8~14）
const pieceIndex = (p) => (p > 0 ? p : 7 - p);

// ───────────────────────── 高速搜尋引擎 ─────────────────────────
class XiangqiEngine {
  constructor() {
    this.cells = new Int8Array(NSQ);
    this.kingSq = [0, 0];
    this.cnt = [new Int8Array(8), new Int8Array(8)];
    this.mat = 0;          // 紅方視角子力 + 位置分（增量維護）
    this.hashLo = 0;
    this.hashHi = 0;
    this.tt = new Map();
    this.killers = [];
    this.history = new Int32Array(NSQ * NSQ);
    this.pathLo = new Int32Array(128);
    this.pathHi = new Int32Array(128);
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
  }

  // 從 UI 棋盤載入局面
  load(board) {
    this.cells.fill(0);
    this.cnt[0].fill(0);
    this.cnt[1].fill(0);
    this.mat = 0;
    this.hashLo = 0;
    this.hashHi = 0;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = board.grid[r][c];
        if (!piece) continue;
        const t = TYPE_BY_NAME[piece.id.split('_')[1]];
        const s = piece.side === SIDE.RED ? 1 : -1;
        const si = s > 0 ? 0 : 1;
        const sq = r * COLS + c;
        const p = s * t;
        this.cells[sq] = p;
        this.cnt[si][t]++;
        this.mat += s * (PIECE_VAL[t] + PST[si][t][sq]);
        this.hashLo ^= Z_LO[pieceIndex(p) * NSQ + sq];
        this.hashHi ^= Z_HI[pieceIndex(p) * NSQ + sq];
        if (t === KING) this.kingSq[si] = sq;
      }
    }
  }

  // 執行走步（回傳被吃的棋子代碼）
  make(m) {
    const from = m & 127;
    const to = m >> 7;
    const p = this.cells[from];
    const cap = this.cells[to];
    const s = p > 0 ? 1 : -1;
    const si = s > 0 ? 0 : 1;
    const t = p * s;
    const pi = pieceIndex(p) * NSQ;

    this.mat += s * (PST[si][t][to] - PST[si][t][from]);
    this.hashLo ^= Z_LO[pi + from] ^ Z_LO[pi + to];
    this.hashHi ^= Z_HI[pi + from] ^ Z_HI[pi + to];

    if (cap !== 0) {
      const ci = cap > 0 ? 0 : 1;
      const ct = cap > 0 ? cap : -cap;
      this.mat -= (cap > 0 ? 1 : -1) * (PIECE_VAL[ct] + PST[ci][ct][to]);
      this.cnt[ci][ct]--;
      const cpi = pieceIndex(cap) * NSQ;
      this.hashLo ^= Z_LO[cpi + to];
      this.hashHi ^= Z_HI[cpi + to];
    }

    this.cells[to] = p;
    this.cells[from] = 0;
    if (t === KING) this.kingSq[si] = to;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    return cap;
  }

  // 撤銷走步
  unmake(m, cap) {
    const from = m & 127;
    const to = m >> 7;
    const p = this.cells[to];
    const s = p > 0 ? 1 : -1;
    const si = s > 0 ? 0 : 1;
    const t = p * s;
    const pi = pieceIndex(p) * NSQ;

    this.mat -= s * (PST[si][t][to] - PST[si][t][from]);
    this.hashLo ^= Z_LO[pi + from] ^ Z_LO[pi + to];
    this.hashHi ^= Z_HI[pi + from] ^ Z_HI[pi + to];

    if (cap !== 0) {
      const ci = cap > 0 ? 0 : 1;
      const ct = cap > 0 ? cap : -cap;
      this.mat += (cap > 0 ? 1 : -1) * (PIECE_VAL[ct] + PST[ci][ct][to]);
      this.cnt[ci][ct]++;
      const cpi = pieceIndex(cap) * NSQ;
      this.hashLo ^= Z_LO[cpi + to];
      this.hashHi ^= Z_HI[cpi + to];
    }

    this.cells[from] = p;
    this.cells[to] = cap;
    if (t === KING) this.kingSq[si] = from;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
  }

  // 判斷格子 sq 是否受到 by 方（1 紅 / -1 黑）攻擊；同時涵蓋將帥照面
  isAttacked(sq, by) {
    const cells = this.cells;
    const rays = RAYS[sq];

    for (let d = 0; d < 4; d++) {
      const ray = rays[d];
      let i = 0;
      while (i < ray.length && cells[ray[i]] === 0) i++;
      if (i >= ray.length) continue;
      const first = cells[ray[i]];
      if (first === by * ROOK) return true;
      if (d < 2 && first === by * KING) return true; // 直線照面
      // 隔一子找炮
      for (let j = i + 1; j < ray.length; j++) {
        const second = cells[ray[j]];
        if (second !== 0) {
          if (second === by * CANNON) return true;
          break;
        }
      }
    }

    // 馬
    const ka = KNIGHT_ATTACKERS[sq];
    for (let i = 0; i < ka.length; i++) {
      if (cells[ka[i].from] === by * KNIGHT && cells[ka[i].leg] === 0) return true;
    }

    // 兵卒
    const r = (sq / COLS) | 0;
    const c = sq % COLS;
    if (by > 0) {
      // 紅兵往上走：位於 (r+1, c) 可前進攻擊；過河兵（r<=4）可橫走攻擊
      if (r + 1 < ROWS && cells[sq + COLS] === PAWN) return true;
      if (r <= 4) {
        if (c > 0 && cells[sq - 1] === PAWN) return true;
        if (c < COLS - 1 && cells[sq + 1] === PAWN) return true;
      }
    } else {
      if (r - 1 >= 0 && cells[sq - COLS] === -PAWN) return true;
      if (r >= 5) {
        if (c > 0 && cells[sq - 1] === -PAWN) return true;
        if (c < COLS - 1 && cells[sq + 1] === -PAWN) return true;
      }
    }
    return false;
  }

  inCheck(s) {
    return this.isAttacked(this.kingSq[s > 0 ? 0 : 1], -s);
  }

  // 產生偽合法走法（整數編碼 from | to << 7）
  genMoves(s, capsOnly) {
    const cells = this.cells;
    const moves = [];
    const push = (from, to) => {
      const q = cells[to];
      if (q === 0) {
        if (!capsOnly) moves.push(from | (to << 7));
      } else if ((q > 0) !== (s > 0)) {
        moves.push(from | (to << 7));
      }
    };

    for (let sq = 0; sq < NSQ; sq++) {
      const p = cells[sq];
      if (p === 0 || (p > 0) !== (s > 0)) continue;
      const t = p > 0 ? p : -p;
      const r = (sq / COLS) | 0;
      const c = sq % COLS;

      switch (t) {
        case KING:
        case ADVISOR: {
          const list = t === KING ? ORTH1[sq] : DIAG1[sq];
          for (let i = 0; i < list.length; i++) {
            const to = list[i];
            const tr = (to / COLS) | 0;
            const tc = to % COLS;
            if (tc < 3 || tc > 5) continue;
            if (s > 0 ? tr < 7 : tr > 2) continue;
            push(sq, to);
          }
          break;
        }
        case BISHOP: {
          const list = BISHOP_MOVES[sq];
          for (let i = 0; i < list.length; i++) {
            const { to, eye } = list[i];
            const tr = (to / COLS) | 0;
            if (s > 0 ? tr < 5 : tr > 4) continue; // 象不過河
            if (cells[eye] !== 0) continue;
            push(sq, to);
          }
          break;
        }
        case KNIGHT: {
          const list = KNIGHT_MOVES[sq];
          for (let i = 0; i < list.length; i++) {
            if (cells[list[i].leg] !== 0) continue;
            push(sq, list[i].to);
          }
          break;
        }
        case ROOK: {
          const rays = RAYS[sq];
          for (let d = 0; d < 4; d++) {
            const ray = rays[d];
            for (let i = 0; i < ray.length; i++) {
              const to = ray[i];
              const q = cells[to];
              if (q === 0) {
                if (!capsOnly) moves.push(sq | (to << 7));
              } else {
                if ((q > 0) !== (s > 0)) moves.push(sq | (to << 7));
                break;
              }
            }
          }
          break;
        }
        case CANNON: {
          const rays = RAYS[sq];
          for (let d = 0; d < 4; d++) {
            const ray = rays[d];
            let screen = false;
            for (let i = 0; i < ray.length; i++) {
              const to = ray[i];
              const q = cells[to];
              if (!screen) {
                if (q === 0) {
                  if (!capsOnly) moves.push(sq | (to << 7));
                } else {
                  screen = true;
                }
              } else if (q !== 0) {
                if ((q > 0) !== (s > 0)) moves.push(sq | (to << 7));
                break;
              }
            }
          }
          break;
        }
        case PAWN: {
          if (s > 0) {
            if (r > 0) push(sq, sq - COLS);
            if (r <= 4) {
              if (c > 0) push(sq, sq - 1);
              if (c < COLS - 1) push(sq, sq + 1);
            }
          } else {
            if (r < ROWS - 1) push(sq, sq + COLS);
            if (r >= 5) {
              if (c > 0) push(sq, sq - 1);
              if (c < COLS - 1) push(sq, sq + 1);
            }
          }
          break;
        }
      }
    }
    return moves;
  }

  // 局面評估（以 s 方視角）
  evaluate(s) {
    let sc = this.mat;
    const red = this.cnt[0];
    const black = this.cnt[1];

    // 士象殘缺時，依對方攻擊子力扣分（老將安全）
    const blackAtk = black[ROOK] * 2 + black[KNIGHT] + black[CANNON];
    const redAtk = red[ROOK] * 2 + red[KNIGHT] + red[CANNON];
    const redWeak = (2 - red[ADVISOR]) * 22 + (2 - red[BISHOP]) * 16;
    const blackWeak = (2 - black[ADVISOR]) * 22 + (2 - black[BISHOP]) * 16;
    sc -= blackAtk >= 3 ? redWeak : redWeak >> 1;
    sc += redAtk >= 3 ? blackWeak : blackWeak >> 1;

    // 雙炮/炮馬配合在殘局的威力變化：子少時車價值相對提高
    return (s > 0 ? sc : -sc) + 10; // +10 先手優勢
  }

  ttKey() {
    return (this.hashHi & 0x1fffff) * 4294967296 + (this.hashLo >>> 0);
  }

  // 走法排序分數
  scoreMoves(moves, ttMove, ply) {
    const scores = new Int32Array(moves.length);
    const k = this.killers[ply] || [0, 0];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) { scores[i] = 10000000; continue; }
      const from = m & 127;
      const to = m >> 7;
      const victim = this.cells[to];
      if (victim !== 0) {
        const vt = victim > 0 ? victim : -victim;
        const at = Math.abs(this.cells[from]);
        scores[i] = 1000000 + (vt === KING ? 5000 : PIECE_VAL[vt]) * 10 - PIECE_VAL[at];
      } else if (m === k[0]) {
        scores[i] = 900000;
      } else if (m === k[1]) {
        scores[i] = 800000;
      } else {
        scores[i] = this.history[from * NSQ + to];
      }
    }
    return scores;
  }

  // 選擇排序：取出剩餘中分數最高者
  pickNext(moves, scores, start) {
    let best = start;
    for (let j = start + 1; j < moves.length; j++) {
      if (scores[j] > scores[best]) best = j;
    }
    if (best !== start) {
      const tm = moves[start]; moves[start] = moves[best]; moves[best] = tm;
      const ts = scores[start]; scores[start] = scores[best]; scores[best] = ts;
    }
    return moves[start];
  }

  checkTime() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) {
      this.aborted = true;
    }
    return this.aborted;
  }

  // 主搜尋（Negamax + PVS）
  search(depth, alpha, beta, ply, s) {
    if (this.checkTime()) return 0;

    // 路徑重覆局面視為和棋，避免無限兜圈
    this.pathLo[ply] = this.hashLo;
    this.pathHi[ply] = this.hashHi;
    for (let i = ply - 2; i >= 0; i -= 2) {
      if (this.pathLo[i] === this.hashLo && this.pathHi[i] === this.hashHi) return 0;
    }

    const si = s > 0 ? 0 : 1;
    const inCheck = this.isAttacked(this.kingSq[si], -s);
    if (inCheck && ply < 30) depth++; // 將軍延伸

    if (depth <= 0) return this.qsearch(alpha, beta, ply, s, 0);

    // 置換表探測
    const key = this.ttKey();
    const entry = this.tt.get(key);
    let ttMove = 0;
    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        let v = entry.score;
        if (v > MATE - 500) v -= ply;
        else if (v < -MATE + 500) v += ply;
        if (entry.flag === 0) return v;
        if (entry.flag === 1 && v >= beta) return v;
        if (entry.flag === 2 && v <= alpha) return v;
      }
    }

    const moves = this.genMoves(s, false);
    const scores = this.scoreMoves(moves, ttMove, ply);
    const origAlpha = alpha;
    let best = -INF;
    let bestMove = 0;
    let legal = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = this.pickNext(moves, scores, i);
      const cap = this.make(m);
      if (this.isAttacked(this.kingSq[si], -s)) { // 走完己方被將 → 非法
        this.unmake(m, cap);
        continue;
      }
      legal++;

      let v;
      if (legal === 1) {
        v = -this.search(depth - 1, -beta, -alpha, ply + 1, -s);
      } else {
        v = -this.search(depth - 1, -alpha - 1, -alpha, ply + 1, -s);
        if (v > alpha && v < beta) {
          v = -this.search(depth - 1, -beta, -alpha, ply + 1, -s);
        }
      }
      this.unmake(m, cap);
      if (this.aborted) return 0;

      if (v > best) {
        best = v;
        bestMove = m;
        if (v > alpha) {
          alpha = v;
          if (alpha >= beta) {
            if (cap === 0) {
              // 殺手步與歷史啟發
              const k = this.killers[ply] || (this.killers[ply] = [0, 0]);
              if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
              this.history[(m & 127) * NSQ + (m >> 7)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    // 無合法步：將死或困斃（象棋中困斃亦判負）
    if (legal === 0) return -MATE + ply;

    // 寫入置換表
    let stored = best;
    if (stored > MATE - 500) stored += ply;
    else if (stored < -MATE + 500) stored -= ply;
    this.tt.set(key, {
      depth,
      score: stored,
      flag: best <= origAlpha ? 2 : (best >= beta ? 1 : 0),
      move: bestMove
    });
    return best;
  }

  // 靜態搜尋：只展開吃子，消除地平線盲點
  qsearch(alpha, beta, ply, s, qd) {
    if (this.checkTime()) return 0;

    const stand = this.evaluate(s);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd >= 8) return stand;

    const si = s > 0 ? 0 : 1;
    const moves = this.genMoves(s, true);
    const scores = this.scoreMoves(moves, 0, ply);
    let best = stand;

    for (let i = 0; i < moves.length; i++) {
      const m = this.pickNext(moves, scores, i);
      const cap = this.make(m);
      if (this.isAttacked(this.kingSq[si], -s)) {
        this.unmake(m, cap);
        continue;
      }
      const v = -this.qsearch(-beta, -alpha, ply + 1, -s, qd + 1);
      this.unmake(m, cap);
      if (this.aborted) return 0;

      if (v > best) {
        best = v;
        if (v > alpha) {
          alpha = v;
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }

  // 根節點合法走法
  rootMoves(s) {
    const si = s > 0 ? 0 : 1;
    const legal = [];
    for (const m of this.genMoves(s, false)) {
      const cap = this.make(m);
      if (!this.isAttacked(this.kingSq[si], -s)) legal.push(m);
      this.unmake(m, cap);
    }
    return legal;
  }
}

// ───────────────────────── 對外 AI 類別 ─────────────────────────
export class LargeAI {
  constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
    this.difficulty = difficulty;
    this.engine = new XiangqiEngine();
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  // 中國象棋正統開局庫（紅黑雙方皆有，增加開局變化）
  getOpeningMove(board, aiSide) {
    const history = board.moveHistory;
    const legalMoves = board.getAllLegalMoves(aiSide);
    if (legalMoves.length === 0) return null;

    const findLegal = (fromR, fromC, toR, toC) =>
      legalMoves.find(m => m.fromR === fromR && m.fromC === fromC && m.toR === toR && m.toC === toC);

    const pickRandom = (arr) => {
      const valid = arr.filter(Boolean);
      if (valid.length === 0) return null;
      return valid[Math.floor(Math.random() * valid.length)];
    };

    // 紅方（AI 先手）第一步
    if (aiSide === SIDE.RED && history.length === 0) {
      return pickRandom([
        findLegal(7, 1, 7, 4), // 中炮（炮二平五）
        findLegal(7, 7, 7, 4), // 中炮（炮八平五）
        findLegal(7, 7, 7, 4), // 中炮加權
        findLegal(9, 1, 7, 2), // 起馬局
        findLegal(9, 7, 7, 6), // 起馬局
        findLegal(9, 2, 7, 4), // 飛相局
        findLegal(6, 2, 5, 2), // 仙人指路
        findLegal(6, 6, 5, 6)  // 仙人指路
      ]);
    }

    if (aiSide !== SIDE.BLACK) return null;

    // 黑方第 1 步應手
    if (history.length === 1) {
      const redMove = history[0];
      const name = redMove.piece?.name;

      if (name === '炮' && redMove.toC === 4) {
        const chosen = pickRandom([
          findLegal(0, 1, 2, 2), // 屏風馬
          findLegal(0, 7, 2, 6), // 屏風馬
          findLegal(2, 7, 2, 4), // 順手炮
          findLegal(2, 1, 2, 4), // 列手炮
          findLegal(2, 1, 2, 3), // 反宮馬
          findLegal(3, 2, 4, 2)  // 挺卒
        ]);
        if (chosen) return chosen;
      }
      if (name === '傌') {
        const chosen = pickRandom([
          findLegal(3, 2, 4, 2), findLegal(3, 6, 4, 6),
          findLegal(0, 1, 2, 2), findLegal(2, 7, 2, 4)
        ]);
        if (chosen) return chosen;
      }
      if (name === '相') {
        const chosen = pickRandom([
          findLegal(2, 1, 2, 4), findLegal(3, 2, 4, 2),
          findLegal(0, 1, 2, 2), findLegal(2, 7, 2, 4)
        ]);
        if (chosen) return chosen;
      }
      if (name === '兵') {
        const chosen = pickRandom([
          findLegal(2, 7, 2, 6), findLegal(3, 2, 4, 2),
          findLegal(0, 7, 2, 6), findLegal(2, 1, 2, 4)
        ]);
        if (chosen) return chosen;
      }
      const chosen = pickRandom([
        findLegal(0, 1, 2, 2), findLegal(0, 7, 2, 6),
        findLegal(3, 2, 4, 2), findLegal(2, 7, 2, 4)
      ]);
      if (chosen) return chosen;
    }
    return null;
  }

  // 取得最佳走步
  getBestMove(board, aiSide) {
    const legalMoves = board.getAllLegalMoves(aiSide);
    if (legalMoves.length === 0) return null;

    const openingMove = this.getOpeningMove(board, aiSide);
    if (openingMove) return openingMove;

    const cfg = LEVEL_CONFIG[this.difficulty] || LEVEL_CONFIG[AI_DIFFICULTY.MEDIUM];
    const E = this.engine;
    const s = aiSide === SIDE.RED ? 1 : -1;

    E.load(board);
    E.tt = new Map();
    E.killers = [];
    E.history.fill(0);
    E.nodes = 0;
    E.aborted = false;
    E.deadline = Date.now() + cfg.time;
    E.pathLo[0] = E.hashLo;
    E.pathHi[0] = E.hashHi;

    let ordered = E.rootMoves(s).map(m => ({ m, score: 0, exact: true }));
    if (ordered.length === 0) return legalMoves[0];

    let completed = null;

    // 迭代加深：每完成一層就保存結果，時間到則使用上一層完整結果
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      const iter = [];
      let iterBest = -INF;

      for (const item of ordered) {
        // 視窗下界 = 目前最佳 - 候選分差，確保候選範圍內分數精確
        const lowBound = iterBest === -INF ? -INF : iterBest - cfg.margin;
        const cap = E.make(item.m);
        const v = -E.search(depth - 1, -INF, -lowBound, 1, -s);
        E.unmake(item.m, cap);
        if (E.aborted) break;

        iter.push({ m: item.m, score: v, exact: v > lowBound });
        if (v > iterBest) iterBest = v;
      }

      if (E.aborted) {
        if (!completed && iter.length > 0) completed = iter;
        break;
      }

      iter.sort((a, b) => b.score - a.score);
      completed = iter;
      ordered = iter;

      if (Math.abs(iterBest) > MATE - 200) break; // 已找到殺棋或必敗
    }

    if (!completed || completed.length === 0) return legalMoves[0];

    // 候選：精確分數且與最佳差距在 margin 內
    const bestScore = Math.max(...completed.filter(x => x.exact).map(x => x.score));
    let candidates = completed.filter(x => x.exact && x.score >= bestScore - cfg.margin);
    if (candidates.length === 0) candidates = [completed[0]];

    // 避免來回兜圈：輕微懲罰「走回上一步原位」
    const hist = board.moveHistory;
    const lastOwn = hist.length >= 2 ? hist[hist.length - 2] : null;

    let picked = null;
    let pickedVal = -Infinity;
    for (const cand of candidates) {
      const from = cand.m & 127;
      const to = cand.m >> 7;
      let val = cand.score + (Math.random() * 2 - 1) * cfg.noise;
      if (lastOwn &&
          from === lastOwn.toR * COLS + lastOwn.toC &&
          to === lastOwn.fromR * COLS + lastOwn.fromC) {
        val -= 25;
      }
      if (val > pickedVal) {
        pickedVal = val;
        picked = cand;
      }
    }

    const from = picked.m & 127;
    const to = picked.m >> 7;
    return legalMoves.find(lm =>
      lm.fromR * COLS + lm.fromC === from && lm.toR * COLS + lm.toC === to
    ) || legalMoves[0];
  }
}
