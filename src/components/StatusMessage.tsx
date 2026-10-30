import type { ReactNode } from "react";

interface StatusMessageProps {
  icon: string;
  title?: string;
  message: string;
  /** 오류처럼 즉시 읽어 줘야 하는 메시지면 role="alert" */
  alert?: boolean;
  /** 아래에 놓을 버튼·링크 (여러 개면 넓은 화면에서 한 줄로) */
  children?: ReactNode;
}

/** 오류·404·빈 상태처럼 "아이콘 + 제목 + 안내 + 버튼"으로 된 화면. */
export function StatusMessage({ icon, title, message, alert = false, children }: StatusMessageProps) {
  return (
    <div className="space-y-4 pt-10 text-center">
      <p aria-hidden className="text-5xl">
        {icon}
      </p>
      {title && <h1 className="text-xl font-bold">{title}</h1>}
      <p role={alert ? "alert" : undefined} className={`break-keep ${title ? "text-muted" : "font-semibold"}`}>
        {message}
      </p>
      {children && <div className="grid gap-3 sm:auto-cols-fr sm:grid-flow-col">{children}</div>}
    </div>
  );
}
