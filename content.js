// 저장된 데이터 구조 초기화
let historyData = {
    items: [] // { title, location, description } 형태
};

// 동기화된 데이터 불러오기 및 마이그레이션
chrome.storage.sync.get(['gcalHistory'], function(syncResult) {
    if (syncResult.gcalHistory) {
        const data = syncResult.gcalHistory;
        if (data.items) {
            historyData = data;
        } else if (data.titles) {
            const newItems = [];
            const limit = Math.min(data.titles.length, 50);
            for (let i = 0; i < limit; i++) {
                newItems.push({
                    title: data.titles[i] || '',
                    location: data.locations?.[i] || '',
                    description: data.descriptions?.[i] || ''
                });
            }
            historyData.items = newItems;
            chrome.storage.sync.set({gcalHistory: historyData});
        }
    } else {
        chrome.storage.local.get(['gcalHistory'], function(localResult) {
            if (localResult.gcalHistory) {
                let data = localResult.gcalHistory;
                if (!data.items && data.titles) {
                     const newItems = [];
                     const limit = Math.min(data.titles.length, 50);
                     for (let i = 0; i < limit; i++) {
                        newItems.push({
                            title: data.titles[i] || '',
                            location: data.locations?.[i] || '',
                            description: data.descriptions?.[i] || ''
                        });
                     }
                     historyData.items = newItems;
                } else {
                    historyData = data;
                }
                chrome.storage.sync.set({gcalHistory: historyData});
                chrome.storage.local.remove('gcalHistory');
            }
        });
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

    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => {
        if((btn.innerText === '저장' || btn.innerText === 'Save') && !btn.dataset.saveListener) {
            btn.dataset.saveListener = "true";
            btn.addEventListener('click', saveAllFields);
        }
    });
});

observer.observe(document.body, { childList: true, subtree: true });

function attachAutocomplete(element, type) {
    element.dataset.acType = type;
    element.setAttribute('autocomplete', 'off');

    const eventType = (element.tagName === 'DIV') ? 'input' : 'input';
    let selectedIndex = -1;

    element.addEventListener(eventType, (e) => {
        if (e.isTrusted) {
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
            if(e.key === 'Enter' && element.tagName === 'INPUT') closeSuggestions();
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
    el.focus();

    if (el.tagName === 'INPUT') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, text);
        } else {
            el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function deleteItem(value, type) {
    if (type === 'titles') {
        const index = historyData.items.indexOf(value);
        if (index > -1) {
            historyData.items.splice(index, 1);
        }
    } else {
        historyData.items.forEach(item => {
            if (type === 'locations' && item.location === value) {
                item.location = '';
            }
            if (type === 'descriptions' && item.description === value) {
                item.description = '';
            }
        });
    }
    chrome.storage.sync.set({gcalHistory: historyData});
}

function showSuggestions(matches, inputElement, type) {
    suggestionBox.innerHTML = '';
    const rect = inputElement.getBoundingClientRect();

    suggestionBox.style.left = rect.left + 'px';
    suggestionBox.style.top = (rect.bottom + window.scrollY) + 'px';
    suggestionBox.style.width = Math.max(rect.width, 350) + 'px';
    suggestionBox.style.display = 'block';

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
            displayText = `<strong>${match.title}</strong>`;
            if (match.location) {
                displayText += ` <span style="color:#70757a; font-size:0.9em;">📍 ${match.location}</span>`;
            }
        } else {
            const icon = type === 'locations' ? '📍 ' : '📝 ';
            displayText = icon + match;
        }

        textSpan.innerHTML = displayText;

        const delBtn = document.createElement('span');
        delBtn.innerHTML = '&times;';
        delBtn.style.cursor = 'pointer';
        delBtn.style.marginLeft = '10px';
        delBtn.style.fontSize = '18px';
        delBtn.style.color = '#9aa0a6';
        delBtn.title = '이 기록 삭제';

        delBtn.onmouseover = () => delBtn.style.color = '#5f6368';
        delBtn.onmouseout = () => delBtn.style.color = '#9aa0a6';

        // [추가] mousedown 이벤트에서 기본 동작을 막아 입력창 포커스 유실(blur) 방지
        delBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            deleteItem(match, type);

            div.remove();

            if (suggestionBox.children.length === 0) closeSuggestions();

            // 포커스 유지 (mousedown preventDefault 덕분에 blur가 안 일어났지만 안전장치로 유지)
            inputElement.focus();
        });

        div.appendChild(textSpan);
        div.appendChild(delBtn);

        div.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (type === 'titles') {
                const inputs = getInputs();

                if (match.location && inputs.location) setVal(inputs.location, match.location);
                if (match.description && inputs.desc) setVal(inputs.desc, match.description);
                setVal(inputElement, match.title);
            } else {
                setVal(inputElement, match);
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
    const inputs = getInputs();

    const newItem = {
        title: inputs.title ? inputs.title.value : '',
        location: inputs.location ? inputs.location.value : '',
        description: inputs.desc ? inputs.desc.innerText : ''
    };

    if (!newItem.title || newItem.title.trim() === "") return;

    const index = historyData.items.findIndex(item =>
        item.title === newItem.title &&
        item.location === newItem.location &&
        item.description === newItem.description
    );

    if (index > -1) {
        historyData.items.splice(index, 1);
    }

    historyData.items.unshift(newItem);

    if (historyData.items.length > 30) historyData.items.pop();

    chrome.storage.sync.set({gcalHistory: historyData});
}