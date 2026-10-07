import { API_URL } from "./config.js";
const $ = (id) => document.getElementById(id);
const base = API_URL.replace(/\/$/, "");
let token = sessionStorage.getItem("fox-session") || "",
  builds = [],
  branch = "all";
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4500);
}
function showLogin(message = "") {
  token = "";
  sessionStorage.removeItem("fox-session");
  builds = [];
  $("build-list").replaceChildren();
  $("account").hidden = true;
  $("builds-view").hidden = true;
  $("login-view").hidden = false;
  $("login-error").textContent = message;
  $("login-error").hidden = !message;
}
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(base + path, {
    ...options,
    headers,
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login")
      showLogin("Your session has expired. Please sign in again.");
    throw new Error(data.error || "The request failed. Please try again.");
  }
  return data;
}
function size(bytes) {
  return `${(bytes / 1048576).toLocaleString("en-GB", { maximumFractionDigits: 1 })} MiB`;
}
function render() {
  const search = $("search").value.trim().toLowerCase();
  const visible = builds
    .filter(
      (b) =>
        (branch === "all" || b.branch === branch) &&
        ($("show-archive").checked || b.status !== "archived") &&
        [b.title, b.version, b.device, b.filename]
          .join(" ")
          .toLowerCase()
          .includes(search),
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  $("build-count").textContent =
    `BUILDS: ${visible.length.toString().padStart(2, "0")}`;
  $("empty").hidden = visible.length !== 0;
  $("build-list").replaceChildren();
  visible.forEach((b) => {
    const card = $("build-template").content.firstElementChild.cloneNode(true);
    const text = (selector, value) => {
      card.querySelector(selector).textContent = value;
    };
    text(".build-branch", `FOX ${b.branch}`);
    text(
      ".build-badge",
      b.demo ? "Preview" : b.status === "archived" ? "Archived" : "Testing",
    );
    const date = card.querySelector("time");
    date.dateTime = b.date;
    date.textContent = new Date(b.date).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    text(".build-title", b.title);
    text(".build-device", b.device);
    text(".build-version", b.version);
    text(".build-size", size(b.bytes));
    text(".build-file", b.filename);
    text(".build-hash", b.sha256);
    card.querySelector("details").hidden = b.changelog.length === 0;
    b.changelog.forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      card.querySelector(".changelog").append(item);
    });
    card.querySelector(".copy-hash").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.sha256);
        toast("SHA256 copied.");
      } catch {
        toast("Copying is unavailable. Select and copy the SHA256 manually.");
      }
    });
    const download = card.querySelector(".download");
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        const result = await api(
          `/api/builds/${encodeURIComponent(b.id)}/ticket`,
          { method: "POST" },
        );
        const target = new URL(result.url);
        if (target.origin !== new URL(base).origin)
          throw new Error("Invalid download URL.");
        const link = document.createElement("a");
        link.href = target.href;
        link.rel = "noreferrer";
        document.body.append(link);
        link.click();
        link.remove();
        toast("Your download is starting.");
      } catch (e) {
        toast(e.message);
      } finally {
        download.disabled = false;
      }
    });
    $("build-list").append(card);
  });
}
async function enter() {
  const me = await api("/api/me");
  $("username").textContent = me.username;
  $("account").hidden = false;
  $("login-view").hidden = true;
  $("builds-view").hidden = false;
  $("catalog-error").hidden = true;
  try {
    const data = await api("/api/builds");
    builds = data.builds;
    render();
  } catch (e) {
    if (token) {
      $("catalog-error").textContent = e.message;
      $("catalog-error").hidden = false;
      $("build-count").textContent = "BUILDS UNAVAILABLE";
    }
  }
}
$("year").textContent = new Date().getFullYear();
$("show-password").addEventListener("click", () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("show-password").textContent = show ? "Hide" : "Show";
  $("show-password").setAttribute("aria-pressed", String(show));
  $("show-password").setAttribute(
    "aria-label",
    show ? "Hide password" : "Show password",
  );
});
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-submit").disabled = true;
  $("login-error").hidden = true;
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("login").value.trim(),
        password: $("password").value,
      }),
    });
    token = result.token;
    sessionStorage.setItem("fox-session", token);
    $("password").value = "";
    await enter();
  } catch (e) {
    $("login-error").textContent =
      e instanceof TypeError
        ? "Sign-in is unavailable. Check your connection or try again later."
        : e.message;
    $("login-error").hidden = false;
  } finally {
    $("login-submit").disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    showLogin();
  } catch (e) {
    toast("Could not end your session. Please try signing out again.");
  }
});
for (const button of document.querySelectorAll(".tab"))
  button.addEventListener("click", () => {
    branch = button.dataset.branch;
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    render();
  });
$("search").addEventListener("input", render);
$("show-archive").addEventListener("change", render);
if (token)
  enter().catch((e) => {
    if (token)
      showLogin(
        e instanceof TypeError
          ? "Sign-in is unavailable. Please try again later."
          : e.message,
      );
  });
