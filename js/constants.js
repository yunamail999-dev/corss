/**
 * 東方御弈 - 常數定義與棋子配置 (js/constants.js)
 * 包含陣營、棋子類型、暗棋位階、價值評估表等常數
 */

// 陣營常數
export const SIDE = {
  RED: 'red',       // 紅方（先行）
  BLACK: 'black',   // 黑方（後行）
  NONE: 'none'      // 無陣營（未翻開或空）
};

// 棋子代號與繁體中文顯示
export const PIECE_INFO = {
  // 紅方棋子
  R_KING:   { id: 'R_KING',   name: '帥', side: SIDE.RED, rank: 7, count: 1, value: 10000 },
  R_ADVISOR:{ id: 'R_ADVISOR',name: '仕', side: SIDE.RED, rank: 6, count: 2, value: 200 },
  R_BISHOP: { id: 'R_BISHOP', name: '相', side: SIDE.RED, rank: 5, count: 2, value: 200 },
  R_ROOK:   { id: 'R_ROOK',   name: '俥', side: SIDE.RED, rank: 4, count: 2, value: 900 },
  R_KNIGHT: { id: 'R_KNIGHT', name: '傌', side: SIDE.RED, rank: 3, count: 2, value: 450 },
  R_CANNON: { id: 'R_CANNON', name: '炮', side: SIDE.RED, rank: 2, count: 2, value: 450 },
  R_PAWN:   { id: 'R_PAWN',   name: '兵', side: SIDE.RED, rank: 1, count: 5, value: 100 },

  // 黑方棋子
  B_KING:   { id: 'B_KING',   name: '將', side: SIDE.BLACK, rank: 7, count: 1, value: 10000 },
  B_ADVISOR:{ id: 'B_ADVISOR',name: '士', side: SIDE.BLACK, rank: 6, count: 2, value: 200 },
  B_BISHOP: { id: 'B_BISHOP', name: '象', side: SIDE.BLACK, rank: 5, count: 2, value: 200 },
  B_ROOK:   { id: 'B_ROOK',   name: '車', side: SIDE.BLACK, rank: 4, count: 2, value: 900 },
  B_KNIGHT: { id: 'B_KNIGHT', name: '馬', side: SIDE.BLACK, rank: 3, count: 2, value: 450 },
  B_CANNON: { id: 'B_CANNON', name: '包', side: SIDE.BLACK, rank: 2, count: 2, value: 450 },
  B_PAWN:   { id: 'B_PAWN',   name: '卒', side: SIDE.BLACK, rank: 1, count: 5, value: 100 }
};

// 遊戲模式
export const GAME_MODE = {
  LARGE: 'large',   // 大盤傳統象棋（9x10）
  SMALL: 'small'    // 小盤暗棋（4x8）
};

// AI 難度等級
export const AI_DIFFICULTY = {
  EASY: 'easy',       // 初學休閒
  MEDIUM: 'medium',   // 進階高手
  HARD: 'hard'        // 大師博弈
};

// 大盤位置價值表（Piece-Square Tables，以紅方視角為基礎，黑方則垂直對稱翻轉）
// 棋盤座標：row 0~9, col 0~8
export const LARGE_POSITION_SCORES = {
  // 兵/卒位置權重：過河前低，過河後逼近九宮格大幅增長
  PAWN: [
    [ 0,  3,  6,  9, 12,  9,  6,  3,  0],
    [18, 36, 56, 80,120, 80, 56, 36, 18],
    [14, 26, 42, 60, 80, 60, 42, 26, 14],
    [10, 20, 30, 34, 40, 34, 30, 20, 10],
    [ 6,  8, 13, 18, 20, 18, 13,  8,  6],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0, -2,  0,  4,  0, -2,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ 0,  0,  0,  0,  0,  0,  0,  0,  0]
  ],
  // 俥/車位置權重：佔據要道與通天線分值極高
  ROOK: [
    [14, 14, 12, 18, 16, 18, 12, 14, 14],
    [16, 20, 18, 24, 26, 24, 18, 20, 16],
    [12, 12, 12, 18, 18, 18, 12, 12, 12],
    [12, 18, 16, 22, 22, 22, 16, 18, 12],
    [12, 14, 12, 18, 18, 18, 12, 14, 12],
    [12, 16, 14, 20, 20, 20, 14, 16, 12],
    [ 6, 10,  8, 14, 14, 14,  8, 10,  6],
    [ 4,  8,  6, 14, 12, 14,  6,  8,  4],
    [ 8,  4,  8, 16,  8, 16,  8,  4,  8],
    [-2, 10,  6, 14, 12, 14,  6, 10, -2]
  ],
  // 傌/馬位置權重：避免邊緣，中央躍進威脅大
  KNIGHT: [
    [ 4,  8, 16, 12,  4, 12, 16,  8,  4],
    [ 4, 10, 28, 16,  8, 16, 28, 10,  4],
    [12, 14, 18, 20, 18, 20, 18, 14, 12],
    [ 8, 24, 18, 24, 20, 24, 18, 24,  8],
    [ 6, 16, 14, 18, 16, 18, 14, 16,  6],
    [ 4, 12, 16, 14, 12, 14, 16, 12,  4],
    [ 2,  6,  8,  6, 10,  6,  8,  6,  2],
    [ 4,  2,  8,  8,  4,  8,  8,  2,  4],
    [ 0,  2,  4,  4, -2,  4,  4,  2,  0],
    [ 0, -4,  0,  0,  0,  0,  0, -4,  0]
  ],
  // 炮/砲位置權重：有架子與控制中線高分
  CANNON: [
    [ 6,  4,  0, -10, -12, -10,  0,  4,  6],
    [ 2,  2,  0,  -4, -14,  -4,  0,  2,  2],
    [ 2,  2,  0, -10,  -8, -10,  0,  2,  2],
    [ 0,  0, -2,   4,  10,   4, -2,  0,  0],
    [ 0,  0,  0,   2,   8,   2,  0,  0,  0],
    [-2,  0,  4,   2,   6,   2,  4,  0, -2],
    [ 0,  0,  0,   2,   4,   2,  0,  0,  0],
    [ 4,  0,  4,   0,   0,   0,  4,  0,  4],
    [ 0,  2,  0,   0,   0,   0,  0,  2,  0],
    [ 0,  0,  0,   2,  -6,   2,  0,  0,  0]
  ]
};
