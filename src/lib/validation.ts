import { z } from "zod";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/lib/limits";

export const LEADERBOARD_LIMITS = ["10", "50"] as const;

export const quizModeSchema = z.enum(["ALL", "CATEGORY"]);

export const createSessionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ALL") }),
  z.object({ mode: z.literal("CATEGORY"), categorySlug: z.string().trim().min(1) }),
]);

export const submitAnswerSchema = z.object({
  questionId: z.number().int().positive(),
  selectedIndex: z.number().int().min(0).max(3),
});

// 순위표에서 닉네임 사칭·빈 닉네임에 쓰이는 문자:
// - Cc(제어 문자), Cf(서식 문자: 방향 전환 U+202E, 폭 없는 공백 U+200B, BOM U+FEFF 등)
// - 화면에 보이지 않는 "빈 글자": 한글 채움 문자(U+115F, U+1160, U+3164, U+FFA0), 점자 빈칸(U+2800)
const FORBIDDEN_NICKNAME_CHARS = /[\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/u;
// 예외: 이모지를 이어 붙이는 ZWJ(👨‍👩‍👧, ❤️‍🔥)만 허용한다. 글자 사이의 ZWJ는 보이지 않는 차이를 만든다.
const EMOJI_ZWJ = /(?<=\p{Extended_Pictographic}️?)‍(?=\p{Extended_Pictographic})/gu;

export function hasForbiddenNicknameChars(name: string): boolean {
  return FORBIDDEN_NICKNAME_CHARS.test(name.replace(EMOJI_ZWJ, ""));
}

export const usernameSchema = z
  .string()
  // NFC 정규화: 같은 글자를 다른 코드 조합(예: 한글 자모 분해형)으로 써서 다른 닉네임처럼 보이게 하는 것을 막고,
  // 길이도 실제 글자 수로 센다 (DB 컬럼 VARCHAR(12)와 같은 기준).
  .transform((name) => name.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .refine(
        (name) => {
          const length = Array.from(name).length;
          return length >= USERNAME_MIN_LENGTH && length <= USERNAME_MAX_LENGTH;
        },
        { message: `닉네임은 ${USERNAME_MIN_LENGTH}~${USERNAME_MAX_LENGTH}자여야 합니다.` },
      )
      .refine((name) => !hasForbiddenNicknameChars(name), {
        message: "닉네임에 보이지 않는 문자나 제어 문자는 쓸 수 없습니다.",
      }),
  );

export const submitScoreSchema = z.object({ username: usernameSchema });

export const sessionIdSchema = z.uuid();

export const leaderboardQuerySchema = z
  .object({
    mode: quizModeSchema.default("ALL"),
    category: z.string().trim().min(1).optional(),
    limit: z.enum(LEADERBOARD_LIMITS).default("10").transform(Number),
  })
  .refine((q) => q.mode !== "CATEGORY" || q.category !== undefined, {
    message: "mode=CATEGORY에는 category가 필요합니다.",
    path: ["category"],
  })
  // ALL 모드에서는 category를 무시한다.
  .transform((q) => (q.mode === "ALL" ? { ...q, category: undefined } : q));

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
export type SubmitScoreInput = z.infer<typeof submitScoreSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
