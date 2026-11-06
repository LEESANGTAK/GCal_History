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

    // 0. 다국어 지원 (한국어, 영어, 일본어, 중국어)
    const I18N = {
        ko: {
            refreshTooltip: "일정 수동 새로고침",
            rangeLabel: "과거 일정 조회 기간",
            range1: "최근 1개월",
            range3: "최근 3개월",
            range6: "최근 6개월",
            range12: "최근 1년 (기본값)",
            range24: "최근 2년",
            range36: "최근 3년",
            optionsLabel: "자동완성 적용 항목",
            optTime: "기간 및 시간 자동완성",
            optAttendees: "참석자 자동완성",
            optLocation: "위치 자동완성",
            optDescription: "설명 자동완성",
            statusChecking: "데이터 상태를 확인 중입니다...",
            hintText: "💡 일정을 등록하거나 설정을 변경하면 실시간으로 반영됩니다.",
            statusReady: (count) => `현재 ${count}개의 추천 일정이 준비되어 있습니다.`,
            statusNoData: "저장된 데이터가 없습니다. 새로고침을 실행합니다...",
            statusFetching: "구글 캘린더 데이터를 가져오는 중입니다...",
            statusSyncing: "캘린더 데이터 동기화 중...",
            statusSuccess: (count) => `성공! ${count}개의 일정을 분석 완료했습니다.`,
            statusPreparing: "준비 중...",
            progressText: (cur, total) => `${cur} / ${total} 캘린더 완료`,
            errorPrefix: "오류 발생: ",
            unknownError: "알 수 없는 오류"
        },
        en: {
            refreshTooltip: "Refresh events",
            rangeLabel: "Past Event Lookup Range",
            range1: "Past 1 month",
            range3: "Past 3 months",
            range6: "Past 6 months",
            range12: "Past 1 year (Default)",
            range24: "Past 2 years",
            range36: "Past 3 years",
            optionsLabel: "Autocomplete Options",
            optTime: "Time & Duration",
            optAttendees: "Attendees",
            optLocation: "Location",
            optDescription: "Description",
            statusChecking: "Checking data status...",
            hintText: "💡 Changes are synced in real-time as you create events or update settings.",
            statusReady: (count) => `${count} suggested events ready.`,
            statusNoData: "No cached data found. Starting refresh...",
            statusFetching: "Fetching Google Calendar data...",
            statusSyncing: "Syncing calendar data...",
            statusSuccess: (count) => `Success! Analyzed ${count} events.`,
            statusPreparing: "Preparing...",
            progressText: (cur, total) => `${cur} / ${total} calendars completed`,
            errorPrefix: "Error: ",
            unknownError: "Unknown error"
        },
        ja: {
            refreshTooltip: "予定を手動更新",
            rangeLabel: "過去の予定の取得期間",
            range1: "過去1か月",
            range3: "過去3か月",
            range6: "過去6か月",
            range12: "過去1年 (デフォルト)",
            range24: "過去2年",
            range36: "過去3年",
            optionsLabel: "自動入力の適用項目",
            optTime: "期間と時間",
            optAttendees: "ゲスト (参加者)",
            optLocation: "場所",
            optDescription: "説明",
            statusChecking: "データ状態を確認しています...",
            hintText: "💡 予定の登録や設定の変更はリアルタイムで反映されます。",
            statusReady: (count) => `現在${count}件のおすすめの予定が準備されています。`,
            statusNoData: "保存されたデータがありません。更新を開始します...",
            statusFetching: "Googleカレンダーのデータを取得中...",
            statusSyncing: "カレンダーデータを同期中...",
            statusSuccess: (count) => `成功！${count}件の予定を分析しました。`,
            statusPreparing: "準備中...",
            progressText: (cur, total) => `${cur} / ${total} カレンダー完了`,
            errorPrefix: "エラー発生: ",
            unknownError: "不明なエラー"
        },
        zh: {
            refreshTooltip: "手动刷新日程",
            rangeLabel: "以往日程获取范围",
            range1: "最近1个月",
            range3: "最近3个月",
            range6: "最近6个月",
            range12: "最近1年 (默认)",
            range24: "最近2年",
            range36: "最近3年",
            optionsLabel: "自动填充应用项目",
            optTime: "期间与时间",
            optAttendees: "参与人",
            optLocation: "位置",
            optDescription: "说明",
            statusChecking: "正在检查数据状态...",
            hintText: "💡 登记日程或更改设置时将实时生效。",
            statusReady: (count) => `当前已准备好${count}个推荐日程。`,
            statusNoData: "未发现缓存数据。正在开始刷新...",
            statusFetching: "正在获取Google日历数据...",
            statusSyncing: "正在同步日历数据...",
            statusSuccess: (count) => `成功！已分析${count}个日程。`,
            statusPreparing: "准备中...",
            progressText: (cur, total) => `${cur} / ${total} 个日历已完成`,
            errorPrefix: "发生错误: ",
            unknownError: "未知错误"
        }
    };

    function getAppLanguage() {
        const lang = (navigator.language || 'en').toLowerCase();
        if (lang.startsWith('ko')) return 'ko';
        if (lang.startsWith('ja')) return 'ja';
        if (lang.startsWith('zh')) return 'zh';
        return 'en';
    }

    const currentLang = getAppLanguage();
    const t = I18N[currentLang] || I18N.en;

    // UI 텍스트 일괄 적용
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            el.textContent = t[key];
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (t[key]) {
            el.setAttribute('title', t[key]);
        }
    });

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
            statusDiv.textContent = t.statusReady(result.cachedEvents.length);
        } else {
            statusDiv.textContent = t.statusNoData;
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
                progressText.textContent = t.progressText(message.current, message.total);
                statusDiv.textContent = t.statusFetching;
            } else if (message.status === 'success') {
                statusDiv.textContent = t.statusSuccess(message.count);
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
        statusDiv.textContent = t.statusSyncing;
        statusDiv.style.color = '#3c4043';
        refreshBtn.disabled = true;
        rangeSelect.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = t.statusPreparing;

        chrome.runtime.sendMessage({ action: 'forceRefresh' }, function (response) {
            if (response && response.success) {
                // fetchProgress 수신 대기
            } else {
                const errorMsg = response?.error || t.unknownError;
                statusDiv.textContent = `${t.errorPrefix}${errorMsg}`;
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
