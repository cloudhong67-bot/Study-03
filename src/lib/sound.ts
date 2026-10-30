// 정/오답 효과음. 음원 파일 없이 Web Audio API로 짧은 음을 합성한다 (브라우저 전용).

type Note = { frequency: number; at: number };

const CORRECT: Note[] = [
  { frequency: 660, at: 0 },
  { frequency: 880, at: 0.12 },
];
const WRONG: Note[] = [
  { frequency: 220, at: 0 },
  { frequency: 165, at: 0.16 },
];

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  context = Ctor ? new Ctor() : null;
  return context;
}

export function playFeedbackSound(correct: boolean): void {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    // resume()은 브라우저 자동 재생 정책 등으로 거절될 수 있다. 처리하지 않으면 unhandled rejection이 된다.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    for (const note of correct ? CORRECT : WRONG) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + note.at;
      osc.type = correct ? "sine" : "square";
      osc.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(correct ? 0.2 : 0.06, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
  } catch {
    // 오디오를 쓸 수 없는 환경에서는 소리 없이 진행한다.
  }
}

const SOUND_KEY = "trivia:sound";

export function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    // 저장소를 쓸 수 없으면 이번 방문 동안만 유지된다.
  }
}
