"use client";

import { useId } from "react";
import { Check, Palette } from "lucide-react";
import { themeGroups, type Theme } from "../lib/theme";

type ThemeChoice = Theme | "system";

export default function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (theme: ThemeChoice) => void }) {
  const groupName = useId();

  return <section className="settings-card theme-picker" aria-labelledby={`${groupName}-title`}>
    <div className="settings-card-title">
      <span><Palette size={20} aria-hidden="true" /></span>
      <div><h2 id={`${groupName}-title`}>Appearance</h2><p>Choose a theme to preview it. Save changes to keep it.</p></div>
    </div>
    <div className="theme-groups" role="radiogroup" aria-labelledby={`${groupName}-title`}>
      <div className="theme-palette-groups">
        {themeGroups.map(({ heading, themes }) => <div className="theme-group" key={heading}>
          <h3>{heading}</h3>
          <div className="theme-options">
            {themes.map(({ id, label }) => <label className="theme-option" key={id}>
              <input type="radio" name={groupName} value={id} checked={value === id} onChange={() => onChange(id)} />
              <span className="theme-swatch" data-palette={id} aria-hidden="true">
                {value === id && <span className="theme-swatch-check"><Check size={13} strokeWidth={2.6} /></span>}
              </span>
              <span>{label}</span>
            </label>)}
          </div>
        </div>)}
      </div>
      <label className="theme-device"><input type="radio" name={groupName} value="system" checked={value === "system"} onChange={() => onChange("system")} /><span>Match my device</span></label>
    </div>
  </section>;
}
