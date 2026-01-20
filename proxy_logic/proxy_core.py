import asyncio
import datetime as dt
import os
from typing import Dict, Set, Optional

from database import db_manager
from models import ClientConnection

server_ip = os.getenv('SERVER_IP')

active_connections: Dict[str, asyncio.StreamWriter] = {}
authorized_clients: Set[str] = set()


async def connect_client(client_id: str, user_id: str,
                         extension_id: str, client_ip: Optional[str] = None) -> bool:
    """
    Авторизуем клиента для подключения к прокси
    """

    if client_id in authorized_clients:
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_id} уже авторизован")
        return False

    authorized_clients.add(client_id)
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_id} авторизован для подключения")

    try:
        session = db_manager.get_session()

        connection = ClientConnection(
            client_id=client_id,  # ← Уникальный ID клиента
            client_ip=client_ip,  # ← Больше информации о пользователе
            user_id=user_id,
            extension_id=extension_id
        )
        session.add(connection)
        session.commit()

        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_id} авторизован (User: {user_id})")

        return True

    except Exception as e:
        print(f"Error creating connection record: {e}")
        if session:
            session.rollback()
            return False
    finally:
        if session:
            session.close()
            return False


async def disconnect_client(client_id: str, user_id: Optional[str] = None) -> bool:
    """
    Закрываем соединение с прокси для клиента
    """

    # 1. Ищем среди активных подключений
    connections_to_close = []

    for active_id, writer in list(active_connections.items()):
        # Сравниваем только часть до : если это IP:PORT
        if ':' in client_id and ':' in active_id:
            client_ip = client_id.split(':')[0]
            active_ip = active_id.split(':')[0]
            if client_ip == active_ip:
                connections_to_close.append(active_id)
        elif client_id == active_id:
            connections_to_close.append(client_id)

    # 2. Закрываем найденные соединения
    closed_count = 0
    for conn_id in connections_to_close:
        if conn_id in active_connections:
            try:
                writer = active_connections[conn_id]
                writer.close()
                await writer.wait_closed()
                del active_connections[conn_id]
                closed_count += 1
                print(f"{dt.datetime.now().strftime('%H:%M:%S')} Закрыто соединение: {conn_id}")
            except Exception as e:
                print(f"{dt.datetime.now().strftime('%H:%M:%S')} Ошибка при закрытии {conn_id}: {e}")

    # 3. Удаляем из авторизованных
    if client_id in authorized_clients:
        authorized_clients.remove(client_id)
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_id} удален из авторизованных")

    try:
        session = db_manager.get_session()

        query = session.query(ClientConnection).filter(
            ClientConnection.client_id == client_id,  # ← Ищем по client_id
            ClientConnection.is_active == True
        )

        if user_id:
            query = query.filter(ClientConnection.user_id == user_id)

        connection = query.first()
        if connection:
            connection.is_active = False
            session.commit()
            print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_id} отключен")
            return closed_count > 0 or client_id in authorized_clients
        else:
            print(f"Клиент {client_id} не найден")
            return False

    except Exception as e:
        print(f"Error disconnecting client: {e}")
        if session:
            session.rollback()
            return False
    finally:
        if session:
            session.close()
            return False


async def handle_client_proxy(reader, writer):
    """
    Обработка клиента прокси-сервера с поддержкой HTTPS
    """
    addr = writer.get_extra_info('peername')
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Подключен клиент: {addr[0]}:{addr[1]}")

    client_id = f"{addr[0]}:{addr[1]}"
    active_connections[client_id] = writer

    try:
        # 1. Получаем HTTP-запрос от клиента
        request_data = await reader.read(4096)
        request = request_data.decode('utf-8')
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Получен запрос:\n{request}")

        # Проверяем, не обращается ли клиент к самому прокси
        if f'Host: {server_ip}:5050' in request:
            response = """HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n
                    <html><body><h1>Proxy Server Running</h1>
                    <p>Configure your browser to use this proxy, don't access it directly.</p>
                    </body></html>"""
            writer.write(response.encode())
            await writer.drain()
            return

        # 2. Определяем тип запроса и извлекаем хост
        if request.startswith('CONNECT'):
            # Тип HTTPS: извлекаем хост:порт из CONNECT запроса
            host_port = request.split(' ')[1]
            if ':' in host_port:
                host, port = host_port.split(':')
                port = int(port)
            else:
                host, port = host_port, 443

            print(f"🔐 HTTPS подключение к {host}:{port}")

            try:
                remote_reader, remote_writer = await asyncio.open_connection(host, port)

                # Отправляем подтверждение туннеля
                response = "HTTP/1.1 200 Connection Established\r\n\r\n"
                writer.write(response.encode())
                await writer.drain()

                # Туннелируем данные
                await asyncio.gather(
                    forward_data(remote_reader, writer),  # сервер -> клиент
                    forward_data(reader, remote_writer)  # клиент -> сервер
                )

            except Exception as e:
                print(f"❌ Ошибка HTTPS подключения к {host}:{port}: {e}")
                error_response = "HTTP/1.1 502 Bad Gateway\r\n\r\n"
                writer.write(error_response.encode())
                await writer.drain()

        else:
            # Тип HTTP: извлекаем хост из заголовка
            host_line = next((line for line in request.split('\r\n') if line.startswith('Host: ')), None)
            if host_line:
                host = host_line.split(' ')[1].split(':')[0]
                port = 80

                print(f"🌐 HTTP подключение к {host}:{port}")

                try:
                    remote_reader, remote_writer = await asyncio.open_connection(host, port)

                    # Для HTTP отправляем исходный запрос
                    remote_writer.write(request_data)
                    await remote_writer.drain()

                    # Туннелируем данные
                    await asyncio.gather(
                        forward_data(remote_reader, writer),  # сервер -> клиент
                        forward_data(reader, remote_writer)  # клиент -> сервер
                    )

                except Exception as e:
                    print(f"❌ Ошибка HTTP подключения к {host}:{port}: {e}")
                    error_response = "HTTP/1.1 502 Bad Gateway\r\n\r\n"
                    writer.write(error_response.encode())
                    await writer.drain()
            else:
                print("❌ Не удалось определить Host в HTTP запросе")
                error_response = "HTTP/1.1 400 Bad Request\r\n\r\n"
                writer.write(error_response.encode())
                await writer.drain()

    except Exception as e:
        print(f"💥 Общая ошибка: {e}")
    finally:
        active_connections.pop(client_id, None)
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {addr[0]}:{addr[1]} отключен")
        writer.close()
        await writer.wait_closed()
        if 'remote_writer' in locals():
            remote_writer.close()
            await remote_writer.wait_closed()


async def forward_data(reader, writer):
    """
    Перенаправление данных в обе стороны
    """
    try:
        while True:
            try:
                data = await asyncio.wait_for(reader.read(4096), timeout=10.0)
            except asyncio.TimeoutError:
                print("Timeout!")
                break

            if not data:
                break
            writer.write(data)
            await writer.drain()
    except asyncio.CancelledError:
        pass


async def is_client_authorized(client_ip: str, client_id: str) -> bool:
    """
    Проверяем, авторизован ли клиент для подключения
    """
    # Проверяем по полному client_id (IP:PORT)
    if client_id in authorized_clients:
        return True

    # Проверяем по IP (если авторизован по IP)
    for auth_id in authorized_clients:
        if ':' in auth_id:
            auth_ip = auth_id.split(':')[0]
            if auth_ip == client_ip:
                return True

    return False


async def get_active_connections() -> Dict[str, Dict]:
    """
    Получаем информацию об активных подключениях
    """
    connections_info = {}

    for client_id, writer in active_connections.items():
        try:
            addr = writer.get_extra_info('peername')
            sock = writer.get_extra_info('socket')

            connections_info[client_id] = {
                'ip': addr[0],
                'port': addr[1],
                'socket_family': sock.family if sock else None,
                'socket_type': sock.type if sock else None,
                'authorized': client_id in authorized_clients or
                              any(auth_id.split(':')[0] == addr[0]
                                  for auth_id in authorized_clients if ':' in auth_id)
            }
        except Exception as e:
            connections_info[client_id] = {'error': str(e)}

    return connections_info


async def start_proxy_server(host: str='localhost', port: int=5050):
    """Запуск прокси-сервера"""
    server = await asyncio.start_server(handle_client_proxy, host, port)

    addr = server.sockets[0].getsockname()
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Прокси запущен на http://{addr[0] if addr[0] != '::1' else '127.0.0.1'}:{addr[1]}\n")

    async with server:
        await server.serve_forever()


async def main(host:str, port:int):
    server_task = asyncio.create_task(start_proxy_server(host, port)) # Создаём серверный таск
    await asyncio.sleep(0.1) # Даём серверу время на запуск

    try: # Ждём, когда к нам кто-нибудь придёт)
        await server_task

    finally: # При выходе - остановка сервера
        server_task.cancel()
        # Ждём полной остановки сервера
        try: await server_task
        except asyncio.CancelledError: pass


if __name__ == '__main__':
    try:
        # Запускаем прокси-сервер в фоновом режиме
        asyncio.run(main('0.0.0.0', 5050))
        result = {"status": "success", "message": "Proxy server started successfully"}
    except KeyboardInterrupt:
        pass
