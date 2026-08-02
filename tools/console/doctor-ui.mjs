import { doctorPreviewMessage } from "./doctor-view.mjs";

export function mountDoctorPreview(element = document.querySelector(".doctor-preview")) {
  return element ? doctorPreviewMessage : null;
}
