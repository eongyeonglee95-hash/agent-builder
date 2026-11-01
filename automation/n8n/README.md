# n8n 자동화 (배우는 용도)

앱은 계산·기록 본체, n8n은 바깥에서 때 맞춰 묻고 알려 주는 비서. **n8n은 주문하지 않는다.** 내 컴퓨터에서만 돌린다.

## 띄우기
```bash
scripts/dev-web.sh          # 앱 (http://127.0.0.1:8000)
npx n8n                     # n8n (http://localhost:5678) — Node 24 이상
```

## 1단계: 연금 월 1회 점검 (`monthly-check.json`)
`매달 25일 9시` → `앱에 물어보기`(GET /api/workbook/check) → `할 일 있나?`(needs_action) → `텔레그램 보내기`(message)

- 알림 문장은 앱이 만든다(`backend/workbook.py` check). n8n은 나르기만 한다.
- 직접 만들어 보고, 막히면 n8n 메뉴 Import from File로 이 파일을 불러와 비교.
- 텔레그램: @BotFather에서 봇 토큰을 받아 n8n Credentials에 넣고, 봇에게 말을 건 뒤 chat id를 `텔레그램 보내기`에 넣는다. 토큰은 이 저장소에 적지 않는다.

## 다음 단계
2. AI 에이전트 노드 — 앱 API만 도구로 쓰고 설명만 한다.
3. 검사(에이전트 숫자 = 앱 계산값)와 텔레그램 수락/넘기기 버튼 → /api/workbook/decision.
