import asyncio
import datetime as dt

active_connections = {}


def connect_client(client_ip):
    """Авторизуем клиента для подключения к прокси"""
    if not hasattr(connect_client, 'authorized_clients'):
        connect_client.authorized_clients = set()
    connect_client.authorized_clients.add(client_ip)
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {client_ip} авторизован для подключения")


def disconnect_client(client_ip):
    """Закрываем соединение с прокси для клиента"""
    for client_id, writer in list(active_connections.items()):
        if client_id.startswith(client_ip):
            writer.close()


async def handle_client_proxy(reader, writer):
    """Обработка клиента прокси-сервера с поддержкой HTTPS"""
    addr = writer.get_extra_info('peername')
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Подключен клиент: {addr[0]}: {addr[1]}")

    client_id = f"{addr[0]}:{addr[1]}"
    active_connections[client_id] = writer

    try:
        # 1. Получаем HTTP-запрос от клиента
        request_data = await reader.read(4096)
        request = request_data.decode('utf-8')
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Получен запрос:\n{request}")

        # Проверяем, не обращается ли клиент к самому прокси
        if 'Host: 72.56.72.131:5050' in request:
            # Отправляем простую страницу-заглушку
            response = """HTTPS/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n
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

            # Отправляем подтверждение туннеля
            response = "HTTPS/1.1 200 Connection established\r\n\r\n"
            writer.write(response.encode())
            await writer.drain()
            request_data = b""  # Для HTTPS не передаем исходный запрос
        else:
            # Тип HTTP: извлекаем хост из заголовка
            host = request.split('Host: ')[1].split('\r\n')[0]
            if ':80' in host:
                host = host.replace(':80', '')
            port = 80

        # 3. Подключаемся к целевому серверу
        remote_reader, remote_writer = await asyncio.open_connection(host, port)

        # Для HTTP отправляем исходный запрос
        if request_data:
            remote_writer.write(request_data)
            await remote_writer.drain()

        # 4. Перенаправляем трафик в обе стороны
        await asyncio.gather(
            forward_data(remote_reader, writer),  # сервер -> клиент
            forward_data(reader, remote_writer)   # клиент -> сервер
        )

    finally:
        active_connections.pop(client_id, None)
        print(f"{dt.datetime.now().strftime('%H:%M:%S')} Клиент {addr[0]}: {addr[1]} отключен")
        writer.close()
        await writer.wait_closed()
        if 'remote_writer' in locals():
            remote_writer.close()
            await remote_writer.wait_closed()


async def forward_data(reader, writer):
    """Перенаправление данных в обе стороны"""
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


async def start_proxy_server(host: str='localhost', port: int=5050):
    """Запуск прокси-сервера"""
    server = await asyncio.start_server(handle_client_proxy, host, port)

    addr = server.sockets[0].getsockname()
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} Прокси запущен на https://{addr[0] if addr[0] != '::1' else '127.0.0.1'}:{addr[1]}\n")

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
        result = {"status": "success", "message": "Proxy server started on https://72.56.72.131:5050"}
    except KeyboardInterrupt:
        pass
