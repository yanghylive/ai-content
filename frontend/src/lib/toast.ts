import { addToast } from "@heroui/react";

type ToastOptions = {
  duration?: number;
};

function showToast(
  message: unknown,
  color: "default" | "success" | "danger",
  options?: ToastOptions,
) {
  addToast({
    color,
    timeout: options?.duration,
    title: typeof message === "string" ? message : String(message ?? ""),
  });
}

const toast = Object.assign(
  (message: unknown, options?: ToastOptions) =>
    showToast(message, "default", options),
  {
    error: (message: unknown, options?: ToastOptions) =>
      showToast(message, "danger", options),
    success: (message: unknown, options?: ToastOptions) =>
      showToast(message, "success", options),
  },
);

export { toast };
export default toast;
