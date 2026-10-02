"use strict";

document.documentElement.classList.add("js");

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "/assets/vendor/lucide.svg#" + name);
  svg.append(use);
  return svg;
}

function notify(message, type = "info") {
  const region = document.querySelector(".toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  const symbol = document.createElement("span");
  symbol.className = "toast-icon";
  symbol.append(icon(type === "error" ? "circle-alert" : "info"));
  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "button-icon toast-close";
  dismiss.setAttribute("aria-label", "Dismiss message");
  dismiss.append(icon("x"));
  toast.append(symbol, text, dismiss);
  region.append(toast);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".toast-close");
  if (button) button.closest(".toast").remove();
});

/* Mobile navigation keeps focus inside the drawer and restores it on close.
   Without JavaScript, navigation stays visible above the content. */
const sidebar = document.getElementById("app-sidebar");
const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
const backdrop = document.querySelector(".sidebar-backdrop");
const appMain = document.querySelector(".app-main");
const mobile = window.matchMedia("(max-width: 900px)");
function setSidebar(open, restoreFocus = true) {
  if (!sidebar || !sidebarToggle) return;
  const expanded = open && mobile.matches;
  document.documentElement.classList.toggle("sidebar-open", expanded);
  document.body.classList.toggle("modal-open", expanded);
  sidebarToggle.setAttribute("aria-expanded", String(expanded));
  if (backdrop) backdrop.hidden = !expanded;
  if (appMain) appMain.inert = expanded;
  if (expanded) {
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    sidebar.querySelector("[data-sidebar-close]").focus();
  } else {
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    if (restoreFocus && mobile.matches) sidebarToggle.focus();
  }
}
sidebarToggle?.addEventListener("click", () => setSidebar(true));
document.querySelectorAll("[data-sidebar-close]").forEach((button) => {
  button.addEventListener("click", () => setSidebar(false));
});
mobile.addEventListener("change", () => setSidebar(false, false));
document.addEventListener("keydown", (event) => {
  if (!document.documentElement.classList.contains("sidebar-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    setSidebar(false);
  }
  if (event.key !== "Tab") return;
  const items = Array.from(sidebar.querySelectorAll("a[href], button"));
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* requestSubmit preserves validation, submitter semantics, multipart uploads,
   and CSRF fields. Approval is scoped to one subsequent submit event. */
const dialog = document.getElementById("confirm-dialog");
const approved = new WeakSet();
let pending = null;
function showConfirmation(form, submitter) {
  const danger = form.dataset.confirmDanger === "true";
  dialog.classList.toggle("is-danger", danger);
  dialog.querySelector("#confirm-title").textContent =
    form.dataset.confirmTitle || "Confirm action";
  dialog.querySelector("#confirm-message").textContent = form.dataset.confirm;
  const confirm = dialog.querySelector("[data-confirm-submit]");
  confirm.classList.toggle("danger-solid", danger);
  confirm.textContent = form.dataset.confirmLabel || "Continue";
  pending = { form, submitter };
  dialog.showModal();
}
dialog
  ?.querySelector("[data-confirm-cancel]")
  .addEventListener("click", () => dialog.close());
dialog?.addEventListener("close", () => {
  pending = null;
});
dialog?.querySelector("[data-confirm-submit]").addEventListener("click", () => {
  const submission = pending;
  dialog.close();
  if (!submission) return;
  pending = null;
  approved.add(submission.form);
  submission.form.requestSubmit(submission.submitter || undefined);
  // Native validity can stop requestSubmit before a submit event is dispatched.
  approved.delete(submission.form);
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form.dataset.submitting === "true") {
    event.preventDefault();
    return;
  }
  if (form.dataset.confirm && !approved.has(form)) {
    if (dialog && typeof dialog.showModal === "function") {
      event.preventDefault();
      showConfirmation(form, event.submitter);
      return;
    }
    if (!window.confirm(form.dataset.confirm)) {
      event.preventDefault();
      return;
    }
  }
  approved.delete(form);
  if (form.method.toLowerCase() !== "post") return;
  // Let other listeners cancel before applying the submitting state.
  queueMicrotask(() => {
    if (event.defaultPrevented) return;
    form.dataset.submitting = "true";
    form.setAttribute("aria-busy", "true");
    const button = event.submitter;
    if (button) {
      button.dataset.originalLabel = button.innerHTML;
      button.replaceChildren(
        icon("loader-circle"),
        document.createTextNode("Working…"),
      );
      button.classList.add("is-loading");
      button.setAttribute("aria-disabled", "true");
    }
  });
});

window.addEventListener("pageshow", () => {
  document.querySelectorAll('form[data-submitting="true"]').forEach((form) => {
    delete form.dataset.submitting;
    form.removeAttribute("aria-busy");
    form.querySelectorAll("[data-original-label]").forEach((button) => {
      button.innerHTML = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-disabled");
    });
  });
});

/* Keep native constraints and expose the same message beside the input. */
let errorId = 0;
document.addEventListener(
  "invalid",
  (event) => {
    const field = event.target;
    if (!field.matches("input, select, textarea")) return;
    if (!field.dataset.errorId) {
      const error = document.createElement("span");
      error.id = "field-error-" + ++errorId;
      error.className = "field-error";
      field.dataset.errorId = error.id;
      field.dataset.previousDescription =
        field.getAttribute("aria-describedby") || "";
      field.setAttribute(
        "aria-describedby",
        [field.dataset.previousDescription, error.id].filter(Boolean).join(" "),
      );
      field.insertAdjacentElement("afterend", error);
    }
    document.getElementById(field.dataset.errorId).textContent =
      field.validationMessage;
    field.setAttribute("aria-invalid", "true");
  },
  true,
);
document.addEventListener("input", (event) => {
  const field = event.target;
  if (!field.dataset.errorId || !field.validity.valid) return;
  document.getElementById(field.dataset.errorId)?.remove();
  if (field.dataset.previousDescription)
    field.setAttribute("aria-describedby", field.dataset.previousDescription);
  else field.removeAttribute("aria-describedby");
  field.removeAttribute("aria-invalid");
  delete field.dataset.errorId;
  delete field.dataset.previousDescription;
});

document.querySelectorAll("[data-select-all]").forEach((box) => {
  const form = box.closest("form");
  const children = Array.from(
    form.querySelectorAll('input[name="selected_resources"]'),
  );
  function updateSelection() {
    const count = children.filter((child) => child.checked).length;
    box.checked = children.length > 0 && count === children.length;
    box.indeterminate = count > 0 && count < children.length;
    box.disabled = children.length === 0;
    const label = form.querySelector("[data-selection-count]");
    if (label) label.textContent = count + " selected";
    const submit = form.querySelector("[data-delete-selected]");
    if (submit) submit.disabled = count === 0;
  }
  box.addEventListener("change", () => {
    children.forEach((child) => {
      child.checked = box.checked;
    });
    updateSelection();
  });
  children.forEach((child) =>
    child.addEventListener("change", updateSelection),
  );
  updateSelection();
});

document.querySelectorAll("[data-print]").forEach((button) => {
  button.addEventListener("click", () => window.print());
});
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => window.history.back());
});
document.querySelectorAll("[data-receipt-png]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById("receipt-export");
    if (!target || typeof window.html2canvas !== "function") {
      notify(
        "Receipt image service is not available. Please try printing instead.",
        "error",
      );
      return;
    }
    const original = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    button.replaceChildren(
      icon("loader-circle"),
      document.createTextNode("Preparing image…"),
    );
    try {
      await Promise.all(
        Array.from(target.querySelectorAll("img")).map((img) =>
          img.decode().catch(() => undefined),
        ),
      );
      const canvas = await window.html2canvas(target, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = button.dataset.receiptPng + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      notify(
        "Unable to create the receipt image. Please try printing instead.",
        "error",
      );
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.innerHTML = original;
    }
  });
});
