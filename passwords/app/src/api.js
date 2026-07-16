// Central client for the /api/v3 backend. Credentials (already client-side
// hashes) travel in the x-username / x-password headers, never in the URL.

async function call(backend, path, { method = "GET", auth, body } = {}) {
  const headers = auth
    ? { "x-username": auth.en_user, "x-password": auth.en_pw }
    : {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${backend}/api/v3${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status !== 200) {
    throw new Error(`${method} ${path} failed with status ${response.status}`);
  }
  return response;
}

async function callJson(backend, path, opts) {
  return (await call(backend, path, opts)).json();
}

export function apiNewPassword(backend) {
  return callJson(backend, "/generate");
}

export function apiCreateUser(backend, auth) {
  return call(backend, "/user", { method: "POST", auth });
}

export function apiVerifyUser(backend, auth) {
  return call(backend, "/user/verify", { auth });
}

export function apiChangeMasterPassword(backend, auth, new_password, buckets) {
  return call(backend, "/user", {
    method: "PUT",
    auth,
    body: { new_password, buckets },
  });
}

export function apiGetBucketKeys(backend, auth) {
  return callJson(backend, "/buckets", { auth });
}

export function apiGetAllBuckets(backend, auth) {
  return callJson(backend, "/buckets/all", { auth });
}

export function apiGetBucket(backend, auth, key) {
  return callJson(backend, `/bucket/${encodeURIComponent(key)}`, { auth });
}

export function apiCreateBucket(backend, auth, key, fields) {
  return call(backend, `/bucket/${encodeURIComponent(key)}`, {
    method: "POST",
    auth,
    body: fields,
  });
}

export function apiRenameBucket(backend, auth, key, new_key) {
  return call(backend, `/bucket/${encodeURIComponent(key)}/rename`, {
    method: "POST",
    auth,
    body: { new_key },
  });
}

export function apiDeleteBucket(backend, auth, key) {
  return call(backend, `/bucket/${encodeURIComponent(key)}`, {
    method: "DELETE",
    auth,
  });
}

export function apiUpsertField(backend, auth, key, label, en_value, sensitive) {
  return call(
    backend,
    `/bucket/${encodeURIComponent(key)}/field/${encodeURIComponent(label)}`,
    { method: "PUT", auth, body: { en_value, sensitive } }
  );
}

export function apiDeleteField(backend, auth, key, label) {
  return call(
    backend,
    `/bucket/${encodeURIComponent(key)}/field/${encodeURIComponent(label)}`,
    { method: "DELETE", auth }
  );
}
