# 검증 스크립트

조사(`research/03`)와 위키(`wiki/basics`, `wiki/relations`, `wiki/judgment`)의 표·사례 값을 계산해 대조한 스크립트. 세션 임시 폴더에서 옮겨 왔다. 재현용 기록이며 서비스 코드가 아니다.

실행 환경(저장소 밖에 만든다): `uv venv` 후 `lunar-python`, `bazi`, `korean-lunar-calendar`, `skyfield`, `kerykeion` 등 설치. `js/`는 `npm i iztro lunar-typescript`.
`johu_table.tsv`는 `wiki/judgment/climate-johu.md` 120칸 조후표의 원본.
