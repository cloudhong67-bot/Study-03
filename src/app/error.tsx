"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { primaryButton, secondaryButton } from "@/components/button-styles";
import { StatusMessage } from "@/components/StatusMessage";

// 서버 컴포넌트에서 DB 오류 등이 나면 보여 준다.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  // reset()만 부르면 클라이언트에서 다시 그릴 뿐 실패한 서버 컴포넌트 결과를 다시 가져오지 않는다.
  // router.refresh()로 서버에서 새로 렌더링한 결과를 받아 오면서 오류 경계를 초기화해야 복구된다.
  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <StatusMessage icon="⚠️" title="일시적인 오류가 발생했어요" message="잠시 후 다시 시도해 주세요.">
      <button type="button" onClick={retry} disabled={retrying} className={primaryButton}>
        {retrying ? "다시 불러오는 중…" : "다시 시도"}
      </button>
      <Link href="/" className={secondaryButton}>
        메인으로
      </Link>
    </StatusMessage>
  );
}
