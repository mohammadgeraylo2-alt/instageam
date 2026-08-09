# Xray روی Railway + ساخت خودکار کانفیگ از طریق ربات تلگرام

## فایل‌ها (فقط ۴ تا)
- `Dockerfile`
- `app.py` — همه‌کاره: ساخت کانفیگ زنده، API مدیریتی، چک حجم/انقضا
- `entrypoint.sh` — استارت‌کننده
- `README.md`

## مراحل راه‌اندازی روی Railway

### ۱. یه Volume بساز (ضروری)
Settings → Volumes → mount path: `/data`
بدون این، با هر push جدید همه‌ی کانفیگ‌های ساخته‌شده پاک می‌شن.

### ۲. Environment Variables
- `MANAGE_SECRET` — یه رشته‌ی رندوم طولانی (رمز مشترک بین ربات و این سرور)
- `PUBLIC_DOMAIN` — دامنه‌ای که Railway بهت داده (مثلاً `instageam-production.up.railway.app`)

### ۳. دو تا دامنه‌ی عمومی
- دامنه‌ی موجود → target port `8080` (این پورت VPN هست)
- یه دامنه‌ی جدید بساز → target port `8081` (این پورت API مدیریتیه که ربات باهاش صحبت می‌کنه)

### ۴. push کن

## مراحل سمت ربات تلگرام
فایل `admin_bot-4-4-1-6.py` رو جایگزین قبلی کن و این Environment Variables رو اضافه کن:
- `XRAY_MANAGE_URL` = آدرس دامنه‌ی دوم + `/create`
- `XRAY_MANAGE_SECRET` = همون مقدار `MANAGE_SECRET`

## استفاده
```
/getconfig
> چند گیگ؟ 30
> چند روز؟ 10
```
لینک `vless://...` رو برمی‌
گردونه.
