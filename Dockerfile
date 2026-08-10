FROM teddysun/xray:latest

RUN apk add --no-cache python3

WORKDIR /app
COPY app.py /app/app.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
