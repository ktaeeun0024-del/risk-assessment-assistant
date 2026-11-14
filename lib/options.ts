// 화면과 서버가 함께 쓰는 선택지와 응답 형식 (서버 전용 코드는 import하지 않는다)
import type { Assessment, ValidationReport } from "./schema";

export const MODES = {
  ai: "AI 초안",
  search: "표준모델 검색 (AI 없이)",
} as const;

export type Mode = keyof typeof MODES;
export const DEFAULT_MODE: Mode = "ai";

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && Object.hasOwn(MODES, value);
}

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 1500;

export const EXAMPLE =
  "직원 12명인 금속 부품 공장입니다. 오전에 지게차로 철판 코일을 창고에서 꺼내 프레스 옆으로 옮기고, " +
  "80톤 기계식 프레스 2대로 브래킷을 찍습니다. 작업자가 손으로 철판을 넣고 발 페달로 작동시키는데, " +
  "광전자식 방호장치는 1대에만 달려 있습니다. 찍은 부품은 바렐 연마기에 넣고, 끝나면 세척조에서 " +
  "솔벤트로 기름을 닦아냅니다. 프레스 소음이 커서 귀마개를 나눠주지만 잘 안 씁니다. " +
  "금형 교체는 한 달에 두세 번, 반장이 혼자 합니다.";

export type SourceRef = {
  구절: string;
  점수: number;
  표준모델_작업: string;
  표준모델_세부작업: string;
};

export type AssessResponse = {
  assessment: Assessment;
  report: ValidationReport;
  mode: Mode;
  model: string;
  attempts: number;
  // 표준모델 검색 초안일 때 항목마다 어느 표준모델에서 왔는지
  sources?: SourceRef[];
  // AI가 실패해서 검색 초안으로 대신했을 때
  fallback?: boolean;
  // 기록 저장 실패 등 안내 문구
  notice?: string;
};
