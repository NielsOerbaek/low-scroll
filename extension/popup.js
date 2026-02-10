const STORAGE_KEY = "igsub_settings";

let foundCookies = {};

async function loadCookies() {
  const list = document.getElementById("cookies-list");
  list.innerHTML = "";

  const allCookies = await chrome.cookies.getAll({ domain: ".instagram.com" });
  foundCookies = {};

  for (const cookie of allCookies) {
    foundCookies[cookie.name] = cookie.value;
  }

  const count = Object.keys(foundCookies).length;
  const hasSession = "sessionid" in foundCookies;

  // Show key cookies
  const keyCookies = ["sessionid", "csrftoken", "ds_user_id", "mid", "ig_did", "datr", "rur"];
  for (const name of keyCookies) {
    const row = document.createElement("div");
    row.className = "cookie-row";
    if (name in foundCookies) {
      row.innerHTML = `<span class="name">${name}</span><span class="val found">${foundCookies[name].slice(0, 20)}...</span>`;
    } else {
      row.innerHTML = `<span class="name">${name}</span><span class="val missing">not found</span>`;
    }
    list.appendChild(row);
  }

  // Show total count
  const countRow = document.createElement("div");
  countRow.className = "cookie-row";
  countRow.innerHTML = `<span class="name">total</span><span class="val ${hasSession ? 'found' : 'missing'}">${count} cookies</span>`;
  list.appendChild(countRow);

  document.getElementById("sync").disabled = !hasSession;

  if (!hasSession) {
    setStatus("Log into instagram.com first", "err");
  }
}

function setStatus(msg, type) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + (type || "");
}

async function syncCookies() {
  const url = document.getElementById("url").value.replace(/\/$/, "");
  const password = document.getElementById("password").value;

  if (!url) return setStatus("Enter instance URL", "err");
  if (!password) return setStatus("Enter admin password", "err");

  chrome.storage.local.set({
    [STORAGE_KEY]: { url, password },
  });

  const btn = document.getElementById("sync");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  setStatus("");

  try {
    const res = await fetch(`${url}/api/extension/cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, cookies: foundCookies }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const count = Object.keys(foundCookies).length;
    setStatus(`${count} cookies synced!`, "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }

  btn.disabled = false;
  btn.textContent = "Sync Cookies";
}

document.getElementById("sync").addEventListener("click", syncCookies);

// Load saved settings
chrome.storage.local.get(STORAGE_KEY, (data) => {
  const saved = data[STORAGE_KEY];
  if (saved?.url) document.getElementById("url").value = saved.url;
  if (saved?.password) document.getElementById("password").value = saved.password;
});

loadCookies();

let fbFoundCookies = {};

async function loadFbCookies() {
  const list = document.getElementById("fb-cookies-list");
  list.innerHTML = "";

  const allCookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
  fbFoundCookies = {};

  for (const cookie of allCookies) {
    fbFoundCookies[cookie.name] = cookie.value;
  }

  const count = Object.keys(fbFoundCookies).length;
  const hasCUser = "c_user" in fbFoundCookies;

  const keyCookies = ["c_user", "xs", "fr", "datr", "sb"];
  for (const name of keyCookies) {
    const row = document.createElement("div");
    row.className = "cookie-row";
    if (name in fbFoundCookies) {
      row.innerHTML = `<span class="name">${name}</span><span class="val found">${fbFoundCookies[name].slice(0, 20)}...</span>`;
    } else {
      row.innerHTML = `<span class="name">${name}</span><span class="val missing">not found</span>`;
    }
    list.appendChild(row);
  }

  const countRow = document.createElement("div");
  countRow.className = "cookie-row";
  countRow.innerHTML = `<span class="name">total</span><span class="val ${hasCUser ? 'found' : 'missing'}">${count} cookies</span>`;
  list.appendChild(countRow);

  document.getElementById("fb-sync").disabled = !hasCUser;

  if (!hasCUser) {
    setFbStatus("Log into facebook.com first", "err");
  }
}

function setFbStatus(msg, type) {
  const el = document.getElementById("fb-status");
  el.textContent = msg;
  el.className = "status " + (type || "");
}

async function syncFbCookies() {
  const url = document.getElementById("url").value.replace(/\/$/, "");
  const password = document.getElementById("password").value;

  if (!url) return setFbStatus("Enter instance URL", "err");
  if (!password) return setFbStatus("Enter admin password", "err");

  const btn = document.getElementById("fb-sync");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  setFbStatus("");

  try {
    const res = await fetch(`${url}/api/extension/fb-cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, cookies: fbFoundCookies }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    const count = Object.keys(fbFoundCookies).length;
    setFbStatus(`${count} FB cookies synced!`, "ok");
  } catch (e) {
    setFbStatus(e.message, "err");
  }

  btn.disabled = false;
  btn.textContent = "Sync FB Cookies";
}

document.getElementById("fb-sync").addEventListener("click", syncFbCookies);
loadFbCookies();
