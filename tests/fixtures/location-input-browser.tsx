import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import LocationInput from "../../app/location-input";

function LocationFixture() {
  const [location, setLocation] = useState("");
  return <form className="academic-editor location-browser-fixture" aria-label="Edit course">
    <div className="settings-form-grid">
      <label>Course code<input aria-label="Course code" defaultValue="BIO 201" /></label>
      <label>Class name<input aria-label="Class name" defaultValue="Biology" /></label>
      <label>Credits<input aria-label="Credits" defaultValue="4" /></label>
      <label>Instructor<input aria-label="Instructor" defaultValue="Dr. Rivera" /></label>
      <LocationInput value={location} onChange={setLocation} />
      <label>Office hours<input aria-label="Office hours" defaultValue="Tuesdays" /></label>
    </div>
  </form>;
}

const rootNode = document.getElementById("root");
if (!rootNode) throw new Error("Missing browser fixture root");
createRoot(rootNode).render(createElement(LocationFixture));
