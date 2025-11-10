from flask import Flask, request, jsonify
from flask_cors import CORS

import os, sys

sys.path.append('/app')  # Добавляем корень проекта

from proxy_logic.proxy_core import connect_client, disconnect_client



app = Flask(__name__)
CORS(app)
# Глобальная переменная для хранения подключенных клиентов
active_clients = set()

PROXY_SERVER_URL = os.getenv('PROXY_SERVER_URL', 'https://72.56.72.131:5050')


@app.route('/api/connect', methods=['POST'])
def handle_connect():
    """Обработчик подключения клиента"""
    try:
        client_ip = request.remote_addr
        # Отправляем запрос на подключение в proxy_logic
        connect_client(client_ip)

        return jsonify({
            "status": "success",
            "message": f"Client {client_ip} authorized to connect to proxy on server:5050",
            "active_clients": len(active_clients)
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })


@app.route('/api/disconnect', methods=['POST'])
def handle_disconnect():
    """Обработчик отключения клиента"""
    try:
        client_ip = request.remote_addr
        # Отправляем запрос на отключение в proxy_logic
        disconnect_client(client_ip)

        return jsonify({
            "status": "success",
            "message": f"Disconnected connection for {client_ip}",
            "active_clients": len(active_clients)
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        })


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "active_clients": len(active_clients)})