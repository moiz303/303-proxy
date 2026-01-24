from flask import Flask, request, jsonify
from flask_cors import CORS

import os, sys
import asyncio
from pathlib import Path
# Загружаем .env
project_root = Path(__file__).parent.parent
env_path = project_root / '.env'

if env_path.exists():
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip().strip('\'"')

PROXY_SERVER_URL = os.getenv('PROXY_SERVER_URL')

from auth_manager import token_required, ExtensionAuthManager

sys.path.append('/app')  # Добавляем корень проекта
from proxy_logic.proxy_core import connect_client, disconnect_client, get_active_connections


app = Flask(__name__)
CORS(app)

eam = ExtensionAuthManager()

def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@app.route('/api/connect', methods=['POST'])
@token_required
def handle_connect():
    """
    Подключение клиента
    """
    try:
        data = request.get_json()
        client_id = data.get('client_id')
        client_ip = data.get('client_ip')

        if not client_id:
            return jsonify({"status": "error", "message": "client_id is required"}), 400

        user_id = request.user_id
        extension_id = request.extension_id

        success = run_async(connect_client(client_id, user_id, extension_id, client_ip))

        if success:
            return jsonify({
                "status": "success",
                "message": f"Client {client_id} authorized",
                "user_id": user_id,
                "extension_id": extension_id,
                "client_id": client_id,
                "client_ip": client_ip
            })
        else:
            return jsonify({
                "status": "warning",
                "message": f"Client {client_id} already authorized"
            })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/disconnect', methods=['POST'])
@token_required
def handle_disconnect():
    """
    Отключение клиента
    """
    try:
        data = request.get_json()
        client_id = data.get('client_id')

        if not client_id:
            return jsonify({"status": "error", "message": "client_id is required"}), 400

        user_id = request.user_id

        success = run_async(disconnect_client(client_id, user_id))

        if success:
            return jsonify({
                "status": "success",
                "message": f"Client {client_id} disconnected",
                "user_id": user_id,
                "client_id": client_id
            })
        else:
            return jsonify({
                "status": "warning",
                "message": f"Client {client_id} not found"
            })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """
    Получение списка активных подключений
    """
    try:
        connections = run_async(get_active_connections())

        # Фильтруем по user_id (нужна логика сопоставления client_id -> user_id)
        user_connections = {
            cid: info for cid, info in connections.items()
        }

        return jsonify({
            "user_id": request.user_id,
            "active_connections": user_connections,
            "total": len(user_connections)
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/register', methods=['POST'])
def handle_register():
    """
    Регистрация нового пользователя
    """
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        extension_name = data.get('extension_name')

        if not all([email, password, extension_name]):
            return jsonify({"status": "error", "message": "All fields are required"}), 400

        # Вызываем ваш метод регистрации
        success, user_id, extension_id = eam.register_user(email, password, extension_name)

        if success:
            return jsonify({
                "status": "success",
                "message": "User registered successfully",
                "user_id": user_id,
                "extension_id": extension_id
            })
        else:
            return jsonify({
                "status": "error",
                "message": "User already exists or registration failed"
            }), 400

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth', methods=['POST'])
def handle_auth():
    """
    Авторизация пользователя
    """
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        client_ip = data.get('client_ip')

        if not email or not password:
            return jsonify({"status": "error", "message": "Email and password are required"}), 400

        # Авторизуем пользователя
        success, user_data = eam.authenticate_user(email, password, client_ip)

        if success:
            # Создаём токен
            user_id = user_data['user_id']
            extension_id = user_data['extension_id']
            access_token = eam.create_access_token(user_id, extension_id)

            return jsonify({
                "status": "success",
                "message": "Authentication successful",
                "user_id": user_id,
                "extension_id": extension_id,
                "session_id": user_data.get('session_id'),
                "access_token": access_token
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Invalid credentials"
            }), 401

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/logout', methods=['POST'])
@token_required
def handle_logout():
    """
    Logout пользователя
    """
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        user_id = data.get('user_id') or request.user_id

        success = eam.logout_user(session_id, user_id)

        if success:
            return jsonify({
                "status": "success",
                "message": "Logged out successfully"
            })
        else:
            return jsonify({
                "status": "warning",
                "message": "No active session found"
            })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
