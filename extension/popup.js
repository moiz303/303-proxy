document.addEventListener('DOMContentLoaded', async () => {
    // Инициализация элементов UI
    const connectButton = document.getElementById('connectButton');
    const statusElement = document.getElementById('status');

    // Переменные состояния
    let currentUser = null;
    let currentToken = null;
    let autoRefreshInterval = null;

    // Конфигурация из config.js
    const config = CONFIG || {};

    // Обработчики вкладок для авторизованных пользователей
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            // Обновляем активные вкладки
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');

            // Если перешли на вкладку мониторинга, загружаем подключения
            if (tabName === 'monitor') {
                loadConnections();
            }
        });
    });

    async function initExtension() {
        try {
            // Загружаем сохранённые данные
            const result = await chrome.storage.local.get([
                'currentUser',
                'currentToken',
                'isConnected',
                'clientId'
            ]);

            // Проверяем, авторизован ли пользователь
            if (result.currentUser && result.currentToken) {
                currentUser = result.currentUser;
                currentToken = result.currentToken;

                // Если пользователь авторизован, показываем авторизованный вид
                showAuthorizedView();
                updateUI(result.isConnected || false);
                updateUserInfo();

                // Генерируем Client ID если его нет
                if (!result.clientId) {
                    const clientId = generateClientId();
                    document.getElementById('clientId').value = clientId;
                    await chrome.storage.local.set({ clientId: clientId });
                } else {
                    document.getElementById('clientId').value = result.clientId;
                }
            } else {
                // Если пользователь не авторизован, показываем неавторизованный вид
                showUnauthorizedView();
            }

            // Отправляем конфиг в background
            if (config.API_URL || config.PROXY_URL || config.IP_ADDRESS) {
                chrome.runtime.sendMessage({
                    type: 'SET_CONFIG',
                    config: config
                }, (response) => {
                    if (response?.success) {
                        console.log('Config sent to background successfully');
                    }
                });
            }

        } catch (error) {
            console.error('Error initializing extension:', error);
            showAlert('Ошибка инициализации: ' + error.message, 'error');
        }
    }

    // Функция для показа авторизованного вида
    function showAuthorizedView() {
        document.getElementById('unauthorized-view').style.display = 'none';
        document.getElementById('authorized-view').style.display = 'block';
        updateConnectButtonState();
    }

    // Функция для показа неавторизованного вида
    function showUnauthorizedView() {
        document.getElementById('unauthorized-view').style.display = 'block';
        document.getElementById('authorized-view').style.display = 'none';
        // Показываем форму входа по умолчанию
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('toggle-auth-btn').style.display = 'block';

        // Находим кнопку переключения на регистрацию
        const toggleAuthBtn = document.getElementById('toggle-auth-btn');
        if (toggleAuthBtn) {
            toggleAuthBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showRegisterForm();
            });
        }

        // Находим ссылку "Вернуться к входу"
        const backToLoginLink = document.querySelector('a[href="#"]');
        if (backToLoginLink && backToLoginLink.textContent.includes('Вернуться к входу')) {
            backToLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                showLoginForm();
            });
        }
    }

    // Функция обновления информации о пользователе
    function updateUserInfo() {
        if (!currentUser) return;

        const email = currentUser.email;
        const userId = currentUser.user_id || '';

        // Обновляем на вкладке подключения
        const userAvatar = document.getElementById('user-avatar');
        const userEmail = document.getElementById('user-email');
        const userIdSpan = document.getElementById('user-id');

        if (userAvatar) userAvatar.textContent = email.charAt(0).toUpperCase();
        if (userEmail) userEmail.textContent = email;
        if (userIdSpan) userIdSpan.textContent = `ID: ${userId.substring(0, 8)}...`;

        // Обновляем на вкладке мониторинга
        const userAvatarMonitor = document.getElementById('user-avatar-monitor');
        const userEmailMonitor = document.getElementById('user-email-monitor');
        const userIdMonitor = document.getElementById('user-id-monitor');

        if (userAvatarMonitor) userAvatarMonitor.textContent = email.charAt(0).toUpperCase();
        if (userEmailMonitor) userEmailMonitor.textContent = email;
        if (userIdMonitor) userIdMonitor.textContent = `ID: ${userId.substring(0, 8)}...`;
    }

    // Функция генерации Client ID
    function generateClientId() {
        const deviceName = navigator.platform || 'Unknown';
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        return `${deviceName}-${timestamp}-${random}`.toLowerCase().replace(/\s+/g, '-');
    }

    // Функция регистрации нового пользователя
    window.registerUser = async function() {
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value.trim();
        const confirmPassword = document.getElementById('confirmPassword').value.trim();

        // Валидация
        if (!email || !password || !confirmPassword) {
            showAlert('Заполните все поля', 'error');
            return;
        }

        if (password !== confirmPassword) {
            showAlert('Пароли не совпадают', 'error');
            return;
        }

        if (!validateEmail(email)) {
            showAlert('Введите корректный email', 'error');
            return;
        }

        // API_URL берётся из config.js
        const baseUrl = config.API_URL;
        if (!baseUrl) {
            showAlert('API URL не настроен в конфигурации', 'error');
            return;
        }

        showLoading(true);

        try {
            // Отправляем запрос на регистрацию
            const response = await fetch(`${baseUrl}/api/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    extension_name: '303-proxy'
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `Ошибка регистрации: ${response.status}`);
            }

            if (result.status === 'success') {
                // После успешной регистрации сразу авторизуем
                await loginUserDirect(email, password, baseUrl);

                // Очищаем форму регистрации
                document.getElementById('regEmail').value = '';
                document.getElementById('regPassword').value = '';
                document.getElementById('confirmPassword').value = '';

            } else {
                throw new Error(result.message || 'Ошибка регистрации');
            }

        } catch (error) {
            console.error('Ошибка регистрации:', error);
            showAlert('Ошибка регистрации: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    };

    // Функция авторизации существующего пользователя
    window.loginUser = async function() {
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value.trim();

        if (!email || !password) {
            showAlert('Заполните email и пароль', 'error');
            return;
        }

        // API_URL берётся из config.js
        const baseUrl = config.API_URL;
        if (!baseUrl) {
            showAlert('API URL не настроен в конфигурации', 'error');
            return;
        }

        await loginUserDirect(email, password, baseUrl);
    };

    // Вспомогательная функция авторизации
    async function loginUserDirect(email, password, baseUrl) {
        showLoading(true);

        try {
            // Автоматически определяем IP
            const clientIp = await detectLocalIP();

            // Отправляем запрос на авторизацию
            const response = await fetch(`${baseUrl}/api/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    client_ip: clientIp
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `Ошибка авторизации: ${response.status}`);
            }

            if (result.status === 'success') {
                // Сохраняем токен и данные пользователя
                currentUser = {
                    email: email,
                    user_id: result.user_id,
                    extension_id: result.extension_id,
                    session_id: result.session_id
                };

                currentToken = result.access_token;

                // Сохраняем в storage
                await chrome.storage.local.set({
                    currentUser: currentUser,
                    currentToken: currentToken,
                    lastLogin: new Date().toISOString()
                });

                // Отправляем обновлённый конфиг в background
                chrome.runtime.sendMessage({
                    type: 'SET_CONFIG',
                    config: {
                        ...config,
                        AUTH_TOKEN: currentToken,
                        USER_ID: result.user_id,
                        EXTENSION_ID: result.extension_id
                    }
                }, (response) => {
                    if (response?.success) {
                        console.log('Updated config sent to background');
                    }
                });

                // Очищаем форму авторизации
                document.getElementById('email').value = '';
                document.getElementById('password').value = '';

                // Показываем авторизованный вид
                showAuthorizedView();
                updateUserInfo();

                showAlert('Авторизация успешна!', 'success');

            } else {
                throw new Error(result.message || 'Ошибка авторизации');
            }

        } catch (error) {
            console.error('Ошибка авторизации:', error);
            showAlert('Ошибка авторизации: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    }

    // Функция выхода
    window.logoutUser = async function() {
        const { currentUser } = await chrome.storage.local.get(['currentUser']);

        if (!confirm('Вы уверены, что хотите выйти?')) {
            return;
        }

        showLoading(true);

        try {
            // Отправляем запрос на выход если есть соединение
            if (config.API_URL && currentUser?.session_id) {
                await fetch(`${config.API_URL}/api/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        session_id: currentUser.session_id,
                        user_id: currentUser.user_id
                    })
                });
            }

            // Отключаемся от сервера если подключены
            const { isConnected } = await chrome.storage.local.get('isConnected');
            if (isConnected) {
                await disconnectFromServer();
            }

            // Очищаем данные
            await chrome.storage.local.remove([
                'currentUser',
                'currentToken',
                'isConnected',
                'clientId'
            ]);

            currentUser = null;
            currentToken = null;

            // Переключаем на неавторизованный вид
            showUnauthorizedView();

            showAlert('Вы успешно вышли из системы', 'success');

        } catch (error) {
            console.error('Ошибка при выходе:', error);
            showAlert('Ошибка при выходе: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    };

    // Функция для переключения подключения/отключения
    window.toggleConnection = async function() {
        const { isConnected } = await chrome.storage.local.get('isConnected');

        try {
            if (isConnected) {
                await disconnectFromServer();
            } else {
                await connectToServer();
            }
        } catch (error) {
            console.error('Ошибка:', error);
            showAlert('Ошибка: ' + error.message, 'error');
            updateUI(false);
        }
    };

    // Функция подключения к серверу
    async function connectToServer() {
        const clientId = document.getElementById('clientId').value.trim();

        if (!clientId) {
            showAlert('Введите идентификатор устройства', 'error');
            return;
        }

        if (!currentToken) {
            showAlert('Сначала авторизуйтесь', 'error');
            return;
        }

        if (!config.API_URL) {
            showAlert('API URL не настроен в конфигурации', 'error');
            return;
        }

        // Автоматически определяем IP
        const clientIp = await detectLocalIP();

        showLoading(true);
        setStatus('Подключение...', 'processing');
        if (connectButton) connectButton.disabled = true;

        try {
            // Подключаемся к API
            const response = await fetch(`${config.API_URL}/api/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentToken}`
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_ip: clientIp
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `Ошибка сервера: ${response.status}`);
            }

            if (result.status === 'success' || result.status === 'warning') {
                // Сохраняем данные подключения
                await chrome.storage.local.set({
                    isConnected: true,
                    clientId: clientId,
                    clientIp: clientIp,
                    user_id: result.user_id,
                    extension_id: result.extension_id,
                    lastConnection: new Date().toISOString()
                });

                // Определяем прокси-сервер
                let proxyHost, proxyPort;

                if (config.PROXY_URL) {
                    try {
                        const proxyUrl = new URL(config.PROXY_URL);
                        proxyHost = proxyUrl.hostname;
                        proxyPort = proxyUrl.port || 5050;
                    } catch (e) {
                        proxyHost = config.IP_ADDRESS || '127.0.0.1';
                        proxyPort = 5050;
                    }
                } else {
                    proxyHost = config.IP_ADDRESS || '127.0.0.1';
                    proxyPort = 5050;
                }

                // Включаем прокси через background
                await chrome.runtime.sendMessage({
                    action: 'enableProxy',
                    proxyHost: proxyHost,
                    proxyPort: parseInt(proxyPort)
                });

                showAlert(result.message, result.status === 'success' ? 'success' : 'warning');
                updateUI(true);

            } else {
                throw new Error(result.message || 'Ошибка подключения');
            }

        } catch (error) {
            console.error('Ошибка подключения:', error);
            showAlert('Ошибка подключения: ' + error.message, 'error');
            setStatus('Ошибка подключения', 'disconnected');
        } finally {
            showLoading(false);
            updateConnectButtonState();
        }
    }

    // Функция отключения от сервера
    async function disconnectFromServer() {
        const { clientId } = await chrome.storage.local.get(['clientId']);

        if (!clientId) {
            showAlert('Нет данных о текущем подключении', 'error');
            return;
        }

        showLoading(true);
        setStatus('Отключение...', 'processing');

        try {
            // Отключаем прокси
            await chrome.runtime.sendMessage({ action: 'disableProxy' });

            // Уведомляем сервер об отключении
            if (currentToken && config.API_URL) {
                try {
                    const response = await fetch(`${config.API_URL}/api/disconnect`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${currentToken}`
                        },
                        body: JSON.stringify({ client_id: clientId })
                    });

                    const result = await response.json();
                    showAlert(result.message || 'Отключено от сервера', 'success');

                } catch (serverError) {
                    console.log('Сервер недоступен при отключении:', serverError.message);
                }
            }

            // Обновляем статус
            await chrome.storage.local.set({
                isConnected: false,
                proxyEnabled: false
            });

            updateUI(false);

        } catch (error) {
            console.error('Ошибка отключения:', error);
            showAlert('Ошибка отключения: ' + error.message, 'error');
        } finally {
            showLoading(false);
        }
    }

    // Функция загрузки подключений
    window.loadConnections = async function() {
        if (!currentToken) {
            showAlert('Сначала авторизуйтесь', 'error');
            return;
        }

        if (!config.API_URL) {
            showAlert('API URL не настроен в конфигурации', 'error');
            return;
        }

        showLoading(true, true);

        try {
            const response = await fetch(`${config.API_URL}/health`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${currentToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            updateConnectionsUI(data);
            updateApiStatus('✅');

        } catch (error) {
            console.error('Ошибка загрузки подключений:', error);
            updateApiStatus('❌');
            clearConnectionsUI();
            showAlert('Ошибка загрузки: ' + error.message, 'error');
        } finally {
            showLoading(false, true);
        }
    };

    // Вспомогательные функции
    function updateUI(connected) {
        if (!statusElement || !connectButton) return;

        if (connected) {
            setStatus('Подключено ✓', 'connected');
            connectButton.innerHTML = '🔌 Отключиться';
            connectButton.classList.remove('btn-primary');
            connectButton.classList.add('btn-danger');
        } else {
            setStatus('Не подключено', 'disconnected');
            connectButton.innerHTML = '🔗 Подключиться';
            connectButton.classList.remove('btn-danger');
            connectButton.classList.add('btn-primary');
        }
    }

    function setStatus(message, type) {
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `status status-${type}`;
        }
    }

    function updateConnectButtonState() {
        if (!connectButton) return;

        if (!currentUser || !currentToken) {
            connectButton.disabled = true;
            connectButton.style.opacity = '0.6';
            connectButton.style.cursor = 'not-allowed';
            connectButton.title = 'Сначала авторизуйтесь';
        } else {
            connectButton.disabled = false;
            connectButton.style.opacity = '1';
            connectButton.style.cursor = 'pointer';
            connectButton.title = '';
        }
    }

    function showAlert(message, type = 'info') {
        const alertDiv = document.getElementById('alert');
        if (!alertDiv) return;

        alertDiv.textContent = message;
        alertDiv.className = `alert alert-${type}`;
        alertDiv.style.display = 'block';

        setTimeout(() => {
            alertDiv.style.display = 'none';
        }, 3000);
    }

    function showLoading(show, isMonitor = false) {
        // Простая реализация
        if (show) {
            if (isMonitor) {
                const loading = document.getElementById('loading');
                if (loading) loading.style.display = 'block';
            } else {
                if (connectButton) connectButton.disabled = true;
            }
        } else {
            if (isMonitor) {
                const loading = document.getElementById('loading');
                if (loading) loading.style.display = 'none';
            } else {
                updateConnectButtonState();
            }
        }
    }

    function updateApiStatus(status) {
        const apiStatusElement = document.getElementById('apiStatus');
        if (apiStatusElement) {
            apiStatusElement.textContent = status;
        }
    }

    async function detectLocalIP() {
        try {
            // Пробуем определить IP через WebRTC
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            let ip = null;
            pc.createDataChannel('');

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            return new Promise((resolve) => {
                pc.onicecandidate = (ice) => {
                    if (!ice || !ice.candidate || !ice.candidate.candidate) return;
                    const candidate = ice.candidate.candidate;
                    const match = candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
                    if (match && !ip) {
                        ip = match[1];
                        pc.close();
                        resolve(ip);
                    }
                };

                // Таймаут
                setTimeout(() => {
                    pc.close();
                    resolve(config.IP_ADDRESS || '127.0.0.1');
                }, 1000);
            });

        } catch (e) {
            console.log('WebRTC недоступен');
            return config.IP_ADDRESS || '127.0.0.1';
        }
    }

    function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    // Обновление UI подключений
    function updateConnectionsUI(data) {
        const connectionsList = document.getElementById('connectionsList');
        const totalConnections = document.getElementById('totalConnections');

        if (!data.active_connections || Object.keys(data.active_connections).length === 0) {
            connectionsList.innerHTML = `
                <p style="text-align: center; color: #666; padding: 20px;">
                    Нет активных подключений
                </p>
            `;
            totalConnections.textContent = '0';
            return;
        }

        totalConnections.textContent = data.total || Object.keys(data.active_connections).length;

        let html = '';
        Object.entries(data.active_connections).forEach(([clientId, info]) => {
            const details = typeof info === 'object' ? info : {};
            html += `
                <div class="connection-item">
                    <div class="connection-id">
                        <span class="status-indicator indicator-connected"></span>
                        ${clientId}
                    </div>
                    <div class="connection-details">
                        ${details.user_id ? `User: ${details.user_id}` : ''}
                        ${details.extension_id ? ` | Extension: ${details.extension_id}` : ''}
                        ${details.client_ip ? ` | IP: ${details.client_ip}` : ''}
                    </div>
                </div>
            `;
        });

        connectionsList.innerHTML = html;
    }

    // Очистка UI подключений
    function clearConnectionsUI() {
        const connectionsList = document.getElementById('connectionsList');
        connectionsList.innerHTML = `
            <p style="text-align: center; color: #666; padding: 20px;">
                Не удалось загрузить данные
            </p>
        `;
        document.getElementById('totalConnections').textContent = '0';
    }

    // Функции автообновления
    window.startAutoRefresh = function() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }

        autoRefreshInterval = setInterval(() => {
            loadConnections();
        }, 3000);

        showAlert('Автообновление включено', 'success');
    };

    window.stopAutoRefresh = function() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
            showAlert('Автообновление отключено', 'warning');
        }
    };

    function initEventListeners() {
        // Кнопка входа
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', loginUser);
        }

        // Кнопка регистрации
        const registerBtn = document.getElementById('register-btn');
        if (registerBtn) {
            registerBtn.addEventListener('click', registerUser);
        }

        // Кнопка выхода
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', logoutUser);
        }

        // Кнопка подключения/отключения
        const connectBtn = document.getElementById('connectButton');
        if (connectBtn) {
            connectBtn.addEventListener('click', toggleConnection);
        }

        // Кнопки мониторинга
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', loadConnections);
        }

        const autoRefreshBtn = document.getElementById('auto-refresh-btn');
        if (autoRefreshBtn) {
            autoRefreshBtn.addEventListener('click', startAutoRefresh);
        }

        const stopRefreshBtn = document.getElementById('stop-refresh-btn');
        if (stopRefreshBtn) {
            stopRefreshBtn.addEventListener('click', stopAutoRefresh);
        }
    }

    window.showRegisterForm = function() {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const toggleBtn = document.getElementById('toggle-auth-btn');

        if (loginForm) loginForm.style.display = 'none';
        if (registerForm) registerForm.style.display = 'block';
        if (toggleBtn) toggleBtn.style.display = 'none';
    };

    window.showLoginForm = function() {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const toggleBtn = document.getElementById('toggle-auth-btn');

        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'block';
    };

    // Инициализация
    initEventListeners();
    await initExtension();
});