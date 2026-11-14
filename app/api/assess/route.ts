import { NextResponse } from "next/server";
import { aiDraft, DraftError } from "@/lib/ai";
import { dbErrorCode, saveHistory } from "@/lib/db";
import {
  DEFAULT_MODE,
  isMode,
  MAX_LENGTH,
  MIN_LENGTH,
  type AssessResponse,
} from "@/lib/options";
import { referenceText, retrieveDraft } from "@/lib/retrieve";
import { validate } from "@/lib/validator";

// 무료 AI 모델은 느릴 때가 있어 넉넉히 둔다 (형식 재요청·검사 수정까지 최대 3번 호출)
export const maxDuration = 300;

const SEARCH_MODEL = "표준모델 검색 (BM25)";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const input = (typeof body === "object" && body !== null ? body : {}) as {
    description?: unknown;
    mode?: unknown;
  };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const mode = input.mode ?? DEFAULT_MODE;

  if (description.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `작업 내용을 ${MIN_LENGTH}자 이상 적어 주세요. 무엇을, 어떤 기계로, 몇 명이 하는지 적으면 좋아요.` },
      { status: 400 },
    );
  }
  if (description.length > MAX_LENGTH) {
    return NextResponse.json({ error: `작업 설명은 ${MAX_LENGTH}자 이내로 적어 주세요.` }, { status: 400 });
  }
  if (!isMode(mode)) {
    return NextResponse.json({ error: "만드는 방식을 다시 골라 주세요." }, { status: 400 });
  }

  // 검색 초안은 두 모드 모두에서 쓴다 (AI 모드에서는 참고 자료, AI가 실패하면 대신 보여 줄 초안)
  const searched = retrieveDraft(description);
  let result: AssessResponse;

  if (mode === "search") {
    result = {
      assessment: searched.assessment,
      report: validate(searched.assessment),
      mode,
      model: SEARCH_MODEL,
      attempts: 0,
      sources: searched.sources,
    };
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY;
    try {
      if (!apiKey) {
        console.error("[assess] OPENROUTER_API_KEY가 설정되지 않았습니다.");
        throw new DraftError("서버에 AI API 키가 설정되지 않았어요.", 500);
      }
      const ai = await aiDraft(apiKey, description, referenceText(searched.sources, searched.assessment));
      result = { ...ai, mode };
    } catch (err) {
      if (!(err instanceof DraftError)) console.error("[assess] 알 수 없는 오류");
      const reason = err instanceof DraftError ? err.message : "AI 초안을 만들지 못했어요.";
      // AI가 실패해도 빈손으로 돌려보내지 않고, 표준모델 검색 초안을 대신 보여 준다
      result = {
        assessment: searched.assessment,
        report: validate(searched.assessment),
        mode: "search",
        model: SEARCH_MODEL,
        attempts: 0,
        sources: searched.sources,
        fallback: true,
        notice: `${reason} 대신 표준모델 검색 초안을 보여 드려요.`,
      };
    }
  }

  // 기록 저장에 실패해도 평가표는 그대로 돌려준다.
  try {
    await saveHistory({
      description,
      mode: result.mode,
      model: result.model,
      assessment: result.assessment,
      report: result.report,
    });
  } catch (err) {
    console.error(`[assess] 기록 저장 실패: ${dbErrorCode(err)}`);
    result.notice = [result.notice, "평가표를 기록에 저장하지 못했어요."].filter(Boolean).join(" ");
  }
  return NextResponse.json(result);
}
