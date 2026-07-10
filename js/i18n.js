const DEFAULT_LOCALE = "en";

const catalogs = {
  en: {
    ui: {
      title: "K0V0K Comfy Fetch",
      resolveButton: "Resolve Missing Models",
      resolvingButton: "Resolving...",
      cancelButton: "Cancel",
      cancelingButton: "Canceling...",
      noKnownDownloads:
        "Missing models were detected by ComfyUI, but this workflow does not expose downloadable model hints or source URLs that K0V0K Comfy Fetch can use yet.",
      noDownloadsYet: "No missing-model resolution job has been started for this workflow yet.",
      noItemsYet: "No downloadable models or dependencies have been identified yet.",
      pollingLabel: "Polled {age}",
      progressAgeLabel: "Byte progress {age}",
      waitingForFirstByteProgress: "Waiting for first byte progress",
      preparingDownloads: "Preparing downloads",
      currentItem: "Current: {name}",
      etaEstimating: "ETA estimating",
      etaLabel: "ETA {eta}",
      attemptLabel_one: "{count} attempt",
      attemptLabel_other: "{count} attempts",
      recoveryInterrupted_one: "Marked {count} persisted job as interrupted.",
      recoveryInterrupted_other: "Marked {count} persisted jobs as interrupted.",
      recoveryRecovered_one: "Recovered {count} orphaned staging file from {path}.",
      recoveryRecovered_other: "Recovered {count} orphaned staging files from {path}.",
      recoveryLead: "Previous Comfy or asset-fetch shutdown interrupted work.",
      freeSpaceLabel: "Free space in",
      resolvedSummary: "Resolved {resolved} models · Pending {pending} · Failed {failed}",
      jobLabel: "Job {jobId}",
      totalJoiner: "of {total}",
      unknownModel: "Unknown model",
      workflowUnavailable: "Current workflow graph is not available.",
      alertSerializeFailed: "Unable to serialize the current workflow: {message}",
      alertResolveFailed: "Unable to start missing-model resolution: {message}",
      alertCancelFailed: "Unable to cancel missing-model resolution: {message}",
      alertBootstrapFailed: "Unable to initialize K0V0K Comfy Fetch authentication: {message}",
      retryableLabel: "retryable",
      freeNeedLabel: "free {free} / need {need}"
    },
    status: {
      resolved: "Resolved",
      failed: "Failed",
      canceled: "Canceled",
      retryQueued: "Retry queued ({retry}/{max})",
      retrying: "Retrying ({retry}/{max})",
      downloading: "Downloading",
      planning: "Planning",
      queued: "Queued",
      pending: "Pending"
    },
    kinds: {
      checkpoint: "Checkpoint",
      lora: "LoRA",
      vae: "VAE",
      text_encoder: "Text encoder",
      clip: "CLIP",
      clip_vision: "CLIP Vision",
      controlnet: "ControlNet",
      diffusion_model: "Diffusion model",
      unet: "UNet",
      upscale_model: "Upscale model",
      latent_upscale_model: "Latent upscaler",
      embedding: "Embedding",
      custom_node_asset: "Custom node asset",
      unknown: "unknown"
    },
    time: {
      estimating: "estimating",
      observing: "observing",
      done: "done",
      justNow: "just now",
      seconds: "{count}s",
      minutesSeconds: "{minutes}m {seconds}s",
      hoursMinutes: "{hours}h {minutes}m",
      ago: "{value} ago"
    },
    bytes: {
      unknown: "unknown",
      units: {
        B: "B",
        KB: "KB",
        MB: "MB",
        GB: "GB",
        TB: "TB"
      }
    },
    errors: {
      missing_huggingface_token: {
        headline: "Hugging Face token required",
        body: "This model is hosted on Hugging Face, but the Comfy host does not have a Hugging Face token configured.",
        action: "Add `huggingface_token` to Bao at `secret/homeserver/autoforge/comfy/assets`, redeploy the Comfy asset service, and retry."
      },
      huggingface_gated_model_access_required: {
        headline: "Hugging Face access is blocked",
        body: "The request reached Hugging Face, but this model is gated or your current token does not have permission to download it.",
        action: "Confirm the token has accepted the model license and has download access, then retry."
      },
      huggingface_access_forbidden: {
        headline: "Hugging Face denied the download",
        body: "The Comfy host reached Hugging Face, but the download was forbidden for the current token or account.",
        action: "Check the configured Hugging Face token permissions and model access, then retry."
      },
      huggingface_model_not_found: {
        headline: "Hugging Face model file not found",
        body: "The referenced Hugging Face file path does not exist or is no longer available.",
        action: "Verify the workflow’s model URL or update it to a valid file path."
      },
      missing_civitai_token: {
        headline: "Civitai token required",
        body: "This download is hosted on Civitai, but the Comfy host does not have a Civitai token configured.",
        action: "Add `civitai_token` to Bao at `secret/homeserver/autoforge/comfy/assets`, redeploy the Comfy asset service, and retry."
      },
      civitai_access_forbidden: {
        headline: "Civitai denied the download",
        body: "The Comfy host reached Civitai, but the current token or account is not allowed to download this file.",
        action: "Check the configured Civitai token and the asset’s access requirements, then retry."
      },
      provider_rate_limited: {
        headline: "Download provider is rate limiting",
        body: "The remote host accepted the request but is temporarily limiting download traffic.",
        action: "Wait a bit and retry. If this keeps happening, reduce concurrent downloads or use another mirror."
      },
      provider_not_found: {
        headline: "Remote file not found",
        body: "The remote host reported that the requested file does not exist.",
        action: "Verify the workflow’s model URL and update it to a valid source."
      },
      provider_server_error: {
        headline: "Remote host failed the request",
        body: "The download provider returned a server-side error while serving this file.",
        action: "Retry later. If it keeps failing, use a different mirror or update the source URL."
      },
      provider_http_error: {
        headline: "Remote host rejected the request",
        body: "The download provider returned an HTTP error for this file.",
        action: "Check the source URL and any required credentials, then retry."
      },
      network_timeout: {
        headline: "Network timeout while downloading",
        body: "The Comfy host started the request but the remote server did not respond in time.",
        action: "Retry. If it keeps timing out, the remote host may be slow or unreachable."
      },
      network_dns_failure: {
        headline: "DNS lookup failed",
        body: "The Comfy host could not resolve the remote download hostname.",
        action: "Check host networking and DNS on the Comfy VM, then retry."
      },
      network_connection_failed: {
        headline: "Network connection failed",
        body: "The Comfy host could not establish or keep a connection to the remote download server.",
        action: "Check network reachability from the Comfy VM and retry."
      },
      tls_ssl_error: {
        headline: "TLS/SSL handshake failed",
        body: "The Comfy host connected to the remote server, but secure transport setup failed.",
        action: "Retry first. If it persists, the remote endpoint or certificate chain may be broken."
      },
      insufficient_free_space: {
        headline: "Not enough disk space",
        body: "The Comfy host does not have enough free space in staging or the target model directory to finish this download safely.",
        action: "Free space on the Comfy host, then retry."
      },
      destination_write_failed: {
        headline: "Could not write the downloaded file",
        body: "The Comfy host downloaded data but failed while writing or moving it into the target model directory.",
        action: "Check disk health, permissions, and free space on the Comfy model paths, then retry."
      },
      checksum_mismatch: {
        headline: "Downloaded file failed checksum verification",
        body: "The file finished downloading, but its checksum did not match the expected value.",
        action: "Retry. If it keeps failing, the source file may be corrupt or the checksum may be wrong."
      },
      aria2_unavailable: {
        headline: "Parallel download helper is unavailable",
        body: "The Comfy host tried to use `aria2c` for a ranged download, but the helper is not installed or was not available.",
        action: "Reinstall or restore `aria2c` on the Comfy host, or retry after switching the service back to standard downloads."
      },
      retry_exhausted: {
        headline: "Retries were exhausted",
        body: "This file kept failing until the configured retry limit was reached.",
        action: "Review the error above, fix the underlying issue, and retry."
      },
      canceled_by_user: {
        headline: "Download canceled",
        body: "This workflow-scoped download job was canceled before all model files finished.",
        action: "Start resolution again when you want to resume."
      },
      workflow_scope_mismatch: {
        headline: "Workflow scope mismatch",
        body: "The requested operation did not belong to the currently open workflow tab.",
        action: "Retry from the workflow that started the job."
      },
      service_restarted_during_job: {
        headline: "Comfy Fetch restarted during the job",
        body: "The asset fetch worker or Comfy process restarted before this download finished.",
        action: "Retry the workflow after the service is stable."
      },
      internal_fetch_error: {
        headline: "Unexpected download failure",
        body: "The download failed for an internal reason that was not mapped to a more specific user-facing error yet.",
        action: "Review the raw error details and server logs, then retry if appropriate."
      },
      plugin_auth_required: {
        headline: "Plugin authentication is required",
        body: "The fetch panel must initialize a server-issued session cookie before these endpoints can be used.",
        action: "Reload the Comfy page and retry. If it continues, reopen Workflow Overview so the plugin can bootstrap again."
      },
      plugin_auth_bootstrap_denied: {
        headline: "Plugin bootstrap request was denied",
        body: "The server rejected the initial cookie bootstrap because the request did not look same-origin.",
        action: "Open Comfy directly in the browser, then retry from the built-in UI instead of a copied endpoint URL."
      }
    }
  }
};

function normalizedLocale() {
  const explicit = globalThis?.window?.K0V0K_COMFY_FETCH_LOCALE;
  if (explicit && catalogs[explicit]) return explicit;
  const browserLocale = (globalThis?.navigator?.language || DEFAULT_LOCALE).toLowerCase();
  if (catalogs[browserLocale]) return browserLocale;
  const languageOnly = browserLocale.split("-")[0];
  return catalogs[languageOnly] ? languageOnly : DEFAULT_LOCALE;
}

function getByPath(value, path) {
  return path.split(".").reduce((accumulator, key) => {
    if (accumulator && typeof accumulator === "object" && key in accumulator) {
      return accumulator[key];
    }
    return undefined;
  }, value);
}

function interpolate(template, variables = {}) {
  return String(template ?? "").replaceAll(/\{([^}]+)\}/g, (_match, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}

export function t(path, variables = {}, fallback = "") {
  const locale = normalizedLocale();
  const template = getByPath(catalogs[locale], path) ?? getByPath(catalogs[DEFAULT_LOCALE], path) ?? fallback ?? path;
  return interpolate(template, variables);
}

export function tPlural(basePath, count, variables = {}, fallback = "") {
  const suffix = count === 1 ? "_one" : "_other";
  return t(`${basePath}${suffix}`, { ...variables, count }, fallback);
}

export function localizeError(errorInfo = {}) {
  const code = errorInfo?.code || "internal_fetch_error";
  const basePath = `errors.${code}`;
  const headline = t(`${basePath}.headline`, {}, t("errors.internal_fetch_error.headline"));
  const body = t(`${basePath}.body`, {}, errorInfo?.message || t("errors.internal_fetch_error.body"));
  const action = t(`${basePath}.action`, {}, t("errors.internal_fetch_error.action"));
  return {
    code,
    headline,
    body,
    action
  };
}

export const supportedLocales = Object.freeze(Object.keys(catalogs));
