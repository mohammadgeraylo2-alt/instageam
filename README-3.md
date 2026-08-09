# دیپلوی Xray (VLESS + WebSocket) روی Railway

## مراحل دیپلوی

1. این پوشه رو به یه ریپوی گیت‌هاب push کن (یا مستقیم با Railway CLI دیپلوی کن).
2. توی [railway.app](https://railway.app) یه پروژه‌ی جدید بساز و ریپو رو وصل کن (New Project → Deploy from GitHub repo).
3. Railway به‌صورت خودکار Dockerfile رو تشخیص می‌ده و بیلد می‌کنه.
4. توی تب **Settings → Networking**، روی **Generate Domain** بزن تا یه دامنه‌ی عمومی مثل `your-app.up.railway.app` بگیری.
   - مطمئن شو Target Port روی `8080` تنظیم شده باشه.
5. صبر کن دیپلوی تموم بشه (لاگ‌ها رو توی تب Deployments چک کن).

## کانفیگ کلاینت (لینک VLESS)

بعد از گرفتن دامنه، `your-app.up.railway.app` رو توی لینک زیر جایگزین کن:

```
vless://a9c3279d-483f-479a-8dc6-a59240d24169@your-app.up.railway.app:443?type=ws&security=tls&path=%2Fa9c3279d-483f-479a-8dc6-a59240d24169-vless&host=your-app.up.railway.app#RailwayRelay
```

این لینک رو توی v2rayN، v2rayNG، NekoBox یا هر کلاینت VLESS دیگه import کن.

## نکات امنیتی

- UUID و path توی این فایل نمونه هستن — قبل از استفاده‌ی واقعی، UUID جدید با `xray uuid` بساز و path رو هم عوض کن تا لینک قابل حدس نباشه.
- اگه چند نفر می‌خوان از این سرور استفاده کنن، توی `clients` آرایه، هرکدوم رو با UUID جدا اضافه کن.
