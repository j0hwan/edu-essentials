import { createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ClassSetup from "../../app/class-setup";
import ModalPresence from "../../app/modal-presence";
import { useClassSetupMotion } from "../../app/use-class-setup-motion";
import { emptyCourse } from "../../lib/academics";

function Fixture() {
  const [chooserOpen, setChooserOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [initialBounds, setInitialBounds] = useState<{ width: number; height: number }>();
  const chooserRef = useRef<HTMLElement | null>(null);
  const transitionClassChoice = useClassSetupMotion(chooserRef, chooserOpen);
  const course = { ...emptyCourse("browser-course"), code: "BIO 101", name: "Biology" };
  return <>
    <ModalPresence animateExit={!setupOpen}>
      {chooserOpen ? <div className="modal-backdrop"><section ref={chooserRef} className="small-modal add-class-choice-modal" role="dialog" aria-modal="true" aria-label="Add a class">
        <div className="modal-header"><h2>Add a class</h2><button type="button" onClick={() => setChooserOpen(false)} aria-label="Close chooser">Close</button></div>
        <button type="button" onClick={() => transitionClassChoice((bounds) => { setChooserOpen(false); setSetupOpen(true); setInitialBounds(bounds); })}>Manual entry</button>
      </section></div> : null}
    </ModalPresence>
    <ModalPresence>
      {setupOpen ? <ClassSetup initial={course} initialBounds={initialBounds} today="2026-10-26" canUpload={false} onSave={async () => {}} onClose={() => setSetupOpen(false)} /> : null}
    </ModalPresence>
  </>;
}

createRoot(document.getElementById("root")!).render(createElement(Fixture));
