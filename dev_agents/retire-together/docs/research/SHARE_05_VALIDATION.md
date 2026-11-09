# SHARE-05 공유 자료·이전 서버 계약과 검수

2026-11-09, 작업 `44233def-36e9-40a3-820d-67b4254124b9`. 상태 원본은 [AGENT_DESIGN §0](../AGENT_DESIGN.md). SHARE-05의 완료 범위는 서버·이전 도구와 격리 자동 검수다. 실제 두 Google 계정·별도 테스트 시트·두 기기 검수는 SHARE-07에서 반드시 수행한다.

## 저장 원천과 스키마

공통 파일 연결만으로 자료를 이전하지 않는다. 오너의 명시적인 미리보기와 충돌 선택, 이전 확정 요청이 필요하다. 기존 `자산`·`보유종목` 탭은 원본으로 보존한다. 이전 후의 원천은 같은 파일의 **`공유자료_v1` 변경 이력 탭**이다. SQLite/YAML/CSV는 이전 전 원본과 비공개 백업이며 이후 조회의 대체 원장으로 쓰지 않는다.

`공유자료_v1`의 열은 `operation_id, parent_revision, kind, part, parts, payload_json`. 한 작업의 전체 상태 JSON을 30,000자씩 나눠 `appendCells`로 추가한다. 첫 탭 생성·머리글·여러 조각은 한 `spreadsheets.batchUpdate`에 담는다. `stringValue`를 써서 문자열이 수식으로 실행되지 않게 한다. Google은 batch 내부 요청의 원자성을 보장하지만 다른 편집자의 변경을 조건부로 차단하는 기능은 아니므로, 앱에서는 별도의 버전·이력·재조회 검사를 수행한다. [Google batch 문서](https://developers.google.com/workspace/sheets/api/guides/batch), [AppendCellsRequest](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AppendCellsRequest).

상태 형태는 `{schema: 1, members: {me: 고정ID, partner: 고정ID}, records: [...]}`. 각 record는 `{kind, id, member_id, payload}`다. `members.me`는 최초 오너 기준의 사람이며 로그인에 따라 바뀌지 않는다. 응답 `viewer.me/partner`만 현재 로그인한 사람을 기준으로 바뀐다. 가구 공통은 `household`, 공동 명의는 `joint`이며, 은퇴 목표 기준 사람과 공동 지분의 기준 사람도 최초 오너의 고정 ID를 명시한다. 오너 권한과 배우자 자산의 명의를 혼동하지 않는다.

| kind | 이전 원천·ID | 내용/검증 |
|---|---|---|
| profile | SQLite `family.me/partner`; ID=고정 멤버 | 이름·나이·역할, 기존 `Person` 모델 |
| family_goal | `family`; ID=`goal`, household | 은퇴 나이·목표액·최초 오너 기준 ID |
| pension | `retirement_plan.me/partner`; ID=고정 멤버 | 국민/퇴직/개인연금 입력, `PersonPlan` |
| retirement | `retirement_plan` 공통 필드; ID=`plan` | 생활비·예산·수익률·물가, `PlanInput` |
| asset | SQLite `assets` 및 기존 자산 탭; 기존 UUID 유지 | 명의·지분·금액·부모/세부자산·계좌 연결, `AssetInput` |
| account / pool | `accounts.yaml`; 기존 ID 유지 | 계좌 명의·유형·주머니·전략 선택/묶음. YAML의 spouse도 최초 partner에 대응 |
| holding | 계좌별 최신 CSV 및 보유종목 탭; 계좌+종목의 결정적 UUID | 수량·현재가·매입액·계좌 명의. 과거 CSV는 백업에 보존 |
| property_detail | SQLite `property_detail`; 집 UUID | 주소·매입가·거주 형태·대출·보증금·매물, 기존 `HomeInput`/`Listing` 재사용 |
| property_plan | SQLite `property_move`; 고정 멤버 또는 household | 후보·선택 집·계획. together는 household, 기존 `MoveInput` 재사용 |
| property_track | SQLite `property_track`; 범위:후보:날짜 | 당시 가격·격차·필요액·메모. 미입력 null과 음수 순매각액/가격 격차 보존 |
| decision | 결정 문서의 리밸런싱 제안 기록; 내용+원래 순서의 해시 | 읽기 전용. 문서 원문 전체는 비공개 백업 |
| rules | strategies/asset_map YAML; 고정 ID | 원문과 SHA-256을 보존하는 읽기 전용 기록. 투자 규칙 자동 변경 없음 |

알 수 없는 kind/필드, 다른 멤버, 중복 ID·보유종목, 끊어진 계좌/부모/집/후보/대출 연결, 잘못된 금액/모델을 거부한다. 금융 원장을 인증 저장소와 함께 복사하지 않는다. 사람 매핑·앱 편집 허용·작업 영수증·백업 체크섬은 서버 인증 DB에 따로 저장하며 Google 토큰/세션/초대는 시트나 금융 백업에 넣지 않는다.

## 이전·저장·복구

1. **미리보기**: 로컬 DB를 읽기 전용으로 연결하고 하나의 읽기 트랜잭션에서 가계 자료·이력 테이블만 SQLite 스냅샷으로 복사한다. `family/assets/asset_history/retirement_plan/property_detail/property_move/property_track`의 행·스키마·인덱스·트리거와 관련 AUTOINCREMENT 값을 보존한다. 부동산 공개 수집·지리/장소 테이블은 원본 DB에 남기며 이 백업/이전 대상에 넣지 않는다. 목적지 SQLite에 100MB 페이지 한도를 적용한다. YAML·CSV·결정 문서 원문은 바이트 그대로 보관한다. 기존 두 시트의 사용 범위를 수식 형태로 보관하고 해석된 행도 함께 대조한다. 새 공유 탭에는 아직 쓰지 않는다.
2. **대조**: 원천별/이전 결과별 종류 건수, 명의별 자산/부채 합계, 계좌별 종목 평가액, 전체 해시를 반환한다. 총액과 세부자산을 이중 합산하지 않으며 공동 자산은 joint 합계로 별도 표시한다. 같은 ID의 로컬/시트 차이는 양쪽 원문을 표시하고 모든 충돌에 `local` 또는 `sheet`를 선택해야 한다. 이전 미리보기 뒤 원본이 바뀌면 다시 미리보기해야 한다.
3. **확정/저장**: 서버 파일 잠금으로 한 가구의 앱 요청을 직렬화한다. 별도 프로세스도 같은 잠금을 쓴다. 충돌 요청은 409로 돌아가며, `expected_revision`은 전체 공유 기록의 SHA-256이다. 백업 파일 fsync와 영수증 기록을 먼저 마친 뒤 한 batch로 추가하고 다시 읽어 상태·건수·합계·명의를 대조한다.
4. **재시도**: 같은 작업 UUID/같은 사용자/같은 본문은 기존 작업을 조회한다. 응답만 유실되고 기록이 확인되면 성공을 복원한다. 전송 전 실패/불확실·기록 변경 때는 자동 재전송하지 않고 복구 대조로 보낸다. 다른 본문이나 사용자의 같은 UUID는 거부한다. 과거 복구 체크포인트 이전 작업의 재요청은 자동 재전송하지 않고 대조를 요구할 수 있다.
5. **직접 시트 편집**: 현재 공유 JSON의 유효한 변경은 새 조회에 반영한다. 앱의 오래된 revision 저장은 거절한다. 검사와 추가 사이 기존 기록이 바뀌면 parent 해시가 어긋나 충돌을 반환하며 양쪽 행을 보존한다. 과거 행·머리글·JSON의 손상도 복구 대조 대상이다. 기존 자산/보유종목 탭은 이전 시점 원본이므로, 이전 후 그 탭의 수정이 새 원천에 반영된다고 안내해서는 안 된다.
6. **복구**: 오너가 백업의 before/proposed와 현재 revision을 확인해 별도 작업 UUID로 확정한다. 기존 시트 행을 지우거나 덮어쓰지 않고, 현재 원본 해시를 인정하는 recovery 체크포인트를 추가한다. 손상 이력/일부 행/머리글은 그대로 남긴다. 탭이 사라졌으면 같은 파일에 해당 탭만 복원한다. 정상적인 현재 상태를 읽을 수 없을 때는 서버가 백업한 마지막 제안 상태를 권한 대조 기준으로 사용한다. 상대방 자료의 복원 변경에도 앱 편집 허용이 필요하며 복구로 오너/멤버 명의를 바꾸지 않는다.

백업 위치는 인증 DB와 같은 디렉터리의 `shared-data-backups/<UUID>.json`. 폴더 0700·파일 0600, 체크섬 검사·심볼릭 링크 거부. 브라우저에는 백업 UUID와 대조할 상태만 내려주며 원본 바이트/서버 경로는 반환하지 않는다. SQLite 복사본은 위 가계 테이블의 논리적 내용이 같은 복구 가능한 DB이며 전체 원본 DB 백업이 아니다. 파일 헤더 바이트가 원본과 같다는 보장은 하지 않는다. 원본 파일 자체는 쓰지 않는다.

2026-11-09 크기 오류 보완: 실제 DB 약1.26GB 중 대부분이 공개 부동산 관측 자료였으나 전체 DB 100MB 제한으로 가계 이전 대조까지 차단되던 결함을 수정했다. 가계 스냅샷은 실제 원본 읽기 전용 점검에서 **86,016바이트**, quick_check 및 local_sources 검증 통과. 운영 시트 연결1건·이전 시작0건을 읽기 전용 확인했으며 Google 쓰기/운영 이전은 수행하지 않았다. 신규3개(큰 관측 자료 보존·수집 후 대조 재사용/이전, 실제 가계 이력 초과 거부, WAL 동시 변경 시 단일 버전) 포함 전용62개·전체Python **677개** 통과. 수집 갱신은 가계 원본 변경으로 세지 않으며, 가계/YAML/CSV 변경은 기존 재대조 조건을 유지한다. 수정 전 생성한 대조는 다시 생성해야 할 수 있다. 금융 화면 공유 전환·실제 두 계정 검수 미결은 그대로다.

앱 편집 제한은 두 사람 모두에게 적용한다. 자기 자료와 가구 공통/공동 자료는 편집 가능, 상대방 자료는 그 사람이 `allow_other`를 켜야 한다. 여러 명의 계좌가 묶인 pool 변경은 해당 명의자들의 허용을 확인한다. 규칙·결정 이력은 일반 저장 API에서 변경하지 못한다. Google 시트 편집자는 시트 전체를 수정할 수 있으므로 이 제한을 Google의 행 단위 보안으로 설명하지 않는다.

## API와 후속 화면 연결

모든 API는 기존 웹 세션·Origin·CSRF 경계를 사용한다. 자기 계정의 drive.file 토큰으로 같은 파일에 접근하며 고정 오너 소유권도 재확인한다. 오류 때 파일 ID를 지우거나 새 파일/로컬 자료로 전환하지 않는다.

| API | 계약 |
|---|---|
| GET `/api/shared-data` | 고정 멤버 상태·revision·summary·viewer·permissions. 이전 전/손상/충돌은 409 |
| POST `/api/shared-data/migration/preview` | 오너만. preview_id·원천별 대조·충돌·고정 멤버·확정 필요 반환 |
| POST `/api/shared-data/migration/commit` | `{operation_id, preview_id, choices: {충돌키: local 또는 sheet}}` |
| POST `/api/shared-data/save` | `{operation_id, expected_revision, upsert: [Record], delete: [{kind,id}]}`. 삭제와 연결 해소도 한 번에 보내 검증 |
| PUT `/api/shared-data/permissions` | `{allow_other: boolean}`. 로그인한 사람 자신의 허용만 변경 |
| GET `/api/shared-data/recovery` | 오너만. 현재 revision·최근 백업 ID/kind 목록 |
| GET `/api/shared-data/recovery/{backup_id}` | 오너만. 현재 revision·before/proposed 대조 |
| POST `/api/shared-data/recovery` | `{operation_id, expected_revision, backup_id, version: before 또는 proposed}` |

공통 파일을 설정하면 기존 로컬 쓰기는 차단된다. **이전 시작 이후 기존 금융 조회 API도 409로 차단**해 오래된 프로필·계획·YAML을 최신 자료처럼 보이지 않게 한다. 배우자의 기존 owner 기준 금융 API는 계속 403이다. `/api/shared-data`만 고정 멤버 계약을 제공한다. SHARE-06은 이 API에 조회/편집과 원천 전환 상태를 연결해야 하며, 기존 API의 owner 기준 me/partner를 단순히 배우자에게 열면 안 된다. 기존 도메인 계산의 UI 연결도 고정 사람과 같은 공유 상태를 기준으로 맞춰야 한다. 이번 작업은 화면/계산 연결을 완료했다고 보고하지 않는다.

현재 단일 서버·공유 인증 DB/잠금 파일을 사용하는 한 가구 배포가 범위다. 서로 다른 파일시스템의 여러 서버를 지원하지 않는다. 상태 한도는 10,000 records/JSON 1.5 MB, 읽는 이력은 100,000행이며 자동 이력 삭제·압축은 하지 않는다. 로컬 원본 파일당 30 MB, 금융 DB 100 MB를 넘으면 이전을 차단한다. 백업/이력의 운영 보존·확장 정책은 실사용 전에 검토한다.

## 실제 실행한 격리 검수

전용 `tests/test_shared_data.py` **59 passed**, 최종 전체 Python **630 passed (10.90초)**. 실제 FastAPI 경계·SQLite·서명한 합성 Google 로그인/초대와 Google HTTP 어댑터를 거치고 외부 요청만 가짜로 대체했다. 임시 금융 DB/YAML/CSV만 사용했고 운영 자격 증명·금융 자료는 읽거나 쓰지 않았다. 최초 확대 검수에서 손상 기록 복구 3건·중복 원본 ID·부동산 필드 3건·숫자 정규화 1건의 실패를 재현한 뒤 수정했고, 최종 회귀에서 모두 통과했다.

- 13종 원천·백업 복원 후 DB 내용 일치·원본 무변경·같은 시트의 원본 탭 보존·명의/건수/합계/계좌 평가액.
- 두 계정의 동일 상태/계획·로그인 기준 표지만 교체·재로그인/이메일 변경·공동 지분·은퇴 기준 사람 유지.
- 상대방 허용/철회·자기 계획/공통 계획 저장·혼합 pool/명의 변경/규칙 수정 거부·CSRF·제3자/접근 해제 차단·DB 고정 사람 제약.
- 재시도 중복 방지·다른 본문 UUID 재사용 거부·전송 전 실패/응답 유실·읽기 결과 불일치를 성공으로 처리하지 않음.
- 스레드 동시 저장·별도 Python 프로세스 잠금·오래된 revision·직접 편집 경쟁에서 양쪽 기록 보존.
- 손상 JSON/머리글/일부 행/머리글만 남음/빈 탭/탭 삭제 복구·복구의 배우자 허용 경계·백업 변조/실패 차단.
- 원본 DB/YAML/CSV/시트 변경 감지·중복 행/미등록 계좌/잘못된 합계/심볼릭 링크/깨진 DB 차단.
- 부동산 금액·형태 검증·미입력/음수 이력 보존·비유한 숫자 거절·여러 JSON 조각 원자 저장·수식 모양 이름을 문자열로 보존.
- 401/403/404/429/503에서 연결 ID 유지·로컬 전환 없음·부모/세부자산/부채 중복 합계 방지.

재현 명령(제품 서버를 띄우거나 재시작하지 않음):

```sh
.venv/bin/python -m pytest -q tests/test_shared_data.py
.venv/bin/python -m pytest -q
git diff --check
```

## 남은 실제 검수와 다음 담당

디자인 변경·브라우저 검수는 없음. SHARE-06에서 기존 대시보드 구조를 유지하며 위 API를 화면에 연결한다. 실제 운영 자료 이전·Google 계정/외부 설정 변경·공용 서버 재시작·커밋/푸시/배포는 수행하지 않았다.

SHARE-07 담당은 별도 테스트 인증 저장소와 별도 Google 시트에 합성 자료를 넣어 두 실제 계정의 동일 파일/명의/계획·이전 대조/원본 백업·재로그인·동시 저장/직접 편집 경쟁·복구·접근 해제를 확인해야 한다. 두 계정의 drive.file 동의, 필요한 Picker 설정/파일 승인, HTTPS 확인을 포함한다. 실제 계정 검수가 남아 있으므로 운영 사용·전체 공유 기능 완료로 해석하지 않는다. 이번 세션은 SHARE-06/07을 시작하지 않는다.
