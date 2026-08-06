async function submitAuth(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message ?? "Something went wrong.");
  }
  window.location.href = "/dashboard";
}

window.submitAuth = submitAuth;
