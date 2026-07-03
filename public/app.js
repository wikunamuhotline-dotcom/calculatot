const SECRET_CODE = "7749";
const app = document.querySelector("#app");
let calcValue = "";
let token = localStorage.getItem("chat_token") || "";
let me = JSON.parse(localStorage.getItem("chat_user") || "null");
let socket;
let currentView = "chats";
let conversations = [];
let activeConversation = null;
let activeMessages = [];
let stickersOpen = false;
let messagePoll;

const themes = {
  green: ["#075e54", "#25d366", "#005c4b"],
  blue: ["#165d8f", "#4bb3fd", "#13547a"],
  rose: ["#8f1d52", "#ff6fae", "#7a204f"],
  graphite: ["#2f3a40", "#9cc6d3", "#3b4a50"],
};

render();

function render() {
  if (!token || !me) return renderCalculator();
  applyTheme(me.theme || "green");
  if (activeConversation) return renderChatRoom();
  renderShell();
}

function renderCalculator() {
  app.innerHTML = `
    <section class="calculator" aria-label="Calculator">
      <div class="calc-top"><span class="calc-dot"></span><span class="calc-dot"></span><span class="calc-dot"></span></div>
      <output class="calc-display">${calcValue || "0"}</output>
      <div class="calc-grid">
        ${button("AC", "utility", "clear")}${button("DEL", "utility", "backspace")}${button("%", "operator")}${button("/", "operator")}
        ${button("7")}${button("8")}${button("9")}${button("*", "operator")}
        ${button("4")}${button("5")}${button("6")}${button("-", "operator")}
        ${button("1")}${button("2")}${button("3")}${button("+", "operator")}
        ${button("0", "wide")}${button(".")}${button("=", "equals", "equals")}
      </div>
    </section>`;
}

function button(label, cls = "", action = "") {
  const data = action ? `data-action="${action}"` : `data-value="${label}"`;
  return `<button class="${cls}" ${data}>${label}</button>`;
}

app.addEventListener("click", async (event) => {
  const valueBtn = event.target.closest("[data-value]");
  const actionBtn = event.target.closest("[data-action]");
  if (valueBtn) {
    calcValue = `${calcValue}${valueBtn.dataset.value}`.slice(0, 18);
    renderCalculator();
    return;
  }
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    if (action === "clear") calcValue = "";
    if (action === "backspace") calcValue = calcValue.slice(0, -1);
    if (action === "equals") return handleEquals();
    renderCalculator();
  }
});

function handleEquals() {
  if (calcValue === SECRET_CODE) {
    calcValue = "";
    return renderAuth();
  }
  try {
    if (!/^[\d+\-*/%. ()]+$/.test(calcValue)) throw new Error("Bad input");
    const result = Function(`"use strict"; return (${calcValue})`)();
    calcValue = Number.isFinite(result) ? String(Number(result.toFixed(8))) : "";
  } catch {
    calcValue = "Error";
  }
  renderCalculator();
}

async function renderAuth() {
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-box">
        <h1>Chat Login</h1>
        <p>Google account එකෙන් sign in වුණාම unique @username එකක් auto හැදෙනවා.</p>
        <button id="google-login" class="google-button"><span class="google-icon">G</span> Continue with Google</button>
        <button id="dev-login" class="dev-button">Dev test account</button>
        <p id="auth-error" class="error"></p>
      </div>
    </section>`;
  const config = await api("/api/config", { public: true });
  const error = document.querySelector("#auth-error");
  document.querySelector("#google-login").onclick = () => {
    if (!config.googleClientId || !window.google) {
      error.textContent = "Google Client ID එක තවම .env එකට දාලා නැහැ.";
      return;
    }
    google.accounts.id.initialize({ client_id: config.googleClientId, callback: finishGoogleLogin });
    google.accounts.id.prompt();
  };
  document.querySelector("#dev-login").onclick = async () => {
    const result = await api("/api/auth/dev", { method: "POST", body: { name: `User ${Math.floor(Math.random() * 999)}` }, public: true });
    saveSession(result);
  };
}

async function finishGoogleLogin(response) {
  const result = await api("/api/auth/google", { method: "POST", body: { credential: response.credential }, public: true });
  saveSession(result);
}

function saveSession(result) {
  token = result.token;
  me = result.user;
  localStorage.setItem("chat_token", token);
  localStorage.setItem("chat_user", JSON.stringify(me));
  connectSocket();
  loadConversations();
}

function connectSocket() {
  if (socket) socket.disconnect();
  if (typeof io !== "function") return;
  socket = io({ auth: { token } });
  socket.on("message:new", (message) => {
    if (activeConversation?.id === String(message.conversation)) {
      activeMessages.push(message);
      renderChatRoom();
    }
    loadConversations(false);
  });
}

function startPollingMessages() {
  stopPollingMessages();
  messagePoll = setInterval(async () => {
    if (!activeConversation) return;
    try {
      const result = await api(`/api/conversations/${activeConversation.id}/messages`);
      const nextMessages = result.messages || [];
      if (nextMessages.length !== activeMessages.length || nextMessages.at(-1)?.id !== activeMessages.at(-1)?.id) {
        activeMessages = nextMessages;
        renderChatRoom();
      }
    } catch {
      stopPollingMessages();
    }
  }, 2500);
}

function stopPollingMessages() {
  if (messagePoll) clearInterval(messagePoll);
  messagePoll = null;
}

async function loadConversations(shouldRender = true) {
  const result = await api("/api/conversations");
  conversations = result.conversations || [];
  if (shouldRender) renderShell();
}

function renderShell() {
  const titles = { chats: "Chats", add: "Add Friends", profile: "Profile" };
  app.innerHTML = `
    <section class="phone-app">
      <header class="topbar"><div><h1>${titles[currentView]}</h1><small>@${me.username}</small></div></header>
      <section class="content">${currentView === "chats" ? chatsHtml() : currentView === "add" ? addHtml() : profileHtml()}</section>
      <nav class="bottom-nav">
        <button class="${currentView === "chats" ? "active" : ""}" data-nav="chats">Chats</button>
        <button class="${currentView === "add" ? "active" : ""}" data-nav="add">Add</button>
        <button class="${currentView === "profile" ? "active" : ""}" data-nav="profile">Profile</button>
      </nav>
    </section>`;
}

function chatsHtml() {
  const rows = conversations
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((chat) => {
      const other = chat.participants.find((user) => user.id !== me.id) || chat.participants[0];
      return `<article class="chat-row" data-open-chat="${chat.id}">
        ${avatar(other)}<div><p class="row-title">${escapeHtml(other.name || other.username)}</p><p class="row-sub">${escapeHtml(chat.lastMessageText || `@${other.username}`)}</p></div>
        <span class="pin">${chat.pinned ? "Pin" : ""}</span>
      </article>`;
    })
    .join("");
  return `<div class="chat-list">${rows || `<p class="row-sub">Search friends and start your first chat.</p>`}</div>`;
}

function addHtml() {
  return `<div class="search-wrap"><input id="friend-search" class="search-box" placeholder="Search @username" autocomplete="off" /></div><div id="search-results" class="search-results"></div>`;
}

function profileHtml() {
  return `<form id="profile-form" class="profile-form">
    <div class="setting-card">${avatar(me)}<label>Name<input name="name" value="${escapeAttr(me.name || "")}" /></label></div>
    <div class="setting-card"><label>Username<input name="username" value="@${escapeAttr(me.username || "")}" /></label></div>
    <div class="setting-card"><label>Mobile number<input name="mobile" value="${escapeAttr(me.mobile || "")}" placeholder="+94..." /></label></div>
    <div class="setting-card"><label>Profile picture URL<input name="avatarUrl" value="${escapeAttr(me.avatarUrl || "")}" /></label></div>
    <div class="setting-card"><label>Chat wallpaper URL<input name="wallpaper" value="${escapeAttr(me.wallpaper || "")}" /></label></div>
    <div class="setting-card"><p class="row-sub">Theme</p><div class="swatches">${Object.keys(themes).map((key) => `<button type="button" class="swatch" data-theme="${key}" style="background:${themes[key][0]}"></button>`).join("")}</div></div>
    <button class="primary-button">Save profile</button>
    <button id="new-account" type="button" class="dev-button">Add another account</button>
    <button id="logout" type="button" class="dev-button">Log out</button>
    <p id="profile-error" class="error"></p>
  </form>`;
}

app.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    currentView = nav.dataset.nav;
    renderShell();
  }
  const open = event.target.closest("[data-open-chat]");
  if (open) openConversation(open.dataset.openChat);
  const theme = event.target.closest("[data-theme]");
  if (theme) {
    me.theme = theme.dataset.theme;
    applyTheme(me.theme);
    await saveProfile({ theme: me.theme });
    renderShell();
  }
  if (event.target.closest("#logout")) logout();
  if (event.target.closest("#new-account")) {
    logout(false);
    renderAuth();
  }
});

app.addEventListener("input", async (event) => {
  if (event.target.id !== "friend-search") return;
  const q = event.target.value.trim();
  const results = document.querySelector("#search-results");
  if (q.length < 2) return (results.innerHTML = "");
  const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  results.innerHTML = data.users.map((user) => `<article class="user-row"><div>${avatar(user)}</div><div><p class="row-title">${escapeHtml(user.name || user.username)}</p><p class="row-sub">@${escapeHtml(user.username)}</p></div><button class="primary-button" data-start="${user.id}">Chat</button></article>`).join("");
});

app.addEventListener("submit", async (event) => {
  if (event.target.id === "profile-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = Object.fromEntries(form.entries());
    const result = await saveProfile(body);
    me = result.user;
    localStorage.setItem("chat_user", JSON.stringify(me));
    renderShell();
  }
});

app.addEventListener("click", async (event) => {
  const start = event.target.closest("[data-start]");
  if (!start) return;
  const result = await api("/api/conversations", { method: "POST", body: { userId: start.dataset.start } });
  activeConversation = result.conversation;
  activeMessages = [];
  openConversation(activeConversation.id);
});

async function openConversation(id) {
  activeConversation = conversations.find((chat) => chat.id === id) || activeConversation;
  const result = await api(`/api/conversations/${id}/messages`);
  activeMessages = result.messages || [];
  if (socket) socket.emit("conversation:join", id);
  if (!socket) startPollingMessages();
  renderChatRoom();
}

function renderChatRoom() {
  const other = activeConversation.participants.find((user) => user.id !== me.id) || activeConversation.participants[0];
  document.documentElement.style.setProperty("--wallpaper", me.wallpaper ? `url("${me.wallpaper}") center/cover` : "#0f1514");
  app.innerHTML = `
    <section class="chat-room">
      <header class="room-head"><button id="back">‹</button>${avatar(other)}<div><strong>${escapeHtml(other.name || other.username)}</strong><small>@${escapeHtml(other.username)}</small></div><button id="pin-chat">⌖</button></header>
      <section id="messages" class="messages">${activeMessages.map(messageHtml).join("")}</section>
      <section class="stickers ${stickersOpen ? "" : "hidden"}">${["😀","😂","❤️","🔥","👍","🙏","🎉","😎"].map((s) => `<button data-sticker="${s}">${s}</button>`).join("")}</section>
      <form id="composer" class="composer"><button type="button" id="toggle-stickers">☺</button><label class="file-label">＋<input id="file-input" type="file" /></label><input id="message-text" placeholder="Message" autocomplete="off" /><button class="send">Send</button></form>
    </section>`;
  const messages = document.querySelector("#messages");
  messages.scrollTop = messages.scrollHeight;
  document.querySelector("#back").onclick = () => {
    activeConversation = null;
    stickersOpen = false;
    stopPollingMessages();
    loadConversations();
  };
  document.querySelector("#pin-chat").onclick = () => api(`/api/conversations/${activeConversation.id}/pin`, { method: "PATCH" }).then(() => loadConversations(false));
  document.querySelector("#toggle-stickers").onclick = () => {
    stickersOpen = !stickersOpen;
    renderChatRoom();
  };
  document.querySelector("#composer").onsubmit = sendMessage;
  document.querySelector("#file-input").onchange = uploadAttachment;
}

async function sendMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#message-text");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await api(`/api/conversations/${activeConversation.id}/messages`, { method: "POST", body: { text } });
}

app.addEventListener("click", async (event) => {
  const sticker = event.target.closest("[data-sticker]");
  if (!sticker || !activeConversation) return;
  await api(`/api/conversations/${activeConversation.id}/messages`, { method: "POST", body: { sticker: sticker.dataset.sticker } });
});

async function uploadAttachment(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const attachment = await api("/api/upload", { method: "POST", form });
  await api(`/api/conversations/${activeConversation.id}/messages`, { method: "POST", body: { attachment } });
}

function messageHtml(message) {
  const mine = message.sender.id === me.id;
  const attachment = message.attachment?.url
    ? message.attachment.type?.startsWith("image/")
      ? `<img src="${message.attachment.url}" alt="${escapeAttr(message.attachment.name || "image")}" />`
      : `<a href="${message.attachment.url}" target="_blank">${escapeHtml(message.attachment.name || "File")}</a>`
    : "";
  return `<article class="message ${mine ? "mine" : ""}">${message.sticker || ""}${attachment}${message.text ? `<div>${escapeHtml(message.text)}</div>` : ""}<time>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>`;
}

async function saveProfile(body) {
  return api("/api/me", { method: "PATCH", body });
}

function logout(clear = true) {
  if (clear) {
    localStorage.removeItem("chat_token");
    localStorage.removeItem("chat_user");
  }
  token = "";
  me = null;
  if (socket) socket.disconnect();
  renderCalculator();
}

async function api(url, options = {}) {
  const headers = options.form ? {} : { "Content-Type": "application/json" };
  if (!options.public && token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.form || (options.body ? JSON.stringify(options.body) : undefined),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function applyTheme(name) {
  const [brand, accent, bubble] = themes[name] || themes.green;
  document.documentElement.style.setProperty("--brand", brand);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--bubble", bubble);
}

function avatar(user) {
  return user.avatarUrl ? `<img class="avatar" src="${escapeAttr(user.avatarUrl)}" alt="" />` : `<div class="avatar">${escapeHtml((user.name || user.username || "?").slice(0, 1).toUpperCase())}</div>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

if (token && me) {
  connectSocket();
  loadConversations();
}
