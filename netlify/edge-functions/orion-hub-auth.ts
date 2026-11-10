import { getStore } from "@netlify/blobs";

const COOKIE_NAME = "orion-hub-session";
const PASSWORD_ENV = "ORION_HUB_PASSWORD";
const SESSION_SECRET_ENV = "ORION_HUB_SESSION_SECRET";
const DASHBOARD_STORE_NAME = "orion-dashboard-snapshots";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_PASSWORD_LENGTH = 256;

function htmlResponse(body: string, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function loginPage(error = "") {
  const errorBlock = error
    ? `<p class="error" role="alert">${error}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <meta name="theme-color" content="#0f172a" />
  <title>Orion Hub · Unlock</title>
  <style>
    *{box-sizing:border-box}
    html{background:#0b1020}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef5ff;background:radial-gradient(circle at top left,rgba(52,211,153,.08),transparent 28rem),linear-gradient(180deg,#0b1020,#0d1425)}
    main{width:min(100%,390px);padding:24px;border:1px solid #223149;border-radius:22px;background:rgba(10,17,31,.9);box-shadow:0 14px 32px rgba(0,0,0,.26)}
    .eyebrow{margin:0 0 7px;color:#6ee7b7;font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    h1{margin:0;font-size:2rem;letter-spacing:-.04em}
    .sub{margin:8px 0 20px;color:#9aa8bc}
    label{display:block;margin-bottom:7px;font-size:.82rem;font-weight:800}
    input{width:100%;min-height:48px;padding:10px 12px;border:1px solid #31425a;border-radius:13px;background:#101827;color:#eef5ff;font:inherit}
    input:focus{outline:3px solid rgba(110,231,183,.35);outline-offset:2px}
    button{width:100%;min-height:48px;margin-top:12px;border:1px solid rgba(110,231,183,.35);border-radius:13px;background:#6ee7b7;color:#082019;font:inherit;font-weight:850;cursor:pointer}
    .error{margin:0 0 14px;padding:10px 12px;border:1px solid rgba(248,113,113,.35);border-radius:12px;background:rgba(127,29,29,.25);color:#fecaca;font-size:.84rem}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Personal workspace</p>
    <h1>Orion Hub</h1>
    <p class="sub">Enter the hub password to continue.</p>
    ${errorBlock}
    <form method="post">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="${MAX_PASSWORD_LENGTH}" autofocus />
      <button type="submit">Unlock Hub</button>
    </form>
  </main>
</body>
</html>`;
}

function configurationError() {
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Orion Hub unavailable</title></head><body><main><h1>Orion Hub unavailable</h1><p>Authentication has not been configured for this deployment.</p></main></body></html>`, 503);
}

function parseCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function passwordMatches(candidate: string, configured: string) {
  const [candidateHash, configuredHash] = await Promise.all([sha256(candidate), sha256(configured)]);
  return constantTimeEqual(candidateHash, configuredHash);
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createSession(secret: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

async function validSession(value: string | null, secret: string) {
  if (!value) return false;
  const match = /^(\d{10})\.([A-Za-z0-9_-]{40,64})$/.exec(value);
  if (!match) return false;

  const expires = Number(match[1]);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;

  const signature = fromBase64Url(match[2]);
  if (!signature) return false;

  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(match[1]));
}

function sessionCookie(value: string) {
  return `${COOKIE_NAME}=${value}; Max-Age=${SESSION_SECONDS}; Path=/orion-hub; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/orion-hub; HttpOnly; Secure; SameSite=Strict`;
}

function validProjectId(value: string | null): value is string {
  return Boolean(value && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value));
}

function validSnapshotId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

async function dashboardCurrent(url: URL) {
  const projectId = url.searchParams.get("project");
  if (!validProjectId(projectId)) {
    return jsonResponse({ error: "invalid_project", message: "A valid project id is required." }, 400);
  }

  const store = getStore(DASHBOARD_STORE_NAME);
  const pointer = await store.get(`projects/${projectId}/current.json`, {
    type: "json",
    consistency: "strong",
  }) as { snapshotId?: unknown } | null;

  if (!pointer || !validSnapshotId(pointer.snapshotId)) {
    return jsonResponse({ error: "snapshot_not_found", message: "No canonical snapshot exists for this project." }, 404);
  }

  const snapshot = await store.get(
    `projects/${projectId}/snapshots/${pointer.snapshotId}.json`,
    { type: "json", consistency: "strong" },
  );

  if (!snapshot) {
    return jsonResponse({ error: "snapshot_missing", message: "The current snapshot pointer is invalid." }, 500);
  }

  return jsonResponse(snapshot);
}

async function handleAuthenticatedRequest(request: Request, context: { next: () => Promise<Response> }, url: URL) {
  if (url.pathname === "/orion-hub/api/dashboard/current") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "method_not_allowed", message: "Method not allowed." }, 405);
    }
    return dashboardCurrent(url);
  }

  return context.next();
}

export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const password = Netlify.env.get(PASSWORD_ENV)?.trim();
  const sessionSecret = Netlify.env.get(SESSION_SECRET_ENV)?.trim();

  if (!password || !sessionSecret || sessionSecret.length < 32) {
    return configurationError();
  }

  const url = new URL(request.url);

  if (url.searchParams.get("logout") === "1") {
    const redirectUrl = new URL("/orion-hub/", url);
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl.toString(),
        "Set-Cookie": clearCookie(),
        "Cache-Control": "no-store",
      },
    });
  }

  const existingSession = parseCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (await validSession(existingSession, sessionSecret)) {
    return handleAuthenticatedRequest(request, context, url);
  }

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return htmlResponse(loginPage("Request too large."), 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return htmlResponse(loginPage("Invalid request."), 400);
    }

    const candidate = form.get("password");
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_PASSWORD_LENGTH) {
      return htmlResponse(loginPage("Enter the hub password."), 400);
    }

    if (!(await passwordMatches(candidate, password))) {
      return htmlResponse(loginPage("Incorrect password."), 401);
    }

    const token = await createSession(sessionSecret);
    const redirectUrl = new URL(url.pathname.startsWith("/orion-hub/") ? url.pathname : "/orion-hub/", url);
    redirectUrl.search = url.search;
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl.toString(),
        "Set-Cookie": sessionCookie(token),
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" },
    });
  }

  return htmlResponse(loginPage());
};

export const config = {
  path: "/orion-hub/*",
};
