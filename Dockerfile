FROM teddysun/xray:latest

RUN apk add --no-cache python3

WORKDIR /app
COPY app.py /app/app.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
EXPOSE 8081

ENTRYPOINT ["/app/entrypoint.sh"]
