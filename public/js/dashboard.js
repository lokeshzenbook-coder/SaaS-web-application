const $ = (id) => document.getElementById(id);

let stats = null;

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Request failed (${res.status})`);
  }
  return data;
}

function redirectToLogin() {
  window.location.href = "/login";
}

async function loadStats() {
  stats = await fetchJSON("/api/dashboard/stats");
  const u = stats.usage;
  const sub = stats.subscription;

  $("nav-email").textContent = stats.user.email;
  $("api-key").textContent = await getApiKey();

  const plan = {
    id: stats.user.plan,
    name: stats.user.planName,
    priceCents: stats.plan.priceCents,
    apiRateMax: stats.plan.apiRateMax,
    features: stats.plan.features,
  };

  $("stat-grid").innerHTML = [
    stat("Plan", plan.name),
    stat("Calls this month", u.used.toLocaleString()),
    stat("Quota", u.quota.toLocaleString()),
    stat("Remaining", u.remaining.toLocaleString()),
    stat("Rate limit", `${plan.apiRateMax}/min`),
    stat("Subscription", sub ? sub.status : "none"),
  ].join("");

  $("usage-label").textContent = `${u.used.toLocaleString()} of ${u.quota.toLocaleString()} calls used in ${u.month}`;
  $("usage-percent").textContent = `${u.percent}%`;
  $("usage-bar").style.width = `${Math.min(100, u.percent)}%`;
  $("rate-limit").textContent = String(plan.apiRateMax);

  await loadPlans(plan);
}

async function getApiKey() {
  const me = await fetchJSON("/api/auth/me");
  return me.user.apiKey;
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function price(cents) {
  return cents === 0 ? "$0" : `$${(cents / 100).toFixed(0)}`;
}

async function loadPlans(currentPlan) {
  const { plans } = await fetchJSON("/api/plans");
  $("plan-grid").innerHTML = plans
    .map((p) => {
      const isCurrent = p.id === currentPlan.id;
      return `
        <div class="card ${p.id === "pro" ? "highlight" : ""}">
          <h3>${p.name} ${isCurrent ? '<span class="small muted">(current)</span>' : ""}</h3>
          <div class="price">${price(p.price_cents)} <small>/ month</small></div>
          <ul>${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
          ${
            isCurrent
              ? `<button class="btn" disabled>Current plan</button>`
              : p.price_cents === 0
                ? `<button class="btn primary" data-plan="${p.id}">Switch to ${p.name}</button>`
                : `<button class="btn primary" data-plan="${p.id}">Subscribe · ${price(p.price_cents)}</button>`
          }
        </div>`;
    })
    .join("");
}

async function subscribe(planId) {
  $("billing-error").style.display = "none";
  $("billing-success").style.display = "none";
  try {
    const data = await fetchJSON("/api/billing/subscribe", {
      method: "POST",
      body: JSON.stringify({ plan_id: planId, payment_method: "card" }),
    });
    $("billing-success").textContent = `Subscribed to ${data.subscription.planId} (mock charge ${data.charge.id} succeeded). Refreshing…`;
    $("billing-success").style.display = "block";
    setTimeout(loadStats, 1200);
  } catch (err) {
    $("billing-error").textContent = err.message;
    $("billing-error").style.display = "block";
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-plan]");
  if (btn) subscribe(btn.dataset.plan);
});

$("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
});

$("pg-call").addEventListener("click", async () => {
  let value = $("pg-value").value.trim();
  try {
    value = value ? JSON.parse(value) : null;
  } catch {
    value = $("pg-value").value.trim() || null;
  }
  try {
    const apiKey = await getApiKey();
    const data = await fetchJSON("/api/v1/data", {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: JSON.stringify({ value }),
    });
    $("pg-output").textContent = JSON.stringify(data, null, 2);
    loadStats();
  } catch (err) {
    $("pg-output").textContent = `Error: ${err.message}`;
  }
});

loadStats().catch((err) => {
  if (err.message.includes("unauthorized") || err.message.includes("Authentication")) {
    redirectToLogin();
  } else {
    toast(err.message, true);
  }
});
