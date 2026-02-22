// 구글 캘린더에서 최근 일정을 가져옵니다. (모든 캘린더 대상)
async function fetchCalendarEvents(interactive = true) {
    try {
        console.log("Fetching token...");
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: interactive }, function (token) {
                if (chrome.runtime.lastError || !token) {
                    reject(chrome.runtime.lastError || new Error("Failed to get token"));
                    return;
                }
                resolve(token);
            });
        });

        console.log("Token obtained", token ? "Yes" : "No");

        // 1. 사용자의 캘린더 목록 가져오기
        const calendarListUrl = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
        const calendarListResponse = await fetch(calendarListUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!calendarListResponse.ok) {
            throw new Error(`Calendar List API request failed: ${calendarListResponse.status}`);
        }

        const calendarListData = await calendarListResponse.json();
        const calendars = calendarListData.items || [];
        console.log(`Found ${calendars.length} calendars.`);

        // 캘린더 API 호출 (최근 1년 정도의 데이터를 가져오도록 설정)
        const timeMin = new Date();
        timeMin.setFullYear(timeMin.getFullYear() - 1); // 1년 전부터
        const timeMinStr = timeMin.toISOString();

        // 2. 모든 캘린더에서 일정 가져오기 (병렬 처리)
        console.log("Fetching events from all calendars...");
        const eventPromises = calendars.map(async (calendar) => {
            const calendarId = encodeURIComponent(calendar.id);
            const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMinStr}&maxResults=2500&singleEvents=true&orderBy=startTime`;

            try {
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) {
                    console.warn(`Failed to fetch events for calendar ${calendar.summary}: ${response.status}`);
                    return [];
                }
                const data = await response.json();
                const items = data.items || [];
                return items.map(event => ({
                    ...event,
                    _calendarSummary: calendar.summary,
                    _calendarId: calendar.id
                }));
            } catch (err) {
                console.error(`Error fetching events for calendar ${calendar.summary}:`, err);
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
        const seenTitles = new Set();

        // 역순으로 정렬하여 최근 일정이 먼저 오도록 (결과가 startTime 오름차순이므로)
        for (let i = allEvents.length - 1; i >= 0; i--) {
            const event = allEvents[i];

            // event에는 calendarSummary 속성이 없습니다. eventPromises에서 추가해 줘야 합니다.
            // 위에서 map 할 때 추가하도록 수정해야 함.

            if (event.summary && !seenTitles.has(event.summary)) {
                seenTitles.add(event.summary);
                items.push({
                    title: event.summary || '',
                    location: event.location || '',
                    description: event.description ? event.description.replace(/(<([^>]+)>)/gi, "") : '', // HTML 태그 제거
                    calendarSummary: event._calendarSummary || '',
                    calendarId: event._calendarId || '',
                    startTime: event.start?.dateTime || event.start?.date || '',
                    endTime: event.end?.dateTime || event.end?.date || '',
                    isAllDay: !!event.start?.date
                });
            }
        }

        console.log(`Fetched ${items.length} unique events from ${calendars.length} calendars.`);

        // 가져온 일정을 로컬에 캐시
        await chrome.storage.local.set({ cachedEvents: items });

        return items;

    } catch (error) {
        console.error("Error fetching calendar events:", error);
        return [];
    }
}

// 명시적으로 토큰을 삭제하고 다시 가져오는 함수 (문제 발생 시)
async function refreshEvents() {
    await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token: '' }, resolve));
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
                    sendResponse({ success: false, error: error.toString() });
                });
            }
        });
        return true; // 비동기 응답을 위해 true 반환
    } else if (request.action === 'forceRefresh') {
        refreshEvents().then(items => {
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
