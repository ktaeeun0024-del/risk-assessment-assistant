"""공공데이터포털에서 한국가스공사 위험성평가 표준모델(103종 작업)을 내려받는다.

출처: 한국가스공사_KOGAS 위험성평가 표준모델 (공공데이터포털 15156225, 이용허락범위 제한 없음)
https://www.data.go.kr/data/15156225/fileData.do

실행: python scripts/download_data.py  →  data/raw/kogas_standard_model.zip
(포털 화면 구조가 바뀌면 위 주소에서 직접 내려받아 같은 이름으로 저장하면 된다)
"""

import json
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

PAGE = "https://www.data.go.kr/data/15156225/fileData.do"
API = "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do"
FILE = "https://www.data.go.kr/cmm/cmm/fileDownload.do"
OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "kogas_standard_model.zip"


def main():
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    opener.addheaders = [("User-Agent", "Mozilla/5.0")]
    opener.open(PAGE).read()
    body = urllib.parse.urlencode({
        "publicDataDetailPk": "uddi:607002e9-5adc-4c0a-a040-9440378e1078",
        "publicDataPk": "15156225", "atchFileId": "", "fileDetailSn": "1",
        "publicDataTyCode": "PR0051",
    }).encode()
    info = json.loads(opener.open(API, body).read())
    q = urllib.parse.urlencode({"atchFileId": info["atchFileId"], "fileDetailSn": info["fileDetailSn"]})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(opener.open(f"{FILE}?{q}").read())
    print(f"저장: {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
