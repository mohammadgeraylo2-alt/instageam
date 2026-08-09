// ---------- تلگرام مینی‌اپ ----------
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#ffffff');
    tg.setBackgroundColor('#fafafa');
  } catch (e) {}
}

// ---------- عناصر ----------
const appScreen = document.getElementById('app-screen');

const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const profileSection = document.getElementById('profile-section');
const exploreGrid = document.getElementById('explore-grid');
const feed = document.getElementById('feed');
const errorBox = document.getElementById('error-box');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const navHome = document.getElementById('nav-home');
const navExplore = document.getElementById('nav-explore');
const navReels = document.getElementById('nav-reels');
const navProfile = document.getElementById('nav-profile');
const reelsContainer = document.getElementById('reels-container');
const mainEl = document.querySelector('main');
const navProfilePic = document.getElementById('nav-profile-pic');

let myUsername = null;

const ICONS = {
  heart: '<svg viewBox="0 0 24 24" class="action-icon icon-heart"><path d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.5C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  heartFilled: '<svg viewBox="0 0 24 24" class="action-icon icon-heart liked"><path d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.5C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  comment: '<svg viewBox="0 0 24 24" class="action-icon"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" class="action-icon"><line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 24 24" class="action-icon save-icon"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" class="more-icon" width="18" height="18"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>',
  repost: '<svg viewBox="0 0 24 24" class="action-icon"><path d="M17 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 22l-4-4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" class="explore-icon"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

function formatNum(n) {
  if (n === undefined || n === null) return 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return n;
}

// ---------- نمایش اپ اصلی (بدون نیاز به لاگین کاربر) ----------
async function showApp() {
  appScreen.style.display = 'block';
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.logged_in) {
      myUsername = data.username;
    } else {
      errorBox.textContent = data.error || 'اکانت سرور لاگین نیست';
    }
  } catch (e) {}
  loadHome();
}

function handleAuthError(data) {
  if (data && data.detail && (data.detail.code === 'not_logged_in')) {
    errorBox.textContent = data.detail.message || 'اکانت سرور لاگین نیست، بعداً امتحان کن';
    return true;
  }
  return false;
}

// شروع خودکار بدون صفحه‌ی ورود
showApp();

// ---------- فید خانه ----------
async function loadHome() {
  setTab('home');
  feed.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  exploreGrid.style.display = 'none';
  profileSection.innerHTML = '';
  errorBox.textContent = '';

  try {
    const res = await fetch('/api/timeline');
    const data = await res.json();
    if (!res.ok) {
      if (handleAuthError(data)) return;
      feed.innerHTML = '';
      errorBox.textContent = (data.detail && data.detail.message) || 'خطا در دریافت فید';
      return;
    }
    renderFeed(data.items || []);
  } catch (err) {
    feed.innerHTML = '';
    errorBox.textContent = 'خطا در ارتباط با سرور';
  }
}

// ---------- اکسپلور ----------
async function loadExplore() {
  setTab('explore');
  feed.innerHTML = '';
  profileSection.innerHTML = '';
  exploreGrid.style.display = 'grid';
  exploreGrid.innerHTML = '<p class="loading">در حال بارگذاری...</p>';
  errorBox.textContent = '';

  try {
    const res = await fetch('/api/explore');
    const data = await res.json();
    if (!res.ok) {
      if (handleAuthError(data)) return;
      exploreGrid.innerHTML = '';
      errorBox.textContent = (data.detail && data.detail.message) || 'خطا در دریافت اکسپلور';
      return;
    }
    exploreGrid.innerHTML = '';
    (data.items || []).forEach((post) => {
      const div = document.createElement('div');
      div.className = 'explore-item';
      div.innerHTML = `
        <img src="${post.thumbnail}" loading="lazy">
        <span class="explore-overlay">${ICONS.eye}<span>${formatNum(post.likes)}</span></span>
      `;
      div.onclick = () => openModal(post, { username: post.owner_username });
      exploreGrid.appendChild(div);
    });
  } catch (err) {
    exploreGrid.innerHTML = '';
    errorBox.textContent = 'خطا در ارتباط با سرور';
  }
}

// ---------- ریلز ----------
async function loadReels() {
  setTab('reels');
  mainEl.style.display = 'none';
  reelsContainer.style.display = 'block';
  reelsContainer.innerHTML = '<p class="reels-loading">در حال بارگذاری...</p>';

  try {
    const res = await fetch('/api/reels');
    const data = await res.json();
    if (!res.ok) {
      if (handleAuthError(data)) return;
      reelsContainer.innerHTML = `<p class="reels-loading">${(data.detail && data.detail.message) || 'خطا در دریافت ریلز'}</p>`;
      return;
    }

    const items = (data.items || []).filter((p) => p.video_url);
    if (items.length === 0) {
      reelsContainer.innerHTML = '<p class="reels-loading">ریلزی پیدا نشد</p>';
      return;
    }

    reelsContainer.innerHTML = '';
    items.forEach((post) => {
      const div = document.createElement('div');
      div.className = 'reel-item';
      div.innerHTML = `
        <video src="${post.video_url}" poster="${post.thumbnail || ''}" loop playsinline muted></video>
        <div class="reel-overlay">
          <div class="reel-info">
            <div class="reel-uname-row">
              <span class="reel-uname">${post.owner_username || ''}</span>
              <button class="follow-btn">دنبال کردن</button>
            </div>
            <div class="reel-caption">${post.caption || ''}</div>
          </div>
          <div class="reel-actions">
            <span>${ICONS.heart}<span class="count">${formatNum(post.likes)}</span></span>
            <span>${ICONS.comment}<span class="count">${formatNum(post.comments)}</span></span>
            <span>${ICONS.repost}</span>
            <span>${ICONS.share}</span>
            <span>${ICONS.save}</span>
          </div>
        </div>
        <div class="reel-comment-box">افزودن نظر...</div>
      `;
      const video = div.querySelector('video');
      video.onclick = () => { video.muted = !video.muted; };
      const followBtn = div.querySelector('.follow-btn');
      followBtn.onclick = () => {
        const following = followBtn.classList.toggle('following');
        followBtn.textContent = following ? 'دنبال شد' : 'دنبال کردن';
      };
      reelsContainer.appendChild(div);
    });

    // پخش خودکار ویدیویی که تو دید کاربره، بقیه رو متوقف کن
    const videos = reelsContainer.querySelectorAll('video');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.play().catch(() => {});
          } else {
            entry.target.pause();
          }
        });
      },
      { threshold: 0.6 }
    );
    videos.forEach((v) => observer.observe(v));
  } catch (err) {
    reelsContainer.innerHTML = '<p class="reels-loading">خطا در ارتباط با سرور</p>';
  }
}

// ---------- پروفایل ----------
async function loadProfile(username) {
  setTab('profile');
  errorBox.textContent = '';
  profileSection.innerHTML = '';
  exploreGrid.style.display = 'none';
  feed.innerHTML = '<p class="loading">در حال بارگذاری...</p>';

  try {
    const res = await fetch(`/api/profile/${encodeURIComponent(username)}`);
    const data = await res.json();

    if (!res.ok) {
      if (handleAuthError(data)) return;
      feed.innerHTML = '';
      errorBox.textContent = (data.detail && data.detail.message) || 'خطایی رخ داد';
      return;
    }

    profileSection.innerHTML = `
      <img class="profile-pic" src="${data.profile_pic}" alt="${data.username}">
      <div class="profile-info">
        <h2>${data.full_name || data.username}</h2>
        <p class="username">@${data.username}</p>
        <p class="bio">${data.biography || ''}</p>
        <div class="stats">
          <span><b>${formatNum(data.posts_count)}</b> پست</span>
          <span><b>${formatNum(data.followers)}</b> فالوور</span>
          <span><b>${formatNum(data.following)}</b> فالووینگ</span>
        </div>
      </div>
    `;

    if (username === myUsername) {
      navProfilePic.src = data.profile_pic;
      navProfilePic.style.display = 'block';
    }

    renderFeed(
      (data.posts || []).map((p) => ({ ...p, owner_username: data.username, owner_pic: data.profile_pic }))
    );
  } catch (err) {
    feed.innerHTML = '';
    errorBox.textContent = 'خطا در ارتباط با سرور';
  }
}

// ---------- رندر فید ----------
function renderFeed(posts) {
  feed.innerHTML = '';
  posts.forEach((post) => {
    if (!post.thumbnail) return;
    const article = document.createElement('article');
    article.className = 'post';
    const mediaHtml = post.is_video && post.video_url
      ? `<video class="post-img" src="${post.video_url}" poster="${post.thumbnail || ''}" controls playsinline muted loop></video>`
      : `<img class="post-img" src="${post.thumbnail}" loading="lazy">`;
    article.innerHTML = `
      <div class="post-header">
        <img class="avatar" src="${post.owner_pic || post.thumbnail}">
        <span class="uname">${post.owner_username || ''}</span>
        ${ICONS.more}
      </div>
      <div class="post-img-wrap">
        ${mediaHtml}
        <span class="heart-pop">❤️</span>
      </div>
      <div class="post-actions">
        <span class="like-btn">${ICONS.heart}</span>
        ${ICONS.comment}
        ${ICONS.share}
        ${ICONS.save}
      </div>
      <div class="post-likes">${formatNum(post.likes)} لایک</div>
      <div class="post-caption"><b>${post.owner_username || ''}</b>${post.caption || ''}</div>
    `;

    const img = article.querySelector('.post-img');
    const heartPop = article.querySelector('.heart-pop');
    const likeBtn = article.querySelector('.like-btn');
    const likesCountEl = article.querySelector('.post-likes');
    let liked = false;
    const baseLikes = post.likes || 0;

    function setLiked(state) {
      liked = state;
      likeBtn.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
      likesCountEl.textContent = `${formatNum(liked ? baseLikes + 1 : baseLikes)} لایک`;
    }

    likeBtn.onclick = () => setLiked(!liked);
    img.ondblclick = () => {
      if (!liked) setLiked(true);
      heartPop.classList.remove('show');
      void heartPop.offsetWidth;
      heartPop.classList.add('show');
    };
    if (!post.is_video) {
      img.onclick = () => openModal(post, { username: post.owner_username });
    }

    feed.appendChild(article);
  });

  if (posts.length === 0) {
    feed.innerHTML = '<p class="loading">چیزی برای نمایش نیست</p>';
  }
}

function openModal(post, profileInfo) {
  modalContent.innerHTML = `
    <img src="${post.thumbnail}" alt="post">
    <p><b>${profileInfo.username || ''}</b> ${post.caption || ''}</p>
    <div class="stats">
      <span>❤️ ${formatNum(post.likes)}</span>
      <span>💬 ${formatNum(post.comments)}</span>
    </div>
  `;
  modal.classList.add('open');
}

document.getElementById('modal-close').onclick = () => modal.classList.remove('open');
modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };

// ---------- ناوبری ----------
function setTab(tab) {
  navHome.classList.toggle('active', tab === 'home');
  navExplore.classList.toggle('active', tab === 'explore');
  navReels.classList.toggle('active', tab === 'reels');
  searchBar.style.display = tab === 'explore' ? 'flex' : 'none';

  if (tab === 'reels') {
    mainEl.style.display = 'none';
    reelsContainer.style.display = 'block';
  } else {
    mainEl.style.display = 'block';
    reelsContainer.style.display = 'none';
    reelsContainer.querySelectorAll('video').forEach((v) => v.pause());
  }
}

navHome.onclick = () => loadHome();
navExplore.onclick = () => loadExplore();
navReels.onclick = () => loadReels();
navProfile.onclick = () => { if (myUsername) loadProfile(myUsername); };
navProfilePic.onclick = () => { if (myUsername) loadProfile(myUsername); };

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const username = searchInput.value.trim().replace('@', '');
    if (username) loadProfile(username);
  }
});


        
