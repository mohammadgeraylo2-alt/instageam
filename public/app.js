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

let allDialogs = [];        // کل دیالوگ‌ها (خام از سرور)، برای فیلتر/جستجو
let activeFilter = 'all';
let searchQuery = '';

// ---------- Dialogs ----------
async function loadDialogs() {
  const { dialogs } = await api('/api/dialogs');
  allDialogs = dialogs;
  dialogsCache = dialogs.map(d => ({ id: d.id, name: d.name }));
  renderDialogs();
}

function renderDialogs() {
  let list = allDialogs;

  if (activeFilter === 'unread') list = list.filter(d => d.unread_count > 0);
  else if (activeFilter === 'groups') list = list.filter(d => d.is_group);
  else if (activeFilter === 'channels') list = list.filter(d => d.is_channel);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(d => (d.name || '').toLowerCase().includes(q));
  }

  const totalUnread = allDialogs.filter(d => d.unread_count > 0).length;
  const unreadBadge = document.getElementById('unread-total-badge');
  if (totalUnread > 0) { unreadBadge.textContent = totalUnread; unreadBadge.classList.remove('hidden'); }
  else { unreadBadge.classList.add('hidden'); }

  const container = document.getElementById('dialogs-list');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = `<div class="dialogs-empty">چیزی پیدا نشد</div>`;
    return;
  }

  for (const d of list) {
    const item = document.createElement('div');
    item.className = 'dialog-item';
    item.dataset.id = d.id;
    item.innerHTML = `
      ${avatarHtml(d.name, d.avatar)}
      <div class="dialog-info">
        <div class="dialog-info-top">
          <div class="dialog-name">${escapeHtml(d.name)}</div>
          <div class="dialog-time">${d.last_date ? new Date(d.last_date).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        </div>
        <div class="dialog-info-bottom">
          <div class="dialog-last">${escapeHtml(d.last_message || '')}</div>
          ${d.unread_count ? `<div class="unread-badge">${d.unread_count}</div>` : ''}
        </div>
      </div>
    `;
    item.onclick = () => openChat(d.id, d.name, d.avatar);
    container.appendChild(item);
  }
}

// ---------- Filter tabs ----------
document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderDialogs();
  };
});

// ---------- Search ----------
const searchToggleBtn = document.getElementById('search-toggle-btn');
const searchInputWrap = document.getElementById('search-input-wrap');
const searchInput = document.getElementById('search-input');

searchToggleBtn.onclick = () => {
  searchInputWrap.classList.toggle('hidden');
  if (!searchInputWrap.classList.contains('hidden')) searchInput.focus();
  else { searchInput.value = ''; searchQuery = ''; renderDialogs(); }
};
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderDialogs();
});

// ---------- Kebab menu ----------
const kebabBtn = document.getElementById('kebab-menu-btn');
const kebabMenu = document.getElementById('kebab-menu');
kebabBtn.onclick = (e) => {
  e.stopPropagation();
  kebabMenu.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!kebabMenu.contains(e.target) && e.target !== kebabBtn) kebabMenu.classList.add('hidden');
});

// ---------- Bottom nav ----------
document.querySelectorAll('.bottom-nav-item').forEach(btn => {
  btn.onclick = () => {
    if (btn.dataset.tab !== 'chats') {
      alert('این بخش هنوز پیاده‌سازی نشده — فعلاً فقط «چت‌ها» فعاله.');
      return;
    }
    document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
});

// ---------- Chat ----------
async function openChat(chatId, name, avatar) {
  currentChatId = chatId;
  resetComposer();
  document.getElementById('message-input').value = '';
  document.querySelectorAll('.dialog-item').forEach(el => el.classList.toggle('active', el.dataset.id == chatId));
  document.getElementById('chat-empty').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  document.getElementById('chat-header-name').textContent = name;
  const headerAvatarWrap = document.getElementById('chat-header-avatar-wrap');
  headerAvatarWrap.style.setProperty('--avatar-color', avatarColor(name));
  headerAvatarWrap.innerHTML = `<span class="avatar-fallback">${escapeHtml(initials(name))}</span><img class="avatar-img" src="${avatar}" onerror="this.remove()">`;
  appScreen.classList.add('chat-open'); // تو موبایل: چت رو تمام‌صفحه نشون بده، لیست رو مخفی کن

  await loadMessages();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 3000);
}

document.getElementById('chat-back-btn').onclick = () => {
  appScreen.classList.remove('chat-open');
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
};

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

// ---------- Avatar (رنگی با حرف اول، مثل تلگرام واقعی) ----------
const AVATAR_COLORS = ['#FF885E', '#FFA85C', '#FFCD6A', '#7CE092', '#4BC8CE', '#5FA8FF', '#8B7FFF', '#E96FA8'];

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name) {
  const parts = (name || '؟').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  const first = parts[0][0] || '';
  const second = parts.length > 1 ? (parts[1][0] || '') : '';
  return (first + second).toUpperCase();
}

function avatarHtml(name, src, size) {
  const cls = size === 'lg' ? 'avatar-wrap avatar-wrap-lg' : 'avatar-wrap';
  return `
    <div class="${cls}" style="--avatar-color:${avatarColor(name)}">
      <span class="avatar-fallback">${escapeHtml(initials(name))}</span>
      <img class="avatar-img" src="${src}" loading="lazy" onerror="this.remove()">
    </div>
  `;
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
  
