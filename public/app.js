"use strict";
document.querySelectorAll("form[data-confirm]").forEach((form) =>
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  }),
);
document.querySelectorAll("[data-select-all]").forEach((box) =>
  box.addEventListener("change", () => {
    box
      .closest("form")
      .querySelectorAll('input[name="selected_resources"]')
      .forEach((child) => {
        child.checked = box.checked;
      });
  }),
);
document
  .querySelectorAll(".toast-close")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest(".toast").remove()),
  );
document
  .querySelectorAll(".toast")
  .forEach((toast) => window.setTimeout(() => toast.remove(), 7000));
document
  .querySelectorAll("[data-print]")
  .forEach((button) => button.addEventListener("click", () => window.print()));
document
  .querySelectorAll("[data-back]")
  .forEach((button) =>
    button.addEventListener("click", () => window.history.back()),
  );

document.querySelectorAll("[data-receipt-png]").forEach((button) =>
  button.addEventListener("click", async () => {
    const target = document.getElementById("receipt-export");
    if (!target || typeof window.html2canvas !== "function") {
      window.alert("Receipt image service is not available.");
      return;
    }
    button.disabled = true;
    try {
      const images = Array.from(target.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => img.decode().catch(() => undefined)),
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
      window.alert(
        "Unable to create the receipt image. Please try printing instead.",
      );
    } finally {
      button.disabled = false;
    }
  }),
);
