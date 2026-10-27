import { createElement } from "react";
import { createRoot } from "react-dom/client";
import ClassSetup from "../../app/class-setup";
import { emptyCourse } from "../../lib/academics";

const course = { ...emptyCourse("browser-course"), code: "BIO 101", name: "Biology" };

createRoot(document.getElementById("root")!).render(createElement(ClassSetup, {
  initial: course,
  today: "2026-10-26",
  canUpload: false,
  onSave: async () => {},
  onClose: () => {},
}));
