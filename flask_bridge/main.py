from flask import Flask, request, jsonify
from flask_cors import CORS

import os, sys
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

from auth_manager import token_required

sys.path.append('/app')  # Добавляем корень проекта
from proxy_logic.proxy_core import connect_client, disconnect_client, get_active_connections


app = Flask(__name__)
CORS(app)

import asyncio

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

        if not client_id:
            return jsonify({"status": "error", "message": "client_id is required"}), 400

        user_id = request.user_id
        extension_id = request.extension_id

        success = run_async(connect_client(client_id, user_id, extension_id))

        if success:
            return jsonify({
                "status": "success",
                "message": f"Client {client_id} authorized",
                "user_id": user_id,
                "extension_id": extension_id,
                "client_id": client_id
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