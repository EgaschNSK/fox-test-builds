import { verifyPassword, DUMMY_HASH, token, digest } from "./password.mjs";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
const noAccess = () =>
  json({ error: "Войдите в аккаунт, чтобы продолжить." }, 401);
const now = () => Math.floor(Date.now() / 1000);
const sessionToken = (request) =>
  /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("Authorization") || "",
  )?.[1];
async function session(request, env) {
  const raw = sessionToken(request);
  if (!raw) return null;
  return env.DB.prepare(
    "SELECT s.token_hash, u.username FROM sessions s JOIN users u ON u.username=s.username WHERE s.token_hash=? AND s.expires>? AND u.active=1",
  )
    .bind(digest(raw), now())
    .first();
}
async function catalog(env) {
  const object = await env.BUILDS.get("catalog.json");
  if (!object) return [];
  if (object.size > 256 * 1024) throw new Error("Oversized catalog");
  const list = await object.json();
  if (!Array.isArray(list) || list.length > 500)
    throw new Error("Invalid catalog");
  for (const b of list) {
    if (
      !/^[a-z0-9-]{1,100}$/.test(b.id) ||
      !/^[a-zA-Z0-9._-]{1,160}$/.test(b.filename) ||
      !/^[a-f0-9]{64}$/.test(b.sha256) ||
      !Number.isSafeInteger(b.bytes) ||
      b.bytes < 1 ||
      !["12.1", "14.1", "16.0"].includes(b.branch) ||
      !Array.isArray(b.changelog)
    )
      throw new Error("Invalid build metadata");
  }
  return list;
}
async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/login" && request.method === "POST") {
    if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN)
      return json({ error: "Недопустимый источник запроса." }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "Неверный формат запроса." }, 415);
    if (Number(request.headers.get("Content-Length") || 0) > 4096)
      return json({ error: "Слишком большой запрос." }, 413);
    const text = await request.text();
    if (text.length > 4096)
      return json({ error: "Слишком большой запрос." }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Неверный запрос." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Неверный запрос." }, 400);
    const { username, password } = body;
    if (
      typeof username !== "string" ||
      !/^[a-zA-Z0-9_-]{2,40}$/.test(username) ||
      typeof password !== "string" ||
      Buffer.byteLength(password) > 256
    )
      return json({ error: "Неверный логин или пароль." }, 401);
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const [ipLimit, userLimit] = await Promise.all([
      env.LOGIN_LIMITER.limit({ key: `ip:${ip}` }),
      env.LOGIN_LIMITER.limit({ key: `user:${username.toLowerCase()}` }),
    ]);
    if (!ipLimit.success || !userLimit.success)
      return json(
        { error: "Слишком много попыток. Попробуйте через минуту." },
        429,
      );
    const user = await env.DB.prepare(
      "SELECT username,password_hash,active FROM users WHERE username=?",
    )
      .bind(username)
      .first();
    const valid = await verifyPassword(
      password,
      user?.password_hash || DUMMY_HASH,
    );
    if (!valid || !user?.active)
      return json({ error: "Неверный логин или пароль." }, 401);
    const raw = token(),
      expires = now() + 12 * 60 * 60;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tickets WHERE expires<?").bind(now()),
      env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(now()),
      env.DB.prepare(
        "INSERT INTO sessions(token_hash,username,expires) VALUES(?,?,?)",
      ).bind(digest(raw), user.username, expires),
    ]);
    return json({ token: raw, username: user.username, expires });
  }
  // Opaque, single-use, 60-second tickets let the browser stream a protected file.
  if (url.pathname.startsWith("/download/") && request.method === "GET") {
    const raw = url.pathname.slice("/download/".length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return noAccess();
    const ticket = await env.DB.prepare(
      "DELETE FROM tickets WHERE token_hash=? AND expires>? AND EXISTS(SELECT 1 FROM sessions s JOIN users u ON s.username=u.username WHERE s.token_hash=tickets.session_hash AND s.expires>? AND u.active=1) RETURNING build_id",
    )
      .bind(digest(raw), now(), now())
      .first();
    if (!ticket) return noAccess();
    const build = (await catalog(env)).find((b) => b.id === ticket.build_id);
    if (!build) return json({ error: "Билд больше не доступен." }, 404);
    const object = await env.BUILDS.get(`builds/${build.id}/${build.filename}`);
    if (!object || object.size !== build.bytes)
      return json({ error: "Файл временно недоступен." }, 404);
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="${build.filename}"`,
    });
    return new Response(object.body, { headers });
  }
  const user = await session(request, env);
  if (!user) return noAccess();
  if (url.pathname === "/api/me" && request.method === "GET")
    return json({ username: user.username });
  if (url.pathname === "/api/builds" && request.method === "GET")
    return json({ builds: await catalog(env) });
  if (url.pathname === "/api/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(user.token_hash)
      .run();
    return json({ ok: true });
  }
  const match = /^\/api\/builds\/([a-z0-9-]{1,100})\/ticket$/.exec(
    url.pathname,
  );
  if (match && request.method === "POST") {
    const build = (await catalog(env)).find((b) => b.id === match[1]);
    if (!build) return json({ error: "Билд не найден." }, 404);
    const raw = token();
    await env.DB.prepare(
      "INSERT INTO tickets(token_hash,session_hash,build_id,expires) VALUES(?,?,?,?)",
    )
      .bind(digest(raw), user.token_hash, build.id, now() + 60)
      .run();
    return json({ url: `${url.origin}/download/${raw}` });
  }
  return json({ error: "Страница не найдена." }, 404);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowed = origin === env.ALLOWED_ORIGIN;
    let response;
    if (origin && !allowed)
      response = json({ error: "Недопустимый источник запроса." }, 403);
    else if (request.method === "OPTIONS")
      response = new Response(null, { status: 204 });
    else
      try {
        response = await route(request, env);
      } catch {
        response = json(
          { error: "Сервис временно недоступен. Попробуйте позже." },
          503,
        );
      }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, private");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Vary", "Origin");
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
