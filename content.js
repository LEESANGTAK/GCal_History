// 저장된 데이터 구조 초기화
let historyData = {
    items: [] // { title, location, description, attendees, calendarSummary, calendarId, startTime, endTime, isAllDay }
};

// 사용자 설정 상태
let userSettings = {
    autoCompleteTime: true,
    autoCompleteAttendees: true,
    autoCompleteLocation: true,
    autoCompleteDescription: true
};

// 사용자 설정 동기화
function loadUserSettings() {
    if (!chrome.storage?.sync) return;
    chrome.storage.sync.get({
        autoCompleteTime: true,
        autoCompleteAttendees: true,
        autoCompleteLocation: true,
        autoCompleteDescription: true
    }, (res) => {
        userSettings = res;
        console.log("Loaded user autocomplete settings:", userSettings);
    });
}
loadUserSettings();

try {
    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                loadUserSettings();
            }
        });
    }
} catch (e) { }

// 백그라운드 스크립트에서 자동완성할 일정 데이터 가져오기
function loadCalendarEvents() {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) {
            resolve(false);
            return;
        }

        try {
            chrome.runtime.sendMessage({ action: 'getEvents' }, function (response) {
                if (chrome.runtime.lastError) {
                    console.warn("Communication with background script:", chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }

                if (response && response.success && response.items) {
                    console.log("Successfully loaded calendar events:", response.items.length);
                    historyData.items = response.items;
                    resolve(true);
                } else {
                    console.error("Failed to load events:", response?.error || "Unknown error");
                    resolve(false);
                }
            });
        } catch (err) {
            resolve(false);
        }
    });
}

// 초기 데이터 로딩
loadCalendarEvents();

try {
    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.cachedEvents && changes.cachedEvents.newValue) {
                console.log("Updated events from storage change:", changes.cachedEvents.newValue.length);
                historyData.items = changes.cachedEvents.newValue;
            }
        });
    }
} catch (e) { }

// 자동완성 목록 UI 생성
const suggestionBox = document.createElement('div');
suggestionBox.id = 'gcal-history-suggestions';
suggestionBox.style.display = 'none';
suggestionBox.style.maxHeight = '240px'; // 약 5~6개 항목 높이
suggestionBox.style.overflowY = 'auto';
suggestionBox.style.backgroundColor = '#fff';
suggestionBox.style.borderRadius = '4px';
suggestionBox.style.boxShadow = '0 4px 6px rgba(32,33,36,.28)';
suggestionBox.style.zIndex = '9999';
document.body.appendChild(suggestionBox);

// 지원 언어 감지 (한국어, 일본어, 중국어, 이탈리아어, 독일어, 프랑스어, 그 외는 영어 기본)
function getAppLanguage() {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('ko')) return 'ko';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('it')) return 'it';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('fr')) return 'fr';
    return 'en';
}

// 현재 활성화된 모달 다이얼로그 또는 뷰 탐색 (가장 최근 열린 모달 우선)
function getActiveDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-is-view="true"]'));
    return dialogs.find(d => d.querySelector('input[aria-label*="제목" i], input[aria-label*="Title" i], input[aria-label*="タイトル"], input[aria-label*="标题"], input[aria-label*="Titolo" i], input[aria-label*="Titel" i], input[aria-label*="Titre" i]')) || document;
}

// 입력창 찾기 헬퍼 함수 (모달 범위 우선 탐색으로 성능 최적화)
function getInputs() {
    const scope = getActiveDialog() || document;
    return {
        title: scope.querySelector('input[aria-label*="제목" i], input[aria-label*="Title" i], input[aria-label*="タイトル"], input[aria-label*="标题"], input[aria-label*="Titolo" i], input[aria-label*="Titel" i], input[aria-label*="Titre" i]'),
        location: scope.querySelector('input[aria-label*="위치" i], input[aria-label*="Location" i], input[aria-label*="場所"], input[aria-label*="位置"], input[aria-label*="Luogo" i], input[aria-label*="Ort" i], input[aria-label*="Lieu" i]'),
        desc: findDescriptionEditable(scope) || scope.querySelector('div[aria-label*="설명" i], div[aria-label*="Description" i], div[aria-label*="説明"], div[aria-label*="说明"], div[aria-label*="Descrizione" i], div[aria-label*="Beschreibung" i]')
    };
}

// 시간 추출 헬퍼 (ISO 문자열 또는 일반 시간 텍스트 -> 로컬 시/분)
function extractTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;

    // 1. ISO 8601 문자열 포맷 ("2026-11-09T16:00:00+09:00" 등)
    if (timeStr.includes('T')) {
        const date = new Date(timeStr);
        if (!isNaN(date.getTime())) {
            return {
                hours: date.getHours(),
                minutes: date.getMinutes()
            };
        }
    }

    const cleanStr = timeStr.trim();

    // 2. 한국어 / 일본어 / 중국어 12시간제 ("오후 4:00", "오전 10:30", "午後 4:00", "下午 4:00" 등)
    let m = cleanStr.match(/(오전|오후|午前|午後|上午|下午)\s*(\d{1,2}):(\d{2})/i);
    if (m) {
        let h = parseInt(m[2], 10);
        const min = parseInt(m[3], 10);
        const isPM = /오후|午後|下午/i.test(m[1]);
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return { hours: h, minutes: min };
    }

    // 3. 영문 12시간제 ("4:00 PM", "10:30 am", "4:00pm" 등)
    m = cleanStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const isPM = /pm/i.test(m[3]);
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return { hours: h, minutes: min };
    }

    // 4. 24시간제 ("16:00", "09:30" 등)
    m = cleanStr.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
            return { hours: h, minutes: min };
        }
    }

    // 5. Date 파싱 시도 (기타 형식)
    const fallbackDate = new Date(cleanStr);
    if (!isNaN(fallbackDate.getTime())) {
        return {
            hours: fallbackDate.getHours(),
            minutes: fallbackDate.getMinutes()
        };
    }

    return null;
}

// 시간 문자열 포맷팅 헬퍼 (기존 input 형식에 맞춰 포맷)
function formatTime(hours, minutes, templateValue = '') {
    const minStr = String(minutes).padStart(2, '0');

    // 1. 기존 값에 "오전" 또는 "오후"가 포함된 경우 (한국어 12시간제)
    if (templateValue && (templateValue.includes('오전') || templateValue.includes('오후'))) {
        const period = hours < 12 ? '오전' : '오후';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    }

    // 2. 일본어 12시간제 (午前 / 午後)
    if (templateValue && (templateValue.includes('午前') || templateValue.includes('午後'))) {
        const period = hours < 12 ? '午前' : '午後';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    }

    // 3. 중국어 12시간제 (上午 / 下午)
    if (templateValue && (templateValue.includes('上午') || templateValue.includes('下午'))) {
        const period = hours < 12 ? '上午' : '下午';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    }

    // 4. 기존 값에 AM/PM이 포함된 경우 (영어 12시간제)
    if (templateValue && /[ap]m/i.test(templateValue)) {
        const isUpper = /[AP]M/.test(templateValue);
        const period = hours < 12 ? (isUpper ? 'AM' : 'am') : (isUpper ? 'PM' : 'pm');
        let h = hours % 12;
        if (h === 0) h = 12;
        const space = templateValue.includes(' ') ? ' ' : '';
        return `${h}:${minStr}${space}${period}`;
    }

    // 5. 기존 값에 24시간제(콜론만 있음) 형식이 쓰인 경우
    if (templateValue && /\b[0-2]?[0-9]:[0-5][0-9]\b/.test(templateValue)) {
        return `${String(hours).padStart(2, '0')}:${minStr}`;
    }

    // 6. 기본 포맷팅 (로케일 및 페이지 언어 감지)
    const appLang = getAppLanguage();

    if (appLang === 'ko') {
        const period = hours < 12 ? '오전' : '오후';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    } else if (appLang === 'ja') {
        const period = hours < 12 ? '午前' : '午後';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    } else if (appLang === 'zh') {
        const period = hours < 12 ? '上午' : '下午';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    } else if (appLang === 'it' || appLang === 'de' || appLang === 'fr') {
        return `${String(hours).padStart(2, '0')}:${minStr}`;
    } else {
        const period = hours < 12 ? 'AM' : 'PM';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${h}:${minStr} ${period}`;
    }
}

// "종일" 체크박스 요소 탐색
function getAllDayCheckbox(scope) {
    let cb = scope.querySelector('input[type="checkbox"][aria-label*="종일"], input[type="checkbox"][aria-label*="All day" i], input[type="checkbox"][aria-label*="終日"], input[type="checkbox"][aria-label*="全天"], input[type="checkbox"][aria-label*="Tutto il giorno" i], input[type="checkbox"][aria-label*="Ganztägig" i], input[type="checkbox"][aria-label*="Toute la journée" i], [role="checkbox"][aria-label*="종일"], [role="checkbox"][aria-label*="All day" i], [role="checkbox"][aria-label*="終日"], [role="checkbox"][aria-label*="全天"], [role="checkbox"][aria-label*="Tutto il giorno" i], [role="checkbox"][aria-label*="Ganztägig" i], [role="checkbox"][aria-label*="Toute la journée" i]');
    if (cb) return cb;

    const candidates = Array.from(scope.querySelectorAll('label, div, span'));
    for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (text === '종일' || text === 'all day' || text === '終日' || text === '全天' || text === 'tutto il giorno' || text === 'ganztägig' || text === 'toute la journée') {
            cb = el.querySelector('input[type="checkbox"], [role="checkbox"]')
                || el.closest('label')?.querySelector('input[type="checkbox"], [role="checkbox"]')
                || el.parentElement?.querySelector('input[type="checkbox"], [role="checkbox"]');
            if (cb) return cb;
        }
    }
    return null;
}

// 체크박스 활성화 여부 확인
function isCheckboxChecked(cb) {
    if (!cb) return false;
    if (cb.tagName === 'INPUT' && cb.type === 'checkbox') {
        return cb.checked;
    }
    return cb.getAttribute('aria-checked') === 'true';
}

// "시간 추가" / "Add time" 버튼 탐색
function getAddTimeButton(scope) {
    const btns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
    return btns.find(b => {
        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return text === '시간 추가' || text === 'add time' || text === '時間を追加' || text === '添加时间' || text === 'aggiungi orario' || text === 'aggiungi ora' || text === 'uhrzeit hinzufügen' || text === 'ajouter une heure' || text === 'ajouter un horaire' ||
            label.includes('시간 추가') || label.includes('add time') || label.includes('時間を追加') || label.includes('添加时间') || label.includes('aggiungi orario') || label.includes('aggiungi ora') || label.includes('uhrzeit hinzufügen') || label.includes('ajouter une heure') || label.includes('ajouter un horaire');
    });
}

// 시작 시간 및 종료 시간 input 탐색
function getTimeInputs(scope) {
    let startInput = scope.querySelector('input[aria-label*="시작 시간"], input[aria-label*="Start time" i], input[aria-label*="開始時間"], input[aria-label*="开始时间"], input[aria-label*="Ora di inizio" i], input[aria-label*="Orario di inizio" i], input[aria-label*="Startzeit" i], input[aria-label*="Heure de début" i]');
    let endInput = scope.querySelector('input[aria-label*="종료 시간"], input[aria-label*="End time" i], input[aria-label*="終了時間"], input[aria-label*="结束时间"], input[aria-label*="Ora di fine" i], input[aria-label*="Orario di fine" i], input[aria-label*="Endzeit" i], input[aria-label*="Heure de fin" i]');

    if (!startInput || !endInput) {
        const timeRegex = /(오전|오후|\bAM\b|\bPM\b|午前|午後|上午|下午|\b[0-2]?[0-9]:[0-5][0-9])/i;
        const allInputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])'));
        const matched = allInputs.filter(inp => {
            const val = inp.value || '';
            const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
            return timeRegex.test(val) || aria.includes('시간') || aria.includes('time') || aria.includes('時間') || aria.includes('时间') || aria.includes('ora') || aria.includes('orario') || aria.includes('zeit') || aria.includes('heure');
        });

        if (matched.length >= 2) {
            if (!startInput) startInput = matched[0];
            if (!endInput) endInput = matched[1];
        } else if (matched.length === 1 && !startInput) {
            startInput = matched[0];
        }
    }

    return { startInput, endInput };
}

// 시작 날짜 및 종료 날짜 input 정밀 탐색
function getDateInputs(scope) {
    let startInput = scope.querySelector('input[aria-label*="시작 날짜"], input[aria-label*="Start date" i], input[aria-label*="시작일"], input[aria-label*="開始日"], input[aria-label*="开始日期"], input[aria-label*="Data di inizio" i], input[aria-label*="Startdatum" i], input[aria-label*="Date de début" i]');
    let endInput = scope.querySelector('input[aria-label*="종료 날짜"], input[aria-label*="End date" i], input[aria-label*="종료일"], input[aria-label*="終了日"], input[aria-label*="结束日期"], input[aria-label*="Data di fine" i], input[aria-label*="Enddatum" i], input[aria-label*="Date de fin" i]');

    if (startInput && endInput) {
        return { startInput, endInput };
    }

    // 대체 탐색: 제목, 위치, 시간을 제외한 텍스트 input 탐색
    const allInputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])'));
    const candidateInputs = allInputs.filter(inp => {
        const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
        const val = inp.value || '';

        // 제목 및 위치 필드 제외
        if (aria.includes('제목') || aria.includes('title') || aria.includes('タイトル') || aria.includes('标题') || aria.includes('titolo') || aria.includes('titel') || aria.includes('titre') || placeholder.includes('제목') || placeholder.includes('titolo') || placeholder.includes('titel') || placeholder.includes('titre')) return false;
        if (aria.includes('위치') || aria.includes('location') || aria.includes('場所') || aria.includes('位置') || aria.includes('luogo') || aria.includes('ort') || aria.includes('lieu') || placeholder.includes('위치') || placeholder.includes('luogo') || placeholder.includes('ort') || placeholder.includes('lieu')) return false;

        // 시간 필드 제외
        const timeRegex = /(오전|오후|\bAM\b|\bPM\b|午前|午後|上午|下午|\b[0-2]?[0-9]:[0-5][0-9])/i;
        if (timeRegex.test(val) || aria.includes('시간') || aria.includes('time') || aria.includes('時間') || aria.includes('时间') || aria.includes('ora') || aria.includes('orario') || aria.includes('zeit') || aria.includes('heure')) return false;

        // 날짜 패턴(연도가 있거나 없거나: 11월 10일, 11月10日, 11. 10., 2026. 11. 10., 11/10 등) 또는 aria에 날짜 포함
        const dateRegex = /(\d{1,2}[월月\.]\s*\d{1,2}|\d{4}[^\d]+\d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2}\.\d{1,2}\.)/;
        return aria.includes('날짜') || aria.includes('date') || aria.includes('日') || aria.includes('期') || aria.includes('data') || aria.includes('datum') || dateRegex.test(val) || dateRegex.test(aria);
    });

    if (candidateInputs.length >= 2) {
        if (!startInput) startInput = candidateInputs[0];
        if (!endInput) endInput = candidateInputs[1];
    } else if (candidateInputs.length === 1 && !startInput) {
        startInput = candidateInputs[0];
    }

    return { startInput, endInput };
}

// 날짜 문자열 파싱 (연도가 생략된 형식도 현재 연도로 안전하게 보완)
function parseDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const cleanStr = dateStr.trim();
    const currentYear = new Date().getFullYear();
    const appLang = getAppLanguage();

    // 1. "2026. 11. 10." 또는 "2026-11-10" 또는 "2026년 11월 10일"
    let m = cleanStr.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    // 2. 슬래시 날짜: 유럽식("10/11/2026" = 11월 10일) vs 미국식("11/10/2026" = 11월 10일)
    m = cleanStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const p1 = parseInt(m[1], 10);
        const p2 = parseInt(m[2], 10);
        const yr = parseInt(m[3], 10);
        // 첫 번째 숫자가 12 초과거나 이탈리아/프랑스/독일어면 dd/mm/yyyy
        if (appLang === 'it' || appLang === 'fr' || appLang === 'de' || p1 > 12) {
            return new Date(yr, p2 - 1, p1); // day=p1, month=p2
        } else {
            return new Date(yr, p1 - 1, p2); // month=p1, day=p2
        }
    }

    // 3. 독일식 점 날짜 ("10. 11. 2026" 또는 "10.11.2026" 또는 "10. 11.")
    m = cleanStr.match(/(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/);
    if (m) {
        const day = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10);
        const yr = m[3] ? parseInt(m[3], 10) : currentYear;
        return new Date(yr, mon - 1, day);
    }

    // 4. 연도가 생략된 한국어/일본어/중국어: "11월 10일", "11月10日", "11월 10일 (화)", "11. 10." 등
    m = cleanStr.match(/(\d{1,2})[월月\.]\s*(\d{1,2})/);
    if (m) {
        return new Date(currentYear, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }

    // 5. 이탈리아어 월 이름 포함 ("10 nov 2026", "10 novembre", "nov 10" 등)
    const itMonths = { gen: 0, feb: 1, mar: 2, apr: 3, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, nov: 10, dic: 11 };
    m = cleanStr.match(/(?:(\d{1,2})\s+)?(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*(?:\s+(\d{1,2}))?(?:[^\d]+(\d{4}))?/i);
    if (m && (m[1] || m[3])) {
        const mon = itMonths[m[2].toLowerCase().slice(0, 3)];
        const day = parseInt(m[1] || m[3], 10);
        const yr = m[4] ? parseInt(m[4], 10) : currentYear;
        return new Date(yr, mon, day);
    }

    // 6. 독일어 월 이름 포함 ("10. Nov. 2026", "10 November", "Nov 10" 등)
    const deMonths = { jan: 0, feb: 1, mär: 2, mar: 2, apr: 3, mai: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dez: 11 };
    m = cleanStr.match(/(?:(\d{1,2})\.?\s+)?(jan|feb|mär|mar|apr|mai|jun|jul|aug|sep|okt|nov|dez)[a-z]*(?:\s+(\d{1,2}))?(?:[^\d]+(\d{4}))?/i);
    if (m && (m[1] || m[3])) {
        const mon = deMonths[m[2].toLowerCase().slice(0, 3)];
        const day = parseInt(m[1] || m[3], 10);
        const yr = m[4] ? parseInt(m[4], 10) : currentYear;
        return new Date(yr, mon, day);
    }

    // 7. 프랑스어 월 이름 포함 ("10 nov. 2026", "10 novembre", "nov 10" 등)
    const frMonths = { janv: 0, jan: 0, févr: 1, fevr: 1, fév: 1, fev: 1, mars: 2, mar: 2, avr: 3, mai: 4, juin: 5, juil: 6, août: 7, aout: 7, sept: 8, sep: 8, oct: 9, nov: 10, déc: 11, dec: 11 };
    m = cleanStr.match(/(?:(\d{1,2})\.?\s+)?(janv|févr|fevr|fév|fev|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)[a-z]*(?:\s+(\d{1,2}))?(?:[^\d]+(\d{4}))?/i);
    if (m && (m[1] || m[3])) {
        const mon = frMonths[m[2].toLowerCase().slice(0, 4)] ?? frMonths[m[2].toLowerCase().slice(0, 3)];
        const day = parseInt(m[1] || m[3], 10);
        const yr = m[4] ? parseInt(m[4], 10) : currentYear;
        return new Date(yr, mon, day);
    }

    // 8. 영어 월 이름 포함: "Nov 10, 2026" or "Nov 10"
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const monthRegex = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:[^\d]+(\d{4}))?/i;
    m = cleanStr.match(monthRegex);
    if (m) {
        const mon = months[m[1].toLowerCase().slice(0, 3)];
        const day = parseInt(m[2], 10);
        const yr = m[3] ? parseInt(m[3], 10) : currentYear;
        return new Date(yr, mon, day);
    }

    const d = new Date(cleanStr);
    return isNaN(d.getTime()) ? null : d;
}

// 날짜 객체를 템플릿 형식에 맞추어 포맷
function formatDate(targetDate, templateValue = '') {
    const y = targetDate.getFullYear();
    const m = targetDate.getMonth() + 1;
    const d = targetDate.getDate();
    const appLang = getAppLanguage();

    if (templateValue) {
        if (/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./.test(templateValue)) {
            return `${y}. ${m}. ${d}.`;
        }
        if (/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(templateValue)) {
            return `${y}. ${m}. ${d}`;
        }
        if (/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(templateValue)) {
            return `${y}년 ${m}월 ${d}일`;
        }
        if (/\d{4}年\s*\d{1,2}月\s*\d{1,2}日/.test(templateValue)) {
            return `${y}年${m}月${d}日`;
        }
        if (/\d{1,2}월\s*\d{1,2}일/.test(templateValue)) {
            return `${m}월 ${d}일`;
        }
        if (/\d{1,2}月\s*\d{1,2}日/.test(templateValue)) {
            return `${m}月${d}日`;
        }
        if (/^\d{1,2}\.\s*\d{1,2}\./.test(templateValue)) {
            return `${d}. ${m}. ${y}.`;
        }
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(templateValue)) {
            if (appLang === 'it' || appLang === 'fr') {
                return `${d}/${m}/${y}`;
            }
            return `${m}/${d}/${y}`;
        }
    }

    if (appLang === 'it' || appLang === 'fr') {
        return `${d}/${m}/${y}`;
    }
    if (appLang === 'de') {
        return `${d}. ${m}. ${y}.`;
    }
    return `${y}. ${m}. ${d}.`;
}

// 기존 일정의 기간(일수) 계산
function getDurationDays(match) {
    if (!match.startTime || !match.endTime) return 0;

    if (match.isAllDay) {
        const sStr = match.startTime.includes('T') ? match.startTime.split('T')[0] : match.startTime;
        const eStr = match.endTime.includes('T') ? match.endTime.split('T')[0] : match.endTime;
        const s = new Date(sStr);
        const e = new Date(eStr);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
        const diffMs = e.getTime() - s.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return Math.max(diffDays, 1);
    } else {
        if (!match.startTime.includes('T') || !match.endTime.includes('T')) return 0;
        const sStr = match.startTime.split('T')[0];
        const eStr = match.endTime.split('T')[0];
        if (sStr === eStr) return 0; // 당일 일정
        const s = new Date(sStr);
        const e = new Date(eStr);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
        const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(diffDays, 0);
    }
}

// 시간 input 값 설정 및 확정
async function applyTimeValue(inputEl, timeStr) {
    if (!inputEl || !timeStr) return;

    const currentVal = (inputEl.value || '').trim().replace(/\s+/g, '');
    const targetClean = timeStr.trim().replace(/\s+/g, '');
    if (currentVal === targetClean) {
        console.log(`Time value already matches target: ${timeStr}`);
        return;
    }

    inputEl.focus();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, timeStr);
    } else {
        inputEl.value = timeStr;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // 드롭다운 메뉴 렌더링 대기
    await new Promise(r => setTimeout(r, 100));

    const openMenus = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(m => m.offsetParent !== null && !m.closest('[data-view-family]'));
    let clicked = false;
    for (const menu of openMenus) {
        const options = Array.from(menu.querySelectorAll('[role="option"], [role="menuitem"]'));
        const targetOpt = options.find(opt => {
            const rawText = (opt.innerText || opt.textContent || '').trim();
            // 소요 시간 괄호 (예: "(1시간)", "(30분)", "(1 hour)" 등) 제거
            const cleanOptText = rawText.replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').replace(/\s+/g, '');

            if (cleanOptText === targetClean || cleanOptText.startsWith(targetClean)) return true;
            if (rawText.replace(/\s+/g, '').includes(targetClean)) return true;
            return false;
        });

        if (targetOpt) {
            console.log("Found matching time option:", targetOpt.innerText || targetOpt.textContent);
            triggerClick(targetOpt);
            clicked = true;
            break;
        }
    }

    // 드롭다운 옵션을 찾지 못했더라도 절대 Enter 키를 누르지 않음!
    // (드롭다운에 포커스가 있는 상태에서 Enter를 치면 기존/기본 시간이 덮어써져 시간이 밀리는 원인이 됨)
    if (!clicked) {
        console.log(`No dropdown option matched for "${timeStr}". Ensuring input value directly.`);
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(inputEl, timeStr);
        } else {
            inputEl.value = timeStr;
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    await new Promise(r => setTimeout(r, 60));

    // 드롭다운 닫기 (Escape 키)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    inputEl.blur();
}

// 날짜 input 값 설정 및 확정
async function applyDateValue(inputEl, dateStr) {
    if (!inputEl || !dateStr) return;

    inputEl.focus();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, dateStr);
    } else {
        inputEl.value = dateStr;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));

    await new Promise(r => setTimeout(r, 60));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    inputEl.blur();
}

// 다일 일정(여러 날에 걸친 일정) 날짜 자동완성 및 단일 일정 시 리셋
async function applyEventDates(activeDialog, match) {
    const durationDays = getDurationDays(match);
    console.log("Calculated duration days:", durationDays, "isAllDay:", match.isAllDay, "for event:", match.title);

    let { startInput, endInput } = getDateInputs(activeDialog);

    if (startInput && !endInput) {
        console.log("Only startInput found, attempting to expand date selector...");
        startInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        startInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        startInput.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));

        const recheck = getDateInputs(activeDialog);
        startInput = recheck.startInput;
        endInput = recheck.endInput;
    }

    if (!startInput) {
        console.warn("Could not find start date input in activeDialog");
        return;
    }

    const daysToAdd = match.isAllDay ? Math.max(0, durationDays - 1) : Math.max(0, durationDays);

    // 단일 당일 일정인 경우: 이전에 다일 일정 자동완성으로 인해 endInput이 늘어나 있었다면 startInput과 동일한 날짜로 리셋
    if (daysToAdd === 0) {
        if (endInput && endInput.value && startInput.value && endInput.value !== startInput.value) {
            console.log("Resetting end date to match start date for single-day event:", startInput.value);
            await applyDateValue(endInput, startInput.value);
        }
        return;
    }

    const startDate = parseDateString(startInput.value);
    if (!startDate) {
        console.warn("Could not parse current start date from value:", startInput.value);
        return;
    }

    const targetEndDate = new Date(startDate);
    targetEndDate.setDate(targetEndDate.getDate() + daysToAdd);

    const formattedEndDate = formatDate(targetEndDate, endInput ? endInput.value : startInput.value);
    console.log(`Setting multi-day end date to: ${formattedEndDate} (+${daysToAdd} days from ${startInput.value})`);

    if (endInput) {
        await applyDateValue(endInput, formattedEndDate);
    }
}

// 시간 자동완성 적용
async function applyEventTimes(activeDialog, match) {
    if (!match.startTime && !match.isAllDay) {
        return;
    }

    console.log("Applying event times:", { isAllDay: match.isAllDay, startTime: match.startTime, endTime: match.endTime });

    const allDayCb = getAllDayCheckbox(activeDialog);
    const isCurrentlyAllDay = isCheckboxChecked(allDayCb);

    if (match.isAllDay) {
        if (allDayCb && !isCurrentlyAllDay) {
            console.log("Checking all-day checkbox");
            allDayCb.click();
            await new Promise(r => setTimeout(r, 200));
        }
        return;
    }

    if (allDayCb && isCurrentlyAllDay) {
        console.log("Unchecking all-day checkbox");
        allDayCb.click();
        await new Promise(r => setTimeout(r, 200));
    }

    let { startInput, endInput } = getTimeInputs(activeDialog);
    if (!startInput) {
        const addTimeBtn = getAddTimeButton(activeDialog);
        if (addTimeBtn) {
            console.log("Clicking Add Time button:", addTimeBtn);
            addTimeBtn.click();
            await new Promise(r => setTimeout(r, 200));
            const recheck = getTimeInputs(activeDialog);
            startInput = recheck.startInput;
            endInput = recheck.endInput;
        }
    }

    const startObj = extractTime(match.startTime);
    const endObj = extractTime(match.endTime);

    // 1. 시작 시간 적용
    if (startInput && startObj) {
        const startFormatted = formatTime(startObj.hours, startObj.minutes, startInput.value);
        console.log("Setting start time to:", startFormatted);
        await applyTimeValue(startInput, startFormatted);
        // 구글 캘린더가 시작 시간 변경에 반응하여 종료 시간을 자동 계산할 시간을 줌
        await new Promise(r => setTimeout(r, 150));
    }

    // 2. 종료 시간 적용
    const updatedInputs = getTimeInputs(activeDialog);
    const finalEndInput = updatedInputs.endInput || endInput;
    if (finalEndInput && endObj) {
        const endFormatted = formatTime(endObj.hours, endObj.minutes, finalEndInput.value);
        const currentEndVal = (finalEndInput.value || '').trim().replace(/\s+/g, '');
        const targetEndVal = endFormatted.trim().replace(/\s+/g, '');

        if (currentEndVal === targetEndVal) {
            console.log(`End time already matches target (${endFormatted}) via Google Calendar auto-shift.`);
        } else {
            console.log("Setting end time to:", endFormatted);
            await applyTimeValue(finalEndInput, endFormatted);
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

// 위치(Location) 자동완성 (빈 값 전달 시 기존 입력값 초기화)
async function applyLocation(scope, locationText) {
    let locInput = scope.querySelector('input[aria-label*="위치"], input[aria-label*="Location" i], input[aria-label*="場所"], input[aria-label*="位置"], input[aria-label*="Luogo" i], input[aria-label*="Ort" i], input[aria-label*="Lieu" i], input[placeholder*="위치"], input[placeholder*="Location" i], input[placeholder*="場所"], input[placeholder*="位置"], input[placeholder*="Luogo" i], input[placeholder*="Ort" i], input[placeholder*="Lieu" i]');

    // 1. 위치가 없는 일정이면 기존 입력창 내용 비우기
    if (!locationText || !locationText.trim()) {
        if (locInput && locInput.value) {
            console.log("Clearing existing location input...");
            setVal(locInput, '');
        }
        return;
    }

    if (locInput && locInput.value.trim() === locationText.trim()) {
        console.log("Location already matches target:", locationText);
        return;
    }

    if (!locInput) {
        const btns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
        const locBtn = btns.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.innerText || b.textContent || '').trim().toLowerCase();
            return label.includes('위치') || label.includes('location') || label.includes('場所') || label.includes('位置') || label.includes('luogo') || label.includes('ort') || label.includes('lieu') ||
                text.includes('위치') || text.includes('location') || text.includes('場所') || text.includes('位置') || text.includes('luogo') || text.includes('ort') || text.includes('lieu');
        });

        if (locBtn) {
            locBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            locInput = scope.querySelector('input[aria-label*="위치"], input[aria-label*="Location" i], input[aria-label*="場所"], input[aria-label*="位置"], input[aria-label*="Luogo" i], input[aria-label*="Ort" i], input[aria-label*="Lieu" i], input[placeholder*="위치"], input[placeholder*="Location" i], input[placeholder*="場所"], input[placeholder*="位置"], input[placeholder*="Luogo" i], input[placeholder*="Ort" i], input[placeholder*="Lieu" i]');
        }
    }

    if (locInput) {
        console.log("Setting location to:", locationText);
        setVal(locInput, locationText);
    }
}

// 마우스/포인터 클릭 트리거 헬퍼 (구글 캘린더 커스텀 UI 버튼 완전 지원)
function triggerClick(el) {
    if (!el) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
        el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
    });
    if (typeof el.click === 'function') {
        try { el.click(); } catch (e) { }
    }
}

// 설명 에디터(contenteditable 또는 textarea) 탐색
function findDescriptionEditable(scope) {
    const searchScopes = [scope, document].filter(Boolean);
    for (const root of searchScopes) {
        // 1. contenteditable 태그 우선 탐색
        const editables = Array.from(root.querySelectorAll('[contenteditable="true"]'));
        for (const el of editables) {
            if (el.tagName === 'INPUT') continue;
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (el.getAttribute('data-placeholder') || '').toLowerCase();
            // 제목, 위치, 참석자 인풋 제외
            if (aria.includes('제목') || aria.includes('title') || aria.includes('タイトル') || aria.includes('标题') || aria.includes('titolo') || aria.includes('titel') || aria.includes('titre') ||
                aria.includes('위치') || aria.includes('location') || aria.includes('場所') || aria.includes('位置') || aria.includes('luogo') || aria.includes('ort') || aria.includes('lieu')) continue;
            if (aria.includes('설명') || aria.includes('description') || aria.includes('説明') || aria.includes('说明') || aria.includes('descrizione') || aria.includes('beschreibung') ||
                aria.includes('첨부') || aria.includes('attachment') || aria.includes('添付') || aria.includes('附件') || aria.includes('allegati') || aria.includes('anhäng') || aria.includes('joint') ||
                placeholder.includes('설명') || placeholder.includes('description') || placeholder.includes('説明') || placeholder.includes('说明') || placeholder.includes('descrizione') || placeholder.includes('beschreibung') ||
                el.getAttribute('role') === 'textbox') {
                return el;
            }
        }

        // 2. 모달 내부에 존재하는 contenteditable div (구글 캘린더 빠른 추가 모달은 설명만 contenteditable div임)
        const modalEdit = root.querySelector('[role="dialog"] div[contenteditable="true"], [data-is-view="true"] div[contenteditable="true"]');
        if (modalEdit) return modalEdit;

        // 3. textarea로 구현된 경우 탐색
        const textareas = Array.from(root.querySelectorAll('textarea'));
        for (const ta of textareas) {
            const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
            if (aria.includes('설명') || aria.includes('description') || aria.includes('説明') || aria.includes('说明') || aria.includes('descrizione') || aria.includes('beschreibung') ||
                placeholder.includes('설명') || placeholder.includes('description') || placeholder.includes('説明') || placeholder.includes('说明') || placeholder.includes('descrizione') || placeholder.includes('beschreibung')) {
                return ta;
            }
        }
    }
    return null;
}

// "설명 추가" / "설명 또는 첨부파일 추가" 버튼 탐색
function findDescriptionButton(scope) {
    const searchScopes = [scope, document].filter(Boolean);
    for (const root of searchScopes) {
        const btns = Array.from(root.querySelectorAll('button, div[role="button"], span[role="button"], div[tabindex="0"]'));
        for (const b of btns) {
            // 이미 열려있는 에디터는 제외
            if (b.getAttribute('contenteditable') === 'true' || b.getAttribute('role') === 'textbox') continue;

            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.innerText || b.textContent || '').trim().toLowerCase();

            // 한국어, 영어, 일본어, 중국어, 이탈리아어, 독일어, 프랑스어 지원
            if (label.includes('설명') || label.includes('description') || label.includes('説明') || label.includes('说明') || label.includes('descrizione') || label.includes('beschreibung') ||
                text.includes('설명') || text.includes('description') || text.includes('説明') || text.includes('说明') || text.includes('descrizione') || text.includes('beschreibung') ||
                (text.includes('첨부파일') && !text.includes('google')) ||
                (text.includes('attachment') && !text.includes('google')) ||
                (text.includes('allegati') && !text.includes('google')) ||
                (text.includes('anhäng') && !text.includes('google')) ||
                (text.includes('joint') && !text.includes('google')) ||
                text.includes('添付') || text.includes('附件')) {
                return b;
            }
        }
    }
    return null;
}

// 설명(Description) 자동완성 (빈 값 전달 시 기존 입력 내용 초기화)
async function applyDescription(scope, descText) {
    let editField = findDescriptionEditable(scope);

    // 1. 설명이 없는 일정이면 기존 에디터 내용 비우기
    if (!descText || !descText.trim()) {
        if (editField) {
            const currentVal = (editField.tagName === 'TEXTAREA' || editField.tagName === 'INPUT') ? editField.value : editField.innerText;
            if (currentVal && currentVal.trim()) {
                console.log("Clearing existing description field...");
                if (editField.tagName === 'TEXTAREA' || editField.tagName === 'INPUT') {
                    setVal(editField, '');
                } else {
                    editField.focus();
                    try {
                        let sel = window.getSelection();
                        if (sel) {
                            sel.removeAllRanges();
                            const range = document.createRange();
                            range.selectNodeContents(editField);
                            range.deleteContents();
                            sel.addRange(range);
                        }
                    } catch (e) { }
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                    } catch (e) { }
                    editField.innerHTML = '';
                    editField.textContent = '';
                    editField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    editField.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    editField.blur();
                    try {
                        if (window.getSelection()) window.getSelection().removeAllRanges();
                    } catch (e) { }
                }
            }
        }
        return;
    }

    // 2. 이미 동일한 내용이 들어있다면 중복 입력 스킵
    if (editField) {
        const currentVal = (editField.tagName === 'TEXTAREA' || editField.tagName === 'INPUT') ? editField.value : editField.innerText;
        if (currentVal && currentVal.trim() === descText.trim()) {
            console.log("Description already matches target text.");
            return;
        }
    }

    console.log("Applying description text:", descText.slice(0, 50));

    if (!editField) {
        const descBtn = findDescriptionButton(scope);
        if (descBtn) {
            console.log("Clicking Add Description button to expand editor:", descBtn);
            triggerClick(descBtn);

            // 에디터가 마운트될 때까지 최대 1.5초간 폴링 (100ms * 15)
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 100));
                editField = findDescriptionEditable(scope);
                if (editField) {
                    console.log(`Description editor mounted after ${(i + 1) * 100}ms`);
                    break;
                }
            }
        } else {
            console.warn("Could not find Add Description button");
        }
    }

    if (editField) {
        console.log("Target description field found:", editField);

        // 1. textarea인 경우
        if (editField.tagName === 'TEXTAREA' || editField.tagName === 'INPUT') {
            setVal(editField, descText);
            return;
        }

        // 2. contenteditable div인 경우
        editField.focus();
        await new Promise(r => setTimeout(r, 60));

        // editField 내부만 타겟으로 Range 설정 및 기존 내용 비우기 (전체 화면 선택 번쩍임 현상 완전 제거)
        let sel = window.getSelection();
        try {
            if (sel) {
                sel.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(editField);
                range.deleteContents(); // editField 내부만 깔끔하게 비움
                range.collapse(false);  // 커서를 editField 내부 끝으로
                sel.addRange(range);
            }
        } catch (e) {
            console.warn("Failed to set selection range:", e);
        }

        // execCommand로 텍스트 삽입 (리액트가 가장 잘 인식하는 방식)
        let inserted = false;
        try {
            inserted = document.execCommand('insertText', false, descText);
        } catch (e) {
            console.warn("execCommand error:", e);
        }

        // execCommand 실패 시 DOM 직접 주입 및 InputEvent 디스패치
        if (!inserted || (editField.innerText || '').trim() !== descText.trim()) {
            console.log("Using fallback DOM insertion for description");
            editField.textContent = descText;
            try {
                editField.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: descText
                }));
            } catch (e) { }
        }

        // 변경 이벤트 디스패치
        editField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editField.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        editField.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Process' }));

        // 선택 영역 정리 (파란색 하이라이트 잔여물 완전 제거)
        try {
            if (window.getSelection()) {
                window.getSelection().removeAllRanges();
            }
        } catch (e) { }

        await new Promise(r => setTimeout(r, 60));
        editField.blur();
        console.log("Description successfully applied!");
    } else {
        console.error("Could not find description editable field after button click");
    }
}

// 기존 참석자 제거 (이전 자동완성 항목 정리)
async function clearAttendees(scope) {
    const searchScope = scope || document;
    const removeBtns = Array.from(searchScope.querySelectorAll('button, div[role="button"], span[role="button"]')).filter(btn => {
        // 비표시 요소 제외
        if (btn.offsetParent === null && !btn.getClientRects().length) return false;

        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (!label) return false;

        // 이벤트/일정/알림/첨부파일 삭제 버튼은 절대 클릭 금지
        if (label.includes('이벤트') || label.includes('일정') || label.includes('event') ||
            label.includes('알림') || label.includes('notification') || label.includes('notifica') ||
            label.includes('첨부') || label.includes('attachment') || label.includes('allegat') ||
            label.includes('anhang') || label.includes('termin')) {
            return false;
        }

        const isRemoveAction = label.includes('삭제') || label.includes('remove') ||
            label.includes('削除') || label.includes('移除') || label.includes('rimuovi') ||
            label.includes('entfernen') || label.includes('supprimer');
        if (!isRemoveAction) return false;

        // 참석자 관련 버튼인지 식별 (라벨에 참석자 키워드, 이메일 주소(@) 포함, 또는 칩/목록 내 버튼)
        const isGuestRelated = label.includes('참석자') || label.includes('guest') ||
            label.includes('invit') || label.includes('gast') || label.includes('@') ||
            Boolean(btn.closest('[data-email], [data-hovercard-id], [data-chip-index], [role="listitem"]'));

        return isGuestRelated;
    });

    if (removeBtns.length > 0) {
        console.log(`Clearing ${removeBtns.length} existing attendee(s)...`);
        for (const btn of removeBtns) {
            triggerClick(btn);
            await new Promise(r => setTimeout(r, 60));
        }
        await new Promise(r => setTimeout(r, 100));
    }
}

// 참석자(Attendees) 자동완성 (이전 참석자 초기화 후 새 목록 적용)
async function applyAttendees(scope, attendees) {
    // 1. 기존 참석자 초기화 (이전 자동완성 잔여물 제거)
    await clearAttendees(scope);

    if (!Array.isArray(attendees) || attendees.length === 0) {
        console.log("No attendees to apply.");
        return;
    }

    let guestInput = scope.querySelector('input[placeholder*="참석자"], input[placeholder*="guests" i], input[placeholder*="ゲスト"], input[placeholder*="参与"], input[placeholder*="invitati" i], input[placeholder*="partecipanti" i], input[placeholder*="gäste" i], input[placeholder*="gaste" i], input[placeholder*="invités" i], input[placeholder*="invites" i], input[aria-label*="참석자"], input[aria-label*="guests" i], input[aria-label*="ゲスト"], input[aria-label*="参与"], input[aria-label*="invitati" i], input[aria-label*="partecipanti" i], input[aria-label*="gäste" i], input[aria-label*="gaste" i], input[aria-label*="invités" i], input[aria-label*="invites" i]');

    if (!guestInput) {
        const guestBtns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
        const guestBtn = guestBtns.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.innerText || b.textContent || '').trim().toLowerCase();
            return label.includes('참석자') || label.includes('guests') || label.includes('ゲスト') || label.includes('参与') || label.includes('invitati') || label.includes('partecipanti') || label.includes('gäste') || label.includes('gaste') || label.includes('invités') || label.includes('invites') ||
                text.includes('참석자') || text.includes('guests') || text.includes('ゲスト') || text.includes('参与') || text.includes('invitati') || text.includes('partecipanti') || text.includes('gäste') || text.includes('gaste') || text.includes('invités') || text.includes('invites');
        });

        if (guestBtn) {
            console.log("Clicking Add Guests button to expand guest input...");
            guestBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            guestBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            guestBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));

            guestInput = scope.querySelector('input[placeholder*="참석자"], input[placeholder*="guests" i], input[placeholder*="ゲスト"], input[placeholder*="参与"], input[placeholder*="invitati" i], input[placeholder*="partecipanti" i], input[placeholder*="gäste" i], input[placeholder*="gaste" i], input[placeholder*="invités" i], input[placeholder*="invites" i], input[aria-label*="참석자"], input[aria-label*="guests" i], input[aria-label*="ゲスト"], input[aria-label*="参与"], input[aria-label*="invitati" i], input[aria-label*="partecipanti" i], input[aria-label*="gäste" i], input[aria-label*="gaste" i], input[aria-label*="invités" i], input[aria-label*="invites" i]');
        }
    }

    if (guestInput) {
        console.log("Applying attendees:", attendees);
        for (const email of attendees) {
            guestInput.focus();

            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(guestInput, email);
            } else {
                guestInput.value = email;
            }

            guestInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            guestInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

            await new Promise(r => setTimeout(r, 100));

            guestInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            guestInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            guestInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));

            await new Promise(r => setTimeout(r, 150));
        }
        guestInput.blur();
    } else {
        console.warn("Could not find guest input in dialog");
    }
}

// 캘린더 드롭다운 선택
async function setCalendarSelection(activeDialog, calendarSummary) {
    if (!calendarSummary) return;

    const cleanTarget = calendarSummary.trim();
    if (!cleanTarget) return;

    let targetBtn = activeDialog.querySelector('[aria-label*="캘린더"][aria-haspopup="listbox"], [aria-label*="Calendar" i][aria-haspopup="listbox"], [aria-label*="カレンダー"][aria-haspopup="listbox"], [aria-label*="日历"][aria-haspopup="listbox"], [aria-label*="Calendario" i][aria-haspopup="listbox"], [aria-label*="Kalender" i][aria-haspopup="listbox"], [aria-label*="Agenda" i][aria-haspopup="listbox"], [data-is-calendar-selector="true"]');

    if (!targetBtn) {
        const allLists = Array.from(activeDialog.querySelectorAll('[aria-haspopup="listbox"], [role="combobox"]'));
        // 1순위: aria-label에 캘린더 관련 키워드가 명시된 요소 탐색
        targetBtn = allLists.find(btn => {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            return label.includes('캘린더') || label.includes('calendar') || label.includes('カレンダー') || label.includes('日历') || label.includes('calendario') || label.includes('kalender') || label.includes('agenda');
        });

        // 2순위: data-tooltip에 캘린더 키워드가 있는 버튼 탐색
        if (!targetBtn) {
            const anyCalendarTipped = activeDialog.querySelector('[data-tooltip*="캘린더"], [data-tooltip*="Calendar" i], [data-tooltip*="カレンダー"], [data-tooltip*="日历"], [data-tooltip*="Calendario" i], [data-tooltip*="Kalender" i], [data-tooltip*="Agenda" i]');
            if (anyCalendarTipped) {
                targetBtn = anyCalendarTipped.closest('[role="button"]') || anyCalendarTipped;
            }
        }

        // 3순위: SVG 아이콘과 텍스트를 가진 listbox 폴백
        if (!targetBtn) {
            targetBtn = allLists.find(btn => {
                const iconSvg = btn.querySelector('svg');
                return Boolean(iconSvg && btn.textContent);
            });
        }
    }

    if (targetBtn) {
        const selectedOpt = targetBtn.querySelector('[role="option"][aria-selected="true"]');
        const currentSelectedText = selectedOpt
            ? (selectedOpt.innerText || selectedOpt.textContent || '').trim()
            : (!targetBtn.querySelector('[role="option"]') && targetBtn.innerText && !targetBtn.innerText.trim().includes('\n') ? targetBtn.innerText.trim() : '');

        if (currentSelectedText && currentSelectedText.includes(cleanTarget)) {
            console.log("Already selected desired calendar:", cleanTarget);
        } else {
            console.log("Found calendar dropdown:", targetBtn);
            targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

            await new Promise(r => setTimeout(r, 200));

            const openMenus = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(m => m.offsetParent !== null && !m.closest('[data-view-family]'));

            let listItems = [];
            openMenus.forEach(menu => {
                listItems = listItems.concat(Array.from(menu.querySelectorAll('[role="menuitem"], [role="option"]')));
            });

            const findMatchingOption = (items) => {
                return items.find(li => {
                    const t = (li.innerText || li.textContent || '').trim();
                    return t === cleanTarget;
                }) || items.find(li => {
                    const t = (li.innerText || li.textContent || '');
                    return t.includes(cleanTarget);
                });
            };

            let optionToClick = findMatchingOption(listItems);

            if (!optionToClick) {
                listItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).filter(el => !el.closest('[aria-label="내 캘린더"], [aria-label="My calendars"], #drawer'));
                optionToClick = findMatchingOption(listItems);
            }

            if (optionToClick) {
                console.log("Clicking calendar option:", optionToClick);
                const clickTarget = optionToClick.querySelector('div, span') || optionToClick;

                ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                    clickTarget.dispatchEvent(new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });
            } else {
                console.log("Could not find calendar option for:", cleanTarget);
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }
        }
    }
}

// 캘린더 및 시간/날짜 자동완성 메인 함수
async function setCalendarAndTimes(match) {
    const activeDialog = getActiveDialog();

    // 1. 캘린더 선택
    if (match.calendarSummary) {
        await setCalendarSelection(activeDialog, match.calendarSummary);
        await new Promise(r => setTimeout(r, 150));
    }

    // 2. 시간 및 다일 일정 날짜 자동완성
    try {
        await applyEventTimes(activeDialog, match);
        await new Promise(r => setTimeout(r, 100));
        await applyEventDates(activeDialog, match);
    } catch (e) {
        console.error("Error applying event times and dates:", e);
    }
}

// 일정 저장 감지 및 강제 새로고침 실행
let saveRefreshTimer = null;
let lastSaveTime = 0;

function handleEventSaved() {
    const now = Date.now();
    if (now - lastSaveTime < 1000) return; // 1초 내 중복 방지
    lastSaveTime = now;

    // 1. 낙관적 업데이트 (Optimistic Update)
    const inputs = getInputs();
    const newTitle = inputs.title ? getVal(inputs.title) : "";
    if (newTitle && newTitle.trim() !== "") {
        const activeDialog = getActiveDialog();
        const { startInput, endInput } = getTimeInputs(activeDialog);
        const allDayCb = getAllDayCheckbox(activeDialog);
        const isAllDay = isCheckboxChecked(allDayCb);

        const newItem = {
            title: newTitle.trim(),
            location: inputs.location ? getVal(inputs.location).trim() : "",
            description: inputs.desc ? getVal(inputs.desc).trim() : "",
            attendees: [],
            calendarSummary: "",
            calendarId: "",
            startTime: startInput ? (startInput.value || "") : "",
            endTime: endInput ? (endInput.value || "") : "",
            isAllDay: isAllDay
        };

        // 메모리에 즉시 반영
        historyData.items.unshift(newItem);

        // chrome.storage에도 즉시 반영
        try {
            chrome.storage.local.get(['cachedEvents'], (result) => {
                const current = result.cachedEvents || [];
                const key = `${newItem.title}|${newItem.location}`;
                const filtered = current.filter(item => `${item.title}|${item.location}` !== key);
                chrome.storage.local.set({ cachedEvents: [newItem, ...filtered] });
            });
        } catch (e) { }
    }

    // 2. 구글 서버에 저장된 후 "일정 강제 새로고침" 실행
    if (saveRefreshTimer) clearTimeout(saveRefreshTimer);
    saveRefreshTimer = setTimeout(() => {
        if (!chrome.runtime?.id) return;
        try {
            console.log("Triggering forceRefresh after event save...");
            chrome.runtime.sendMessage({ action: 'forceRefresh' }, (res) => {
                if (chrome.runtime.lastError) {
                    console.warn("forceRefresh message error:", chrome.runtime.lastError.message);
                } else {
                    console.log("forceRefresh successfully completed after save:", res?.success);
                }
            });
        } catch (e) { }
    }, 1500);
}

// DOM 감지 및 이벤트 부착 (초당 최대 60프레임 쓰로틀링 & 모달 스코프 제한으로 렉 완전 방지)
let observerAnimationFrame = null;

function scanAndAttachListeners() {
    const activeDialog = getActiveDialog();
    const inputs = getInputs();

    if (inputs.title && !inputs.title.dataset.acType) attachAutocomplete(inputs.title, 'titles');
    if (inputs.location && !inputs.location.dataset.acType) attachAutocomplete(inputs.location, 'locations');
    if (inputs.desc && !inputs.desc.dataset.acType) attachAutocomplete(inputs.desc, 'descriptions');

    const searchScope = (activeDialog && activeDialog !== document) ? activeDialog : document.querySelector('[role="dialog"], [data-is-view="true"]');
    if (searchScope) {
        const buttons = searchScope.querySelectorAll('button, div[role="button"], span[role="button"]');
        buttons.forEach(btn => {
            if (btn.dataset.saveListener) return;

            const lLower = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            const tLower = (btn.textContent || '').trim().toLowerCase();
            const isSaveBtn = lLower === '저장' || lLower === 'save' || lLower === '保存' || lLower === 'salva' || lLower === 'speichern' || lLower === 'enregistrer' ||
                tLower === '저장' || tLower === 'save' || tLower === '保存' || tLower === 'salva' || tLower === 'speichern' || tLower === 'enregistrer';

            if (isSaveBtn) {
                btn.dataset.saveListener = "true";

                btn.addEventListener('mousedown', () => {
                    handleEventSaved();
                }, { capture: true });

                btn.addEventListener('click', () => {
                    handleEventSaved();
                }, { capture: true });
            }
        });
    }
}

// MutationObserver: requestAnimationFrame을 적용하여 DOM 변경이 폭주해도 1프레임당 최대 1회만 가볍게 실행
const observer = new MutationObserver(() => {
    if (observerAnimationFrame) return;
    observerAnimationFrame = requestAnimationFrame(() => {
        observerAnimationFrame = null;
        scanAndAttachListeners();
    });
});

observer.observe(document.body, { childList: true, subtree: true });

// 단축키 (Ctrl+S / Cmd+S)로 일정 저장 시 감지
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        handleEventSaved();
    }
}, { capture: true });

// 창 크기 변경 및 스크롤 시 자동완성 드롭다운 닫기
window.addEventListener('scroll', closeSuggestions, true);
window.addEventListener('resize', closeSuggestions, true);

function attachAutocomplete(element, type) {
    element.dataset.acType = type;
    element.setAttribute('autocomplete', 'off');

    const eventType = (element.tagName === 'DIV') ? 'input' : 'input';
    let selectedIndex = -1;

    element.addEventListener('focus', () => {
        loadCalendarEvents();
    });

    element.addEventListener(eventType, (e) => {
        if (e.isTrusted) {
            if (historyData.items.length === 0) {
                loadCalendarEvents();
            }

            const val = getVal(element);

            if (!val || val.trim() === "") {
                closeSuggestions();
                return;
            }

            let matches = [];
            const keyword = val.trim().toLowerCase();

            if (type === 'titles') {
                matches = historyData.items.filter(item => item.title && item.title.toLowerCase().includes(keyword));
            } else {
                const rawList = historyData.items.map(item => type === 'locations' ? item.location : item.description);
                const filtered = rawList.filter(text => text && text.toLowerCase().includes(keyword));
                matches = [...new Set(filtered)];
            }

            if (matches.length > 0) {
                showSuggestions(matches, element, type);
                selectedIndex = -1;
            } else {
                closeSuggestions();
            }
        }
    });

    element.addEventListener('blur', () => {
        setTimeout(closeSuggestions, 200);
    });

    element.addEventListener('keydown', (e) => {
        // 한글/동아시아 언어 조합 중(IME) Enter 입력 시 조기 저장 방지
        if (e.isComposing || e.keyCode === 229) return;

        const box = document.getElementById('gcal-history-suggestions');

        if (!box || box.style.display === 'none') {
            if (e.key === 'Enter' && element.tagName === 'INPUT') {
                closeSuggestions();
                handleEventSaved();
            }
            return;
        }

        const items = box.querySelectorAll('.suggestion-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex++;
            if (selectedIndex >= items.length) selectedIndex = 0;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex--;
            if (selectedIndex < 0) selectedIndex = items.length - 1;
            highlightItem(items, selectedIndex);
        } else if (e.key === 'Enter') {
            if (selectedIndex > -1) {
                e.preventDefault();
                e.stopPropagation();
                items[selectedIndex].click();
            } else {
                closeSuggestions();
                if (element.tagName === 'INPUT') {
                    handleEventSaved();
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSuggestions();
        }
    });
}

function highlightItem(items, index) {
    items.forEach((item, i) => {
        const isSelected = (i === index);
        item.style.backgroundColor = isSelected ? '#e8eaed' : '';
        if (isSelected) {
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

function getVal(el) {
    if (el.tagName === 'INPUT') return el.value;
    return el.innerText;
}

function setVal(el, text) {
    if (!el) return;

    el.focus();

    if (el.tagName === 'INPUT') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, text);
        } else {
            el.value = text;
        }

        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', bubbles: true }));

        try {
            el.selectionStart = el.value.length;
            el.selectionEnd = el.value.length;
        } catch (e) { }

    } else {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
}

function showSuggestions(matches, inputElement, type) {
    suggestionBox.innerHTML = '';
    const rect = inputElement.getBoundingClientRect();
    const boxWidth = Math.max(rect.width, 390);
    const maxLeft = Math.max(10, window.innerWidth - boxWidth - 10);
    const leftPos = Math.max(10, Math.min(rect.left, maxLeft));

    suggestionBox.style.left = leftPos + 'px';
    suggestionBox.style.top = (rect.bottom + window.scrollY) + 'px';
    suggestionBox.style.width = boxWidth + 'px';
    suggestionBox.style.display = 'block';

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g,
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    const limitMatches = matches.slice(0, 20);

    limitMatches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';

        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.padding = '10px 12px';
        div.style.cursor = 'pointer';
        div.style.borderBottom = '1px solid #f1f3f4';
        div.style.fontSize = '14px';

        const textSpan = document.createElement('span');
        textSpan.style.flex = '1';
        textSpan.style.overflow = 'hidden';
        textSpan.style.textOverflow = 'ellipsis';
        textSpan.style.whiteSpace = 'nowrap';

        const appLang = getAppLanguage();

        let displayText = '';
        if (type === 'titles') {
            displayText = `<strong>${escapeHTML(match.title)}</strong>`;
            if (match.location) {
                displayText += ` <span style="color:#70757a; font-size:0.9em;">📍 ${escapeHTML(match.location)}</span>`;
            }
            if (match.isAllDay) {
                const duration = getDurationDays(match);
                let durLabel = `${duration} days (All day)`;
                let allDayLabel = 'All day';
                if (appLang === 'ko') {
                    durLabel = `${duration}일간 (종일)`;
                    allDayLabel = '종일';
                } else if (appLang === 'ja') {
                    durLabel = `${duration}日間 (終日)`;
                    allDayLabel = '終日';
                } else if (appLang === 'zh') {
                    durLabel = `${duration}天 (全天)`;
                    allDayLabel = '全天';
                } else if (appLang === 'it') {
                    durLabel = duration === 1 ? '1 giorno (Tutto il giorno)' : `${duration} giorni (Tutto il giorno)`;
                    allDayLabel = 'Tutto il giorno';
                } else if (appLang === 'de') {
                    durLabel = duration === 1 ? '1 Tag (Ganztägig)' : `${duration} Tage (Ganztägig)`;
                    allDayLabel = 'Ganztägig';
                } else if (appLang === 'fr') {
                    durLabel = duration === 1 ? '1 jour (Toute la journée)' : `${duration} jours (Toute la journée)`;
                    allDayLabel = 'Toute la journée';
                }

                if (duration > 1) {
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">📅 ${durLabel}</span>`;
                } else {
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">📅 ${allDayLabel}</span>`;
                }
            } else if (match.startTime) {
                const duration = getDurationDays(match);
                const sObj = extractTime(match.startTime);
                const eObj = extractTime(match.endTime);
                if (sObj) {
                    const sStr = formatTime(sObj.hours, sObj.minutes);
                    const eStr = eObj ? ` ~ ${formatTime(eObj.hours, eObj.minutes)}` : '';
                    let durLabel = '';
                    if (duration > 0) {
                        if (appLang === 'ko') durLabel = ` (${duration + 1}일간)`;
                        else if (appLang === 'ja') durLabel = ` (${duration + 1}日間)`;
                        else if (appLang === 'zh') durLabel = ` (${duration + 1}天)`;
                        else if (appLang === 'it') durLabel = ` (${duration + 1} giorni)`;
                        else if (appLang === 'de') durLabel = ` (${duration + 1} Tage)`;
                        else if (appLang === 'fr') durLabel = ` (${duration + 1} jours)`;
                        else durLabel = ` (${duration + 1} days)`;
                    }
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">⏰ ${sStr}${eStr}${durLabel}</span>`;
                }
            }
            if (Array.isArray(match.attendees) && match.attendees.length > 0) {
                let guestLabel = `${match.attendees.length} ${match.attendees.length === 1 ? 'guest' : 'guests'}`;
                if (appLang === 'ko') guestLabel = `${match.attendees.length}명`;
                else if (appLang === 'ja') guestLabel = `${match.attendees.length}名`;
                else if (appLang === 'zh') guestLabel = `${match.attendees.length}人`;
                else if (appLang === 'it') guestLabel = match.attendees.length === 1 ? '1 invitato' : `${match.attendees.length} invitati`;
                else if (appLang === 'de') guestLabel = match.attendees.length === 1 ? '1 Gast' : `${match.attendees.length} Gäste`;
                else if (appLang === 'fr') guestLabel = match.attendees.length === 1 ? '1 invité' : `${match.attendees.length} invités`;
                displayText += ` <span style="color:#5f6368; font-size:0.85em; margin-left:4px;">👥 ${guestLabel}</span>`;
            }
            if (match.description) {
                let descLabel = 'Description';
                if (appLang === 'ko') descLabel = '설명';
                else if (appLang === 'ja') descLabel = '説明';
                else if (appLang === 'zh') descLabel = '说明';
                else if (appLang === 'it') descLabel = 'Descrizione';
                else if (appLang === 'de') descLabel = 'Beschreibung';
                else if (appLang === 'fr') descLabel = 'Description';
                displayText += ` <span style="color:#5f6368; font-size:0.85em; margin-left:4px;" title="${escapeHTML(match.description.slice(0, 150))}">📝 ${descLabel}</span>`;
            }
        } else {
            const icon = type === 'locations' ? '📍 ' : '📝 ';
            displayText = icon + escapeHTML(match);
        }

        textSpan.innerHTML = displayText;
        div.appendChild(textSpan);

        div.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            console.log("Selected match for autocomplete:", match);

            if (type === 'titles') {
                const activeDialog = getActiveDialog();

                // 1. 위치 자동완성 (설정 켜진 경우: 값이 있으면 입력, 없으면 이전 값 초기화)
                if (userSettings.autoCompleteLocation) {
                    await applyLocation(activeDialog, match.location || '');
                }

                // 2. 설명 자동완성 (설정 켜진 경우: 값이 있으면 입력, 없으면 이전 값 초기화)
                if (userSettings.autoCompleteDescription) {
                    await applyDescription(activeDialog, match.description || '');
                }

                // 3. 참석자 자동완성 (설정 켜진 경우: 이전 목록 정리 후 새 참석자 목록 반영)
                if (userSettings.autoCompleteAttendees) {
                    await applyAttendees(activeDialog, match.attendees || []);
                }

                // 4. 기간/시간 및 캘린더 자동완성
                if (userSettings.autoCompleteTime) {
                    await setCalendarAndTimes(match);
                } else if (match.calendarSummary) {
                    await setCalendarSelection(activeDialog, match.calendarSummary);
                }

                // 5. 제목 확정 및 포커스
                setVal(inputElement, match.title);
                inputElement.focus();

            } else {
                setVal(inputElement, match);
                inputElement.focus();
            }

            closeSuggestions();
        });

        suggestionBox.appendChild(div);
    });
}

function closeSuggestions() {
    suggestionBox.style.display = 'none';
}
