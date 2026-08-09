import os
import io
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PhoneNumberInvalidError,
    FloodWaitError,
)
from telethon.tl.types import User, Chat, Channel

# فایلی که session (به شکل string) توش نگه‌داری می‌شه — نه دیتابیس sqlite قبلی
SESSION_STRING_FILE = os.environ.get("TG_SESSION_STRING_FILE", "tg_session_string.txt")


def get_api_credentials():
    """
    اول از env می‌خونه (TG_API_ID / TG_API_HASH که از my.telegram.org گرفتی).
    اگه ست نشده بودن، با opentele2 یه API رسمی اپ اندروید تلگرام تولید می‌کنه
    تا نیازی به my.telegram.org نباشه (همون روشی که تو ربات ادمین استفاده شده).
    """
    api_id = int(os.environ.get("TG_API_ID", "0") or "0")
    api_hash = os.environ.get("TG_API_HASH", "")
    if api_id and api_hash:
        return api_id, api_hash

    try:
        from opentele2.api import API
        generated = API.TelegramAndroid.Generate(unique_id="personal-site")
        print("INFO: TG_API_ID/TG_API_HASH تنظیم نشده بودن؛ از opentele2 برای تولید API استفاده شد.")
        return generated.api_id, generated.api_hash
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: نه TG_API_ID/TG_API_HASH ست شده، نه opentele2 در دسترسه ({e}). لاگین کار نمی‌کنه.")
        return api_id or 1, api_hash or "x"


API_ID, API_HASH = get_api_credentials()

app = FastAPI()


def load_session_string() -> str:
    p = Path(SESSION_STRING_FILE)
    if p.exists():
        return p.read_text().strip()
    return ""


def save_session_string(session_str: str):
    Path(SESSION_STRING_FILE).write_text(session_str)


client = TelegramClient(StringSession(load_session_string()), API_ID, API_HASH)

# در حافظه: مرحله‌ی لاگین فعلی (چون این سرور شخصیه و تک‌کاربره)
login_state = {"phone": None, "phone_code_hash": None}


async def ensure_connected():
    if not client.is_connected():
        await client.connect()


@app.on_event("startup")
async def startup():
    await ensure_connected()


@app.on_event("shutdown")
async def shutdown():
    if client.is_connected():
        await client.disconnect()


# ---------- وضعیت لاگین ----------
@app.get("/api/auth/status")
async def auth_status():
    await ensure_connected()
    authorized = await client.is_user_authorized()
    return {"authorized": authorized}


class PhoneRequest(BaseModel):
    phone: str


@app.post("/api/auth/send-code")
async def send_code(req: PhoneRequest):
    await ensure_connected()
    try:
        result = await client.send_code_request(req.phone)
    except PhoneNumberInvalidError:
        raise HTTPException(status_code=400, detail={"code": "bad_phone", "message": "شماره نامعتبره (با کد کشور وارد کن، مثلا +98...)"})
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail={"code": "flood_wait", "message": f"تلگرام موقتاً محدودت کرده، {e.seconds} ثانیه صبر کن"})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "unknown", "message": str(e)})

    login_state["phone"] = req.phone
    login_state["phone_code_hash"] = result.phone_code_hash
    return {"sent": True}


class CodeRequest(BaseModel):
    code: str


@app.post("/api/auth/verify-code")
async def verify_code(req: CodeRequest):
    await ensure_connected()
    if not login_state["phone"]:
        raise HTTPException(status_code=400, detail={"code": "no_pending", "message": "اول باید کد بگیری"})

    try:
        await client.sign_in(
            phone=login_state["phone"],
            code=req.code,
            phone_code_hash=login_state["phone_code_hash"],
        )
    except SessionPasswordNeededError:
        return {"need_password": True}
    except (PhoneCodeInvalidError, PhoneCodeExpiredError):
        raise HTTPException(status_code=400, detail={"code": "bad_code", "message": "کد اشتباه یا منقضی شده"})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "unknown", "message": str(e)})

    save_session_string(client.session.save())
    return {"authorized": True}


class PasswordRequest(BaseModel):
    password: str


@app.post("/api/auth/verify-password")
async def verify_password(req: PasswordRequest):
    await ensure_connected()
    try:
        await client.sign_in(password=req.password)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "bad_password", "message": str(e)})
    save_session_string(client.session.save())
    return {"authorized": True}


class ImportSessionRequest(BaseModel):
    session_string: str


@app.post("/api/auth/import-session")
async def import_session(req: ImportSessionRequest):
    """
    ورود مستقیم با یه session string آماده (مثلاً از local_login.py یا خروجی
    ربات ادمین) — برای وقتی که my.telegram.org در دسترس نیست.
    """
    global client
    session_string = req.session_string.strip()
    if not session_string:
        raise HTTPException(status_code=400, detail={"code": "empty", "message": "session رو وارد کن"})

    new_client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
    await new_client.connect()
    try:
        me = await new_client.get_me()
        if me is None:
            raise ValueError("session معتبر نیست")
    except Exception as e:  # noqa: BLE001
        await new_client.disconnect()
        raise HTTPException(status_code=400, detail={"code": "bad_session", "message": f"این session معتبر نیست: {e}"})

    if client.is_connected():
        await client.disconnect()
    client = new_client
    save_session_string(client.session.save())
    return {"authorized": True, "name": me.first_name}


@app.post("/api/auth/logout")
async def logout():
    await ensure_connected()
    if await client.is_user_authorized():
        await client.log_out()
    p = Path(SESSION_STRING_FILE)
    if p.exists():
        p.unlink()
    return {"authorized": False}


async def require_auth():
    await ensure_connected()
    if not await client.is_user_authorized():
        raise HTTPException(status_code=401, detail={"code": "not_authorized", "message": "اول وارد شو"})


def entity_name(entity) -> str:
    if isinstance(entity, User):
        return " ".join(filter(None, [entity.first_name, entity.last_name])) or (entity.username or "بدون نام")
    return getattr(entity, "title", "بدون نام")


# ---------- لیست چت‌ها ----------
@app.get("/api/dialogs")
async def dialogs(limit: int = 30):
    await require_auth()
    result = []
    async for d in client.iter_dialogs(limit=limit):
        entity = d.entity
        last = d.message
        result.append({
            "id": d.id,
            "name": entity_name(entity),
            "is_user": isinstance(entity, User),
            "is_group": isinstance(entity, Chat) or (isinstance(entity, Channel) and not entity.broadcast),
            "is_channel": isinstance(entity, Channel) and entity.broadcast,
            "unread_count": d.unread_count,
            "last_message": (last.message if last and last.message else ""),
            "last_date": last.date.isoformat() if last and last.date else None,
            "avatar": f"/api/avatar/{d.id}",
        })
    return {"dialogs": result}


# ---------- پیام‌های یک چت ----------
@app.get("/api/messages/{chat_id}")
async def messages(chat_id: int, limit: int = 30, offset_id: int = 0):
    await require_auth()
    entity = await client.get_entity(chat_id)
    me = await client.get_me()
    result = []
    async for m in client.iter_messages(entity, limit=limit, offset_id=offset_id):
        has_media = bool(m.photo or m.video or m.document)
        result.append({
            "id": m.id,
            "text": m.message or "",
            "out": m.out,
            "date": m.date.isoformat() if m.date else None,
            "has_media": has_media,
            "media_url": f"/api/media/{chat_id}/{m.id}" if has_media else None,
            "is_photo": bool(m.photo),
            "is_video": bool(m.video),
            "edited": bool(m.edit_date),
            "reply_to_msg_id": m.reply_to.reply_to_msg_id if m.reply_to else None,
            "fwd_from": _fwd_from_name(m),
        })
    result.reverse()
    return {"messages": result, "me_id": me.id}


def _fwd_from_name(m) -> Optional[str]:
    if not m.fwd_from:
        return None
    fh = m.fwd_from
    if fh.from_name:
        return fh.from_name
    return "پیام فوروارد شده"


# ---------- یه پیام تکی (برای پیش‌نمایش ریپلای) ----------
@app.get("/api/message/{chat_id}/{message_id}")
async def get_single_message(chat_id: int, message_id: int):
    await require_auth()
    entity = await client.get_entity(chat_id)
    m = await client.get_messages(entity, ids=message_id)
    if not m:
        raise HTTPException(status_code=404)
    has_media = bool(m.photo or m.video or m.document)
    return {
        "id": m.id,
        "text": m.message or ("رسانه" if has_media else ""),
        "out": m.out,
        "has_media": has_media,
    }


class SendRequest(BaseModel):
    chat_id: int
    text: str
    reply_to: Optional[int] = None


@app.post("/api/send")
async def send(req: SendRequest):
    await require_auth()
    entity = await client.get_entity(req.chat_id)
    m = await client.send_message(entity, req.text, reply_to=req.reply_to)
    return {"id": m.id, "date": m.date.isoformat()}


class EditRequest(BaseModel):
    text: str


@app.put("/api/messages/{chat_id}/{message_id}")
async def edit_message(chat_id: int, message_id: int, req: EditRequest):
    await require_auth()
    entity = await client.get_entity(chat_id)
    try:
        m = await client.edit_message(entity, message_id, req.text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "edit_failed", "message": str(e)})
    return {"id": m.id, "text": m.message or ""}


@app.delete("/api/messages/{chat_id}/{message_id}")
async def delete_message(chat_id: int, message_id: int, for_everyone: bool = True):
    await require_auth()
    entity = await client.get_entity(chat_id)
    await client.delete_messages(entity, message_id, revoke=for_everyone)
    return {"deleted": True}


class ForwardRequest(BaseModel):
    chat_id: int
    message_id: int
    to_chat_id: int


@app.post("/api/forward")
async def forward_message(req: ForwardRequest):
    await require_auth()
    from_entity = await client.get_entity(req.chat_id)
    to_entity = await client.get_entity(req.to_chat_id)
    try:
        m = await client.forward_messages(to_entity, req.message_id, from_entity)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "forward_failed", "message": str(e)})
    return {"id": m.id if not isinstance(m, list) else [x.id for x in m]}


# ---------- آواتار ----------
@app.get("/api/avatar/{chat_id}")
async def avatar(chat_id: int):
    await require_auth()
    entity = await client.get_entity(chat_id)
    buf = io.BytesIO()
    try:
        photo = await client.download_profile_photo(entity, file=buf)
    except Exception:  # noqa: BLE001
        photo = None
    if not photo:
        raise HTTPException(status_code=404)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/jpeg")


# ---------- مدیا (عکس/ویدیو) پیام ----------
@app.get("/api/media/{chat_id}/{message_id}")
async def media(chat_id: int, message_id: int):
    await require_auth()
    entity = await client.get_entity(chat_id)
    m = await client.get_messages(entity, ids=message_id)
    if not m or not (m.photo or m.video or m.document):
        raise HTTPException(status_code=404)

    buf = io.BytesIO()
    await client.download_media(m, file=buf)
    buf.seek(0)

    mime = "application/octet-stream"
    if m.photo:
        mime = "image/jpeg"
    elif m.video:
        mime = "video/mp4"
    elif m.document:
        mime = m.document.mime_type or mime

    return StreamingResponse(buf, media_type=mime)


# ---------- فایل‌های فرانت‌اند ----------
app.mount("/", StaticFiles(directory="public", html=True), name="static")
