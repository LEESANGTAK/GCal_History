document.addEventListener('DOMContentLoaded', function () {
    const statusDiv = document.getElementById('status');
    const refreshBtn = document.getElementById('refreshBtn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    // 현재 캐시 상태 확인
    chrome.storage.local.get(['cachedEvents'], function (result) {
        if (result.cachedEvents && result.cachedEvents.length > 0) {
            statusDiv.textContent = `현재 ${result.cachedEvents.length}개의 추천 데이터가 준비되어 있습니다.`;
        } else {
            statusDiv.textContent = '저장된 데이터가 없습니다. 새로고침을 눌러주세요.';
        }
    });

    // 백그라운드로부터 진행 상태 메시지 수신
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'fetchProgress') {
            if (message.status === 'fetching') {
                progressContainer.style.display = 'block';
                const percent = (message.current / message.total) * 100;
                progressBar.style.width = percent + '%';
                progressText.textContent = `${message.current} / ${message.total} 캘린더 완료`;
                statusDiv.textContent = '구글 캘린더 데이터를 가져오는 중입니다...';
            } else if (message.status === 'success') {
                statusDiv.textContent = `성공! ${message.count}개의 일정을 새로 분석했습니다.`;
                statusDiv.style.color = '#1e8e3e';
                progressBar.style.width = '100%';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    refreshBtn.disabled = false;
                }, 2000);
            }
        }
    });

    refreshBtn.addEventListener('click', function () {
        statusDiv.textContent = '인증 확인 중... (팝업이 뜨면 로그인해 주세요)';
        statusDiv.style.color = '#3c4043';
        refreshBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '준비 중...';

        chrome.runtime.sendMessage({ action: 'forceRefresh' }, function (response) {
            if (response && response.success) {
                // background.js에서 fetchProgress 메시지를 보내므로 여기서는 성공 처리만 기다림
            } else {
                const errorMsg = response?.error || '알 수 없는 오류';
                statusDiv.textContent = `오류 발생: ${errorMsg}`;
                statusDiv.style.color = '#d93025';
                refreshBtn.disabled = false;
                progressContainer.style.display = 'none';
            }
        });
    });
});
