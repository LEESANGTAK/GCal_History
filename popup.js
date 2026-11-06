document.addEventListener('DOMContentLoaded', function () {
    const statusDiv = document.getElementById('status');
    const refreshBtn = document.getElementById('refreshBtn');
    const rangeSelect = document.getElementById('rangeSelect');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const checkTime = document.getElementById('checkTime');
    const checkAttendees = document.getElementById('checkAttendees');
    const checkLocation = document.getElementById('checkLocation');
    const checkDescription = document.getElementById('checkDescription');

    // 0. 다국어 지원: 브라우저 언어 감지 및 영문 UI 적용
    const isKorean = (navigator.language && navigator.language.startsWith('ko'));

    if (!isKorean) {
        document.querySelectorAll('[data-i18n-en]').forEach(el => {
            el.textContent = el.getAttribute('data-i18n-en');
        });
        document.querySelectorAll('[data-i18n-title-en]').forEach(el => {
            el.setAttribute('title', el.getAttribute('data-i18n-title-en'));
        });
    }

    // 1. 저장된 조회 기간 및 자동완성 세부 설정 불러오기
    chrome.storage.sync.get({
        fetchRangeMonths: 12,
        autoCompleteTime: true,
        autoCompleteAttendees: true,
        autoCompleteLocation: true,
        autoCompleteDescription: true
    }, function (res) {
        if (res.fetchRangeMonths && rangeSelect) {
            rangeSelect.value = String(res.fetchRangeMonths);
        }
        if (checkTime) checkTime.checked = res.autoCompleteTime !== false;
        if (checkAttendees) checkAttendees.checked = res.autoCompleteAttendees !== false;
        if (checkLocation) checkLocation.checked = res.autoCompleteLocation !== false;
        if (checkDescription) checkDescription.checked = res.autoCompleteDescription !== false;
    });

    // 2. 자동완성 세부 항목 변경 리스너 등록
    const setupCheckboxSync = (checkbox, key) => {
        if (!checkbox) return;
        checkbox.addEventListener('change', function () {
            const updateObj = {};
            updateObj[key] = checkbox.checked;
            chrome.storage.sync.set(updateObj, function () {
                console.log(`Setting ${key} updated:`, checkbox.checked);
            });
        });
    };

    setupCheckboxSync(checkTime, 'autoCompleteTime');
    setupCheckboxSync(checkAttendees, 'autoCompleteAttendees');
    setupCheckboxSync(checkLocation, 'autoCompleteLocation');
    setupCheckboxSync(checkDescription, 'autoCompleteDescription');

    // 3. 현재 캐시 상태 확인
    chrome.storage.local.get(['cachedEvents'], function (result) {
        if (result.cachedEvents && result.cachedEvents.length > 0) {
            statusDiv.textContent = isKorean
                ? `현재 ${result.cachedEvents.length}개의 추천 일정이 준비되어 있습니다.`
                : `${result.cachedEvents.length} suggested events ready.`;
        } else {
            statusDiv.textContent = isKorean
                ? '저장된 데이터가 없습니다. 새로고침을 실행합니다...'
                : 'No cached data found. Starting refresh...';
            startRefresh();
        }
    });

    // 4. 백그라운드로부터 진행 상태 메시지 수신
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'fetchProgress') {
            if (message.status === 'fetching') {
                progressContainer.style.display = 'block';
                const percent = message.total > 0 ? (message.current / message.total) * 100 : 0;
                progressBar.style.width = percent + '%';
                progressText.textContent = isKorean
                    ? `${message.current} / ${message.total} 캘린더 완료`
                    : `${message.current} / ${message.total} calendars completed`;
                statusDiv.textContent = isKorean
                    ? '구글 캘린더 데이터를 가져오는 중입니다...'
                    : 'Fetching Google Calendar data...';
            } else if (message.status === 'success') {
                statusDiv.textContent = isKorean
                    ? `성공! ${message.count}개의 일정을 분석 완료했습니다.`
                    : `Success! Analyzed ${message.count} events.`;
                statusDiv.style.color = '#1e8e3e';
                progressBar.style.width = '100%';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    refreshBtn.disabled = false;
                    rangeSelect.disabled = false;
                }, 1500);
            }
        }
    });

    // 5. 새로고침 실행 함수
    function startRefresh() {
        statusDiv.textContent = isKorean
            ? '캘린더 데이터 동기화 중...'
            : 'Syncing calendar data...';
        statusDiv.style.color = '#3c4043';
        refreshBtn.disabled = true;
        rangeSelect.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = isKorean ? '준비 중...' : 'Preparing...';

        chrome.runtime.sendMessage({ action: 'forceRefresh' }, function (response) {
            if (response && response.success) {
                // fetchProgress 수신 대기
            } else {
                const errorMsg = response?.error || (isKorean ? '알 수 없는 오류' : 'Unknown error');
                statusDiv.textContent = isKorean ? `오류 발생: ${errorMsg}` : `Error: ${errorMsg}`;
                statusDiv.style.color = '#d93025';
                refreshBtn.disabled = false;
                rangeSelect.disabled = false;
                progressContainer.style.display = 'none';
            }
        });
    }

    // 6. 조회 기간 변경 시 저장 및 즉시 자동 새로고침
    rangeSelect.addEventListener('change', function () {
        const selectedMonths = parseInt(rangeSelect.value, 10);
        chrome.storage.sync.set({ fetchRangeMonths: selectedMonths }, function () {
            console.log("Updated fetchRangeMonths to:", selectedMonths);
            startRefresh();
        });
    });

    // 7. 수동 새로고침 아이콘 버튼 클릭
    refreshBtn.addEventListener('click', function () {
        startRefresh();
    });
});
