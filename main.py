import os
import uuid
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from instagrapi import Client
from instagrapi.exceptions import (
    TwoFactorRequired,
    ChallengeRequired,
    BadPassword,
    LoginRequired,
)

app = FastAPI()

# session_id -> instagrapi Client (توی حافظه؛ با ری‌استارت سرور همه لاگین‌ها پاک می‌شن)
sessions: dict[str, Client] = {}

# پراکسی اختیاری (HTTP/SOCKS5) برای لاگین از IP غیر-دیتاسنتری.
# چون IP سرورهای ابری مثل Railway اغلب توسط اینستاگرام مشکوک/بلاک‌لیست می‌شه و باعث
# می‌شه حتی پسورد درست هم با خطای BadPassword رد بشه، تنظیم این متغیر محیطی
# (مثلاً یه پراکسی مسکونی/موبایل) لازمه تا لاگین واقعاً کار کنه.
# فرمت: PROXY_URL=http://user:pass@host:port  یا  socks5://user:pass@host:port
PROXY_URL = os.environ.get("PROXY_URL")


def make_client() -> Client:
    cl = Client()
    # یه device profile ثابت و واقعی‌تر (به‌جای پیش‌فرض کتابخونه) که اینستاگرام
    # کمتر به‌عنوان دستگاه ناشناس/اسکریپت بهش شک کنه.
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


class LoginRequest(BaseModel):
    username: str
    password: str
    verification_code: Optional[str] = None


@app.post("/api/login")
def login(req: LoginRequest):
    cl = make_client()
    try:
        if req.verification_code:
            cl.login(req.username, req.password, verification_code=req.verification_code)
        else:
            cl.login(req.username, req.password)
    except TwoFactorRequired:
        raise HTTPException(
            status_code=400,
            detail={"code": "2fa_required", "message": "کد تایید دومرحله‌ای لازمه"},
        )
    except ChallengeRequired:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "challenge_required",
                "message": "اینستاگرام درخواست تایید هویت کرده. اول از اپ رسمی/ایمیل تاییدش کن، بعد دوباره امتحان کن",
            },
        )
    except BadPassword as e:
        # پیام واقعی اینستاگرام رو نگه می‌داریم؛ اگه سرور IP بلاک‌لیست‌شده داشته باشه
        # (خیلی رایج روی Railway/سرورهای ابری) دقیقاً همینجا مشخص می‌شه.
        raise HTTPException(
            status_code=401,
            detail={
                "code": "bad_password",
                "message": (
                    "اینستاگرام پسورد رو رد کرد. اگه مطمئنی درسته، احتمالاً IP سرور "
                    "بلاک‌لیست شده — باید PROXY_URL (پراکسی مسکونی/موبایل) تنظیم بشه. "
                    f"پیام اصلی: {e}"
                ),
            },
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "unknown", "message": str(e)})

    session_id = str(uuid.uuid4())
    sessions[session_id] = cl
    return {"session_id": session_id, "username": cl.username}


def get_client(session_id: str) -> Client:
    cl = sessions.get(session_id)
    if not cl:
        raise HTTPException(
            status_code=401,
            detail={"code": "no_session", "message": "لاگین منقضی شده، دوباره وارد شو"},
        )
    return cl


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


# ---------- فید خانه ----------
@app.get("/api/timeline")
def timeline(session_id: str = Query(...)):
    cl = get_client(session_id)
    try:
        feed = cl.private_request("feed/timeline/", params={"reason": "pull_to_refresh"})
    except LoginRequired:
        raise HTTPException(status_code=401, detail={"code": "no_session", "message": "دوباره وارد شو"})
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
def explore(session_id: str = Query(...)):
    cl = get_client(session_id)
    try:
        data = cl.private_request("discover/explore/")
    except LoginRequired:
        raise HTTPException(status_code=401, detail={"code": "no_session", "message": "دوباره وارد شو"})
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
def profile(username: str, session_id: str = Query(...)):
    cl = get_client(session_id)
    try:
        user = cl.user_info_by_username(username)
        medias = cl.user_medias(user.pk, amount=18)
    except LoginRequired:
        raise HTTPException(status_code=401, detail={"code": "no_session", "message": "دوباره وارد شو"})
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
def reels(session_id: str = Query(...)):
    cl = get_client(session_id)
    items = []
    try:
        # این endpoint رسمی نیست و ممکنه اینستاگرام فرمتش رو عوض کنه
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

    # اگه endpoint بالا کار نکرد، از اکسپلور فقط ویدیوها رو فیلتر کن
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
            
