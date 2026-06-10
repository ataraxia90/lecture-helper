# Lecture Helper

Chrome Extension Manifest V3 기반의 특정 온라인 강의 사이트 전용 수강 보조 자동화 도구입니다. 사용자가 로그인한 상태로 강의 목록 페이지를 열어두고 Start를 누르면, 미완료 차시만 순서대로 제목 hover, 전체 시간 확인, 팝업 열기, 남은 시간 대기, 팝업 닫기, 완료 확인 흐름으로 처리합니다.

## 파일 역할

- `manifest.json`: MV3 확장 선언, popup, background service worker, content script, 대상 host 권한 설정
- `config.js`: 대상 도메인, URL 패턴, DOM selector 후보, 시간 regex, retry/wait 값 집중 관리
- `utils.js`: 시간 파싱/포맷팅, 남은 시간 계산, URL 검사, duration 후보 추출
- `background.js`: popup과 content script 사이의 상태 관리자, `chrome.storage.local` 저장, 활성 탭 검사, 팝업 tab/window 추적 및 닫기 보조
- `content.js`: 강의 목록 DOM 수집, row 단위 시간 추출, title hover/click, long-running 자동화 loop, stop 처리
- `popup.html`: Start/Stop 제어판 UI
- `popup.css`: popup UI 스타일
- `popup.js`: popup 이벤트 처리, storage 상태 구독, background 메시지 송수신

## 대상 사이트 설정

현재 권한은 안전한 예시값인 `example.com`으로 제한되어 있습니다. 실제 사이트에 맞게 두 파일을 바꾸세요.

`manifest.json`

```json
"host_permissions": ["https://lecture.example.ac.kr/*"],
"content_scripts": [
  {
    "matches": ["https://lecture.example.ac.kr/*"],
    "js": ["config.js", "utils.js", "content.js"],
    "run_at": "document_idle"
  }
]
```

`config.js`

```js
TARGET_HOSTS: ["lecture.example.ac.kr"],
URL_MATCH: [/^https:\/\/lecture\.example\.ac\.kr\/.*$/i],
```

대상 사이트 DOM에 맞춰 `ROW_SELECTORS`, `TITLE_SELECTORS`, `COMPLETED_TIME_SELECTORS`, `TOTAL_TIME_SELECTORS`를 우선순위 순서로 조정하는 것이 가장 중요합니다.

## Chrome 개발자 모드 로드 방법

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드`를 누릅니다.
4. 이 프로젝트 폴더를 선택합니다.
5. 실제 대상 도메인으로 `manifest.json`을 수정했다면 확장을 다시 로드합니다.

## 필요한 권한

- `storage`: popup을 닫아도 `idle/running/hovering/opening_popup/waiting/verifying/stopped/error` 상태와 현재 차시 정보를 유지합니다.
- `tabs`: 현재 활성 탭이 대상 강의 목록 페이지인지 검사하고 content script와 통신합니다.
- `windows`: 제목 클릭 후 열린 팝업 창을 추적하고 닫는 데 사용합니다.
- `scripting`: content script가 아직 주입되지 않은 활성 탭에 보조 주입을 시도합니다.
- `debugger`: 팝업을 닫을 때 사이트의 `나가시겠습니까?` JavaScript 확인창이 뜨면 자동으로 승인하고 닫기 위해 팝업 탭에 일시적으로 attach합니다.
- `host_permissions`: 대상 강의 사이트에서만 DOM 접근과 script 실행을 허용합니다.

## 자동화 로직

1. Start 클릭 시 background가 활성 탭 URL을 `TARGET_HOSTS`와 `URL_MATCH`로 검사합니다.
2. content script가 row 목록을 수집합니다. DOM 갱신에 대응하기 위해 반복마다 다시 조회합니다.
3. 각 row에서 hover 없이 보이는 시간을 `completed_time`으로 읽습니다.
4. row 전체가 아니라 title element에 `mouseover/mouseenter/mousemove`를 dispatch합니다.
5. hover 후 같은 row 범위 안에서만 `total_time`을 읽습니다.
6. `remaining_time = max(total_time - completed_time, 0)`으로 계산합니다.
7. 남은 시간이 0 이하이거나 완료 keyword가 있으면 건너뜁니다.
8. title element를 클릭하고 background가 새 tab/window 팝업을 감지합니다.
9. 남은 시간에 `SAFETY_BUFFER_MS`를 더해 대기합니다.
10. background가 감지한 팝업을 닫고 부모 목록에서 완료 반영 여부를 확인합니다.
11. Stop 요청이 오면 현재 대기 loop를 빠져나오고 가능한 팝업 닫기를 시도한 뒤 `stopped`로 전환합니다.

## 테스트 방법

1. 실제 강의 목록 페이지에서 DevTools로 row/title/completed/total selector를 확인해 `config.js`를 조정합니다.
2. 확장을 다시 로드합니다.
3. 강의 목록 페이지를 새로고침합니다.
4. popup에서 Start를 누릅니다.
5. 상태가 `running -> hovering -> opening_popup -> waiting -> verifying` 순서로 바뀌는지 확인합니다.
6. `completed`, `total`, `remaining` 값이 사이트에 표시되는 값과 일치하는지 확인합니다.
7. Stop을 눌렀을 때 대기가 중단되고 팝업이 닫히는지 확인합니다.

시간 파싱은 `HH:MM:SS`, `MM:SS`, `17분 40초`, `48분`, `1시간 2분 3초` 형식을 지원합니다.

## 알려진 한계와 fallback 전략

- 사이트가 hover 정보를 row 밖 전역 tooltip에 렌더링하면, 요구사항에 따라 페이지 전체 검색을 하지 않으므로 `TOTAL_TIME_SELECTORS`를 row 내부에 잡히는 구조로 맞춰야 합니다.
- 팝업이 브라우저 tab/window가 아니라 페이지 내부 iframe/modal이면 background의 tab/window 추적 대상이 아닙니다. 이 경우 title 클릭 후 사이트 DOM selector를 추가해 modal close 버튼을 content script fallback으로 확장해야 합니다.
- `window.open`이 사용자 제스처로만 허용되는 사이트에서는 synthetic click이 막힐 수 있습니다. 이때는 title element의 실제 clickable child selector를 `TITLE_SELECTORS` 최상단에 둬야 합니다.
- content script는 페이지 DOM에는 접근하지만 페이지 JS 컨텍스트와는 분리됩니다. 사이트 내부 함수 직접 호출 대신 DOM event dispatch와 Chrome API 메시징으로만 처리합니다.
- 완료 반영이 서버 polling이나 새로고침 후에만 나타나는 사이트는 `VERIFY_WAIT_MS`를 늘리거나 verify 단계에서 목록 새로고침 전략을 추가하세요.

## 페이지 내 자동 패널

대상 페이지를 열면 오른쪽 아래에 `Lecture Helper` 플로팅 패널이 자동으로 표시됩니다. Chrome 확장 아이콘 popup을 열지 않아도 이 패널에서 Start/Stop을 누르고 현재 차시, completed/total/remaining, 마지막 오류를 확인할 수 있습니다.
