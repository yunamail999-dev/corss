/**
 * 東方御弈 - 小盤暗棋（半盤 4x8）AI 決策引擎 (js/ai-small.js)
 *
 * 第三代重構版：
 * - 修正舊版致命缺陷：舊版威脅偵測受 currentTurn 限制，永遠判定「沒有危險」，導致棋子被捉不逃
 * - 獨立高速一維棋盤 + Negamax Alpha-Beta 搜尋 + 靜態吃子搜尋，真正看見「對手下一步會吃我」
 * - 翻棋採「機率期望值」評估：依剩餘未翻棋子組成，逐一模擬翻出每種棋子的後果
 * - 主動翻吃暗棋（冒險攻擊）也以期望值計算，不再亂踩雷
 * - 連吃模式納入搜尋（吃完可繼續吃或停手）
 * - 動態子力：兵卒在對方帥將存活時更值錢；無天敵的棋子額外加分；強子會主動追殺弱子
 * - AI 不偷看暗棋：只使用公開資訊（已翻明棋、被吃棋子、剩餘棋子分佈）
 */

import { SIDE, AI_DIFFICULTY } from './constants.js';

// ───────────────────────── 基本常數 ─────────────────────────
const ROWS = 4;
const COLS = 8;
const NSQ = ROWS * COLS;
const HIDDEN = 99;                 // 未翻開暗棋
const RANK_TOTAL = [0, 5, 2, 2, 2, 2, 2, 1]; // 各位階棋子數（索引為 rank）
// 位階價值：1兵 2炮 3馬 4車 5象 6士 7將
const BASE_VAL = [0, 60, 300, 90, 150, 250, 400, 650];
const WIN = 100000;
const INF = 1000000000;

// 難度設定：搜尋深度、翻棋模擬深度、候選分差、隨機擾動、時間
const LEVEL_CONFIG = {
  [AI_DIFFICULTY.EASY]:        { depth: 1, flipDepth: 0, margin: 70, noise: 35, time: 300 },
  [AI_DIFFICULTY.AMATEUR]:     { depth: 2, flipDepth: 1, margin: 35, noise: 15, time: 600 },
  [AI_DIFFICULTY.MEDIUM]:      { depth: 3, flipDepth: 1, margin: 15, noise: 6,  time: 1000 },
  [AI_DIFFICULTY.HARD]:        { depth: 5, flipDepth: 2, margin: 8,  noise: 3,  time: 1600 },
  [AI_DIFFICULTY.GRANDMASTER]: { depth: 8, flipDepth: 2, margin: 4,  noise: 0,  time: 2500 }
};

// 預先計算鄰格與射線
const NEIGH = [];
const RAYS = [];
(function precompute() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const sq = r * COLS + c;
      NEIGH[sq] = [];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) NEIGH[sq].push(nr * COLS + nc);
      }
      const up = [], down = [], left = [], right = [];
      for (let rr = r - 1; rr >= 0; rr--) up.push(rr * COLS + c);
      for (let rr = r + 1; rr < ROWS; rr++) down.push(rr * COLS + c);
      for (let cc = c - 1; cc >= 0; cc--) left.push(r * COLS + cc);
      for (let cc = c + 1; cc < COLS; cc++) right.push(r * COLS + cc);
      RAYS[sq] = [up, down, left, right];
    }
  }
})();

// 一般吃子位階判定（兵吃將、將不吃兵、大吃小、同級互吃）
function canCap(a, d) {
  if (a === 1 && d === 7) return true;
  if (a === 7 && d === 1) return false;
  return a >= d;
}

// ───────────────────────── 暗棋搜尋引擎 ─────────────────────────
class DarkChessEngine {
  constructor() {
    this.cells = new Int8Array(NSQ);           // 0 空、99 暗棋、±rank 明棋（紅正黑負）
    this.pool = [new Int8Array(8), new Int8Array(8)]; // 未翻棋子分佈 [紅/黑][rank]
    this.alive = [16, 16];
    this.hiddenTotal = 0;
    this.comboMode = true;
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.useTimeLimit = true;
    this._ar = [new Int8Array(8), new Int8Array(8)];
  }

  // 由 UI 棋盤載入（只讀公開資訊）
  load(board, comboMode) {
    this.comboMode = !!comboMode;
    this.pool[0].set(RANK_TOTAL);
    this.pool[1].set(RANK_TOTAL);
    this.hiddenTotal = 0;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board.grid[r][c];
        const sq = r * COLS + c;
        if (!p) {
          this.cells[sq] = 0;
        } else if (!p.isRevealed) {
          this.cells[sq] = HIDDEN;
          this.hiddenTotal++;
        } else {
          const si = p.side === SIDE.RED ? 0 : 1;
          this.cells[sq] = (si === 0 ? 1 : -1) * p.rank;
          this.pool[si][p.rank]--;
        }
      }
    }
    for (const p of board.capturedPieces.red) this.pool[0][p.rank]--;
    for (const p of board.capturedPieces.black) this.pool[1][p.rank]--;
    this.alive[0] = 16 - board.capturedPieces.red.length;
    this.alive[1] = 16 - board.capturedPieces.black.length;

    // 安全防護：避免異常資料造成負數
    for (let si = 0; si < 2; si++) {
      for (let k = 1; k <= 7; k++) if (this.pool[si][k] < 0) this.pool[si][k] = 0;
    }
  }

  // 產生走法（整數編碼：from | to<<5 | 吃子旗標<<10）
  genMoves(s, capsOnly, onlySq = -1) {
    const cells = this.cells;
    const moves = [];
    const start = onlySq >= 0 ? onlySq : 0;
    const end = onlySq >= 0 ? onlySq + 1 : NSQ;

    for (let sq = start; sq < end; sq++) {
      const v = cells[sq];
      if (v === 0 || v === HIDDEN || (v > 0) !== (s > 0)) continue;
      const rank = v > 0 ? v : -v;

      if (rank === 2) {
        // 炮：走相鄰空格，隔一子跳吃敵方明棋（不限位階）
        if (!capsOnly) {
          for (const n of NEIGH[sq]) if (cells[n] === 0) moves.push(sq | (n << 5));
        }
        for (const ray of RAYS[sq]) {
          let screen = false;
          for (const t of ray) {
            const cv = cells[t];
            if (cv === 0) continue;
            if (!screen) { screen = true; continue; }
            if (cv !== HIDDEN && (cv > 0) !== (s > 0)) moves.push(sq | (t << 5) | 1024);
            break;
          }
        }
      } else {
        for (const n of NEIGH[sq]) {
          const cv = cells[n];
          if (cv === 0) {
            if (!capsOnly) moves.push(sq | (n << 5));
          } else if (cv !== HIDDEN && (cv > 0) !== (s > 0) && canCap(rank, cv > 0 ? cv : -cv)) {
            moves.push(sq | (n << 5) | 1024);
          }
        }
      }
    }
    return moves;
  }

  make(m) {
    const f = m & 31;
    const t = (m >> 5) & 31;
    const cap = this.cells[t];
    this.cells[t] = this.cells[f];
    this.cells[f] = 0;
    if (cap !== 0) this.alive[cap > 0 ? 0 : 1]--;
    return cap;
  }

  unmake(m, cap) {
    const f = m & 31;
    const t = (m >> 5) & 31;
    this.cells[f] = this.cells[t];
    this.cells[t] = cap;
    if (cap !== 0) this.alive[cap > 0 ? 0 : 1]++;
  }

  // 依位階與敵方帥將存活狀況決定子力價值
  valueOf(rank, enemyKingAlive) {
    if (rank === 1) return enemyKingAlive ? 100 : 45;
    return BASE_VAL[rank];
  }

  // 局面評估（以 s 方視角）
  evaluate(s) {
    const cells = this.cells;
    const ar = this._ar;
    ar[0].set(this.pool[0]);
    ar[1].set(this.pool[1]);

    for (let sq = 0; sq < NSQ; sq++) {
      const v = cells[sq];
      if (v === 0 || v === HIDDEN) continue;
      if (v > 0) ar[0][v]++; else ar[1][-v]++;
    }

    let score = 0;

    // 1. 子力（含未翻棋子的已知分佈）
    for (let si = 0; si < 2; si++) {
      const sign = si === 0 ? 1 : -1;
      const enemyKingAlive = ar[1 - si][7] > 0;
      for (let k = 1; k <= 7; k++) {
        score += sign * ar[si][k] * this.valueOf(k, enemyKingAlive);
      }
    }

    // 2. 明棋位置因素：無天敵加成、強子追殺弱子
    for (let sq = 0; sq < NSQ; sq++) {
      const v = cells[sq];
      if (v === 0 || v === HIDDEN) continue;
      const si = v > 0 ? 0 : 1;
      const sign = si === 0 ? 1 : -1;
      const k = v > 0 ? v : -v;
      const enemy = ar[1 - si];

      // 場上（含暗棋）還有多少敵子能吃我
      let threats = enemy[2]; // 炮可跳吃任何棋
      for (let e = 1; e <= 7; e++) {
        if (e !== 2 && canCap(e, k)) threats += enemy[e];
      }
      if (threats === 0) score += sign * this.valueOf(k, enemy[7] > 0) * 0.3;

      // 追殺：靠近可吃且吃不回我的敵方明棋
      if (k !== 2) {
        let minDist = 99;
        const r = (sq / COLS) | 0;
        const c = sq % COLS;
        for (let t = 0; t < NSQ; t++) {
          const tv = cells[t];
          if (tv === 0 || tv === HIDDEN || (tv > 0) === (v > 0)) continue;
          const tk = tv > 0 ? tv : -tv;
          if (canCap(k, tk) && !canCap(tk, k)) {
            const d = Math.abs(((t / COLS) | 0) - r) + Math.abs((t % COLS) - c);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist < 99) score += sign * (10 - minDist) * 3;
      }
    }

    return s > 0 ? score : -score;
  }

  checkTime() {
    if (this.useTimeLimit && (++this.nodes & 511) === 0 && Date.now() > this.deadline) {
      this.aborted = true;
    }
    return this.aborted;
  }

  // 走法排序：吃大子優先
  orderMoves(moves) {
    const cells = this.cells;
    const key = (m) => {
      if (!(m & 1024)) return 0;
      const victim = Math.abs(cells[(m >> 5) & 31]);
      const attacker = Math.abs(cells[m & 31]);
      return 1000 + BASE_VAL[victim] * 4 - BASE_VAL[attacker];
    };
    return moves.sort((a, b) => key(b) - key(a));
  }

  // 主搜尋（Negamax）；翻棋以「中性等待步」近似
  search(s, depth, alpha, beta, ply) {
    if (this.checkTime()) return 0;
    const si = s > 0 ? 0 : 1;
    if (this.alive[si] === 0) return -WIN + ply;
    if (this.alive[1 - si] === 0) return WIN - ply;

    if (depth <= 0) return this.qsearch(s, alpha, beta, ply, 0);

    const moves = this.orderMoves(this.genMoves(s, false));
    if (moves.length === 0 && this.hiddenTotal === 0) return -WIN + ply; // 困斃

    let best = -INF;

    // 翻棋選項（視為中性步，讓搜尋不會誤以為對手被迫送子）
    if (this.hiddenTotal > 0) {
      const v = -this.search(-s, depth - 1, -beta, -alpha, ply + 1);
      if (this.aborted) return 0;
      best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) return best;
    }

    for (const m of moves) {
      const cap = this.make(m);
      let v;
      if (cap !== 0 && this.comboMode) {
        v = this.combo(s, (m >> 5) & 31, depth - 1, alpha, beta, ply + 1);
      } else {
        v = -this.search(-s, depth - 1, -beta, -alpha, ply + 1);
      }
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

  // 連吃節點：同一顆棋可繼續吃，或停手換對方（數值以 s 方視角）
  combo(s, sq, depth, alpha, beta, ply) {
    if (this.checkTime()) return 0;
    const si = s > 0 ? 0 : 1;
    if (this.alive[1 - si] === 0) return WIN - ply;

    let best = -this.search(-s, depth, -beta, -alpha, ply);
    if (this.aborted) return 0;
    if (best >= beta) return best;
    if (best > alpha) alpha = best;

    const caps = this.genMoves(s, true, sq);
    for (const m of caps) {
      const cap = this.make(m);
      const v = this.combo(s, (m >> 5) & 31, depth, alpha, beta, ply + 1);
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

  // 靜態吃子搜尋
  qsearch(s, alpha, beta, ply, qd) {
    if (this.checkTime()) return 0;
    const si = s > 0 ? 0 : 1;
    if (this.alive[si] === 0) return -WIN + ply;
    if (this.alive[1 - si] === 0) return WIN - ply;

    const stand = this.evaluate(s);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd >= 10) return stand;

    let best = stand;
    const caps = this.orderMoves(this.genMoves(s, true));
    for (const m of caps) {
      const cap = this.make(m);
      const v = this.comboMode
        ? this.qcombo(s, (m >> 5) & 31, alpha, beta, ply + 1, qd + 1)
        : -this.qsearch(-s, -beta, -alpha, ply + 1, qd + 1);
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

  qcombo(s, sq, alpha, beta, ply, qd) {
    const si = s > 0 ? 0 : 1;
    if (this.alive[1 - si] === 0) return WIN - ply;

    let best = -this.qsearch(-s, -beta, -alpha, ply, qd);
    if (this.aborted) return 0;
    if (best >= beta) return best;
    if (best > alpha) alpha = best;

    const caps = this.genMoves(s, true, sq);
    for (const m of caps) {
      const cap = this.make(m);
      const v = this.qcombo(s, (m >> 5) & 31, alpha, beta, ply + 1, qd + 1);
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

  // 對手回應後的局面價值（以 s 方視角，輪到對手）
  valueAfter(s, depth) {
    return -this.search(-s, depth, -INF, INF, 1);
  }

  // 列舉未翻棋子的所有可能（含機率），對每種結果呼叫 fn 並回傳期望值
  expectOverPool(fn) {
    let ev = 0;
    const total = this.hiddenTotal;
    if (total <= 0) return 0;
    for (let si = 0; si < 2; si++) {
      for (let k = 1; k <= 7; k++) {
        const n = this.pool[si][k];
        if (n <= 0) continue;
        this.pool[si][k]--;
        this.hiddenTotal--;
        const v = fn(si === 0 ? k : -k, si, k);
        this.pool[si][k]++;
        this.hiddenTotal++;
        ev += (n / total) * v;
      }
    }
    return ev;
  }

  // 翻開格子 t 的期望值
  flipEV(s, t, depth) {
    return this.expectOverPool((pv) => {
      this.cells[t] = pv;
      const v = this.valueAfter(s, depth);
      this.cells[t] = HIDDEN;
      return v;
    });
  }

  // 由 f 處的明棋翻吃 t 處暗棋的期望值
  darkCaptureEV(s, f, t, depth) {
    const attacker = this.cells[f];
    const ak = attacker > 0 ? attacker : -attacker;
    const mySi = s > 0 ? 0 : 1;

    return this.expectOverPool((pv, si, k) => {
      let v;
      if (si === mySi) {
        // 翻出自己人：原地不動，回合結束
        this.cells[t] = pv;
        v = this.valueAfter(s, depth);
        this.cells[t] = HIDDEN;
      } else if (ak === 2 || canCap(ak, k)) {
        // 吃下成功
        this.cells[t] = attacker;
        this.cells[f] = 0;
        this.alive[si]--;
        v = this.comboMode
          ? this.combo(s, t, depth, -INF, INF, 1)
          : this.valueAfter(s, depth);
        this.alive[si]++;
        this.cells[f] = attacker;
        this.cells[t] = HIDDEN;
      } else {
        // 踩雷：攻擊者陣亡
        this.cells[f] = 0;
        this.cells[t] = pv;
        this.alive[mySi]--;
        v = this.valueAfter(s, depth);
        this.alive[mySi]++;
        this.cells[t] = HIDDEN;
        this.cells[f] = attacker;
      }
      return v;
    });
  }
}

// ───────────────────────── 對外 AI 類別 ─────────────────────────
export class SmallAI {
  constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
    this.difficulty = difficulty;
    this.comboMode = true; // 由 main.js 同步連吃模式設定
    this.engine = new DarkChessEngine();
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  getConfig() {
    return LEVEL_CONFIG[this.difficulty] || LEVEL_CONFIG[AI_DIFFICULTY.MEDIUM];
  }

  // 評估最佳行動（回傳 { action: 'flip' | 'move', ... }）
  getBestAction(board, aiSide) {
    const unrevealed = board.getUnrevealedTiles();

    // 開局首翻：陣營未定時隨機翻
    if (!aiSide || !board.aiSide) {
      if (unrevealed.length === 0) return null;
      const picked = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      return { action: 'flip', r: picked.r, c: picked.c };
    }

    const cfg = this.getConfig();
    const E = this.engine;
    const s = aiSide === SIDE.RED ? 1 : -1;
    const legal = board.getAllLegalMoves(aiSide);

    E.load(board, this.comboMode);
    E.nodes = 0;
    E.aborted = false;
    E.useTimeLimit = true;
    E.deadline = Date.now() + cfg.time;

    // ── (A) 明棋走步：迭代加深搜尋 ──
    let ordered = E.genMoves(s, false).map(m => ({ m }));
    let completed = [];
    let passDeep = 0;
    let haveDepth = 0;

    if (ordered.length > 0) {
      for (let depth = 1; depth <= cfg.depth; depth++) {
        const iter = [];
        let iterBest = -INF;

        // 「不走棋（翻棋）」的基準值，與走步在同一深度比較
        let pv = 0;
        if (E.hiddenTotal > 0) {
          pv = E.valueAfter(s, depth - 1);
          if (E.aborted) break;
        }

        for (const item of ordered) {
          const lowBound = iterBest === -INF ? -INF : iterBest - cfg.margin;
          const cap = E.make(item.m);
          let v;
          if (cap !== 0 && E.comboMode) {
            v = E.combo(s, (item.m >> 5) & 31, depth - 1, lowBound, INF, 1);
          } else {
            v = -E.search(-s, depth - 1, -INF, -lowBound, 1);
          }
          E.unmake(item.m, cap);
          if (E.aborted) break;
          iter.push({ m: item.m, score: v, exact: v > lowBound });
          if (v > iterBest) iterBest = v;
        }

        if (E.aborted) {
          if (haveDepth === 0 && iter.length === ordered.length) {
            completed = iter;
            passDeep = pv;
            haveDepth = depth;
          }
          break;
        }

        iter.sort((a, b) => b.score - a.score);
        completed = iter;
        ordered = iter;
        passDeep = pv;
        haveDepth = depth;
        if (Math.abs(iterBest) > WIN - 1000) break;
      }

      // 時間極端不足時的保底：深度 1 無時限重算
      if (haveDepth === 0) {
        E.aborted = false;
        E.useTimeLimit = false;
        completed = ordered.map(item => {
          const cap = E.make(item.m);
          const v = (cap !== 0 && E.comboMode)
            ? E.combo(s, (item.m >> 5) & 31, 0, -INF, INF, 1)
            : -E.search(-s, 0, -INF, INF, 1);
          E.unmake(item.m, cap);
          return { m: item.m, score: v, exact: true };
        });
        passDeep = E.hiddenTotal > 0 ? E.valueAfter(s, 0) : 0;
      }
    }

    // ── (B) 翻棋與翻吃：期望值評估（不受時間中斷，確保結果可靠）──
    E.aborted = false;
    E.useTimeLimit = false;
    const candidates = [];

    for (const item of completed) {
      if (!item.exact) continue;
      const f = item.m & 31;
      const t = (item.m >> 5) & 31;
      const move = legal.find(lm =>
        lm.type !== 'dark_capture' && lm.fromR * COLS + lm.fromC === f && lm.toR * COLS + lm.toC === t
      );
      if (move) candidates.push({ kind: 'move', move, score: item.score, f, t });
    }

    if (E.hiddenTotal > 0) {
      const fd = cfg.flipDepth;
      const passShallow = E.valueAfter(s, fd);

      // 我方已翻明棋太少時，鼓勵翻棋展開
      let myRevealed = 0;
      for (let sq = 0; sq < NSQ; sq++) {
        const v = E.cells[sq];
        if (v !== 0 && v !== HIDDEN && (v > 0) === (s > 0)) myRevealed++;
      }
      const flipBias = 4 + (myRevealed < 2 ? 20 : 0);

      for (const tile of unrevealed) {
        const t = tile.r * COLS + tile.c;
        const ev = E.flipEV(s, t, fd);
        candidates.push({
          kind: 'flip',
          r: tile.r,
          c: tile.c,
          score: passDeep + (ev - passShallow) + flipBias
        });
      }

      // 主動翻吃暗棋（帥將、士、炮等強子的冒險攻擊）
      for (const lm of legal) {
        if (lm.type !== 'dark_capture') continue;
        const f = lm.fromR * COLS + lm.fromC;
        const t = lm.toR * COLS + lm.toC;
        const ev = E.darkCaptureEV(s, f, t, fd);
        candidates.push({ kind: 'move', move: lm, score: passDeep + (ev - passShallow), f, t });
      }
    }

    if (candidates.length === 0) {
      if (legal.length > 0) return { action: 'move', move: legal[0] };
      if (unrevealed.length > 0) return { action: 'flip', r: unrevealed[0].r, c: unrevealed[0].c };
      return null;
    }

    // ── (C) 依難度在接近最佳的候選中挑選 ──
    const bestScore = Math.max(...candidates.map(x => x.score));
    const pool = candidates.filter(x => x.score >= bestScore - cfg.margin);

    // 避免兩步來回兜圈
    const hist = board.moveHistory;
    let lastOwn = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      if (h.type === 'move' && h.piece && h.piece.side === aiSide) { lastOwn = h; break; }
    }

    let picked = pool[0];
    let pickedVal = -Infinity;
    for (const cand of pool) {
      let val = cand.score + (Math.random() * 2 - 1) * cfg.noise;
      if (cand.kind === 'move' && lastOwn &&
          cand.f === lastOwn.toR * COLS + lastOwn.toC &&
          cand.t === lastOwn.fromR * COLS + lastOwn.fromC) {
        val -= 20;
      }
      if (val > pickedVal) {
        pickedVal = val;
        picked = cand;
      }
    }

    if (picked.kind === 'flip') return { action: 'flip', r: picked.r, c: picked.c };
    return { action: 'move', move: picked.move };
  }

  // 評估連吃中的下一擊（回傳 null 表示停手）
  getBestConsecutiveCapture(board, r, c, aiSide) {
    const captures = board.getConsecutiveCaptures(r, c);
    if (!captures || captures.length === 0) return null;

    const cfg = this.getConfig();
    const E = this.engine;
    const s = aiSide === SIDE.RED ? 1 : -1;
    const sq = r * COLS + c;
    const depth = Math.min(cfg.flipDepth + 1, 3);

    E.load(board, true);
    E.aborted = false;
    E.useTimeLimit = false;

    // 停手的價值
    const stopVal = E.valueAfter(s, depth);
    let best = stopVal + 3; // 分數相近時寧可見好就收
    let bestMove = null;

    for (const mv of captures) {
      const t = mv.toR * COLS + mv.toC;
      let v;
      if (mv.type === 'capture') {
        const m = sq | (t << 5) | 1024;
        const cap = E.make(m);
        v = E.combo(s, t, depth, -INF, INF, 1);
        E.unmake(m, cap);
      } else {
        v = E.darkCaptureEV(s, sq, t, depth);
      }
      if (v > best) {
        best = v;
        bestMove = mv;
      }
    }
    return bestMove;
  }
}
