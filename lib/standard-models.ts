// 한국가스공사 위험성평가 표준모델 (공공데이터포털 15156225, 이용허락범위 제한 없음)
// data/standard_models.json은 `python -m src.build_dataset --json-only`로 만든다. 서버에서만 쓴다.
import raw from "@/data/standard_models.json";

export type StandardRow = {
  작업명: string;
  세부작업: string;
  분류: string;
  원인: string;
  유해위험요인: string;
  관련근거: string;
  법조항: string[];
  감소대책: string;
  출처파일: string;
};

const data = raw as { columns: string[]; rows: string[][] };
const col = (name: string) => data.columns.indexOf(name);
const C = {
  작업명: col("작업명"),
  세부작업: col("세부작업"),
  분류: col("분류(정리)"),
  원인: col("원인"),
  유해위험요인: col("유해위험요인"),
  관련근거: col("관련근거"),
  법조항: col("법조항"),
  감소대책: col("감소대책"),
  출처파일: col("출처파일"),
};

export const STANDARD_ROWS: StandardRow[] = data.rows.map((r) => ({
  작업명: r[C.작업명],
  세부작업: r[C.세부작업],
  분류: r[C.분류],
  원인: r[C.원인],
  유해위험요인: r[C.유해위험요인],
  관련근거: r[C.관련근거],
  법조항: r[C.법조항] ? r[C.법조항].split(";").filter(Boolean) : [],
  감소대책: r[C.감소대책],
  출처파일: r[C.출처파일],
}));

// 표준모델에 실제로 인용된 법 조항. 여기에 없다고 틀린 건 아니라서 '확인 필요'로만 쓴다.
export const KNOWN_LAW_REFS = new Set(STANDARD_ROWS.flatMap((r) => r.법조항));
