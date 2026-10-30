import Link from "next/link";
import { primaryButton } from "@/components/button-styles";
import { StatusMessage } from "@/components/StatusMessage";

export default function NotFound() {
  return (
    <StatusMessage
      icon="🔍"
      title="페이지를 찾을 수 없어요"
      message="주소가 잘못되었거나 이미 사라진 퀴즈 기록입니다."
    >
      <Link href="/" className={primaryButton}>
        메인으로
      </Link>
    </StatusMessage>
  );
}
