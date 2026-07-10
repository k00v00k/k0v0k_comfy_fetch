import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { localizeError, t, tPlural } from "./i18n.js";

const EXTENSION_NAME = "k0v0k.comfy-fetch";
const PANEL_DATA_ATTRIBUTE = "data-k0v0k-comfy-fetch";
const EVENT_NAME = "k0v0k.comfy-fetch.job_update";
const BOOTSTRAP_PATH = "/k0v0k/comfy-fetch/bootstrap";
const STATUS_PATH = "/k0v0k/comfy-fetch/status";
const ANALYZE_PATH = "/k0v0k/comfy-fetch/analyze";
const RESOLVE_PATH = "/k0v0k/comfy-fetch/resolve";
const CANCEL_PATH = (jobId) => scopedPath(`/k0v0k/comfy-fetch/jobs/${encodeURIComponent(jobId)}/cancel`);
const JOB_POLL_INTERVAL_MS = 2000;

const state = {
  initialized: false,
  root: null,
  status: null,
  analysis: null,
  workflowHints: null,
  activeJob: null,
  jobTimer: null,
  lastRefreshedJobId: null,
  lastResolvedRefreshJobId: null,
  lastResolvedRefreshCount: 0,
  analyzeTimer: null,
  uiHooksInstalled: false,
  domObserverInstalled: false,
  renderTimer: null,
  authBootstrapPromise: null
};

function currentWorkflowScopeId() {
  const hash = (window.location.hash || "").replace(/^#/, "").trim();
  return hash || "current-workflow";
}

function scopedPath(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workflow_scope_id=${encodeURIComponent(currentWorkflowScopeId())}`;
}

function formatSeconds(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds < 0) return t("time.estimating");
  if (seconds === 0) return t("time.done");
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins <= 0) return t("time.seconds", { count: secs });
  if (mins < 60) return t("time.minutesSeconds", { minutes: mins, seconds: secs });
  const hours = Math.floor(mins / 60);
  return t("time.hoursMinutes", { hours, minutes: mins % 60 });
}

function formatRate(bytesPerSecond) {
  if (typeof bytesPerSecond !== "number" || Number.isNaN(bytesPerSecond) || bytesPerSecond <= 0) return t("time.observing");
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return t("time.estimating");
  return `${value.toFixed(1)}%`;
}

function formatAge(timestamp) {
  if (!timestamp) return t("time.justNow");
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return t("time.justNow");
  const diffSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (diffSeconds < 5) return t("time.justNow");
  if (diffSeconds < 60) return t("time.ago", { value: t("time.seconds", { count: diffSeconds }) });
  const mins = Math.floor(diffSeconds / 60);
  const secs = diffSeconds % 60;
  if (mins < 60) return t("time.ago", { value: t("time.minutesSeconds", { minutes: mins, seconds: secs }) });
  const hours = Math.floor(mins / 60);
  return t("time.ago", { value: t("time.hoursMinutes", { hours, minutes: mins % 60 }) });
}

function kindLabel(kind) {
  return t(`kinds.${kind}`, {}, kind || t("kinds.unknown"));
}

function jobErrorInfo(item) {
  if (item?.last_error_info && typeof item.last_error_info === "object") {
    return item.last_error_info;
  }
  if (item?.last_error_code || item?.last_error) {
    return {
      code: item.last_error_code || "internal_fetch_error",
      message: item.last_error || ""
    };
  }
  return null;
}

function renderErrorLine(item) {
  const errorInfo = jobErrorInfo(item);
  if (!errorInfo) return "";
  const copy = localizeError(errorInfo);
  const detailParts = [];
  const details = errorInfo.details && typeof errorInfo.details === "object" ? errorInfo.details : {};

  if (typeof errorInfo.http_status === "number") {
    detailParts.push(`HTTP ${errorInfo.http_status}`);
  }
  if (details.provider) {
    detailParts.push(String(details.provider));
  } else if (errorInfo.provider) {
    detailParts.push(String(errorInfo.provider));
  }
  if (details.host) {
    detailParts.push(String(details.host));
  }
  if (errorInfo.retryable) {
    detailParts.push(t("ui.retryableLabel"));
  }
  if (errorInfo.code === "insufficient_free_space") {
    if (typeof details.available_free_bytes === "number" && typeof details.required_free_bytes === "number") {
      detailParts.push(
        t("ui.freeNeedLabel", {
          free: formatBytes(details.available_free_bytes),
          need: formatBytes(details.required_free_bytes)
        })
      );
    }
    if (details.path) {
      detailParts.push(String(details.path));
    }
  }

  const detailLine = detailParts.length
    ? `<div class="mt-1 text-[10px]/relaxed text-muted-foreground">${escapeHtml(detailParts.join(" · "))}</div>`
    : "";
  const rawLine = errorInfo.message && errorInfo.message !== copy.body
    ? `<div class="mt-1 text-[10px]/relaxed text-muted-foreground">${escapeHtml(errorInfo.message)}</div>`
    : "";

  return `
    <div class="mt-1 rounded-md border border-destructive/25 bg-destructive/6 px-2 py-2">
      <div class="text-[11px]/relaxed font-medium text-destructive">${escapeHtml(copy.headline)}</div>
      <div class="mt-1 text-[11px]/relaxed text-destructive/90">${escapeHtml(copy.body)}</div>
      <div class="mt-1 text-[10px]/relaxed text-muted-foreground">${escapeHtml(copy.action)}</div>
      ${detailLine}
      ${rawLine}
    </div>
  `;
}

function formatBytes(bytes) {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return t("bytes.unknown");
  const units = ["B", "KB", "MB", "GB", "TB"].map((unit) => t(`bytes.units.${unit}`, {}, unit));
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function cloneWorkflowValue(value) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return String(value);
  }
}

function* iterWorkflowObjects(value) {
  if (!value || typeof value !== "object") {
    return;
  }
  yield value;
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* iterWorkflowObjects(item);
    }
    return;
  }
  for (const child of Object.values(value)) {
    yield* iterWorkflowObjects(child);
  }
}

function normalizeDirectoryKind(kind) {
  const aliases = {
    checkpoints: "checkpoints",
    checkpoint: "checkpoints",
    loras: "loras",
    lora: "loras",
    vae: "vae",
    vaes: "vae",
    vae_approx: "vae_approx",
    "vae approx": "vae_approx",
    "vae-approx": "vae_approx",
    text_encoders: "text_encoders",
    "text encoder": "text_encoders",
    "text-encoders": "text_encoders",
    audio_encoders: "audio_encoders",
    "audio encoder": "audio_encoders",
    "audio-encoders": "audio_encoders",
    clip: "clip",
    clip_vision: "clip_vision",
    "clip vision": "clip_vision",
    controlnet: "controlnet",
    controlnets: "controlnet",
    diffusion_models: "diffusion_models",
    "diffusion model": "diffusion_models",
    "diffusion-models": "diffusion_models",
    diffusers: "diffusers",
    diffuser: "diffusers",
    unet: "unet",
    upscale_models: "upscale_models",
    "upscale model": "upscale_models",
    latent_upscale_models: "latent_upscale_models",
    "latent upscale model": "latent_upscale_models",
    "latent-upscale-models": "latent_upscale_models",
    embeddings: "embeddings",
    embedding: "embeddings",
    background_removal: "background_removal",
    "background removal": "background_removal",
    "background-removal": "background_removal",
    detection: "detection",
    detections: "detection",
    frame_interpolation: "frame_interpolation",
    "frame interpolation": "frame_interpolation",
    "frame-interpolation": "frame_interpolation",
    geometry_estimation: "geometry_estimation",
    "geometry estimation": "geometry_estimation",
    "geometry-estimation": "geometry_estimation",
    gligen: "gligen",
    hypernetwork: "hypernetworks",
    hypernetworks: "hypernetworks",
    model_patch: "model_patches",
    model_patches: "model_patches",
    "model patches": "model_patches",
    "model-patches": "model_patches",
    optical_flow: "optical_flow",
    "optical flow": "optical_flow",
    "optical-flow": "optical_flow",
    photomaker: "photomaker",
    style_model: "style_models",
    style_models: "style_models",
    "style model": "style_models",
    "style-models": "style_models",
    ipadapter: "ipadapter",
    insightface: "insightface"
  };
  return aliases[String(kind || "").trim().toLowerCase()] || null;
}

function parseMarkdownDependencies(text) {
  const dependencies = [];
  let currentKind = null;
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^\*\*([^*]+)\*\*$/);
    if (headerMatch) {
      currentKind = normalizeDirectoryKind(headerMatch[1]);
      continue;
    }
    if (line.startsWith("#")) {
      currentKind = null;
      continue;
    }
    if (!currentKind || !line.startsWith("- ")) {
      continue;
    }
    for (const match of line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
      dependencies.push({
        kind: currentKind,
        filename: match[1]?.trim() || "",
        url: match[2]?.trim() || ""
      });
    }
  }
  return dependencies;
}

function extractLocalWorkflowDependencies(workflow) {
  const discovered = new Map();
  for (const node of iterWorkflowObjects(workflow)) {
    const models = Array.isArray(node?.properties?.models) ? node.properties.models : [];
    for (const model of models) {
      const kind = normalizeDirectoryKind(model?.directory);
      const url = String(model?.url || "").trim();
      const filename = String(model?.name || "").trim();
      if (!kind || !url) {
        continue;
      }
      discovered.set(`${kind}:${filename}:${url}`, {
        kind,
        filename,
        url,
        source: "embedded_model_hint"
      });
    }

    if (node?.type !== "MarkdownNote" || !Array.isArray(node?.widgets_values)) {
      continue;
    }
    for (const value of node.widgets_values) {
      if (typeof value !== "string" || !value.includes("http")) {
        continue;
      }
      for (const dependency of parseMarkdownDependencies(value)) {
        discovered.set(
          `${dependency.kind}:${dependency.filename}:${dependency.url}`,
          { ...dependency, source: "markdown_note" }
        );
      }
    }
  }
  return Array.from(discovered.values());
}

function summarizeWorkflowHints(workflow) {
  const dependencies = extractLocalWorkflowDependencies(workflow);
  return {
    dependencyCount: dependencies.length,
    dependencies
  };
}

function readLiveNodeWidgetValues(node) {
  if (typeof node?.serialize === "function") {
    try {
      const serializedNode = node.serialize();
      if (Array.isArray(serializedNode?.widgets_values) && serializedNode.widgets_values.length) {
        return serializedNode.widgets_values.map((value) => cloneWorkflowValue(value));
      }
    } catch (_error) {
      // Fall through to live widget inspection.
    }
  }
  if (Array.isArray(node?.widgets_values) && node.widgets_values.length) {
    return node.widgets_values.map((value) => cloneWorkflowValue(value));
  }
  if (Array.isArray(node?.widgets) && node.widgets.length) {
    return node.widgets.map((widget) => cloneWorkflowValue(widget?.value));
  }
  return null;
}

function enrichSerializedWorkflow(serialized, graph) {
  if (!serialized || !Array.isArray(serialized.nodes)) {
    return serialized;
  }
  const liveNodes = Array.isArray(graph?._nodes) ? graph._nodes : [];
  if (!liveNodes.length) {
    return serialized;
  }
  const liveNodesById = new Map(
    liveNodes
      .filter((node) => node && node.id != null)
      .map((node) => [node.id, node])
  );

  const nodes = serialized.nodes.map((node) => {
    const liveNode = liveNodesById.get(node?.id);
    if (!liveNode) {
      return node;
    }

    let nextNode = node;
    const liveWidgetValues = readLiveNodeWidgetValues(liveNode);
    const serializedWidgetValues = Array.isArray(node?.widgets_values) ? node.widgets_values : null;
    const shouldRestoreWidgets = Array.isArray(liveWidgetValues) && (
      !serializedWidgetValues ||
      !serializedWidgetValues.length ||
      (node?.type === "MarkdownNote" && JSON.stringify(serializedWidgetValues) !== JSON.stringify(liveWidgetValues))
    );
    if (shouldRestoreWidgets) {
      nextNode = { ...nextNode, widgets_values: liveWidgetValues };
    }

    const liveModels = Array.isArray(liveNode?.properties?.models)
      ? liveNode.properties.models.map((value) => cloneWorkflowValue(value))
      : null;
    if (liveModels?.length && !Array.isArray(nextNode?.properties?.models)) {
      nextNode = {
        ...nextNode,
        properties: {
          ...(nextNode?.properties || {}),
          models: liveModels
        }
      };
    }
    return nextNode;
  });

  return { ...serialized, nodes };
}

function currentWorkflow() {
  const graph = app?.graph ?? app?.rootGraph;
  if (!graph || typeof graph.serialize !== "function") {
    throw new Error(t("ui.workflowUnavailable"));
  }
  return enrichSerializedWorkflow(graph.serialize(), graph);
}

async function fetchJson(path, options = {}) {
  const requestOptions = { credentials: "same-origin", ...options };
  if (requestOptions.body && !requestOptions.headers) {
    requestOptions.headers = { "Content-Type": "application/json" };
  }
  const runRequest = async () => {
    const response = await api.fetchApi(path, requestOptions);
    const payload = await response.json();
    return { response, payload };
  };

  let { response, payload } = await runRequest();
  if (response.status === 401 && (payload?.error === "plugin_auth_required" || payload?.detail === "plugin_auth_required")) {
    await ensurePluginAuth();
    ({ response, payload } = await runRequest());
  }
  if (!response.ok) {
    const detail = payload?.error || payload?.detail || response.statusText;
    throw new Error(detail);
  }
  return payload;
}

async function ensurePluginAuth() {
  if (state.authBootstrapPromise) {
    return state.authBootstrapPromise;
  }
  state.authBootstrapPromise = (async () => {
    const response = await api.fetchApi(BOOTSTRAP_PATH, {
      method: "POST",
      credentials: "same-origin"
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = payload?.error || payload?.detail || response.statusText;
      throw new Error(detail);
    }
    return payload;
  })();
  try {
    return await state.authBootstrapPromise;
  } finally {
    state.authBootstrapPromise = null;
  }
}

async function refreshStatus() {
  try {
    const payload = await fetchJson(scopedPath(STATUS_PATH));
    state.status = payload;
    state.activeJob = payload.active_job ?? null;
    render();
  } catch (error) {
    console.warn("[K0V0K Comfy Fetch] Failed to load model resolver status.", error);
  }
}

async function refreshActiveJob() {
  const jobId = state.activeJob?.job_id;
  if (!jobId) return;
  try {
    const previousJob = state.activeJob;
    const payload = await fetchJson(`/k0v0k/comfy-fetch/jobs/${encodeURIComponent(jobId)}`);
    if (payload?.workflow_scope_id !== currentWorkflowScopeId()) {
      state.activeJob = null;
      render();
      return;
    }
    state.activeJob = payload;
    maybeRefreshNativeMissingModels(previousJob, payload);
    render();
  } catch (error) {
    console.warn("[K0V0K Comfy Fetch] Failed to refresh active job status.", error);
  }
}

async function refreshAnalysis() {
  let workflow;
  try {
    workflow = currentWorkflow();
    state.workflowHints = summarizeWorkflowHints(workflow);
  } catch (_error) {
    state.analysis = null;
    state.workflowHints = null;
    removePanel();
    return;
  }
  try {
    const payload = await fetchJson(ANALYZE_PATH, {
      method: "POST",
      body: JSON.stringify({ workflow })
    });
    state.analysis = payload.analysis ?? null;
    render();
  } catch (error) {
    console.warn("[K0V0K Comfy Fetch] Failed to analyze current workflow.", error);
    state.analysis = null;
    render();
  }
}

function scheduleAnalysis() {
  if (state.analyzeTimer) {
    window.clearTimeout(state.analyzeTimer);
  }
  state.analyzeTimer = window.setTimeout(() => {
    state.analyzeTimer = null;
    void refreshAnalysis();
  }, 250);
}

function startJobPolling() {
  if (state.jobTimer) return;
  state.jobTimer = window.setInterval(() => {
    void refreshActiveJob();
  }, JOB_POLL_INTERVAL_MS);
}

function stopJobPolling() {
  if (!state.jobTimer) return;
  window.clearInterval(state.jobTimer);
  state.jobTimer = null;
}

function scheduleRender() {
  if (state.renderTimer) {
    window.clearTimeout(state.renderTimer);
  }
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    render();
  }, 50);
}

function findErrorGroups() {
  return Array.from(document.querySelectorAll('[data-testid^="error-group-"]'));
}

function findErrorsContainer() {
  return document.querySelector('[data-testid="errors-summary-hero"]')?.closest(".overflow-hidden.rounded-lg")
    ?? findErrorGroups()
      .map((element) => element.closest(".overflow-hidden.rounded-lg") ?? element.parentElement)
      .find(Boolean)
    ?? document.querySelector('[data-testid="error-group-missing-model"]')?.parentElement
    ?? document.querySelector('[data-testid="error-group-missing-media"]')?.parentElement;
}

function findMissingModelsSection() {
  return document.querySelector('[data-testid="error-group-missing-model"]')
    ?? document.querySelector('[data-testid="error-group-missing-media"]')
    ?? findErrorGroups().find((element) => {
      const text = (element.textContent || "").toLowerCase();
      return (
        text.includes("missing model") ||
        text.includes("missing models") ||
        text.includes("diffusion model") ||
        text.includes("text encoder") ||
        text.includes("vae") ||
        text.includes("background removal") ||
        text.includes("lora")
      );
    })
    ?? null;
}

function ensurePanel() {
  const existing = document.querySelector(`[${PANEL_DATA_ATTRIBUTE}="root"]`);
  if (existing) {
    state.root = existing;
    return existing;
  }

  const missingInputsSection = findMissingModelsSection();
  const errorsContainer = findErrorsContainer();
  if (!missingInputsSection && !errorsContainer) return null;

  const panel = document.createElement("section");
  panel.setAttribute(PANEL_DATA_ATTRIBUTE, "root");
  panel.className = "border-b border-secondary-background bg-interface-panel-surface px-3 py-3";

  if (errorsContainer) {
    errorsContainer.prepend(panel);
  } else if (missingInputsSection?.parentElement) {
    missingInputsSection.parentElement.insertBefore(panel, missingInputsSection);
  }
  state.root = panel;
  return panel;
}

function removePanel() {
  const existing = document.querySelector(`[${PANEL_DATA_ATTRIBUTE}="root"]`);
  if (existing) existing.remove();
  state.root = null;
}

function itemStatusText(item) {
  switch (item?.status) {
    case "resolved":
      return t("status.resolved");
    case "failed":
      return t("status.failed");
    case "canceled":
      return t("status.canceled");
    case "retry_queued":
      return t("status.retryQueued", { retry: item.retry_count, max: item.max_retries });
    case "retrying":
      return t("status.retrying", { retry: item.retry_count, max: item.max_retries });
    case "downloading":
      return t("status.downloading");
    case "planning":
      return t("status.planning");
    case "queued":
      return t("status.queued");
    default:
      return t("status.pending");
  }
}

function renderItems(job) {
  const items = Array.isArray(job?.items) ? job.items : [];
  if (!items.length) {
      return `<p class="m-0 text-xs/normal text-muted-foreground">${escapeHtml(t("ui.noItemsYet"))}</p>`;
  }
  return `
    <ul class="m-0 mt-2 list-none space-y-2 p-0">
      ${items
        .map((item) => {
          const errorLine = renderErrorLine(item);
          const destination = item.destination
            ? `<div class="text-muted-foreground" style="font-size: 9.5px; line-height: 1.4;">${escapeHtml(item.destination)}</div>`
            : "";
          const progressLine = typeof item.percent_complete === "number"
            ? `<div class="text-[11px]/relaxed text-muted-foreground">${escapeHtml(formatPercent(item.percent_complete))} · ${escapeHtml(formatBytes(item.bytes_downloaded || 0))}${typeof item.content_length === "number" ? ` / ${escapeHtml(formatBytes(item.content_length))}` : ""}${item.eta_seconds != null ? ` · ETA ${escapeHtml(formatSeconds(item.eta_seconds))}` : ""}</div>`
            : "";
          const progressBar = typeof item.percent_complete === "number"
            ? `<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-base-foreground/10"><div class="h-full rounded-full bg-primary" style="width:${Math.max(0, Math.min(item.percent_complete, 100))}%"></div></div>`
            : "";
          return `
            <li class="rounded-md border border-secondary-background px-2 py-2">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-xs font-medium text-base-foreground">${escapeHtml(item.filename || item.name || t("ui.unknownModel"))}</div>
                  <div class="text-muted-foreground" style="font-size: 9.5px; line-height: 1.4;">${escapeHtml(kindLabel(item.kind))} · ${escapeHtml(itemStatusText(item))}</div>
                  ${progressLine}
                  ${progressBar}
                  ${destination}
                  ${errorLine}
                </div>
                <div class="shrink-0 text-muted-foreground" style="font-size: 9.5px; line-height: 1.4;">${escapeHtml(tPlural("ui.attemptLabel", item.attempt_count || 0, { count: item.attempt_count || 0 }))}</div>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render() {
  const currentScopeId = currentWorkflowScopeId();
  const scopedActiveJob = state.activeJob?.workflow_scope_id === currentScopeId ? state.activeJob : null;
  if (state.activeJob && !scopedActiveJob) {
    state.activeJob = null;
  }
  const activeJobRunning = scopedActiveJob && ["queued", "running", "canceling"].includes(scopedActiveJob.status);
  if (activeJobRunning) {
    startJobPolling();
  } else {
    stopJobPolling();
  }
  const uiMissingModelsPresent = Boolean(findMissingModelsSection());
  const missingModelCount = state.analysis?.workflow?.missing_model_count ?? 0;
  const analysisKnownSatisfied = Boolean(state.analysis) && missingModelCount === 0;
  const dependencyCount = state.analysis?.workflow?.dependency_count ?? state.workflowHints?.dependencyCount ?? 0;
  const resolverHasKnownDownloads = dependencyCount > 0;
  const shouldShowNoKnownDownloadsNotice = uiMissingModelsPresent && !activeJobRunning && Boolean(state.analysis) && !resolverHasKnownDownloads;
  const shouldShowForIssues = shouldShowNoKnownDownloadsNotice || (analysisKnownSatisfied ? false : (missingModelCount > 0 || uiMissingModelsPresent));
  if (!activeJobRunning && !shouldShowForIssues) {
    removePanel();
    return;
  }

  const root = ensurePanel();
  if (!root) return;

  const disk = state.status?.download_staging ?? scopedActiveJob?.disk;
  const recovery = state.status?.startup_recovery;
  const free = disk?.free_bytes;
  const total = disk?.total_bytes;
  const path = disk?.path ?? "/srv/comfy/download-staging";
  const hasDiskFreeValue = typeof free === "number" && !Number.isNaN(free);
  const job = scopedActiveJob;
  const summary = job?.summary ?? {};
  const progress = job?.progress ?? {};
  const running = job && ["queued", "running", "canceling"].includes(job.status);
  const canceling = job?.status === "canceling";
  const messages = Array.isArray(job?.messages) ? job.messages.slice(-3) : [];
  const overallPercent = progress?.percent_complete;
  const overallEta = progress?.eta_seconds;
  const overallRate = progress?.transfer_rate_bps;
  const downloadedBytes = progress?.downloaded_bytes;
  const knownTotalBytes = progress?.known_total_bytes;
  const currentItem = progress?.current_item;
  const currentItemLastProgressAt = currentItem?.last_progress_at || progress?.last_progress_at || null;
  const jobUpdatedAt = job?.updated_at || null;

  const recoveredFiles = recovery?.staging_recovery?.recovered_count || 0;
  const interruptedJobs = recovery?.job_recovery?.interrupted_job_count || 0;
  const showRecoveryNotice = Boolean(recovery?.had_recovery_actions) && (recoveredFiles > 0 || interruptedJobs > 0);

  root.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-base-foreground">${escapeHtml(t("ui.title"))}</div>
          ${
            hasDiskFreeValue
              ? `
                <div class="mt-1 text-xs/relaxed text-muted-foreground">
                  ${escapeHtml(t("ui.freeSpaceLabel", { path }))} <code class="rounded bg-base-foreground/5 px-1 py-0.5 text-[11px]">${escapeHtml(path)}</code>
                  <span class="font-medium text-base-foreground">${formatBytes(free)}</span>
                  ${typeof total === "number" ? ` ${escapeHtml(t("ui.totalJoiner", { total: formatBytes(total) }))}` : ""}
                </div>
              `
              : ""
          }
        </div>
        <div class="flex items-center gap-2">
          ${
            running
              ? `
                <button
                  type="button"
                  data-k0v0k-comfy-fetch-action="cancel"
                  class="rounded-md border border-interface-stroke px-3 py-2 text-xs font-medium text-base-foreground transition hover:bg-base-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
                  ${canceling ? "disabled" : ""}
                >
                  ${escapeHtml(canceling ? t("ui.cancelingButton") : t("ui.cancelButton"))}
                </button>
              `
              : ""
          }
          <button
            type="button"
            data-k0v0k-comfy-fetch-action="resolve"
            class="rounded-md border border-interface-stroke px-3 py-2 text-xs font-medium text-base-foreground transition hover:bg-base-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
            ${running || (Boolean(state.analysis) && !resolverHasKnownDownloads && !activeJobRunning) ? "disabled" : ""}
          >
            ${escapeHtml(canceling ? t("ui.cancelingButton") : running ? t("ui.resolvingButton") : t("ui.resolveButton"))}
          </button>
        </div>
      </div>
      ${
        shouldShowNoKnownDownloadsNotice
          ? `
            <div class="rounded-md border border-secondary-background px-2 py-2 text-[11px]/relaxed text-muted-foreground">
              ${escapeHtml(t("ui.noKnownDownloads"))}
            </div>
          `
          : ""
      }
      ${
        showRecoveryNotice
          ? `
            <div class="rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-2 text-[11px]/relaxed text-base-foreground">
              ${escapeHtml(t("ui.recoveryLead"))}
              ${interruptedJobs > 0 ? ` ${escapeHtml(tPlural("ui.recoveryInterrupted", interruptedJobs, { count: interruptedJobs }))}` : ""}
              ${recoveredFiles > 0 ? ` ${escapeHtml(tPlural("ui.recoveryRecovered", recoveredFiles, { count: recoveredFiles, path }))}` : ""}
            </div>
          `
          : ""
      }
      ${
        job
          ? `
            <div class="rounded-md border border-secondary-background px-2 py-2">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-medium text-base-foreground">${escapeHtml(t("ui.jobLabel", { jobId: job.job_id }))}</span>
                <span class="text-muted-foreground">${escapeHtml(job.status || t("kinds.unknown"))}</span>
              </div>
              <div class="mt-1 text-[11px]/relaxed text-muted-foreground">
                ${escapeHtml(t("ui.resolvedSummary", { resolved: summary.resolved_count || 0, pending: summary.pending_count || 0, failed: summary.failed_count || 0 }))}
              </div>
              <div class="mt-2 rounded-md bg-base-foreground/5 px-2 py-2">
                <div class="flex items-center justify-between gap-2 text-[11px]/relaxed text-muted-foreground">
                  <span>${escapeHtml(formatPercent(overallPercent))}</span>
                  <span>${escapeHtml(formatBytes(downloadedBytes || 0))}${typeof knownTotalBytes === "number" ? ` / ${escapeHtml(formatBytes(knownTotalBytes))}` : ""}</span>
                </div>
                <div class="mt-1 h-2 overflow-hidden rounded-full bg-base-foreground/10">
                  <div class="h-full rounded-full bg-primary transition-all" style="width:${typeof overallPercent === "number" ? Math.max(0, Math.min(overallPercent, 100)) : 0}%"></div>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[11px]/relaxed text-muted-foreground">
                  <span>${escapeHtml(formatRate(overallRate))}</span>
                  <span>${currentItem?.filename ? escapeHtml(t("ui.currentItem", { name: currentItem.filename })) : escapeHtml(t("ui.preparingDownloads"))}</span>
                  <span>${overallEta != null ? escapeHtml(t("ui.etaLabel", { eta: formatSeconds(overallEta) })) : escapeHtml(t("ui.etaEstimating"))}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[11px]/relaxed text-muted-foreground">
                  <span>${escapeHtml(t("ui.pollingLabel", { age: formatAge(jobUpdatedAt) }))}</span>
                  <span>${currentItemLastProgressAt ? escapeHtml(t("ui.progressAgeLabel", { age: formatAge(currentItemLastProgressAt) })) : escapeHtml(t("ui.waitingForFirstByteProgress"))}</span>
                </div>
              </div>
              ${renderItems(job)}
            </div>
          `
          : `<p class="m-0 text-xs/normal text-muted-foreground">${escapeHtml(t("ui.noDownloadsYet"))}</p>`
      }
      ${
        messages.length
          ? `
            <div class="space-y-1">
              ${messages
                .map(
                  (entry) => `
                    <div class="text-[11px]/relaxed text-muted-foreground">${escapeHtml(entry.message)}</div>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
    </div>
  `;

  const button = root.querySelector('[data-k0v0k-comfy-fetch-action="resolve"]');
  if (button) {
    button.addEventListener("click", () => {
      void startResolve();
    });
  }
  const cancelButton = root.querySelector('[data-k0v0k-comfy-fetch-action="cancel"]');
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      void cancelResolve();
    });
  }
}

async function refreshErrorsAfterSuccess() {
  try {
    if (typeof app.refreshMissingModels === "function") {
      await app.refreshMissingModels({ silent: true });
    }
  } catch (error) {
    console.warn("[K0V0K Comfy Fetch] Failed to refresh missing model state.", error);
  }
  if (app?.canvas?.setDirty) {
    app.canvas.setDirty(true, true);
  }
}

function maybeRefreshNativeMissingModels(previousJob, nextJob) {
  const nextJobId = nextJob?.job_id;
  if (!nextJobId) return;
  const nextResolvedCount = Number(nextJob?.summary?.resolved_count || 0);
  const previousResolvedCount = Number(previousJob?.summary?.resolved_count || 0);

  if (state.lastResolvedRefreshJobId !== nextJobId) {
    state.lastResolvedRefreshJobId = nextJobId;
    state.lastResolvedRefreshCount = previousResolvedCount;
  }

  if (nextResolvedCount > previousResolvedCount && nextResolvedCount > state.lastResolvedRefreshCount) {
    state.lastResolvedRefreshCount = nextResolvedCount;
    void refreshErrorsAfterSuccess();
  }
}

async function startResolve() {
  let workflow;
  try {
    workflow = currentWorkflow();
    state.workflowHints = summarizeWorkflowHints(workflow);
  } catch (error) {
    window.alert(t("ui.alertSerializeFailed", { message: error.message }));
    return;
  }
  try {
    const payload = await fetchJson(RESOLVE_PATH, {
      method: "POST",
      body: JSON.stringify({ workflow, workflow_scope_id: currentWorkflowScopeId() })
    });
    state.activeJob = payload.job;
    state.lastResolvedRefreshJobId = payload.job?.job_id || null;
    state.lastResolvedRefreshCount = Number(payload.job?.summary?.resolved_count || 0);
    startJobPolling();
    render();
  } catch (error) {
    window.alert(t("ui.alertResolveFailed", { message: error.message }));
  }
}

async function cancelResolve() {
  const jobId = state.activeJob?.job_id;
  if (!jobId) return;
  try {
    const payload = await fetchJson(CANCEL_PATH(jobId), {
      method: "POST"
    });
    state.activeJob = payload.job;
    render();
  } catch (error) {
    window.alert(t("ui.alertCancelFailed", { message: error.message }));
  }
}

function handleSocketEvent(event) {
  const payload = event?.detail;
  if (!payload || payload.event !== "job_update" || !payload.job) return;
  const workflowScopeId = currentWorkflowScopeId();
  if (payload.job.workflow_scope_id !== workflowScopeId) {
    if (state.activeJob?.job_id === payload.job.job_id && state.activeJob?.workflow_scope_id !== workflowScopeId) {
      state.activeJob = null;
      render();
    }
    return;
  }
  const previousJob = state.activeJob;
  state.activeJob = payload.job;
  maybeRefreshNativeMissingModels(previousJob, payload.job);
  if (payload.job.status === "queued" || payload.job.status === "running") {
    startJobPolling();
  } else {
    stopJobPolling();
  }
  render();
  if (payload.job.status === "completed" || payload.job.status === "partial" || payload.job.status === "failed" || payload.job.status === "canceled") {
    scheduleAnalysis();
  }
  if (
    payload.job.status === "completed" &&
    payload.job.summary?.all_resolved &&
    state.lastRefreshedJobId !== payload.job.job_id
  ) {
    state.lastRefreshedJobId = payload.job.job_id;
    void refreshErrorsAfterSuccess();
  }
}

function installUiHooks() {
  if (state.uiHooksInstalled) return;
  state.uiHooksInstalled = true;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const trigger = target.closest(
      [
        '[data-testid="error-overlay-see-errors"]',
        '[data-testid="panel-tab-errors"]',
        '[data-testid="missing-model-refresh"]',
        '[data-testid="error-overlay-dismiss"]'
      ].join(",")
    );
    if (!trigger) return;
    window.setTimeout(() => {
      void refreshStatus();
      scheduleAnalysis();
      render();
    }, 100);
  }, true);
}

function installDomObserver() {
  if (state.domObserverInstalled) return;
  state.domObserverInstalled = true;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const candidates = [
        mutation.target,
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes)
      ];
      const hasRelevantChange = candidates.some((candidate) => {
        if (!(candidate instanceof Element)) {
          return false;
        }
        return (
          candidate.matches?.('[data-testid="errors-summary-hero"], [data-testid^="error-group-"]') ||
          Boolean(candidate.querySelector?.('[data-testid="errors-summary-hero"], [data-testid^="error-group-"]'))
        );
      });
      if (hasRelevantChange) {
        scheduleRender();
        break;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function installScopeChangeListener() {
  window.addEventListener("hashchange", () => {
    state.activeJob = null;
    stopJobPolling();
    void refreshStatus();
    scheduleAnalysis();
    render();
  });
}

app.registerExtension({
  name: EXTENSION_NAME,
  async setup() {
    if (state.initialized) return;
    state.initialized = true;
    api.addEventListener(EVENT_NAME, handleSocketEvent);
    installUiHooks();
    installDomObserver();
    installScopeChangeListener();
    try {
      await ensurePluginAuth();
    } catch (error) {
      window.alert(t("ui.alertBootstrapFailed", { message: error.message }));
      return;
    }
    await refreshStatus();
    await refreshAnalysis();
    render();
  }
});
