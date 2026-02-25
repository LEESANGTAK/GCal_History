// 저장된 데이터 구조 초기화
let historyData = {
    items: [] // { title, location, description } 형태
};

// 백그라운드 스크립트에서 자동완성할 일정 데이터 가져오기
function loadCalendarEvents() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getEvents' }, function (response) {
            if (chrome.runtime.lastError) {
                console.error("Error communicating with background script:", chrome.runtime.lastError.message);
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
    });
}

// 초기 데이터 로딩
loadCalendarEvents();

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.cachedEvents && changes.cachedEvents.newValue) {
        console.log("Updated events from storage change:", changes.cachedEvents.newValue.length);
        historyData.items = changes.cachedEvents.newValue;
    }
});

// 자동완성 목록 UI 생성
const suggestionBox = document.createElement('div');
suggestionBox.id = 'gcal-history-suggestions';
suggestionBox.style.display = 'none';
document.body.appendChild(suggestionBox);

// 입력창 찾기 헬퍼 함수
function getInputs() {
    return {
        title: document.querySelector('input[aria-label="제목 추가"], input[aria-label="Add title"], input[aria-label="제목 및 시간 추가"]'),
        location: document.querySelector('input[aria-label="위치 추가"], input[aria-label="Add location"]'),
        desc: document.querySelector('div[aria-label="설명 추가"], div[aria-label="Add description"]')
    };
}

// 입력창 감지 옵저버
const observer = new MutationObserver((mutations) => {
    const inputs = getInputs();

    if (inputs.title && !inputs.title.dataset.acType) attachAutocomplete(inputs.title, 'titles');
    if (inputs.location && !inputs.location.dataset.acType) attachAutocomplete(inputs.location, 'locations');
    if (inputs.desc && !inputs.desc.dataset.acType) attachAutocomplete(inputs.desc, 'descriptions');

    // Capture all possible save buttons (button tags and role="button" divs)
    const buttons = document.querySelectorAll('button, div[role="button"], span[role="button"]');
    buttons.forEach(btn => {
        const text = btn.innerText || btn.textContent || '';
        if ((text.trim() === '저장' || text.trim() === 'Save') && !btn.dataset.saveListener) {
            btn.dataset.saveListener = "true";

            // Capture the elements *now* while we know they exist, but get values on mousedown/click
            btn.addEventListener('mousedown', () => {
                const inputs = getInputs();
                const newTitle = inputs.title ? getVal(inputs.title) : "";
                if (newTitle && newTitle.trim() !== "") {
                    // Optimistic update
                    historyData.items.unshift({
                        title: newTitle.trim(),
                        location: inputs.location ? getVal(inputs.location).trim() : "",
                        description: inputs.desc ? getVal(inputs.desc).trim() : "",
                        calendarSummary: "",
                        calendarId: "",
                        startTime: "",
                        endTime: "",
                        isAllDay: false
                    });
                }
            }, { capture: true }); // Use capture phase to ensure we hit it before SPA navigates away

            btn.addEventListener('click', () => {
                setTimeout(() => {
                    chrome.runtime.sendMessage({ action: 'silentRefresh' });
                }, 1500);
            }, { capture: true });
        }
    });
});

observer.observe(document.body, { childList: true, subtree: true });

async function setCalendarAndTimes(match) {
    // 캘린더 선택 자동완성
    if (match.calendarSummary) {
        // 드롭다운을 찾을 때, 메인 페이지의 사이드바 체크박스가 눌리는 것을 방지하기 위해
        // 가급적 모달 내창(dialog) 범위 내에서만 탐색하도록 제한합니다.
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-is-view="true"]'));
        const activeDialog = dialogs.find(d => d.querySelector('input[aria-label="제목 추가"], input[aria-label="Add title"], input[aria-label="제목 및 시간 추가"]')) || document;

        let targetBtn = null;

        // 방법 1: aria-label이 직접적으로 '캘린더' 또는 'Calendar'인 요소 (주로 구글 캘린더에서 쓰임)
        targetBtn = activeDialog.querySelector('[aria-label="캘린더"][aria-haspopup="listbox"], [aria-label="Calendar"][aria-haspopup="listbox"], [data-is-calendar-selector="true"]');

        // 방법 2: 없는 경우, 모달 내의 모든 listbox 중에 현재 선택되어 있는 캘린더 이름이 보이는 요소 찾기
        if (!targetBtn) {
            const allLists = Array.from(activeDialog.querySelectorAll('[aria-haspopup="listbox"], [role="combobox"]'));
            // 보통 캘린더 선택기는 모달의 하단부에 위치하며, 색상 원(dot)을 포함하는 경우가 많습니다.
            targetBtn = allLists.find(btn => {
                const text = btn.innerText || '';
                const label = btn.getAttribute('aria-label') || '';
                // 라벨 자체에 캘린더가 있거나
                if (label.includes('캘린더') || label.includes('Calendar')) return true;
                // 내용 중에 본인 이메일이나, 기존에 캘린더 목록에 있는 이름이 포함되어 있을 수 있습니다.
                // 여기서는 확실하지 않으므로, 캘린더 아이콘 근처에 있는 버튼을 찾습니다.
                const iconSvg = btn.querySelector('svg');
                if (iconSvg && btn.textContent) return true; // 다소 엉성할 수 있으므로 보완 필요
                return false;
            });

            // 방법 3: 그래도 없다면, 구글 캘린더 돔 구조상 마지막 listbox가 캘린더일 때가 많습니다.
            // 단축키용 툴팁(예: "캘린더 변경")이 있는 요소를 먼저 찾습니다.
            if (!targetBtn) {
                const anyCalendarTipped = activeDialog.querySelector('[data-tooltip*="캘린더"], [data-tooltip*="Calendar"]');
                if (anyCalendarTipped) {
                    targetBtn = anyCalendarTipped.closest('[role="button"]') || anyCalendarTipped;
                }
            }
        }

        // 라벨로 못찾았다면, 보통 맨 아래에 있는 listbox가 캘린더일 확률이 높음 (또는 공개설정)
        // 안전하게 targetBtn이 있을 때만 동작하도록 함
        if (targetBtn) {
            // 이미 이 일정이 목표 캘린더(match.calendarSummary)로 선택되어 있는지 텍스트로 확인
            if (targetBtn.innerText && targetBtn.innerText.includes(match.calendarSummary)) {
                console.log("Already selected desired calendar:", match.calendarSummary);
                return; // 이미 선택됨
            }

            console.log("Found calendar dropdown:", targetBtn);
            // 단순 click()은 React 합성 이벤트 등에서 막힐 수 있으므로 mousedown -> mouseup 모의
            targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

            await new Promise(r => setTimeout(r, 200)); // DOM 렌더링 대기 조금 여유있게 (200ms)

            // 드롭다운 메뉴는 보통 body 끝에 포탈(Portal)로 렌더링되므로 화면에 보이는(현재 열려있는) 메뉴 안에서 탐색합니다.
            // 이렇게 하면 왼쪽 사이드바에 있는 캘린더 목록을 잘못 누르는 대참사를 방지할 수 있습니다.
            const openMenus = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(m => m.offsetParent !== null && !m.closest('[data-view-family]'));

            let listItems = [];
            openMenus.forEach(menu => {
                listItems = listItems.concat(Array.from(menu.querySelectorAll('[role="menuitem"], [role="option"]')));
            });

            // 대비책: 만약 못 찾았다면, 사이드바 영역('#drawer', '[aria-label="내 캘린더"]')을 제외한 곳에서 명시적인 option만 탐색
            if (listItems.length === 0) {
                listItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).filter(el => !el.closest('[aria-label="내 캘린더"], [aria-label="My calendars"], #drawer'));
            }

            const optionToClick = listItems.find(li => li.innerText && li.innerText.includes(match.calendarSummary));

            if (optionToClick) {
                console.log("Clicking calendar option:", optionToClick);

                // React 합성 이벤트를 확실히 트리거하기 위해 이벤트를 옵션 요소 내부의 가장 정확한 요소에 전달 시도
                const clickTarget = optionToClick.querySelector('div, span') || optionToClick;

                ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                    clickTarget.dispatchEvent(new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });

            } else {
                console.log("Could not find calendar option for:", match.calendarSummary);
                // 찾는 캘린더가 없으면 닫기 (Escape 키)
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }
        } else {
            console.log("Calendar dropdown button not found in DOM.");
        }
    }
}

function attachAutocomplete(element, type) {
    element.dataset.acType = type;
    element.setAttribute('autocomplete', 'off');

    const eventType = (element.tagName === 'DIV') ? 'input' : 'input';
    let selectedIndex = -1;

    element.addEventListener('focus', () => {
        // 언제든 입력창을 포커스할 때 백그라운드의 최신 캐시를 불러옵니다 (SPA 환경 대비)
        loadCalendarEvents();
    });

    element.addEventListener(eventType, (e) => {
        if (e.isTrusted) {
            // Google Calendar is an SPA, if the memory was somehow wiped or empty, try re-fetching
            if (historyData.items.length === 0) {
                loadCalendarEvents();
            }

            const val = getVal(element);

            if (!val || val.trim() === "") {
                closeSuggestions();
                return;
            }

            let matches = [];
            const keyword = val.toLowerCase();

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
            if (e.key === 'Enter' && element.tagName === 'INPUT') closeSuggestions();
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
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSuggestions();
        }
    });
}

function highlightItem(items, index) {
    items.forEach((item, i) => {
        item.style.backgroundColor = (i === index) ? '#e8eaed' : '';
    });
}

function getVal(el) {
    if (el.tagName === 'INPUT') return el.value;
    return el.innerText;
}

function setVal(el, text) {
    if (!el) return;

    // React가 이벤트를 감지할 수 있도록 먼저 포커스를 줍니다.
    el.focus();

    if (el.tagName === 'INPUT') {
        // React의 기본 setter 우회
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, text);
        } else {
            el.value = text;
        }

        // React 상태 업데이트를 유도하기 위해 다양한 이벤트를 순차적으로 발생
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // 키보드 입력을 흉내내어 구글 캘린더 내부 로직(유효성 검사 등) 트리거
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Process', bubbles: true }));

        // DO NOT blur the element here so the user can continue typing.
        // Instead, move cursor to the end of the input
        try {
            el.selectionStart = el.value.length;
            el.selectionEnd = el.value.length;
        } catch (e) { }

    } else {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        // DO NOT blur DIV elements either
    }
}

function showSuggestions(matches, inputElement, type) {
    suggestionBox.innerHTML = '';
    const rect = inputElement.getBoundingClientRect();

    suggestionBox.style.left = rect.left + 'px';
    suggestionBox.style.top = (rect.bottom + window.scrollY) + 'px';
    suggestionBox.style.width = Math.max(rect.width, 350) + 'px';
    suggestionBox.style.display = 'block';

    // HTML Escape Helper
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

    const limitMatches = matches.slice(0, 5);

    limitMatches.forEach(match => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';

        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

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
        } else {
            const icon = type === 'locations' ? '📍 ' : '📝 ';
            displayText = icon + escapeHTML(match);
        }

        textSpan.innerHTML = displayText;

        div.appendChild(textSpan);

        div.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (type === 'titles') {
                const inputs = getInputs();

                if (match.location && inputs.location) setVal(inputs.location, match.location);
                if (match.description && inputs.desc) setVal(inputs.desc, match.description);

                // 선택한 일정명에 맞게 캘린더와 시간을 세팅 (이 과정에서 포커스가 뺏길 수 있음)
                setCalendarAndTimes(match).then(() => {
                    // Set the title last, and explicitly focus it
                    setVal(inputElement, match.title);
                    inputElement.focus();
                });

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

function saveAllFields() {
    // 더 이상 직접 입력한 내용을 로컬에 저장하지 않습니다.
    // 구글 캘린더 자체에서 저장하면 API를 통해 나중에 불러오게 됩니다.
}