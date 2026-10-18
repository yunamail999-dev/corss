/**
 * Yunamail的棋盤 - 自然實木聲學與古典金石音效引擎 (js/audio.js)
 * 透過 Web Audio API 物理建模合成天然實木敲擊、雙子碰撞、清脆翻棋與古雅五音編鐘泛音
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.noiseBuffer = null;
  }

  // 初始化或恢復 AudioContext（需使用者首次點擊互動觸發）
  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.initNoiseBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 快取木質瞬態微雜音緩衝區
  initNoiseBuffer() {
    if (!this.ctx || this.noiseBuffer) return;
    const length = Math.floor(this.ctx.sampleRate * 0.04); // 40ms 高頻木質敲擊雜訊
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // 隨機粉紅噪聲衰減
      const decay = Math.exp(-i / (length * 0.25));
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }

  // 設定靜音
  setMuted(muted) {
    this.isMuted = muted;
  }

  // 1. 落子音效：天然硬木象棋落在厚實木盤上的清脆「嗒（Tak）」聲
  playMove() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // (A) 木質硬碰瞬態微點擊（Transient Clack）
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(2200, t);
      noiseFilter.Q.setValueAtTime(2.5, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noise.start(t);
      noise.stop(t + 0.02);
    }

    // (B) 實木本體共振（Wood Body Resonance）：沉穩乾脆，絕不拖沓
    const oscBody = this.ctx.createOscillator();
    const gainBody = this.ctx.createGain();
    oscBody.type = 'triangle';
    oscBody.frequency.setValueAtTime(360, t);
    oscBody.frequency.exponentialRampToValueAtTime(140, t + 0.045);

    gainBody.gain.setValueAtTime(0.65, t);
    gainBody.gain.exponentialRampToValueAtTime(0.001, t + 0.055);

    oscBody.connect(gainBody);
    gainBody.connect(this.ctx.destination);
    oscBody.start(t);
    oscBody.stop(t + 0.06);

    // (C) 底盤厚木低音（Sub Thud）
    const oscSub = this.ctx.createOscillator();
    const gainSub = this.ctx.createGain();
    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(110, t);
    oscSub.frequency.exponentialRampToValueAtTime(60, t + 0.04);

    gainSub.gain.setValueAtTime(0.3, t);
    gainSub.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    oscSub.connect(gainSub);
    gainSub.connect(this.ctx.destination);
    oscSub.start(t);
    oscSub.stop(t + 0.05);
  }

  // 2. 吃子音效：兩顆實木棋子強烈相撞的雙重清脆撞擊聲「喀-嗒（Clack-Thud）」
  playCapture() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 【第一擊：衝撞脆碰 (t)】
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(480, t);
    osc1.frequency.exponentialRampToValueAtTime(180, t + 0.035);

    gain1.gain.setValueAtTime(0.7, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.045);

    // 【第二擊：棋子被擊退與落盤實音 (t + 0.022)】
    const t2 = t + 0.022;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(320, t2);
    osc2.frequency.exponentialRampToValueAtTime(95, t2 + 0.065);

    gain2.gain.setValueAtTime(0.85, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.075);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + 0.08);

    // 撞擊破裂微高頻雜訊
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.setValueAtTime(1600, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.4, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);
      noise.start(t);
      noise.stop(t + 0.035);
    }
  }

  // 3. 翻棋音效：指尖挑起實木暗棋翻轉扣盤的輕巧乾脆聲（Soft Snap & Tap）
  playFlip() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 前段輕撫微挑 (t)
    const oscTick = this.ctx.createOscillator();
    const gainTick = this.ctx.createGain();
    oscTick.type = 'sine';
    oscTick.frequency.setValueAtTime(580, t);
    oscTick.frequency.exponentialRampToValueAtTime(320, t + 0.02);

    gainTick.gain.setValueAtTime(0.3, t);
    gainTick.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    oscTick.connect(gainTick);
    gainTick.connect(this.ctx.destination);
    oscTick.start(t);
    oscTick.stop(t + 0.03);

    // 後段翻面落定清扣 (t + 0.025)
    const tSnap = t + 0.025;
    const oscSnap = this.ctx.createOscillator();
    const gainSnap = this.ctx.createGain();
    oscSnap.type = 'triangle';
    oscSnap.frequency.setValueAtTime(420, tSnap);
    oscSnap.frequency.exponentialRampToValueAtTime(190, tSnap + 0.035);

    gainSnap.gain.setValueAtTime(0.55, tSnap);
    gainSnap.gain.exponentialRampToValueAtTime(0.001, tSnap + 0.045);

    oscSnap.connect(gainSnap);
    gainSnap.connect(this.ctx.destination);
    oscSnap.start(tSnap);
    oscSnap.stop(tSnap + 0.05);
  }

  // 4. 將軍音效：古雅深沉的青銅編鐘微鳴（Deep Bronze Gong Chime）
  playCheck() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // 沉穩青銅泛音組合 (基音與自然泛音)
    const bellNotes = [
      { freq: 220, amp: 0.5, dur: 0.8 },
      { freq: 330, amp: 0.35, dur: 0.7 },
      { freq: 554, amp: 0.2, dur: 0.5 },
      { freq: 880, amp: 0.12, dur: 0.35 }
    ];

    bellNotes.forEach(note => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, t);
      osc.frequency.exponentialRampToValueAtTime(note.freq * 0.98, t + note.dur);

      gain.gain.setValueAtTime(note.amp, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + note.dur + 0.05);
    });
  }

  // 5. 勝利音效：古典宮商角徵羽清越高亢流水琴音
  playWin() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // 悠揚大氣五音音階 (宮 C4, 商 D4, 角 E4, 徵 G4, 羽 A4, 宮 C5)
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 659.25];
    scale.forEach((freq, idx) => {
      const noteTime = t + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.001, noteTime);
      gain.gain.linearRampToValueAtTime(0.28, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.55);
    });
  }

  // 6. UI 按鈕微觸音（極微弱柔和的實木反饋微觸音）
  playClick() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(450, t + 0.015);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.018);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  // 7. 連吃專屬音效：古典五音清越金石泛音（隨連吃次數階梯攀升，清澈通透悅耳）
  playCombo(comboCount = 2) {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 中國古典五聲音階（宮商角徵羽）：清越空靈、餘音悠遠
    // 依序階梯：C5 (523.25), D5 (587.33), E5 (659.25), G5 (783.99), A5 (880.00), C6 (1046.50), D6 (1174.66)
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66];
    const pitchIdx = Math.min(Math.max(comboCount - 1, 0), pentatonic.length - 1);
    const fundamental = pentatonic[pitchIdx];

    // (A) 清澈基音（圓潤琴音）
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(fundamental, t);

    gain1.gain.setValueAtTime(0.001, t);
    gain1.gain.linearRampToValueAtTime(0.4, t + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.38);

    // (B) 晶瑩高八度金石泛音（Chime Sparkle）
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(fundamental * 2, t);

    gain2.gain.setValueAtTime(0.001, t);
    gain2.gain.linearRampToValueAtTime(0.2, t + 0.008);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.3);

    // (C) 敲擊木槌質感頭音
    const oscTap = this.ctx.createOscillator();
    const gainTap = this.ctx.createGain();
    oscTap.type = 'sine';
    oscTap.frequency.setValueAtTime(fundamental * 3, t);
    oscTap.frequency.exponentialRampToValueAtTime(fundamental * 0.8, t + 0.02);

    gainTap.gain.setValueAtTime(0.25, t);
    gainTap.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    oscTap.connect(gainTap);
    gainTap.connect(this.ctx.destination);
    oscTap.start(t);
    oscTap.stop(t + 0.03);
  }
}

export const sound = new SoundEngine();
