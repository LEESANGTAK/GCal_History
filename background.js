const CLIENT_ID = '952545109836-cifm1576j845ghegeesrfq3ce2gl9jg1.apps.googleusercontent.com';
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
];

// 구글 캘린더에서 최근 일정을 가져옵니다. (모든 캘린더 대상)
async function fetchCalendarEvents(interactive = true) {
    try {
        console.log("Fetching token using launchWebAuthFlow...");

        let token = await getStoredToken();

        if (!token && interactive) {
            token = await authenticateUser();
        }

        if (!token) {
            throw new Error("No access token available.");
        }

        console.log("Token obtained", token ? "Yes" : "No");

        // 0. (디버깅) 현재 계정 정보 가져오기
        let userEmail = "Unknown";
        try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (userInfoRes.ok) {
                const userInfo = await userInfoRes.json();
                userEmail = userInfo.email;
                console.log("Current Auth Account:", userEmail);
            } else if (userInfoRes.status === 401) {
                console.log("Token expired, re-authenticating...");
                if (interactive) {
                    token = await authenticateUser();
                    return fetchCalendarEvents(false); // 재귀 호출 (interactive는 이미 처리됨)
                }
            }
        } catch (e) { console.error("Failed to fetch userinfo", e); }

        // 1. 사용자의 캘린더 목록 가져오기
        const calendarListUrl = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
        const calendarListResponse = await fetch(calendarListUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!calendarListResponse.ok) {
            console.error("Calendar List Error Status:", calendarListResponse.status);
            if (calendarListResponse.status === 401 && interactive) {
                token = await authenticateUser();
                return fetchCalendarEvents(false);
            }
            throw new Error(`Calendar List API request failed: ${calendarListResponse.status}`);
        }

        const calendarListData = await calendarListResponse.json();
        const calendars = calendarListData.items || [];
        console.log(`Found ${calendars.length} calendars for ${userEmail}.`, calendars.map(c => c.summary));

        // 캘린더 API 호출 (최근 1년 정도의 데이터를 가져오도록 설정)
        const timeMin = new Date();
        timeMin.setFullYear(timeMin.getFullYear() - 1); // 1년 전부터
        const timeMinStr = timeMin.toISOString();

        // 2. 모든 캘린더에서 일정 가져오기 (병렬 처리)
        console.log("Fetching events from all calendars...");
        let completedCalendars = 0;
        const totalCalendars = calendars.length;

        // 진행 상태 보고 함수
        const reportProgress = () => {
            chrome.runtime.sendMessage({
                action: 'fetchProgress',
                current: completedCalendars,
                total: totalCalendars,
                status: 'fetching'
            }).catch(() => { }); // 팝업이 닫혀있을 수 있음
        };

        reportProgress();

        const eventPromises = calendars.map(async (calendar) => {
            const calendarId = encodeURIComponent(calendar.id);
            // 캘린더당 최대 500개로 제한하여 성능 확보
            const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMinStr}&maxResults=500&singleEvents=true&orderBy=startTime`;

            try {
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) {
                    console.warn(`Failed to fetch events for calendar ${calendar.summary}: ${response.status}`);
                    completedCalendars++;
                    reportProgress();
                    return [];
                }
                const data = await response.json();
                const items = data.items || [];
                completedCalendars++;
                reportProgress();
                return items.map(event => ({
                    ...event,
                    _calendarSummary: calendar.summary,
                    _calendarId: calendar.id
                }));
            } catch (err) {
                console.error(`Error fetching events for calendar ${calendar.summary}:`, err);
                completedCalendars++;
                reportProgress();
                return [];
            }
        });

        const results = await Promise.all(eventPromises);

        // 3. 모든 결과 합치기 및 시간순 정렬
        let allEvents = [];
        for (const items of results) {
            allEvents = allEvents.concat(items);
        }

        allEvents.sort((a, b) => {
            const timeA = new Date(a.start?.dateTime || a.start?.date || 0).getTime();
            const timeB = new Date(b.start?.dateTime || b.start?.date || 0).getTime();
            return timeA - timeB;
        });

        const items = [];
        const seenKeys = new Set(); // 제목 + 위치 조합으로 중복 체크

        // 역순으로 정렬하여 최근 일정이 먼저 오도록
        for (let i = allEvents.length - 1; i >= 0; i--) {
            const event = allEvents[i];
            const title = event.summary || '';
            const location = event.location || '';

            // 제목과 위치가 모두 같아야 동일한 일정으로 간주 (사용자 피드백 반영: 위치가 다르면 다른 추천으로 보여줌)
            const key = `${title.trim()}|${location.trim()}`;

            if (title && !seenKeys.has(key)) {
                seenKeys.add(key);
                items.push({
                    title: title,
                    location: location,
                    description: event.description ? event.description.replace(/(<([^>]+)>)/gi, "") : '',
                    calendarSummary: event._calendarSummary || '',
                    calendarId: event._calendarId || '',
                    startTime: event.start?.dateTime || event.start?.date || '',
                    endTime: event.end?.dateTime || event.end?.date || '',
                    isAllDay: !!event.start?.date
                });
            }
        }

        console.log(`Fetched ${items.length} unique items (title+location) from ${totalCalendars} calendars.`);

        // 가져온 일정을 로컬에 캐시
        await chrome.storage.local.set({ cachedEvents: items });

        // 최종 상태 보고
        chrome.runtime.sendMessage({
            action: 'fetchProgress',
            current: totalCalendars,
            total: totalCalendars,
            status: 'success',
            count: items.length
        }).catch(() => { });

        return items;

        // 가져온 일정을 로컬에 캐시
        await chrome.storage.local.set({ cachedEvents: items });

        return items;

    } catch (error) {
        console.error("Error fetching calendar events:", error);
        throw error;
    }
}

async function getStoredToken() {
    const result = await chrome.storage.local.get(['access_token']);
    return result.access_token;
}

async function authenticateUser() {
    // getRedirectURL()을 사용하여 현재 확장 프로그램의 ID(로컬 or 스토어)에 맞는 주소를 자동으로 생성합니다.
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES.join(' '))}`;

    console.log("-----------------------------------------");
    console.log("OAuth Redirect URI (Dynamic):", redirectUri);
    console.log("Make sure this URI is registered in Google Cloud Console!");
    console.log("-----------------------------------------");
    console.log("Starting Web Auth Flow...", authUrl);

    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async function (responseUrl) {
            if (chrome.runtime.lastError) {
                console.error("Auth Flow Error:", chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (responseUrl) {
                const url = new URL(responseUrl);
                const params = new URLSearchParams(url.hash.substring(1));
                const token = params.get('access_token');

                if (token) {
                    await chrome.storage.local.set({ access_token: token });
                    resolve(token);
                } else {
                    reject(new Error("No access token found in response."));
                }
            } else {
                reject(new Error("No response URL from auth flow."));
            }
        });
    });
}

// 명시적으로 토큰을 삭제하고 다시 가져오는 함수 (문제 발생 시)
async function refreshEvents() {
    console.log("Refreshing events: removing stored token...");
    await chrome.storage.local.remove(['access_token']);
    return fetchCalendarEvents(true);
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getEvents') {
        // 캐시된 데이터가 있는지 먼저 확인
        chrome.storage.local.get(['cachedEvents'], function (result) {
            if (result.cachedEvents && result.cachedEvents.length > 0 && !request.forceRefresh) {
                console.log("Returning cached events", result.cachedEvents.length);
                sendResponse({ success: true, items: result.cachedEvents });

                // 백그라운드에서 조용히 데이터 갱신
                fetchCalendarEvents(false).catch(e => console.log("Silent refresh failed", e));
            } else {
                console.log("Fetching new events");
                fetchCalendarEvents(true).then(items => {
                    sendResponse({ success: true, items: items });
                }).catch(error => {
                    console.error("Manual fetch error:", error);
                    sendResponse({ success: false, error: error.message || error.toString() });
                });
            }
        });
        return true; // 비동기 응답을 위해 true 반환
    } else if (request.action === 'forceRefresh') {
        refreshEvents().then(items => {
            console.log("Force refresh success, items:", items.length);
            sendResponse({ success: true, items: items });
        }).catch(error => {
            console.error("Force refresh error:", error);
            sendResponse({ success: false, error: error.message || error.toString() });
        });
        return true;
    } else if (request.action === 'silentRefresh') {
        fetchCalendarEvents(false).then(items => {
            sendResponse({ success: true, items: items });
        }).catch(error => {
            sendResponse({ success: false, error: error.toString() });
        });
        return true;
    }
});

chrome.runtime.onInstalled.addListener(() => {
    // 확장 프로그램 업데이트/설치 시 기존 캐시 삭제하여 새로운 로직으로 데이터를 다시 받아오도록 함
    chrome.storage.local.remove(['cachedEvents']);
});
