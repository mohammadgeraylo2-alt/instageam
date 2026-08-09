const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginError = document.getElementById('login-error');

const stepPhone = document.getElementById('step-phone');
const stepCode = document.getElementById('step-code');
const stepPassword = document.getElementById('step-password');
const stepImport = document.getElementById('step-import');

let currentChatId = null;
let pollTimer = null;
let dialogsCache = [];      // [{id, name}] برای مودال فوروارد
let messagesCache = {};     // id -> پیام، برای پیش‌نمایش ریپلای بدون فچ اضافه
let composerState = { mode: 'send', replyTo: null, editId: null };

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function clearError() {
  loginError.classList.add('hidden');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.detail && data.detail.message) || 'خطای ناشناخته';
    throw new Error(msg);
  }
  return data;
}

// ---------- Login flow ----------
document.getElementById('send-code-btn').onclick = async () => {
  clearError();
  const phone = document.getElementById('phone-input').value.trim();
  if (!phone) return showError('شماره رو وارد کن');
  try {
    await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone }) });
    stepPhone.classList.add('hidden');
    stepCode.classList.remove('hidden');
  } catch (e) {
    showError(e.message);
  }
};

document.getElementById('verify-code-btn').onclick = async () => {
  clearError();
  const code = document.getElementById('code-input').value.trim();
  if (!code) return showError('کد رو وارد کن');
  try {
    const res = await api('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ code }) });
    if (res.need_password) {
      stepCode.classList.add('hidden');
      stepPassword.classList.remove('hidden');
    } else {
      enterApp();
    }
  } catch (e) {
    showError(e.message);
  }
};

document.getElementById('verify-password-btn').onclick = async () => {
  clearError();
  const password = document.getElementById('password-input').value;
  if (!password) return showError('رمز رو وارد کن');
  try {
    await api('/api/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
    enterApp();
  } catch (e) {
    showError(e.message);
  }
};

document.getElementById('show-import-link').onclick = (e) => {
  e.preventDefault();
  clearError();
  stepPhone.classList.add('hidden');
  stepImport.classList.remove('hidden');
};

document.getElementById('show-phone-link').onclick = (e) => {
  e.preventDefault();
  clearError();
  stepImport.classList.add('hidden');
  stepPhone.classList.remove('hidden');
};

document.getElementById('import-session-btn').onclick = async () => {
  clearError();
  const session_string = document.getElementById('import-input').value.trim();
  if (!session_string) return showError('session رو وارد کن');
  try {
    await api('/api/auth/import-session', { method: 'POST', body: JSON.stringify({ session_string }) });
    enterApp();
  } catch (e) {
    showError(e.message);
  }
};

document.getElementById('logout-btn').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
};

function enterApp() {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  loadDialogs();
}

// ---------- Dialogs ----------
async function loadDialogs() {
  const { dialogs } = await api('/api/dialogs');
  dialogsCache = dialogs.map(d => ({ id: d.id, name: d.name }));
  const list = document.getElementById('dialogs-list');
  list.innerHTML = '';
  for (const d of dialogs) {
    const item = document.createElement('div');
    item.className = 'dialog-item';
    item.dataset.id = d.id;
    item.innerHTML = `
      <img class="avatar" src="${d.avatar}" onerror="this.style.background='linear-gradient(160deg,#2AABEE,#229ED9)'; this.src='';">
      <div class="dialog-info">
        <div class="dialog-name">${escapeHtml(d.name)}</div>
        <div class="dialog-last">${escapeHtml(d.last_message || '')}</div>
      </div>
      ${d.unread_count ? `<div class="unread-badge">${d.unread_count}</div>` : ''}
    `;
    item.onclick = () => openChat(d.id, d.name, d.avatar);
    list.appendChild(item);
  }
}

// ---------- Chat ----------
async function openChat(chatId, name, avatar) {
  currentChatId = chatId;
  resetComposer();
  document.getElementById('message-input').value = '';
  document.querySelectorAll('.dialog-item').forEach(el => el.classList.toggle('active', el.dataset.id == chatId));
  document.getElementById('chat-empty').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('chat-header-avatar').src = avatar;

  await loadMessages();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 3000);
}

async function loadMessages() {
  if (!currentChatId) return;
  const { messages, me_id } = await api(`/api/messages/${currentChatId}?limit=30`);
  const list = document.getElementById('messages-list');
  list.innerHTML = '';
  messagesCache = {};
  for (const m of messages) messagesCache[m.id] = m;

  for (const m of messages) {
    const row = document.createElement('div');
    row.className = `msg-row ${m.out ? 'in' : 'out'}`; // RTL: پیام‌های من سمت چپ‌شون بشه با دایرکشن راست به چپ صفحه
    row.dataset.id = m.id;
    row.dataset.out = m.out ? '1' : '0';

    let mediaHtml = '';
    if (m.has_media) {
      if (m.is_photo) mediaHtml = `<img src="${m.media_url}" loading="lazy">`;
      else if (m.is_video) mediaHtml = `<video src="${m.media_url}" controls></video>`;
    }

    let fwdHtml = '';
    if (m.fwd_from) fwdHtml = `<div class="fwd-label">↪ فوروارد از ${escapeHtml(m.fwd_from)}</div>`;

    let replyHtml = '';
    if (m.reply_to_msg_id) {
      replyHtml = `<div class="reply-strip" data-reply-id="${m.reply_to_msg_id}">در حال بارگذاری...</div>`;
    }

    const time = m.date ? new Date(m.date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
    const editedTag = m.edited ? `<span class="edited-tag">ویرایش شده</span>` : '';
    row.innerHTML = `<div class="bubble">${fwdHtml}${replyHtml}${mediaHtml}${escapeHtml(m.text)}<div class="time">${time}${editedTag}</div></div>`;
    list.appendChild(row);

    if (m.reply_to_msg_id) fillReplyPreview(row.querySelector('.reply-strip'), m.reply_to_msg_id);
    attachLongPress(row, m);
  }
  list.scrollTop = list.scrollHeight;
}

async function fillReplyPreview(el, replyId) {
  const cached = messagesCache[replyId];
  if (cached) {
    el.textContent = cached.has_media && !cached.text ? '📎 رسانه' : cached.text;
    return;
  }
  try {
    const m = await api(`/api/message/${currentChatId}/${replyId}`);
    el.textContent = m.has_media && !m.text ? '📎 رسانه' : m.text;
  } catch (e) {
    el.textContent = 'پیام حذف شده';
  }
}

// ---------- Long-press action menu (Reply / Forward / Edit / Delete) ----------
function attachLongPress(row, m) {
  let timer = null;
  const start = (e) => {
    timer = setTimeout(() => {
      const point = e.touches ? e.touches[0] : e;
      openActionMenu(point.clientX, point.clientY, m);
    }, 450);
  };
  const cancel = () => { if (timer) clearTimeout(timer); };
  row.addEventListener('mousedown', start);
  row.addEventListener('touchstart', start, { passive: true });
  ['mouseup', 'mouseleave', 'touchend', 'touchmove'].forEach(evt => row.addEventListener(evt, cancel));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openActionMenu(e.clientX, e.clientY, m);
  });
}

const actionMenu = document.getElementById('msg-action-menu');
let activeMenuMessage = null;

function openActionMenu(x, y, m) {
  activeMenuMessage = m;
  actionMenu.querySelectorAll('.own-only').forEach(btn => btn.classList.toggle('hidden', !m.out));
  actionMenu.style.left = Math.min(x, window.innerWidth - 170) + 'px';
  actionMenu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
  actionMenu.classList.remove('hidden');
}

function closeActionMenu() {
  actionMenu.classList.add('hidden');
  activeMenuMessage = null;
}

document.addEventListener('click', (e) => {
  if (!actionMenu.contains(e.target)) closeActionMenu();
});

actionMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !activeMenuMessage) return;
  const m = activeMenuMessage;
  closeActionMenu();

  if (action === 'reply') {
    setComposerReply(m);
  } else if (action === 'edit') {
    setComposerEdit(m);
  } else if (action === 'delete') {
    if (confirm('این پیام حذف بشه؟')) {
      await api(`/api/messages/${currentChatId}/${m.id}`, { method: 'DELETE' });
      await loadMessages();
    }
  } else if (action === 'forward') {
    openForwardModal(m);
  }
});

// ---------- Composer banner (reply/edit state) ----------
const composerBanner = document.getElementById('composer-banner');
const composerBannerLabel = document.getElementById('composer-banner-label');
const composerBannerPreview = document.getElementById('composer-banner-preview');
const messageInput = document.getElementById('message-input');

function setComposerReply(m) {
  composerState = { mode: 'reply', replyTo: m.id, editId: null };
  composerBannerLabel.textContent = 'پاسخ به:';
  composerBannerPreview.textContent = m.has_media && !m.text ? '📎 رسانه' : m.text;
  composerBanner.classList.remove('hidden');
  messageInput.value = '';
  messageInput.focus();
}

function setComposerEdit(m) {
  composerState = { mode: 'edit', replyTo: null, editId: m.id };
  composerBannerLabel.textContent = 'در حال ویرایش:';
  composerBannerPreview.textContent = m.text;
  composerBanner.classList.remove('hidden');
  messageInput.value = m.text;
  messageInput.focus();
}

function resetComposer() {
  composerState = { mode: 'send', replyTo: null, editId: null };
  composerBanner.classList.add('hidden');
  composerBannerPreview.textContent = '';
}

document.getElementById('composer-banner-cancel').onclick = () => {
  resetComposer();
  messageInput.value = '';
};

// ---------- Forward modal ----------
const forwardModal = document.getElementById('forward-modal');
let forwardingMessage = null;

function openForwardModal(m) {
  forwardingMessage = m;
  const list = document.getElementById('forward-dialogs-list');
  list.innerHTML = '';
  for (const d of dialogsCache) {
    const item = document.createElement('div');
    item.className = 'forward-dialog-item';
    item.textContent = d.name;
    item.onclick = async () => {
      forwardModal.classList.add('hidden');
      try {
        await api('/api/forward', {
          method: 'POST',
          body: JSON.stringify({ chat_id: currentChatId, message_id: forwardingMessage.id, to_chat_id: d.id }),
        });
        if (d.id === currentChatId) await loadMessages();
      } catch (e) {
        alert(e.message);
      }
    };
    list.appendChild(item);
  }
  forwardModal.classList.remove('hidden');
}

document.getElementById('forward-cancel-btn').onclick = () => {
  forwardModal.classList.add('hidden');
};

document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChatId) return;

  try {
    if (composerState.mode === 'edit') {
      await api(`/api/messages/${currentChatId}/${composerState.editId}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      });
    } else {
      await api('/api/send', {
        method: 'POST',
        body: JSON.stringify({ chat_id: currentChatId, text, reply_to: composerState.replyTo }),
      });
    }
    input.value = '';
    resetComposer();
    await loadMessages();
  } catch (e) {
    alert(e.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Boot ----------
(async function boot() {
  try {
    const { authorized } = await api('/api/auth/status');
    if (authorized) enterApp();
  } catch (e) {
    // بمون تو صفحه‌ی لاگین
  }
})();
