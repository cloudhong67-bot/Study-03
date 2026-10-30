// sound.ts는 window·localStorage·AudioContext에 의존하므로, 전역을 테스트마다 바꿔 끼우고
// 모듈을 새로 불러온다 (AudioContext를 모듈 안에 캐시하기 때문).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadSound() {
  vi.resetModules();
  return import("@/lib/sound");
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    data,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
};

class FakeAudioContext {
  static instances = 0;
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  constructor() {
    FakeAudioContext.instances++;
  }
  createOscillator() {
    const gainTarget = { connect: () => ({}) };
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: () => gainTarget,
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: () => ({}),
    };
  }
}

beforeEach(() => {
  FakeAudioContext.instances = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("효과음 설정 저장 (localStorage)", () => {
  it("저장된 값이 없거나 'on'이면 켜짐, 'off'면 꺼짐", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { loadSoundEnabled, saveSoundEnabled } = await loadSound();

    expect(loadSoundEnabled()).toBe(true);
    saveSoundEnabled(false);
    expect(storage.data.get("trivia:sound")).toBe("off");
    expect(loadSoundEnabled()).toBe(false);
    saveSoundEnabled(true);
    expect(loadSoundEnabled()).toBe(true);
  });

  it("알 수 없는 저장값은 켜짐으로 본다", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "trivia:sound": "garbage" }));
    const { loadSoundEnabled } = await loadSound();
    expect(loadSoundEnabled()).toBe(true);
  });

  it("저장소를 쓸 수 없는 환경(사생활 보호 모드·용량 초과)에서도 예외를 던지지 않는다", async () => {
    vi.stubGlobal("localStorage", throwingStorage);
    const { loadSoundEnabled, saveSoundEnabled } = await loadSound();
    expect(loadSoundEnabled()).toBe(true);
    expect(() => saveSoundEnabled(false)).not.toThrow();
  });
});

describe("playFeedbackSound", () => {
  it("AudioContext가 없는 브라우저에서는 조용히 넘어간다", async () => {
    vi.stubGlobal("window", {});
    const { playFeedbackSound } = await loadSound();
    expect(() => playFeedbackSound(true)).not.toThrow();
  });

  it("오래된 Safari의 webkitAudioContext로 대체한다", async () => {
    vi.stubGlobal("window", { webkitAudioContext: FakeAudioContext });
    const { playFeedbackSound } = await loadSound();
    playFeedbackSound(false);
    expect(FakeAudioContext.instances).toBe(1);
  });

  it("AudioContext는 한 번만 만들어 재사용한다", async () => {
    vi.stubGlobal("window", { AudioContext: FakeAudioContext });
    const { playFeedbackSound } = await loadSound();
    playFeedbackSound(true);
    playFeedbackSound(false);
    playFeedbackSound(true);
    expect(FakeAudioContext.instances).toBe(1);
  });

  it("자동 재생 정책으로 resume()이 거절돼도 처리되지 않은 거절(unhandled rejection)이 생기지 않는다", async () => {
    // 주의: vi.fn은 반환된 promise에 자체 핸들러를 붙여 거절을 "처리됨"으로 만든다.
    // 그러면 이 테스트가 잡아야 할 결함이 가려지므로, 일반 함수로 거절을 돌려준다.
    let resumeCalls = 0;
    class Suspended extends FakeAudioContext {
      state = "suspended" as const;
      // @ts-expect-error vi.fn 대신 일반 함수로 덮어쓴다
      resume = () => {
        resumeCalls++;
        return Promise.reject(new DOMException("not allowed", "NotAllowedError"));
      };
    }
    vi.stubGlobal("window", { AudioContext: Suspended });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { playFeedbackSound } = await loadSound();
      expect(() => playFeedbackSound(true)).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(resumeCalls).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("AudioContext 생성 자체가 실패해도(기기 제한) 예외를 던지지 않는다", async () => {
    vi.stubGlobal("window", {
      AudioContext: class {
        constructor() {
          throw new Error("too many AudioContexts");
        }
      },
    });
    const { playFeedbackSound } = await loadSound();
    expect(() => playFeedbackSound(true)).not.toThrow();
  });
});
