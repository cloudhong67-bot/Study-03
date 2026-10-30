// 이 브라우저에만 남기는 내 게임 기록과 통계 (localStorage).
// 순위표와는 별개다. 순위표는 서버가 채점·저장한 점수만 쓰고, 이 기록은 화면 표시에만 쓴다.
// 클라이언트 번들에 들어가므로 zod·Prisma를 가져오지 않는다 (QuizResult·QuizMode는 타입만 쓴다).
import type { QuizResult } from "@/lib/quiz/sessions";
import type { QuizMode } from "@/lib/routes";

export const HISTORY_STORAGE_KEY = "trivia:history";
/** 최근 게임 기록은 이 개수만 남긴다. 통계는 지워진 기록까지 누적한다. */
export const MAX_GAME_RECORDS = 100;

const STORE_VERSION = 1;
const QUIZ_MODES: readonly QuizMode[] = ["ALL", "CATEGORY", "SPEED"];
const MAX_TEXT_LENGTH = 100;
const MAX_CATEGORIES = 100;

export interface CategoryTally {
  category: string;
  correct: number;
  total: number;
}

export interface GameRecord {
  sessionId: string;
  mode: QuizMode;
  /** 카테고리 모드일 때 그 카테고리 */
  category: string | null;
  categorySlug: string | null;
  score: number;
  maxScore: number;
  correctCount: number;
  totalCount: number;
  maxStreak: number;
  timedOutCount: number;
  byCategory: CategoryTally[];
  /** ISO 8601 */
  playedAt: string;
}

export interface ModeStats {
  games: number;
  totalScore: number;
  bestScore: number;
}

/** 카테고리별 누적 통계. correct·total은 모든 모드에서 그 카테고리 문제를 푼 결과, games·bestScore는 카테고리 모드만 센다. */
export interface CategoryStats extends CategoryTally {
  games: number;
  bestScore: number | null;
}

export interface LocalStats {
  gamesPlayed: number;
  totalCorrect: number;
  totalQuestions: number;
  totalTimedOut: number;
  bestStreak: number;
  byMode: Record<QuizMode, ModeStats>;
  byCategory: CategoryStats[];
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
}

export interface LocalHistory {
  /** 최근 게임이 앞에 온다. 최대 MAX_GAME_RECORDS개 */
  games: GameRecord[];
  stats: LocalStats;
}

/** 결과 화면이 넘기는 값 (서버의 QuizResult 중 기록에 필요한 부분) */
export type GameResultInput = Pick<
  QuizResult,
  | "mode"
  | "category"
  | "categorySlug"
  | "completed"
  | "score"
  | "maxScore"
  | "correctCount"
  | "totalCount"
  | "maxStreak"
  | "timedOutCount"
  | "byCategory"
>;

/** localStorage와 같은 모양. 테스트에서는 가짜 저장소를 넣는다. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class LocalDataManager {
  private snapshot: LocalHistory | undefined;
  private readonly listeners = new Set<() => void>();

  /** storage가 null이면(사생활 보호 모드 등) 이번 방문 동안만 메모리에 기록한다. */
  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 저장된 기록. 바뀌지 않았으면 같은 객체를 돌려준다 (useSyncExternalStore 스냅샷). */
  load(): LocalHistory {
    this.snapshot ??= parseHistory(this.read());
    return this.snapshot;
  }

  getRecentGames(): readonly GameRecord[] {
    return this.load().games;
  }

  getStats(): LocalStats {
    return this.load().stats;
  }

  /**
   * 끝난 게임 하나를 기록하고 통계를 갱신한다. 같은 세션은 한 번만 센다(새로고침·StrictMode 재실행).
   * 기록했으면 true, 끝나지 않았거나 이미 있거나 값이 이상하면 false.
   */
  recordGame(sessionId: string, result: GameResultInput): boolean {
    if (!result.completed) return false;
    const record = parseGameRecord({
      sessionId,
      mode: result.mode,
      category: result.category,
      categorySlug: result.categorySlug,
      score: result.score,
      maxScore: result.maxScore,
      correctCount: result.correctCount,
      totalCount: result.totalCount,
      maxStreak: result.maxStreak,
      timedOutCount: result.timedOutCount,
      byCategory: result.byCategory,
      playedAt: this.now().toISOString(),
    });
    if (!record) return false;

    const current = this.load();
    if (current.games.some((g) => g.sessionId === record.sessionId)) return false;

    this.commit({
      games: [record, ...current.games].slice(0, MAX_GAME_RECORDS),
      stats: addGame(current.stats, record),
    });
    return true;
  }

  /** 기록과 통계를 모두 지운다. */
  clear(): void {
    try {
      this.storage?.removeItem(HISTORY_STORAGE_KEY);
    } catch {
      // 지우지 못해도 화면에서는 비운다.
    }
    this.snapshot = emptyHistory();
    this.notify();
  }

  /** 다른 탭이 저장소를 바꿨을 때(storage 이벤트) 다시 읽는다. */
  reload(): void {
    this.snapshot = undefined;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(HISTORY_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private commit(next: LocalHistory): void {
    this.snapshot = next;
    try {
      this.storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: STORE_VERSION, ...next }));
    } catch {
      // 용량 초과·접근 거부: 이번 방문 동안은 메모리 값으로 유지한다.
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

// ── 통계 계산 (순수 함수) ──

function emptyModeStats(): ModeStats {
  return { games: 0, totalScore: 0, bestScore: 0 };
}

export function emptyStats(): LocalStats {
  return {
    gamesPlayed: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    totalTimedOut: 0,
    bestStreak: 0,
    byMode: { ALL: emptyModeStats(), CATEGORY: emptyModeStats(), SPEED: emptyModeStats() },
    byCategory: [],
    firstPlayedAt: null,
    lastPlayedAt: null,
  };
}

function emptyHistory(): LocalHistory {
  return { games: [], stats: emptyStats() };
}

/** 오래 쌓여도 안전한 정수 범위를 넘지 않게 더한다. */
function addCount(a: number, b: number): number {
  return Math.min(a + b, Number.MAX_SAFE_INTEGER);
}

/** 통계에 게임 하나를 더한 새 통계 (입력은 바꾸지 않는다) */
export function addGame(stats: LocalStats, game: GameRecord): LocalStats {
  const mode = stats.byMode[game.mode];
  const byCategory = new Map(stats.byCategory.map((c) => [c.category, { ...c }]));

  for (const tally of game.byCategory) {
    const entry = byCategory.get(tally.category) ?? { category: tally.category, correct: 0, total: 0, games: 0, bestScore: null };
    entry.correct = addCount(entry.correct, tally.correct);
    entry.total = addCount(entry.total, tally.total);
    byCategory.set(tally.category, entry);
  }
  if (game.mode === "CATEGORY" && game.category !== null) {
    const entry = byCategory.get(game.category) ?? { category: game.category, correct: 0, total: 0, games: 0, bestScore: null };
    entry.games = addCount(entry.games, 1);
    entry.bestScore = Math.max(entry.bestScore ?? 0, game.score);
    byCategory.set(game.category, entry);
  }

  const earlier = (a: string | null, b: string) => (a === null || b < a ? b : a);
  const later = (a: string | null, b: string) => (a === null || b > a ? b : a);

  return {
    gamesPlayed: addCount(stats.gamesPlayed, 1),
    totalCorrect: addCount(stats.totalCorrect, game.correctCount),
    totalQuestions: addCount(stats.totalQuestions, game.totalCount),
    totalTimedOut: addCount(stats.totalTimedOut, game.timedOutCount),
    bestStreak: Math.max(stats.bestStreak, game.maxStreak),
    byMode: {
      ...stats.byMode,
      [game.mode]: {
        games: addCount(mode.games, 1),
        totalScore: addCount(mode.totalScore, game.score),
        bestScore: Math.max(mode.bestScore, game.score),
      },
    },
    byCategory: [...byCategory.values()],
    firstPlayedAt: earlier(stats.firstPlayedAt, game.playedAt),
    lastPlayedAt: later(stats.lastPlayedAt, game.playedAt),
  };
}

/** 저장된 통계가 깨졌을 때 남은 기록으로 다시 만든다 (오래된 순으로 더한다). */
export function statsFromGames(games: readonly GameRecord[]): LocalStats {
  return [...games].reverse().reduce(addGame, emptyStats());
}

// ── 저장소 값 읽기: 다른 코드·사용자가 손댄 값일 수 있으므로 하나하나 확인한다 ──

type UnknownRecord = Record<string, unknown>;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isMode(value: unknown): value is QuizMode {
  return QUIZ_MODES.some((m) => m === value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function parseTally(value: unknown): CategoryTally | null {
  if (!isObject(value)) return null;
  const { category, correct, total } = value;
  if (!isText(category) || !isCount(correct) || !isCount(total) || correct > total) return null;
  return { category, correct, total };
}

export function parseGameRecord(value: unknown): GameRecord | null {
  if (!isObject(value)) return null;
  const v = value;
  if (
    !isText(v.sessionId) ||
    !isMode(v.mode) ||
    !isTextOrNull(v.category) ||
    !isTextOrNull(v.categorySlug) ||
    !isCount(v.score) ||
    !isCount(v.maxScore) ||
    v.score > v.maxScore ||
    !isCount(v.totalCount) ||
    v.totalCount === 0 ||
    !isCount(v.correctCount) ||
    v.correctCount > v.totalCount ||
    !isCount(v.maxStreak) ||
    v.maxStreak > v.correctCount ||
    !isCount(v.timedOutCount) ||
    v.timedOutCount > v.totalCount - v.correctCount ||
    !Array.isArray(v.byCategory) ||
    v.byCategory.length > MAX_CATEGORIES ||
    !isIsoDate(v.playedAt)
  ) {
    return null;
  }
  const byCategory = v.byCategory.map(parseTally);
  if (byCategory.some((t) => t === null)) return null;
  const tallies = byCategory as CategoryTally[];
  if (new Set(tallies.map((t) => t.category)).size !== tallies.length) return null;

  return {
    sessionId: v.sessionId,
    mode: v.mode,
    category: v.category,
    categorySlug: v.categorySlug,
    score: v.score,
    maxScore: v.maxScore,
    correctCount: v.correctCount,
    totalCount: v.totalCount,
    maxStreak: v.maxStreak,
    timedOutCount: v.timedOutCount,
    byCategory: tallies,
    playedAt: v.playedAt,
  };
}

function parseModeStats(value: unknown): ModeStats | null {
  if (!isObject(value)) return null;
  const { games, totalScore, bestScore } = value;
  if (!isCount(games) || !isCount(totalScore) || !isCount(bestScore)) return null;
  return { games, totalScore, bestScore };
}

function parseCategoryStats(value: unknown): CategoryStats | null {
  const tally = parseTally(value);
  if (!tally || !isObject(value)) return null;
  const { games, bestScore } = value;
  if (!isCount(games) || !(bestScore === null || isCount(bestScore))) return null;
  return { ...tally, games, bestScore };
}

export function parseStats(value: unknown): LocalStats | null {
  if (!isObject(value) || !isObject(value.byMode) || !Array.isArray(value.byCategory)) return null;
  const v = value;
  const byMode = value.byMode;
  const modes = QUIZ_MODES.map((m) => (Object.hasOwn(byMode, m) ? parseModeStats(byMode[m]) : null));
  const byCategory = value.byCategory.length <= MAX_CATEGORIES ? value.byCategory.map(parseCategoryStats) : [null];
  if (
    !isCount(v.gamesPlayed) ||
    !isCount(v.totalCorrect) ||
    !isCount(v.totalQuestions) ||
    v.totalCorrect > v.totalQuestions ||
    !isCount(v.totalTimedOut) ||
    !isCount(v.bestStreak) ||
    !(v.firstPlayedAt === null || isIsoDate(v.firstPlayedAt)) ||
    !(v.lastPlayedAt === null || isIsoDate(v.lastPlayedAt)) ||
    modes.some((m) => m === null) ||
    byCategory.some((c) => c === null)
  ) {
    return null;
  }
  const [ALL, CATEGORY, SPEED] = modes as ModeStats[];
  const categories = byCategory as CategoryStats[];
  if (new Set(categories.map((c) => c.category)).size !== categories.length) return null;

  return {
    gamesPlayed: v.gamesPlayed,
    totalCorrect: v.totalCorrect,
    totalQuestions: v.totalQuestions,
    totalTimedOut: v.totalTimedOut,
    bestStreak: v.bestStreak,
    byMode: { ALL, CATEGORY, SPEED },
    byCategory: categories,
    firstPlayedAt: v.firstPlayedAt,
    lastPlayedAt: v.lastPlayedAt,
  };
}

/**
 * 저장소의 문자열을 기록으로 읽는다. 읽을 수 없으면 빈 기록.
 * 잘못된 게임 기록은 건너뛰고, 통계가 깨졌으면 남은 기록으로 다시 계산한다.
 */
export function parseHistory(raw: string | null): LocalHistory {
  if (raw === null) return emptyHistory();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyHistory();
  }
  if (!isObject(data) || data.version !== STORE_VERSION || !Array.isArray(data.games)) return emptyHistory();

  const seen = new Set<string>();
  const games: GameRecord[] = [];
  for (const item of data.games) {
    const game = parseGameRecord(item);
    if (!game || seen.has(game.sessionId)) continue;
    seen.add(game.sessionId);
    games.push(game);
    if (games.length === MAX_GAME_RECORDS) break;
  }

  return { games, stats: parseStats(data.stats) ?? statsFromGames(games) };
}
