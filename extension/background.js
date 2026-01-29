let config = {
    IP_ADDRESS: null,
    API_URL: null,
    PROXY_URL: null
};

// Восстановление конфига при запуске
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get(['backgroundConfig'], (result) => {
        if (result.backgroundConfig) {
            config = result.backgroundConfig;
            console.log('Config restored on startup:', config);
        }
    });
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['backgroundConfig'], (result) => {
        if (result.backgroundConfig) {
            config = result.backgroundConfig;
            console.log('Config restored on install:', config);
        }
    });
});

// Обработчик сообщений от popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 Получено сообщение в background:', request.type || request.action);

    // Обработка конфигурации из popup
    if (request.type === 'SET_CONFIG') {
        config = { ...config, ...request.config };

        // Сохраняем в storage для персистентности
        chrome.storage.local.set({ backgroundConfig: config }, () => {
            console.log('Config saved in background:', config);
            sendResponse({ success: true });
        });
        return true;
    }

    // Включение прокси
    if (request.action === 'enableProxy') {
        enableProxy(request.proxyHost, request.proxyPort)
            .then(() => sendResponse({ status: 'success' }))
            .catch(error => sendResponse({ status: 'error', message: error.message }));
        return true;
    }

    // Отключение прокси
    if (request.action === 'disableProxy') {
        disableProxy()
            .then(() => sendResponse({ status: 'success' }))
            .catch(error => sendResponse({ status: 'error', message: error.message }));
        return true;
    }

    // Получение статуса прокси
    if (request.action === 'getProxyStatus') {
        chrome.proxy.settings.get({}, (proxyConfig) => {
            sendResponse({
                status: 'success',
                isEnabled: proxyConfig.value?.mode === 'fixed_servers',
                proxyConfig: proxyConfig
            });
        });
        return true;
    }

    // Получение конфига
    if (request.action === 'getConfig') {
        sendResponse({ config: config });
        return true;
    }

    // Автоматическое подключение
    if (request.action === 'autoConnect') {
        autoConnect()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ status: 'error', message: error.message }));
        return true;
    }

    // Проверка подключения
    if (request.action === 'checkConnection') {
        checkConnection()
            .then(status => sendResponse({ status: 'success', connected: status }))
            .catch(error => sendResponse({ status: 'error', message: error.message }));
        return true;
    }
});

// Функция для настройки прокси
async function enableProxy(host = null, port = null) {
    let proxyHost, proxyPort;

    if (host && port) {
        // Параметры переданы из popup
        proxyHost = host;
        proxyPort = parseInt(port);
        console.log('Using proxy from popup parameters:', proxyHost, ':', proxyPort);
    }
    else if (config.PROXY_URL) {
        // Используем PROXY_URL из конфига
        try {
            const proxyUrl = new URL(config.PROXY_URL);
            proxyHost = proxyUrl.hostname;
            proxyPort = proxyUrl.port || 5050;
            console.log('Using PROXY_URL from config:', config.PROXY_URL);
        } catch (e) {
            console.error('Invalid PROXY_URL in config:', config.PROXY_URL, e);
            proxyHost = config.IP_ADDRESS || '127.0.0.1';
            proxyPort = 5050;
        }
    }
    else if (config.IP_ADDRESS) {
        // Используем IP_ADDRESS из конфига + порт 5050
        proxyHost = config.IP_ADDRESS;
        proxyPort = 5050;
        console.log('Using IP_ADDRESS from config:', config.IP_ADDRESS);
    }
    else {
        // Значения по умолчанию
        proxyHost = '127.0.0.1';
        proxyPort = 5050;
        console.log('Using default proxy settings');
    }

    console.log('Final proxy settings - Host:', proxyHost, 'Port:', proxyPort);

    return new Promise((resolve, reject) => {
        // Создаем bypassList - какие домены НЕ идут через прокси
        const bypassList = [
            "localhost",
            "127.0.0.1",
            proxyHost
        ];

        // Добавляем API домен в bypassList, чтобы API запросы шли напрямую
        if (config.API_URL) {
            try {
                const apiUrl = new URL(config.API_URL);
                bypassList.push(apiUrl.hostname);
                console.log('Adding API to bypass list:', apiUrl.hostname);
            } catch (e) {
                console.error('Invalid API_URL in config:', config.API_URL, e);
            }
        }

        // Если PROXY_URL - домен (не IP), добавляем его тоже в bypassList
        if (config.PROXY_URL && config.PROXY_URL !== proxyHost) {
            try {
                const proxyUrlObj = new URL(config.PROXY_URL);
                if (proxyUrlObj.hostname !== proxyHost) {
                    bypassList.push(proxyUrlObj.hostname);
                    console.log('Adding PROXY_URL to bypass list:', proxyUrlObj.hostname);
                }
            } catch (e) {
                // Игнорируем ошибку
            }
        }

        // Убираем дубликаты и null значения
        const uniqueBypassList = [...new Set(bypassList.filter(Boolean))];

        const proxyConfig = {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: "http",
                    host: proxyHost,
                    port: proxyPort
                },
                bypassList: uniqueBypassList
            }
        };

        console.log('Setting proxy config:', proxyConfig);

        chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular' }, () => {
            if (chrome.runtime.lastError) {
                console.error('❌ Proxy setup error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('✅ Proxy enabled successfully');
                console.log('Proxy server:', `${proxyHost}:${proxyPort}`);
                console.log('Bypass list:', uniqueBypassList);

                // Сохраняем статус прокси
                chrome.storage.local.set({
                    proxyEnabled: true,
                    proxyHost: proxyHost,
                    proxyPort: proxyPort,
                    lastProxyUpdate: new Date().toISOString()
                }, () => {
                    resolve();
                });
            }
        });
    });
}

// Функция для отключения прокси
async function disableProxy() {
    return new Promise((resolve, reject) => {
        chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }, () => {
            if (chrome.runtime.lastError) {
                console.error('❌ Proxy disable error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('✅ Proxy disabled');

                // Обновляем статус
                chrome.storage.local.set({
                    proxyEnabled: false,
                    isConnected: false
                }, () => {
                    resolve();
                });
            }
        });
    });
}

// Функция автоматического подключения
async function autoConnect() {
    try {
        const storage = await chrome.storage.local.get([
            'isConnected',
            'clientId',
            'clientIp',
            'currentUser',
            'currentToken'
        ]);

        if (!storage.isConnected || !config.API_URL || !storage.currentToken) {
            return { status: 'skipped', message: 'No saved connection or user' };
        }

        console.log('Attempting auto-connection for user:', storage.currentUser?.email);

        // Проверяем подключение к серверу
        const response = await fetch(`${config.API_URL}/health`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${storage.currentToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Server not available');
        }

        const data = await response.json();

        // Проверяем, есть ли наш client_id в активных подключениях
        const isStillConnected = data.active_connections &&
                                data.active_connections[storage.clientId];

        if (isStillConnected) {
            // Включаем прокси
            await enableProxy(storage.clientIp || config.IP_ADDRESS || '127.0.0.1', 5050);
            console.log('✅ Auto-connection successful');
            return { status: 'success', message: 'Auto-connected successfully' };
        } else {
            // Наше подключение не активно на сервере
            await chrome.storage.local.set({ isConnected: false });
            return { status: 'warning', message: 'Connection lost on server' };
        }

    } catch (error) {
        console.error('❌ Auto-connection failed:', error);
        await chrome.storage.local.set({ isConnected: false });
        await disableProxy();
        return { status: 'error', message: error.message };
    }
}

// Функция проверки подключения
async function checkConnection() {
    return new Promise((resolve) => {
        chrome.proxy.settings.get({}, (proxyConfig) => {
            const isProxyEnabled = proxyConfig.value?.mode === 'fixed_servers';
            resolve(isProxyEnabled);
        });
    });
}

// Функция для работы с API
async function callApi(endpoint, method = 'GET', data = null) {
    if (!config.API_URL) {
        throw new Error('API URL not configured');
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    // Добавляем токен если есть
    const storage = await chrome.storage.local.get(['currentToken']);
    if (storage.currentToken) {
        headers['Authorization'] = `Bearer ${storage.currentToken}`;
    }

    const options = {
        method: method,
        headers: headers
    };

    if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(`${config.API_URL}${endpoint}`, options);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Периодическая проверка подключения (опционально)
setInterval(() => {
    chrome.storage.local.get(['isConnected', 'proxyEnabled'], async (result) => {
        if (result.isConnected && result.proxyEnabled) {
            try {
                const isConnected = await checkConnection();
                if (!isConnected) {
                    console.log('Proxy was disabled, attempting to reconnect...');
                    // Можно попробовать переподключиться
                }
            } catch (error) {
                console.log('Background connection check failed:', error.message);
            }
        }
    });
}, 30000); // Проверка каждые 30 секунд

// Обработка отключения расширения
chrome.runtime.onSuspend.addListener(() => {
    console.log('Extension is being suspended');
    // Можно отправить запрос на отключение перед закрытием
});

// Уведомления о статусе (опционально)
function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: title,
        message: message,
        priority: 1
    });
}

// Экспортируем функции для отладки (опционально)
if (typeof window !== 'undefined') {
    window.background = {
        enableProxy,
        disableProxy,
        checkConnection,
        callApi,
        getConfig: () => config
    };
}