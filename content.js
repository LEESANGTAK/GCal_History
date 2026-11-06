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

// 현재 활성화된 모달 다이얼로그 또는 뷰 탐색 (가장 최근 열린 모달 우선)
function getActiveDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-is-view="true"]'));
    return dialogs.find(d => d.querySelector('input[aria-label="제목 추가"], input[aria-label="Add title"], input[aria-label="제목 및 시간 추가"]')) || document;
}

// 입력창 찾기 헬퍼 함수 (모달 범위 우선 탐색으로 성능 최적화)
function getInputs() {
    const scope = getActiveDialog() || document;
    return {
        title: scope.querySelector('input[aria-label="제목 추가"], input[aria-label="Add title"], input[aria-label="제목 및 시간 추가"]'),
        location: scope.querySelector('input[aria-label="위치 추가"], input[aria-label="Add location"]'),
        desc: scope.querySelector('div[aria-label="설명 추가"], div[aria-label="Add description"]')
    };
}

// 시간 추출 헬퍼 (ISO 문자열 -> 로컬 시/분)
function extractTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes('T')) return null;
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) return null;
    return {
        hours: date.getHours(),
        minutes: date.getMinutes()
    };
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

    // 2. 기존 값에 AM/PM이 포함된 경우 (영어 12시간제)
    if (templateValue && /[ap]m/i.test(templateValue)) {
        const isUpper = /[AP]M/.test(templateValue);
        const period = hours < 12 ? (isUpper ? 'AM' : 'am') : (isUpper ? 'PM' : 'pm');
        let h = hours % 12;
        if (h === 0) h = 12;
        const space = templateValue.includes(' ') ? ' ' : '';
        return `${h}:${minStr}${space}${period}`;
    }

    // 3. 기존 값에 24시간제(콜론만 있음) 형식이 쓰인 경우
    if (templateValue && /\b[0-2]?[0-9]:[0-5][0-9]\b/.test(templateValue)) {
        return `${String(hours).padStart(2, '0')}:${minStr}`;
    }

    // 4. 기본 포맷팅 (로케일 및 페이지 언어 감지)
    const isKorean = (navigator.language && navigator.language.startsWith('ko')) ||
        !!document.querySelector('[aria-label*="시작 시간"], [aria-label*="저장"], [aria-label*="제목 추가"]');

    if (isKorean) {
        const period = hours < 12 ? '오전' : '오후';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${period} ${h}:${minStr}`;
    } else {
        const period = hours < 12 ? 'AM' : 'PM';
        let h = hours % 12;
        if (h === 0) h = 12;
        return `${h}:${minStr} ${period}`;
    }
}

// "종일" 체크박스 요소 탐색
function getAllDayCheckbox(scope) {
    let cb = scope.querySelector('input[type="checkbox"][aria-label*="종일"], input[type="checkbox"][aria-label*="All day"], [role="checkbox"][aria-label*="종일"], [role="checkbox"][aria-label*="All day"]');
    if (cb) return cb;

    const candidates = Array.from(scope.querySelectorAll('label, div, span'));
    for (const el of candidates) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text === '종일' || text === 'All day') {
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
        const text = (b.innerText || b.textContent || '').trim();
        const label = b.getAttribute('aria-label') || '';
        return text === '시간 추가' || text === 'Add time' || label.includes('시간 추가') || label.includes('Add time');
    });
}

// 시작 시간 및 종료 시간 input 탐색
function getTimeInputs(scope) {
    let startInput = scope.querySelector('input[aria-label*="시작 시간"], input[aria-label*="Start time"]');
    let endInput = scope.querySelector('input[aria-label*="종료 시간"], input[aria-label*="End time"]');

    if (!startInput || !endInput) {
        const timeRegex = /(오전|오후|\bAM\b|\bPM\b|\b[0-2]?[0-9]:[0-5][0-9])/i;
        const allInputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])'));
        const matched = allInputs.filter(inp => {
            const val = inp.value || '';
            const aria = inp.getAttribute('aria-label') || '';
            return timeRegex.test(val) || aria.includes('시간') || aria.toLowerCase().includes('time');
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
    let startInput = scope.querySelector('input[aria-label*="시작 날짜"], input[aria-label*="Start date"], input[aria-label*="시작일"]');
    let endInput = scope.querySelector('input[aria-label*="종료 날짜"], input[aria-label*="End date"], input[aria-label*="종료일"]');

    if (startInput && endInput) {
        return { startInput, endInput };
    }

    // 대체 탐색: 제목, 위치, 시간을 제외한 텍스트 input 탐색
    const allInputs = Array.from(scope.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"])'));
    const candidateInputs = allInputs.filter(inp => {
        const aria = inp.getAttribute('aria-label') || '';
        const placeholder = inp.getAttribute('placeholder') || '';
        const val = inp.value || '';

        // 제목 및 위치 필드 제외
        if (aria.includes('제목') || aria.toLowerCase().includes('title') || placeholder.includes('제목')) return false;
        if (aria.includes('위치') || aria.toLowerCase().includes('location') || placeholder.includes('위치')) return false;

        // 시간 필드 제외 (오전/오후, AM/PM, HH:MM 패턴 또는 aria에 '시간' 포함)
        const timeRegex = /(오전|오후|\bAM\b|\bPM\b|\b[0-2]?[0-9]:[0-5][0-9])/i;
        if (timeRegex.test(val) || aria.includes('시간') || aria.toLowerCase().includes('time')) return false;

        // 날짜 패턴(연도가 있거나 없거나: 11월 10일, 11. 10., 2026. 11. 10., 11/10 등) 또는 aria에 날짜 포함
        const dateRegex = /(\d{1,2}[월\.]\s*\d{1,2}|\d{4}[^\d]+\d{1,2}|\d{1,2}\/\d{1,2})/;
        return aria.includes('날짜') || aria.toLowerCase().includes('date') || dateRegex.test(val) || dateRegex.test(aria);
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

    // 1. "2026. 11. 10." 또는 "2026-11-10" 또는 "2026년 11월 10일"
    let m = cleanStr.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    // 2. 미국식: "11/10/2026"
    m = cleanStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }

    // 3. 연도가 생략된 한국어: "11월 10일", "11월 10일 (화)", "11. 10." 등
    m = cleanStr.match(/(\d{1,2})[월\.]\s*(\d{1,2})/);
    if (m) {
        return new Date(currentYear, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }

    // 4. 영어 월 이름 포함: "Nov 10, 2026" or "Nov 10"
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
        if (/\d{1,2}월\s*\d{1,2}일/.test(templateValue)) {
            return `${m}월 ${d}일`;
        }
        if (/^\d{1,2}\.\s*\d{1,2}\./.test(templateValue)) {
            return `${m}. ${d}.`;
        }
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(templateValue)) {
            return `${m}/${d}/${y}`;
        }
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
        const diffMs = e.getTime() - s.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return Math.max(diffDays, 1);
    } else {
        const sStr = match.startTime.split('T')[0];
        const eStr = match.endTime.split('T')[0];
        if (sStr === eStr) return 0; // 당일 일정
        const s = new Date(sStr);
        const e = new Date(eStr);
        const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(diffDays, 0);
    }
}

// 시간 input 값 설정 및 확정
async function applyTimeValue(inputEl, timeStr) {
    if (!inputEl || !timeStr) return;

    inputEl.focus();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, timeStr);
    } else {
        inputEl.value = timeStr;
    }

    inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    await new Promise(r => setTimeout(r, 60));
    const openMenus = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(m => m.offsetParent !== null && !m.closest('[data-view-family]'));
    let clicked = false;
    for (const menu of openMenus) {
        const options = Array.from(menu.querySelectorAll('[role="option"], [role="menuitem"]'));
        const targetOpt = options.find(opt => {
            const t = (opt.innerText || '').trim().replace(/\s+/g, '');
            return t === timeStr.replace(/\s+/g, '');
        });
        if (targetOpt) {
            targetOpt.click();
            clicked = true;
            break;
        }
    }

    if (!clicked) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

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

// 다일 일정(여러 날에 걸친 일정) 날짜 자동완성
async function applyEventDates(activeDialog, match) {
    const durationDays = getDurationDays(match);
    console.log("Calculated duration days:", durationDays, "isAllDay:", match.isAllDay, "for event:", match.title);

    if (match.isAllDay && durationDays <= 1) return;
    if (!match.isAllDay && durationDays <= 0) return;

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

    const startDate = parseDateString(startInput.value);
    if (!startDate) {
        console.warn("Could not parse current start date from value:", startInput.value);
        return;
    }

    const daysToAdd = match.isAllDay ? (durationDays - 1) : durationDays;
    if (daysToAdd <= 0) return;

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

    if (startInput && startObj) {
        const startFormatted = formatTime(startObj.hours, startObj.minutes, startInput.value);
        console.log("Setting start time to:", startFormatted);
        await applyTimeValue(startInput, startFormatted);
        await new Promise(r => setTimeout(r, 100));
    }

    const updatedInputs = getTimeInputs(activeDialog);
    const finalEndInput = updatedInputs.endInput || endInput;
    if (finalEndInput && endObj) {
        const endFormatted = formatTime(endObj.hours, endObj.minutes, finalEndInput.value);
        console.log("Setting end time to:", endFormatted);
        await applyTimeValue(finalEndInput, endFormatted);
        await new Promise(r => setTimeout(r, 100));
    }
}

// 위치(Location) 자동완성
async function applyLocation(scope, locationText) {
    if (!locationText || !locationText.trim()) return;

    let locInput = scope.querySelector('input[aria-label="위치 추가"], input[aria-label="Add location"], input[placeholder*="위치 추가"], input[placeholder*="Add location"]');

    if (!locInput) {
        const btns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
        const locBtn = btns.find(b => {
            const label = b.getAttribute('aria-label') || '';
            const text = (b.innerText || b.textContent || '').trim();
            return label.includes('위치') || label.toLowerCase().includes('location') || text === '위치 추가' || text === 'Add location';
        });

        if (locBtn) {
            locBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            locInput = scope.querySelector('input[aria-label="위치 추가"], input[aria-label="Add location"], input[placeholder*="위치 추가"], input[placeholder*="Add location"]');
        }
    }

    if (locInput) {
        console.log("Setting location to:", locationText);
        setVal(locInput, locationText);
    }
}

// 설명(Description) 자동완성
async function applyDescription(scope, descText) {
    if (!descText || !descText.trim()) return;

    let editField = scope.querySelector('div[aria-label*="설명 추가"][contenteditable="true"], div[aria-label*="Add description"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');

    if (!editField) {
        const descBtns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
        const descBtn = descBtns.find(b => {
            const label = b.getAttribute('aria-label') || '';
            const text = (b.innerText || b.textContent || '').trim();
            return label.includes('설명') || label.toLowerCase().includes('description') || text === '설명 추가' || text === 'Add description';
        });

        if (descBtn) {
            console.log("Clicking Add Description button to expand editor...");
            descBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            descBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            descBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));

            editField = scope.querySelector('div[aria-label*="설명 추가"][contenteditable="true"], div[aria-label*="Add description"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');
        }
    }

    if (editField) {
        console.log("Applying description text:", descText.slice(0, 30));
        editField.focus();

        try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, descText);
        } catch (e) {
            editField.innerText = descText;
        }

        editField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        editField.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        await new Promise(r => setTimeout(r, 60));
        editField.blur();
    } else {
        console.warn("Could not find description editable field");
    }
}

// 참석자(Attendees) 자동완성
async function applyAttendees(scope, attendees) {
    if (!Array.isArray(attendees) || attendees.length === 0) return;

    let guestInput = scope.querySelector('input[placeholder*="참석자 추가"], input[placeholder*="Add guests"], input[aria-label*="참석자 추가"], input[aria-label*="Add guests"]');

    if (!guestInput) {
        const guestBtns = Array.from(scope.querySelectorAll('button, div[role="button"], span[role="button"]'));
        const guestBtn = guestBtns.find(b => {
            const label = b.getAttribute('aria-label') || '';
            const text = (b.innerText || b.textContent || '').trim();
            return label.includes('참석자') || label.toLowerCase().includes('guests') || text === '참석자 추가' || text === 'Add guests';
        });

        if (guestBtn) {
            console.log("Clicking Add Guests button to expand guest input...");
            guestBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            guestBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            guestBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));

            guestInput = scope.querySelector('input[placeholder*="참석자 추가"], input[placeholder*="Add guests"], input[aria-label*="참석자 추가"], input[aria-label*="Add guests"]');
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

    let targetBtn = activeDialog.querySelector('[aria-label="캘린더"][aria-haspopup="listbox"], [aria-label="Calendar"][aria-haspopup="listbox"], [data-is-calendar-selector="true"]');

    if (!targetBtn) {
        const allLists = Array.from(activeDialog.querySelectorAll('[aria-haspopup="listbox"], [role="combobox"]'));
        targetBtn = allLists.find(btn => {
            const text = btn.innerText || '';
            const label = btn.getAttribute('aria-label') || '';
            if (label.includes('캘린더') || label.includes('Calendar')) return true;
            const iconSvg = btn.querySelector('svg');
            if (iconSvg && btn.textContent) return true;
            return false;
        });

        if (!targetBtn) {
            const anyCalendarTipped = activeDialog.querySelector('[data-tooltip*="캘린더"], [data-tooltip*="Calendar"]');
            if (anyCalendarTipped) {
                targetBtn = anyCalendarTipped.closest('[role="button"]') || anyCalendarTipped;
            }
        }
    }

    if (targetBtn) {
        if (targetBtn.innerText && targetBtn.innerText.includes(calendarSummary)) {
            console.log("Already selected desired calendar:", calendarSummary);
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

            if (listItems.length === 0) {
                listItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).filter(el => !el.closest('[aria-label="내 캘린더"], [aria-label="My calendars"], #drawer'));
            }

            const optionToClick = listItems.find(li => li.innerText && li.innerText.includes(calendarSummary));

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
                console.log("Could not find calendar option for:", calendarSummary);
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

            const label = btn.getAttribute('aria-label') || '';
            const text = btn.textContent || '';
            const isSaveBtn = label === '저장' || label === 'Save' || text.trim() === '저장' || text.trim() === 'Save';

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

    suggestionBox.style.left = rect.left + 'px';
    suggestionBox.style.top = (rect.bottom + window.scrollY) + 'px';
    suggestionBox.style.width = Math.max(rect.width, 390) + 'px';
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

        let displayText = '';
        if (type === 'titles') {
            displayText = `<strong>${escapeHTML(match.title)}</strong>`;
            if (match.location) {
                displayText += ` <span style="color:#70757a; font-size:0.9em;">📍 ${escapeHTML(match.location)}</span>`;
            }
            if (match.isAllDay) {
                const duration = getDurationDays(match);
                if (duration > 1) {
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">📅 ${duration}일간 (종일)</span>`;
                } else {
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">📅 종일</span>`;
                }
            } else if (match.startTime) {
                const duration = getDurationDays(match);
                const sObj = extractTime(match.startTime);
                const eObj = extractTime(match.endTime);
                if (sObj) {
                    const sStr = formatTime(sObj.hours, sObj.minutes);
                    const eStr = eObj ? ` ~ ${formatTime(eObj.hours, eObj.minutes)}` : '';
                    const durStr = duration > 0 ? ` (${duration + 1}일간)` : '';
                    displayText += ` <span style="color:#1a73e8; font-size:0.85em; margin-left:4px;">⏰ ${sStr}${eStr}${durStr}</span>`;
                }
            }
            if (Array.isArray(match.attendees) && match.attendees.length > 0) {
                displayText += ` <span style="color:#5f6368; font-size:0.85em; margin-left:4px;">👥 ${match.attendees.length}명</span>`;
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

            if (type === 'titles') {
                const activeDialog = getActiveDialog();

                // 1. 위치 자동완성 (설정 켜진 경우)
                if (userSettings.autoCompleteLocation && match.location) {
                    await applyLocation(activeDialog, match.location);
                }

                // 2. 설명 자동완성 (설정 켜진 경우)
                if (userSettings.autoCompleteDescription && match.description) {
                    await applyDescription(activeDialog, match.description);
                }

                // 3. 참석자 자동완성 (설정 켜진 경우)
                if (userSettings.autoCompleteAttendees && Array.isArray(match.attendees) && match.attendees.length > 0) {
                    await applyAttendees(activeDialog, match.attendees);
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
