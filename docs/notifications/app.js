const config = window.JOB_ALERT_CONFIG ?? {};
const state = {
  catalog: null,
  companies: [],
  selected: new Set(),
  selectedPreset: "",
  token: new URLSearchParams(location.search).get("token") ?? "",
  action: new URLSearchParams(location.search).get("action") ?? "",
  manageMode: false,
  turnstileToken: "",
  turnstileWidgetId: null,
};
if (state.token || state.action) history.replaceState(null, "", `${location.pathname}${location.hash}`);

const elements = Object.fromEntries([
  "email", "recommended-mode", "scratch-mode", "preset-list", "company-search",
  "company-list", "selected-count", "clear-selection", "consent",
  "submit-subscription", "form-message", "setup-panel", "account-panel",
  "account-title", "account-message", "account-actions", "turnstile-container",
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

function setMessage(message, isError = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle("is-error", isError);
}

async function api(action, payload = {}) {
  if (!config.apiUrl) throw new Error("Job alerts are not deployed yet. Set JOB_ALERT_CONFIG.apiUrl in config.js.");
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The alert service could not complete that request.");
  return data;
}

function renderPresets() {
  elements.presetList.replaceChildren(...state.catalog.recommendation_presets.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preset-button${state.selectedPreset === preset.id ? " is-selected" : ""}`;
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.description}</span>`;
    button.addEventListener("click", () => {
      state.selectedPreset = preset.id;
      state.selected = new Set(preset.company_ids);
      elements.companySearch.value = "";
      renderPresets();
      renderCompanies();
    });
    return button;
  }));
}

function renderCompanies() {
  const query = elements.companySearch.value.trim().toLowerCase();
  const companies = state.companies
    .filter((company) => `${company.name} ${company.bucket} ${(company.role_families ?? []).join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => Number(state.selected.has(b.id)) - Number(state.selected.has(a.id)));
  if (companies.length === 0) {
    elements.companyList.innerHTML = '<p class="empty-state">No companies match that search.</p>';
  } else {
    elements.companyList.replaceChildren(...companies.map((company) => {
      const label = document.createElement("label");
      label.className = "company-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(company.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selected.add(company.id);
        else state.selected.delete(company.id);
        state.selectedPreset = "";
        elements.selectedCount.textContent = state.selected.size;
        renderPresets();
      });
      const name = document.createElement("span");
      name.className = "company-name";
      name.textContent = `${company.featured ? "🔥 " : ""}${company.name}`;
      const bucket = document.createElement("span");
      bucket.className = "company-bucket";
      bucket.textContent = company.bucket;
      label.append(checkbox, name, bucket);
      return label;
    }));
  }
  elements.selectedCount.textContent = state.selected.size;
}

function setMode(mode) {
  const recommended = mode === "recommended";
  elements.recommendedMode.classList.toggle("is-selected", recommended);
  elements.recommendedMode.setAttribute("aria-pressed", String(recommended));
  elements.scratchMode.classList.toggle("is-selected", !recommended);
  elements.scratchMode.setAttribute("aria-pressed", String(!recommended));
  elements.presetList.hidden = !recommended;
  if (!recommended) {
    state.selectedPreset = "";
    state.selected.clear();
    renderPresets();
    renderCompanies();
  }
}

async function submitSubscription() {
  if (state.manageMode) {
    if (state.selected.size === 0) return setMessage("Select at least one company.", true);
    elements.submitSubscription.disabled = true;
    setMessage("Saving preferences…");
    try {
      await api("update_preferences", { token: state.token, company_ids: [...state.selected] });
      setMessage("Preferences saved.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      elements.submitSubscription.disabled = false;
    }
    return;
  }
  const email = elements.email.value.trim();
  if (!email || !elements.email.checkValidity()) return setMessage("Enter a valid email address.", true);
  if (state.selected.size === 0) return setMessage("Select at least one company. Nothing is selected by default.", true);
  if (!elements.consent.checked) return setMessage("Confirm that you want to receive these alerts.", true);
  elements.submitSubscription.disabled = true;
  setMessage("Sending your verification email…");
  try {
    const result = await api("request_subscription", {
      email,
      company_ids: [...state.selected],
      preset_id: state.selectedPreset || null,
      turnstile_token: state.turnstileToken || null,
    });
    setMessage(result.message || "Check your inbox for a verification link.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    if (state.turnstileWidgetId !== null) {
      state.turnstileToken = "";
      window.turnstile.reset(state.turnstileWidgetId);
    }
    elements.submitSubscription.disabled = false;
  }
}

function showAccount(title, message, actions = []) {
  elements.setupPanel.hidden = true;
  document.querySelectorAll(".panel, .submit-row").forEach((element) => {
    if (element !== elements.accountPanel) element.hidden = true;
  });
  elements.accountPanel.hidden = false;
  elements.accountTitle.textContent = title;
  elements.accountMessage.textContent = message;
  elements.accountActions.replaceChildren(...actions);
}

function actionButton(label, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", callback);
  return button;
}

async function handleTokenAction() {
  if (!state.token || !state.action) return;
  try {
    if (!["verify", "manage", "unsubscribe"].includes(state.action)) throw new Error("Unknown preference action.");
    if (state.action === "unsubscribe") {
      await api("unsubscribe", { token: state.token });
      showAccount("You’re unsubscribed", "You will not receive more role alerts unless you opt in again.");
      return;
    }
    const result = await api(state.action === "verify" ? "verify" : "get_preferences", { token: state.token });
    state.selected = new Set(result.company_ids ?? []);
    const manage = actionButton("Manage companies", () => {
      elements.accountPanel.hidden = true;
      document.querySelectorAll(".panel, .submit-row").forEach((element) => {
        if (element !== elements.accountPanel) element.hidden = false;
      });
      state.manageMode = true;
      elements.email.value = result.email ?? "";
      elements.email.disabled = true;
      elements.submitSubscription.textContent = "Save preferences";
      elements.consent.checked = true;
      elements.consent.closest("label").hidden = true;
      elements.turnstileContainer.hidden = true;
      renderCompanies();
    });
    const unsubscribe = actionButton("Unsubscribe", async () => {
      try {
        await api("unsubscribe", { token: state.token });
        showAccount("You’re unsubscribed", "You will not receive more role alerts unless you opt in again.");
      } catch (error) {
        showAccount("Unsubscribe failed", error.message);
      }
    });
    showAccount(
      state.action === "verify" ? "Email verified" : "Welcome back",
      `Alerts are active for ${(result.company_ids ?? []).length} companies.`,
      [manage, unsubscribe],
    );
  } catch (error) {
    showAccount("This link could not be used", error.message);
  }
}

async function setupTurnstile() {
  if (!config.turnstileSiteKey) {
    elements.turnstileContainer.hidden = true;
    return;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Human verification could not be loaded."));
    document.head.append(script);
  });
  state.turnstileWidgetId = window.turnstile.render(elements.turnstileContainer, {
    sitekey: config.turnstileSiteKey,
    callback: (token) => { state.turnstileToken = token; },
    "expired-callback": () => { state.turnstileToken = ""; },
    "error-callback": () => { state.turnstileToken = ""; },
  });
}

async function init() {
  const response = await fetch("catalog.json", { cache: "no-store" });
  if (!response.ok) throw new Error("The company catalog is unavailable.");
  state.catalog = await response.json();
  state.companies = state.catalog.companies;
  renderPresets();
  renderCompanies();
  elements.recommendedMode.addEventListener("click", () => setMode("recommended"));
  elements.scratchMode.addEventListener("click", () => setMode("scratch"));
  elements.companySearch.addEventListener("input", renderCompanies);
  elements.clearSelection.addEventListener("click", () => {
    state.selected.clear();
    state.selectedPreset = "";
    renderPresets();
    renderCompanies();
  });
  elements.submitSubscription.addEventListener("click", submitSubscription);
  await setupTurnstile();
  await handleTokenAction();
}

init().catch((error) => {
  elements.companyList.innerHTML = `<p class="empty-state">${error.message}</p>`;
  setMessage(error.message, true);
});
