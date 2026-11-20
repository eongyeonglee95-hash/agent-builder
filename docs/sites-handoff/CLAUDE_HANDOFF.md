# Claude 인계 — ChatGPT Sites

## 사용자 의도와 현재 상태

사용자는 ChatGPT Sites 플러그인으로 사이트를 만들려 하며, 토큰이 부족해 Claude에게 작업을 인계하려 한다. 제공한 주소는 `https://chatgpt.com/space?tab=suggested&artifact=sites`이다. 이 대화에서는 개별 사이트 URL, 프로젝트 ID, 제작할 사이트의 주제나 확정 디자인을 받지 않았다. 새 사이트 제작·수정·게시를 수행하지 않았다.

앞선 답변에서 부동산 관측실을 언급했으나, 저장소 검색에서 발견한 과거 기록일 뿐 사용자가 지목한 사이트로 확인되지 않았다. 이를 현재 제작 대상으로 단정하지 말 것.

## 먼저 읽을 자료

- 이 파일: 작업 맥락과 핵심 요약.
- [SITES_FULL_REFERENCE.md](SITES_FULL_REFERENCE.md): 설치된 Sites 1.1.6의 SKILL.md, 디자인, 기능, 배포, 문제 해결, 리믹스, 템플릿 README 및 라이선스 등 모든 Markdown 원문.
- [SOURCE_INDEX.md](SOURCE_INDEX.md): 실행 스크립트·템플릿·컴포넌트 파일 목록과 로컬 원본 경로. 코드 본문은 MD 전체본에 포함하지 않았다.

## 디자인에 실제로 정의된 내용

Sites에는 완성된 하나의 디자인이나 모든 사이트에 적용할 고정 색상·글꼴·레이아웃 규격이 정의돼 있지 않다. 사이트의 목적과 대상에 맞는 일관된 시각 방향을 선택하도록 안내한다. 기존 사이트를 편집할 때는 브랜드와 요청 범위를 유지한다.

- 반응형 레이아웃, 읽기 쉬운 텍스트, 접근 가능한 상호작용.
- 이미지가 경험에 도움이 될 때 사용.
- 소개·홍보·포트폴리오는 이해 → 구체적 탐색 → 다음 행동으로 이어지는 구성.
- 각 섹션에 서로 다른 실질적 내용을 넣고 반복 문구·빈 장식·같은 카드 배치의 반복을 피함.
- 사례·이미지·시연으로 주제를 구체화하고 구성과 상호작용이 설명에 기여하게 함.
- 실존 인물·조직·제품의 고객·후기·통계·기능은 근거 없이 만들지 않음. 데모 자료는 실제와 구분.
- 소개를 풍부하게 만든다는 이유만으로 로그인·DB·외부 연동을 추가하지 않음.

Vinext 스타터에 CSS와 UI 컴포넌트가 포함돼 있지만, 사용자가 승인한 최종 디자인이라는 뜻은 아니다. 실제 제작 시 색상, 서체, 간격, 화면별 구성, 모바일 동작은 대상에 맞춰 정해야 한다.

## 제작 흐름

1. 기존 사이트가 특정되면 get_site로 ID·공개 범위를 확인하고 소스 접근 권한을 받아 원본 체크아웃을 연다. 새 사이트는 별도 빈 폴더에서 시작한다.
2. 단순 화면·브라우저 내부 동작은 빌드 없는 HTML/JS를 기본으로 한다. 서버 기능에는 제공 Vinext 스타터를 사용할 수 있다. 사용자가 프레임워크를 지정하면 그 선택을 따른다.
3. 실제 호스팅 작업에서는 create_site로 비공개 미게시 사이트를 등록하고 반환 ID를 보존한다. 로컬 작업만 요청됐으면 등록·배포를 생략한다.
4. 콘텐츠·기능·이미지를 구현하고 필요한 의존성을 설치한다. 환경에 맞는 미리보기 지침을 먼저 읽는다.
5. 변경에 필요한 검증을 수행하고 소스와 배포 산출물을 패키징한다.
6. 기존 공개 범위를 보존해 저장·배포하고 반환 상태와 URL을 확인한다.

이 인계 작업에서는 위 등록·배포 명령을 실행하지 않았다.

## 호스팅과 기술 구조

정적 사이트는 `.openai/hosting.json`에 project_id와 static.directory를 기록한다. 지원 디렉터리는 dist, dist/client, out, build, .output/public이며 index.html과 사용 자산이 있어야 한다.

서버 사이트는 static 필드를 생략하고 `dist/server/index.js`에 fetch 핸들러를 내보내는 Cloudflare Worker ES 모듈을 만든다. Worker 런타임은 isolate당 128MB이며 외부 연결은 HTTP 기반이고 raw TCP는 지원하지 않는다. Vinext 스타터의 sites() 빌드 통합을 유지한다.

site-workflow.mjs는 소스 준비, 검사·빌드, 커밋·푸시, 패키징을 담당한다. 인증정보는 stdin으로만 전달하며 파일·로그·명령 인자에 넣지 않는다. work_proxy 인증에는 별도 토큰이 없다.

## 지원 기능과 읽을 원문

| 필요 기능 | 전체본의 원본 문서 |
| --- | --- |
| D1 DB, R2 파일 저장 | references/storage.md |
| ChatGPT 로그인, 사용자별 데이터, 시크릿 | references/identity-and-secrets.md |
| 방문자가 연결한 앱 데이터·작업 | references/app-integrations.md |
| 사이트 기능을 에이전트 도구로 제공 | references/site-mcp-server.md |
| 브라우저 에이전트용 WebMCP | references/browser-agent-support.md |
| 사이트를 닫아둔 동안 정기 갱신 | references/recurring-updates.md |
| 로컬·관리형 환경 미리보기 | references/preview/local.md, managed.md |
| 오류 해결 | references/troubleshooting.md |
| 기존 사이트를 새 사이트로 복제 | sites-remix/SKILL.md |

## Claude에서 이어받을 때

디자인 지침과 구현 방식은 이 문서로 참고할 수 있다. ChatGPT Sites 전용 도구, 계정 권한, 로그인 및 호스팅 기능이 MD를 전달하는 것만으로 Claude에 생기지는 않는다. Claude 환경에 도구가 실제 제공되는지 확인하고, 없으면 로컬 소스 제작까지 진행한 후 배포 가능한 환경으로 넘긴다. 현재 로컬 플러그인 파일 경로도 다른 컴퓨터에는 없을 수 있다.

기존 작업공간에서 구현할 경우 루트 CLAUDE.md와 해당 프로젝트의 AGENTS.md·CLAUDE.md를 먼저 따른다. 프로젝트가 정해지지 않은 상태에서 둘이서은퇴나 다른 제품 파일을 수정하지 않는다.

## 기존 저장소에서 발견한 관련 자료 — 현재 대상 미확정

- `dev_agents/retire-together/sites/property-observatory/`: 과거 부동산 관측실 소스 위치로 기록됨.
- `dev_agents/retire-together/docs/archive/CHANGELOG.md`: 2026-11-09 비공개 Sites 게시 및 비교 시각화 업데이트 기록.
- 기록상의 URL: https://retire-property-observatory.eongyeonglee95.chatgpt.site
- `dev_agents/retire-together/docs/DESIGN_SYSTEM.md`: 둘이서은퇴 자체 디자인 시스템. Sites 플러그인 공통 디자인과는 별개.

위 항목은 이번에 라이브 사이트 및 배포 소스와 대조 검증하지 않았다.
