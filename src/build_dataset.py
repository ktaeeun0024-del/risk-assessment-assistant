"""가스공사 위험성평가 표준모델(엑셀 80개)을 하나의 표로 합친다.

입력: data/raw/kogas_standard_model.zip  (scripts/download_data.py로 받음)
출력: data/standard_models.csv  — 한 행이 유해·위험요인 하나

엑셀은 안전보건공단 KRAS 양식이다. 머리글이 두 줄이고(예: '현재 위험성' 아래 '가능성/중대성/위험성')
세부 작업명·분류·원인 칸은 셀 병합이라 아래 행이 비어 있어서 앞 값으로 채운다.
실행: python -m src.build_dataset
"""

import re
import warnings
import zipfile
from pathlib import Path

import pandas as pd

from src.schema import extract_law_refs, normalize_category

ROOT = Path(__file__).resolve().parent.parent
RAW_ZIP = ROOT / "data" / "raw" / "kogas_standard_model.zip"
EXTRACT_DIR = ROOT / "data" / "raw" / "extracted"
OUT = ROOT / "data" / "standard_models.csv"

# (윗줄 머리글, 아랫줄 머리글) → 표준 컬럼 이름. 아랫줄이 없으면 None
COLUMN_MAP = [
    ("세부작업명", None, "세부작업"),
    ("주요재해사례", None, "재해사례"),
    ("유해위험요인파악", "분류", "분류"),
    ("유해위험요인파악", "원인", "원인"),
    ("유해위험요인파악", "유해위험요인", "유해위험요인"),
    ("관련근거", None, "관련근거"),
    ("현재안전보건조치", None, "현재조치"),
    ("현재위험성", "가능성", "가능성"),
    ("현재위험성", "중대성", "중대성"),
    ("현재위험성", "위험성", "위험성"),
    ("위험성감소대책", None, "감소대책"),
    ("개선후위험성", None, "개선후위험성"),
]
FILL_DOWN = ["세부작업", "분류", "원인"]


def _clean(v) -> str:
    return "" if pd.isna(v) else re.sub(r"\s+", "", str(v))


def _extract():
    with zipfile.ZipFile(RAW_ZIP) as z:
        for info in z.infolist():
            name = info.filename.encode("cp437").decode("cp949") if not info.flag_bits & 0x800 else info.filename
            target = (EXTRACT_DIR / name).resolve()
            if not str(target).startswith(str(EXTRACT_DIR.resolve())):  # 압축 경로 조작 방지
                continue
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(info))


def _parse_sheet(df: pd.DataFrame) -> pd.DataFrame | None:
    head = None
    for i in range(min(len(df) - 1, 30)):
        row = [_clean(v) for v in df.iloc[i]]
        if any("유해위험요인" in v for v in row) and any("감소대책" in v for v in row):
            head = i
            break
    if head is None:
        return None
    top = pd.Series([_clean(v) or None for v in df.iloc[head]]).ffill().fillna("")
    sub = [_clean(v) for v in df.iloc[head + 1]]
    cols = {}
    for j, (t, s) in enumerate(zip(top, sub)):
        if t.startswith("담당자"):
            break
        for want_top, want_sub, name in COLUMN_MAP:
            if t.startswith(want_top) and (want_sub is None or s.startswith(want_sub)) and name not in cols:
                cols[name] = j
    if "유해위험요인" not in cols or "감소대책" not in cols:
        return None
    body = df.iloc[head + 2:, list(cols.values())]
    body.columns = list(cols.keys())
    body = body.map(lambda v: "" if pd.isna(v) else str(v).strip())
    for c in FILL_DOWN:
        if c in body:
            body[c] = body[c].replace("", pd.NA).ffill().fillna("")
    body = body[body["유해위험요인"].str.len() > 3]
    return body


def _task_name(path: Path) -> tuple[str, str]:
    """파일 이름에서 (부문, 작업명)을 뽑는다. 예: '생산-14 지게차 작업 위험성평가지' → ('생산', '지게차 작업')"""
    division = path.parent.name.split(". ")[-1]
    stem = re.sub(r"^\S+-\d+\s*", "", path.stem)
    stem = re.sub(r"\[개정\]|\(수정\)|_r\d+|\(보완\)", "", stem)
    stem = re.sub(r"위험성\s*평가(지|_KRAS_\S+?_|\s*표준모델_?)?", "", stem)
    return division, stem.strip(" _-") or path.stem


def build() -> pd.DataFrame:
    if not EXTRACT_DIR.exists():
        _extract()
    frames = []
    for f in sorted(EXTRACT_DIR.rglob("*.xls*")):
        division, task = _task_name(f)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            sheets = pd.read_excel(f, sheet_name=None, header=None)
        for sheet_name, df in sheets.items():
            body = _parse_sheet(df)
            if body is None or body.empty:
                continue
            body.insert(0, "작업명", task)
            body.insert(0, "부문", division)
            body.insert(0, "출처파일", f.name)
            frames.append(body)
    out = pd.concat(frames, ignore_index=True).fillna("")
    out = out.drop_duplicates(subset=["작업명", "세부작업", "유해위험요인", "감소대책"])
    out["분류(정리)"] = out["분류"].map(normalize_category)
    out["법조항"] = out["관련근거"].map(lambda s: ";".join(extract_law_refs(s)))
    return out


if __name__ == "__main__":
    df = build()
    df.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"{len(df)}행, 작업 {df['작업명'].nunique()}종, 파일 {df['출처파일'].nunique()}개 → {OUT.name}")
    print(df["부문"].value_counts().to_dict())
    print("관련근거 있는 행:", (df.get("관련근거", pd.Series(dtype=str)) != "").sum())
    print(df[["작업명", "세부작업", "분류", "유해위험요인", "감소대책"]].sample(5, random_state=0)
            .map(lambda s: s[:30]).to_string(index=False))
