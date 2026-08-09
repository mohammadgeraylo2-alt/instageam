import os
import threading

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse

from instagrapi import Client
from instagrapi.exceptions import LoginRequired

app = FastAPI()

# ---------- لاگین با یک اکانت مشترک (نه لاگین کاربر نهایی) ----------
# یوزرنیم/پسورد رو توی Railway به‌عنوان متغیر محیطی تنظیم کن، نه توی کد:
#   IG_USERNAME=...
#   IG_PASSWORD=...
# .strip() چون کپی/پیست توی Railway گاهی فاصله یا خط جدید مخفی اضافه می‌کنه
# که باعث می‌شه اینستاگرام یوزرنیم رو "پیدا نشد" اعلام کنه.
_raw_username = os.environ.get("IG_USERNAME")
_raw_password = os.environ.get("IG_PASSWORD")
IG_USERNAME = _raw_username.strip() if _raw_username else None
IG_PASSWORD = _raw_password.strip() if _raw_password else None

# پراکسی اختیاری (HTTP/SOCKS5) برای لاگین از IP غیر-دیتاسنتری.
# چون IP سرورهای ابری مثل Railway اغلب توسط اینستاگرام بلاک‌لیست می‌شه.
# فرمت: PROXY_URL=http://user:pass@host:port  یا  socks5://user:pass@host:port
_raw_proxy = os.environ.get("PROXY_URL")
PROXY_URL = _raw_proxy.strip() if _raw_proxy else None

shared_client: Client | None = None
login_lock = threading.Lock()
login_error: str | None = None


def make_client() -> Client:
    cl = Client()
    cl.set_device({
        "app_version": "300.0.0.29.110",
        "android_version": 33,
        "android_release": "13.0",
        "dpi": "420dpi",
        "resolution": "1080x2340",
        "manufacturer": "samsung",
        "device": "SM-A536E",
        "model": "a53x",
        "cpu": "exynos1280",
        "version_code": "480794569",
    })
    cl.set_user_agent()
    if PROXY_URL:
        cl.set_proxy(PROXY_URL)
    return cl


def do_shared_login() -> None:
    """یک بار با اکانت مشترک لاگین می‌کنه و نتیجه رو توی shared_client نگه می‌داره."""
    global shared_client, login_error
    if not IG_USERNAME or not IG_PASSWORD:
        login_error = "متغیرهای IG_USERNAME / IG_PASSWORD روی سرور تنظیم نشدن"
        return
    cl = make_client()
    try:
        cl.login(IG_USERNAME, IG_PASSWORD)
        shared_client = cl
        login_error = None
    except Exception as e:  # noqa: BLE001
        shared_client = None
        login_error = str(e)


@app.on_event("startup")
def on_startup():
    do_shared_login()


def get_client() -> Client:
    global shared_client
    with login_lock:
        if shared_client is None:
            # اگه لاگین اولیه شکست خورده بود، دوباره امتحان کن
            do_shared_login()
        if shared_client is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "not_logged_in",
                    "message": f"اکانت مشترک لاگین نیست: {login_error or 'نامشخص'}",
                },
            )
        return shared_client


def relogin_and_retry(fn):
    """اگه سشن مشترک منقضی شده بود، یه بار دوباره لاگین می‌کنه و تابع رو تکرار می‌کنه."""
    global shared_client
    try:
        return fn(get_client())
    except LoginRequired:
        with login_lock:
            shared_client = None
            do_shared_login()
        if shared_client is None:
            raise HTTPException(
                status_code=503,
                detail={"code": "not_logged_in", "message": login_error or "لاگین دوباره ناموفق بود"},
            )
        return fn(shared_client)


def serialize_media_dict(media: dict) -> dict:
    image_url = None
    try:
        candidates = media.get("image_versions2", {}).get("candidates", [])
        if candidates:
            image_url = candidates[0]["url"]
    except Exception:  # noqa: BLE001
        pass

    video_url = None
    try:
        versions = media.get("video_versions") or []
        if versions:
            video_url = versions[0]["url"]
    except Exception:  # noqa: BLE001
        pass

    owner = media.get("user") or {}
    is_video = media.get("media_type") == 2
    return {
        "id": media.get("id"),
        "code": media.get("code"),
        "is_video": is_video,
        "thumbnail": f"/api/img?url={image_url}" if image_url else None,
        "video_url": f"/api/video?url={video_url}" if (is_video and video_url) else None,
        "caption": (media.get("caption") or {}).get("text", "") if media.get("caption") else "",
        "likes": media.get("like_count", 0),
        "comments": media.get("comment_count", 0),
        "owner_username": owner.get("username", ""),
        "owner_pic": f"/api/img?url={owner.get('profile_pic_url')}" if owner.get("profile_pic_url") else None,
    }


def serialize_media_obj(m) -> dict:
    is_video = m.media_type == 2
    video_url = getattr(m, "video_url", None)
    return {
        "id": m.id,
        "code": m.code,
        "is_video": is_video,
        "thumbnail": f"/api/img?url={m.thumbnail_url}" if m.thumbnail_url else None,
        "video_url": f"/api/video?url={video_url}" if (is_video and video_url) else None,
        "caption": m.caption_text,
        "likes": m.like_count,
        "comments": m.comment_count,
    }


# ---------- وضعیت لاگین اکانت مشترک ----------
@app.get("/api/status")
def status():
    username = shared_client.username if shared_client else None
    return {
        "logged_in": shared_client is not None,
        "username": username,
        "error": login_error,
        # برای عیب‌یابی: طول و نمایش دقیق کاراکترهای IG_USERNAME (بدون افشای پسورد)
        "debug_ig_username_repr": repr(IG_USERNAME),
        "debug_ig_username_len": len(IG_USERNAME) if IG_USERNAME else 0,
    }


# ---------- فید خانه ----------
@app.get("/api/timeline")
def timeline():
    def _call(cl):
        return cl.private_request("feed/timeline/", params={"reason": "pull_to_refresh"})

    try:
        feed = relogin_and_retry(_call)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))

    items = []
    for item in feed.get("feed_items", []):
        media = item.get("media_or_ad")
        if media:
            items.append(serialize_media_dict(media))
    return {"items": items}


# ---------- اکسپلور ----------
@app.get("/api/explore")
def explore():
    def _call(cl):
        return cl.private_request("discover/explore/")

    try:
        data = relogin_and_retry(_call)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))

    items = []
    for section in data.get("sectional_items", []):
        layout = section.get("layout_content", {}) or {}
        medias = layout.get("medias") or []
        for m in medias:
            media = m.get("media")
            if media:
                items.append(serialize_media_dict(media))
    return {"items": items}


# ---------- پروفایل ----------
@app.get("/api/profile/{username}")
def profile(username: str):
    def _call(cl):
        user = cl.user_info_by_username(username)
        medias = cl.user_medias(user.pk, amount=18)
        return user, medias

    try:
        user, medias = relogin_and_retry(_call)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))

    pic = user.profile_pic_url_hd or user.profile_pic_url
    return {
        "username": user.username,
        "full_name": user.full_name,
        "biography": user.biography,
        "followers": user.follower_count,
        "following": user.following_count,
        "posts_count": user.media_count,
        "profile_pic": f"/api/img?url={pic}" if pic else None,
        "posts": [serialize_media_obj(m) for m in medias],
    }


# ---------- ریلز ----------
@app.get("/api/reels")
def reels():
    cl = get_client()
    items = []
    try:
        data = cl.private_request(
            "clips/home/",
            data={"container_module": "clips_viewer_clips_tab", "feed_type": "clips"},
        )
        for item in data.get("items", []):
            media = item.get("media")
            if media:
                items.append(serialize_media_dict(media))
    except Exception:  # noqa: BLE001
        pass

    if not items:
        try:
            data2 = cl.private_request("discover/explore/")
            for section in data2.get("sectional_items", []):
                layout = section.get("layout_content", {}) or {}
                medias = layout.get("medias") or []
                for m in medias:
                    media = m.get("media")
                    if media and media.get("media_type") == 2:
                        items.append(serialize_media_dict(media))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=str(e))

    return {"items": items}


# ---------- پروکسی عکس/تصویر ----------
@app.get("/api/img")
def img_proxy(url: str):
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, stream=True, timeout=15)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e))
    if not r.ok:
        raise HTTPException(status_code=r.status_code)
    return StreamingResponse(r.raw, media_type=r.headers.get("content-type", "image/jpeg"))


# ---------- پروکسی ویدیو (با پشتیبانی Range برای Seek کردن) ----------
@app.get("/api/video")
def video_proxy(url: str, request: Request):
    headers = {"User-Agent": "Mozilla/5.0"}
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    try:
        r = requests.get(url, headers=headers, stream=True, timeout=20)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(e))
    if not r.ok:
        raise HTTPException(status_code=r.status_code)

    resp_headers = {}
    for h in ("content-range", "accept-ranges", "content-length"):
        if h in r.headers:
            resp_headers[h] = r.headers[h]

    return StreamingResponse(
        r.iter_content(chunk_size=65536),
        status_code=r.status_code,
        media_type=r.headers.get("content-type", "video/mp4"),
        headers=resp_headers,
    )


# ---------- فایل‌های فرانت‌اند ----------
app.mount("/", StaticFiles(directory="public", html=True), name="static")
