const COOKIE_NAMES = ["sessionid", "csrftoken", "ds_user_id"];
const STORAGE_KEY = "igsub_settings";

let foundCookies = {};

async function loadCookies() {
  const list = document.getElementById("cookies-list");
  list.innerHTML = "";

  const allCookies = await chrome.cookies.getAll({ domain: ".instagram.com" });
  foundCookies = {};

  for (const name of COOKIE_NAMES) {
    const cookie = allCookies.find((c) => c.name === name);
    const row = document.createElement("div");
    row.className = "cookie-row";

    if (cookie) {
      foundCookies[name] = cookie.value;
      row.innerHTML = `<span class="name">${name}</span><span class="val found">${cookie.value.slice(0, 24)}...</span>`;
    } else {
      row.innerHTML = `<span class="name">${name}</span><span class="val missing">not found</span>`;
    }
    list.appendChild(row);
  }

  const allFound = COOKIE_NAMES.every((n) => n in foundCookies);
  document.getElementById("sync").disabled = !allFound;

  if (!allFound) {
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

    setStatus("Cookies synced!", "ok");
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
