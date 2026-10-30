import { describe, expect, it } from "vitest";
import {
  addGame,
  emptyStats,
  HISTORY_STORAGE_KEY,
  LocalDataManager,
  MAX_GAME_RECORDS,
  parseGameRecord,
  parseHistory,
  parseStats,
  statsFromGames,
  type GameRecord,
  type GameResultInput,
  type KeyValueStorage,
} from "@/lib/data-manager";

/** 메모리 저장소. fail로 읽기·쓰기·지우기 실패를 흉내 낸다. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const fail = { get: false, set: false, remove: false };
  const storage: KeyValueStorage = {
    getItem: (key) => {
      if (fail.get) throw new Error("SecurityError");
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (fail.set) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => {
      if (fail.remove) throw new Error("SecurityError");
      data.delete(key);
    },
  };
  return { storage, data, fail };
}

/** 1분씩 흐르는 시계 */
function clock(start = "2026-10-30T03:00:00.000Z") {
  let time = Date.parse(start);
  return () => {
    const now = new Date(time);
    time += 60_000;
    return now;
  };
}

const scienceResult: GameResultInput = {
  mode: "CATEGORY",
  category: "과학",
  categorySlug: "science",
  completed: true,
  score: 152,
  maxScore: 217,
  correctCount: 7,
  totalCount: 10,
  maxStreak: 4,
  timedOutCount: 0,
  byCategory: [{ category: "과학", correct: 7, total: 10 }],
};

const allResult: GameResultInput = {
  mode: "ALL",
  category: null,
  categorySlug: null,
  completed: true,
  score: 600,
  maxScore: 821,
  correctCount: 30,
  totalCount: 40,
  maxStreak: 12,
  timedOutCount: 0,
  byCategory: [
    { category: "한국사", correct: 8, total: 10 },
    { category: "과학", correct: 9, total: 10 },
    { category: "지리", correct: 6, total: 10 },
    { category: "일반상식", correct: 7, total: 10 },
  ],
};

const speedResult: GameResultInput = {
  mode: "SPEED",
  category: null,
  categorySlug: null,
  completed: true,
  score: 200,
  maxScore: 400,
  correctCount: 12,
  totalCount: 20,
  maxStreak: 5,
  timedOutCount: 3,
  byCategory: [
    { category: "과학", correct: 6, total: 8 },
    { category: "지리", correct: 6, total: 12 },
  ],
};

function record(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    sessionId: "s-1",
    mode: "CATEGORY",
    category: "과학",
    categorySlug: "science",
    score: 152,
    maxScore: 217,
    correctCount: 7,
    totalCount: 10,
    maxStreak: 4,
    timedOutCount: 0,
    byCategory: [{ category: "과학", correct: 7, total: 10 }],
    playedAt: "2026-10-30T03:00:00.000Z",
    ...overrides,
  };
}

const sessionId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("LocalDataManager.recordGame", () => {
  it("끝난 게임을 저장소에 자동 저장하고, 최근 게임이 앞에 온다", () => {
    const { storage, data } = memoryStorage();
    const manager = new LocalDataManager(storage, clock());

    expect(manager.recordGame("a", scienceResult)).toBe(true);
    expect(manager.recordGame("b", allResult)).toBe(true);

    expect(manager.getRecentGames().map((g) => g.sessionId)).toEqual(["b", "a"]);
    expect(manager.getRecentGames()[1]).toEqual({
      sessionId: "a",
      mode: "CATEGORY",
      category: "과학",
      categorySlug: "science",
      score: 152,
      maxScore: 217,
      correctCount: 7,
      totalCount: 10,
      maxStreak: 4,
      timedOutCount: 0,
      byCategory: [{ category: "과학", correct: 7, total: 10 }],
      playedAt: "2026-10-30T03:00:00.000Z",
    });

    // 새 관리자(다음 방문)가 같은 기록을 읽는다.
    const saved = JSON.parse(data.get(HISTORY_STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(new LocalDataManager(storage).load()).toEqual(manager.load());
  });

  it("같은 세션은 한 번만 센다 (새로고침·StrictMode의 effect 재실행)", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    expect(manager.recordGame("a", scienceResult)).toBe(true);
    expect(manager.recordGame("a", scienceResult)).toBe(false);
    expect(manager.getRecentGames()).toHaveLength(1);
    expect(manager.getStats().gamesPlayed).toBe(1);
  });

  it("끝나지 않은 게임은 기록하지 않는다", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    expect(manager.recordGame("a", { ...scienceResult, completed: false })).toBe(false);
    expect(manager.getStats()).toEqual(emptyStats());
  });

  it.each([
    ["빈 세션 id", "", scienceResult],
    ["점수 NaN", "a", { ...scienceResult, score: NaN }],
    ["점수 Infinity", "a", { ...scienceResult, score: Infinity }],
    ["음수 점수", "a", { ...scienceResult, score: -1 }],
    ["소수 점수", "a", { ...scienceResult, score: 1.5 }],
    ["MAX_SAFE_INTEGER 초과", "a", { ...scienceResult, score: 2 ** 53, maxScore: 2 ** 53 }],
    ["만점보다 큰 점수", "a", { ...scienceResult, score: 218 }],
    ["문제 수 0", "a", { ...scienceResult, correctCount: 0, maxStreak: 0, totalCount: 0 }],
    ["정답이 문제 수보다 많음", "a", { ...scienceResult, correctCount: 11 }],
    ["연속 정답이 정답 수보다 많음", "a", { ...scienceResult, maxStreak: 8 }],
    ["시간 초과가 오답 수보다 많음", "a", { ...scienceResult, timedOutCount: 4 }],
    ["알 수 없는 모드", "a", { ...scienceResult, mode: "DAILY" as never }],
  ])("값이 이상하면(%s) 기록하지 않는다", (_name, id, result) => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    expect(manager.recordGame(id, result)).toBe(false);
    expect(manager.getRecentGames()).toEqual([]);
  });

  it(`최근 ${MAX_GAME_RECORDS}개만 남기고, 통계는 지워진 기록까지 누적한다`, () => {
    const { storage } = memoryStorage();
    const manager = new LocalDataManager(storage, clock());
    for (let i = 1; i <= MAX_GAME_RECORDS + 1; i++) manager.recordGame(sessionId(i), scienceResult);

    const games = manager.getRecentGames();
    expect(games).toHaveLength(MAX_GAME_RECORDS);
    expect(games[0].sessionId).toBe(sessionId(MAX_GAME_RECORDS + 1));
    expect(games.at(-1)!.sessionId).toBe(sessionId(2)); // 가장 오래된 1번이 빠졌다
    expect(manager.getStats().gamesPlayed).toBe(MAX_GAME_RECORDS + 1);
    expect(manager.getStats().totalQuestions).toBe((MAX_GAME_RECORDS + 1) * 10);
    expect(new LocalDataManager(storage).getStats().gamesPlayed).toBe(MAX_GAME_RECORDS + 1);
  });

  it("목록에서 빠진 오래된 세션은 다시 기록될 수 있다 (알려진 한계)", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    for (let i = 1; i <= MAX_GAME_RECORDS + 1; i++) manager.recordGame(sessionId(i), scienceResult);
    expect(manager.recordGame(sessionId(1), scienceResult)).toBe(true);
  });
});

describe("통계", () => {
  it("모드별 플레이 수·최고·합계와 전체 정답·시간 초과·최고 연속 정답을 누적한다", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    manager.recordGame("a", scienceResult);
    manager.recordGame("b", allResult);
    manager.recordGame("c", speedResult);
    manager.recordGame("d", { ...scienceResult, score: 100 });

    const stats = manager.getStats();
    expect(stats).toMatchObject({
      gamesPlayed: 4,
      totalCorrect: 7 + 30 + 12 + 7,
      totalQuestions: 10 + 40 + 20 + 10,
      totalTimedOut: 3,
      bestStreak: 12,
      firstPlayedAt: "2026-10-30T03:00:00.000Z",
      lastPlayedAt: "2026-10-30T03:03:00.000Z",
    });
    expect(stats.byMode).toEqual({
      ALL: { games: 1, totalScore: 600, bestScore: 600 },
      CATEGORY: { games: 2, totalScore: 252, bestScore: 152 },
      SPEED: { games: 1, totalScore: 200, bestScore: 200 },
    });
  });

  it("카테고리별: 정답·문제 수는 모든 모드에서, 플레이 수·최고 점수는 카테고리 모드에서만 센다", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    manager.recordGame("a", scienceResult);
    manager.recordGame("b", allResult);
    manager.recordGame("c", speedResult);

    const byName = new Map(manager.getStats().byCategory.map((c) => [c.category, c]));
    expect(byName.get("과학")).toEqual({ category: "과학", correct: 7 + 9 + 6, total: 28, games: 1, bestScore: 152 });
    expect(byName.get("지리")).toEqual({ category: "지리", correct: 12, total: 22, games: 0, bestScore: null });
    expect(byName.get("한국사")).toEqual({ category: "한국사", correct: 8, total: 10, games: 0, bestScore: null });
    // 처음 나온 순서를 유지한다.
    expect([...byName.keys()]).toEqual(["과학", "한국사", "지리", "일반상식"]);
  });

  it("새 카테고리도 하드코딩 없이 그대로 집계하고, Object.prototype 이름도 안전하다", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    const weird = ["__proto__", "constructor", "대중문화"];
    manager.recordGame("a", {
      ...allResult,
      byCategory: weird.map((category) => ({ category, correct: 1, total: 2 })),
      correctCount: 3,
      totalCount: 6,
      maxStreak: 3,
    });
    expect(manager.getStats().byCategory.map((c) => [c.category, c.correct, c.total])).toEqual(
      weird.map((name) => [name, 1, 2]),
    );
    expect(({} as Record<string, unknown>).correct).toBeUndefined();
  });

  it("addGame은 입력 통계를 바꾸지 않는다", () => {
    const before = emptyStats();
    const snapshot = structuredClone(before);
    addGame(before, record());
    expect(before).toEqual(snapshot);
  });

  it("누적값은 안전한 정수 범위에서 멈춘다", () => {
    const stats = { ...emptyStats(), gamesPlayed: Number.MAX_SAFE_INTEGER, totalQuestions: Number.MAX_SAFE_INTEGER - 3 };
    const next = addGame(stats, record());
    expect(next.gamesPlayed).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.totalQuestions).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("statsFromGames는 기록(최근 순)을 오래된 순으로 더한다", () => {
    const games = [
      record({ sessionId: "new", playedAt: "2026-10-30T05:00:00.000Z" }),
      record({ sessionId: "old", playedAt: "2026-10-30T01:00:00.000Z", score: 10 }),
    ];
    expect(statsFromGames(games)).toMatchObject({
      gamesPlayed: 2,
      firstPlayedAt: "2026-10-30T01:00:00.000Z",
      lastPlayedAt: "2026-10-30T05:00:00.000Z",
    });
    expect(statsFromGames([])).toEqual(emptyStats());
  });
});

describe("저장소 읽기 (손상·변조된 값)", () => {
  const stored = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

  it.each([
    ["없음", null],
    ["JSON 아님", "{oops"],
    ["null", "null"],
    ["배열", "[]"],
    ["숫자", "42"],
    ["다른 버전", stored({ version: 2, games: [], stats: emptyStats() })],
    ["games가 배열 아님", stored({ version: 1, games: {}, stats: emptyStats() })],
  ])("%s → 빈 기록", (_name, raw) => {
    expect(parseHistory(raw)).toEqual({ games: [], stats: emptyStats() });
  });

  it("잘못된 게임 기록과 중복 세션은 건너뛰고 나머지는 살린다", () => {
    const raw = stored({
      version: 1,
      games: [record({ sessionId: "a" }), { nope: true }, null, record({ sessionId: "a" }), record({ sessionId: "b" })],
      stats: statsFromGames([record({ sessionId: "a" }), record({ sessionId: "b" })]),
    });
    expect(parseHistory(raw).games.map((g) => g.sessionId)).toEqual(["a", "b"]);
  });

  it(`기록이 ${MAX_GAME_RECORDS}개보다 많으면 앞의 ${MAX_GAME_RECORDS}개만 읽는다`, () => {
    const games = Array.from({ length: MAX_GAME_RECORDS + 5 }, (_, i) => record({ sessionId: sessionId(i) }));
    expect(parseHistory(stored({ version: 1, games, stats: statsFromGames(games) })).games).toHaveLength(
      MAX_GAME_RECORDS,
    );
  });

  it("통계가 깨졌으면 남은 기록으로 다시 계산한다", () => {
    const games = [record({ sessionId: "a" }), record({ sessionId: "b", mode: "SPEED", category: null })];
    for (const stats of [undefined, null, "x", { ...emptyStats(), gamesPlayed: -1 }, { ...emptyStats(), byMode: {} }]) {
      expect(parseHistory(stored({ version: 1, games, stats })).stats).toEqual(statsFromGames(games));
    }
  });

  it("추가 필드는 버린다", () => {
    const parsed = parseGameRecord({ ...record(), extra: "<script>" });
    expect(parsed).toEqual(record());
  });

  it.each([
    ["객체 아님", "x"],
    ["배열", []],
    ["playedAt이 ISO 아님", record({ playedAt: "2026-10-30" })],
    ["playedAt 잘못된 날짜", record({ playedAt: "2026-13-40T00:00:00.000Z" })],
    ["너무 긴 세션 id", record({ sessionId: "x".repeat(101) })],
    ["category가 숫자", { ...record(), category: 1 }],
    ["byCategory가 배열 아님", { ...record(), byCategory: {} }],
    ["byCategory 항목의 정답 > 문제 수", record({ byCategory: [{ category: "과학", correct: 3, total: 2 }] })],
    ["byCategory 같은 카테고리 중복", record({ byCategory: [{ category: "과학", correct: 1, total: 2 }, { category: "과학", correct: 1, total: 2 }] })],
    ["byCategory 항목이 너무 많음", record({ byCategory: Array.from({ length: 101 }, (_, i) => ({ category: `c${i}`, correct: 0, total: 1 })) })],
  ])("parseGameRecord: %s → null", (_name, value) => {
    expect(parseGameRecord(value)).toBeNull();
  });

  it("parseStats: 정답이 문제 수보다 많거나 카테고리가 중복되면 null", () => {
    expect(parseStats({ ...emptyStats(), totalCorrect: 2, totalQuestions: 1 })).toBeNull();
    const dup = { category: "과학", correct: 0, total: 0, games: 0, bestScore: null };
    expect(parseStats({ ...emptyStats(), byCategory: [dup, dup] })).toBeNull();
    expect(parseStats({ ...emptyStats(), byMode: Object.create({ ALL: {}, CATEGORY: {}, SPEED: {} }) })).toBeNull();
    expect(parseStats(emptyStats())).toEqual(emptyStats());
  });
});

describe("저장소를 쓸 수 없을 때", () => {
  it("저장소가 없으면(null) 이번 방문 동안 메모리에 기록한다", () => {
    const manager = new LocalDataManager(null, clock());
    expect(manager.recordGame("a", scienceResult)).toBe(true);
    expect(manager.getStats().gamesPlayed).toBe(1);
    manager.clear();
    expect(manager.getStats().gamesPlayed).toBe(0);
  });

  it("읽기가 실패하면 빈 기록, 쓰기·지우기가 실패해도 메모리 값은 바뀐다", () => {
    const { storage, fail } = memoryStorage();
    fail.get = true;
    fail.set = true;
    fail.remove = true;
    const manager = new LocalDataManager(storage, clock());
    expect(manager.load()).toEqual({ games: [], stats: emptyStats() });
    expect(manager.recordGame("a", scienceResult)).toBe(true);
    expect(manager.getRecentGames()).toHaveLength(1);
    manager.clear();
    expect(manager.getRecentGames()).toHaveLength(0);
  });
});

describe("구독·스냅샷", () => {
  it("바뀌지 않으면 같은 스냅샷 객체를, 바뀌면 새 객체를 돌려준다", () => {
    const manager = new LocalDataManager(memoryStorage().storage, clock());
    const first = manager.load();
    expect(manager.load()).toBe(first);
    manager.recordGame("a", scienceResult);
    expect(manager.load()).not.toBe(first);
    expect(first.games).toEqual([]); // 이전 스냅샷은 그대로다
  });

  it("기록·지우기·다시 읽기 때 구독자에게 알리고, 구독을 끊으면 알리지 않는다", () => {
    const { storage, data } = memoryStorage();
    const manager = new LocalDataManager(storage, clock());
    let calls = 0;
    const unsubscribe = manager.subscribe(() => calls++);

    manager.recordGame("a", scienceResult);
    manager.recordGame("a", scienceResult); // 중복은 알리지 않는다
    expect(calls).toBe(1);

    // 다른 탭이 지운 상황
    data.delete(HISTORY_STORAGE_KEY);
    manager.reload();
    expect(calls).toBe(2);
    expect(manager.getRecentGames()).toEqual([]);

    manager.clear();
    expect(calls).toBe(3);
    expect(data.has(HISTORY_STORAGE_KEY)).toBe(false);

    unsubscribe();
    manager.recordGame("b", scienceResult);
    expect(calls).toBe(3);
  });
});
