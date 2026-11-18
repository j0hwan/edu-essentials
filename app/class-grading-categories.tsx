"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Percent, Plus, Trash2 } from "lucide-react";
import type { GradingCategory } from "../lib/coursework";
import "./class-coursework.css";

export default function ClassGradingCategories({ categories, onChange, onRemove, disabled, showErrors }: {
  categories: GradingCategory[];
  onChange: (categories: GradingCategory[]) => void;
  onRemove: (category: GradingCategory) => void;
  disabled: boolean;
  showErrors: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const total = Math.round(categories.reduce((sum, category) => sum + category.weight, 0) * 10000) / 10000;
  const meterValue = Number.isFinite(total) ? Math.max(0, Math.min(100, total)) : 0;
  const meterStatus = total === 100 ? " is-complete" : total >= 0 && total <= 99 ? "" : " is-invalid";
  const previousMeterValue = useRef(meterValue);
  const meterFillRef = useRef<HTMLSpanElement>(null);
  const formatWeight = (weight: number) => weight.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const invalidWeights = categories.some(({ weight }) => !Number.isFinite(weight) || weight < 0 || weight > 100);
  const remainingLabel = invalidWeights ? "—% remaining" : `${formatWeight(100 - total)}% remaining`;
  const update = (id: string, patch: Partial<GradingCategory>) => onChange(categories.map((category) => category.id === id ? { ...category, ...patch } : category));
  const changeWeight = (category: GradingCategory, input: HTMLInputElement, value = input.value) => {
    const weight = value === "" ? 0 : /^\d+$/.test(value) ? Math.min(100, Number(value)) : category.weight;
    // React treats numeric strings like "092" as equal to 92, so normalize the displayed value too.
    if (input.value !== String(weight)) input.value = String(weight);
    update(category.id, { weight });
  };
  useLayoutEffect(() => {
    const distance = Math.abs(meterValue - previousMeterValue.current);
    previousMeterValue.current = meterValue;
    if (!distance || !meterFillRef.current) return;
    const duration = Math.round(120 + 110 * (1 - distance / 100) ** 2);
    meterFillRef.current.style.transitionDuration = `${duration}ms`;
  }, [meterValue]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const input = [...(sectionRef.current?.querySelectorAll<HTMLInputElement>("[data-category-name]") ?? [])].find((node) => node.dataset.categoryName === pendingFocus.current);
    (input ?? sectionRef.current?.querySelector<HTMLButtonElement>("[data-add-category]"))?.focus();
    pendingFocus.current = null;
  });
  const add = () => {
    let name = "New category";
    let suffix = 2;
    while (categories.some((category) => category.name.trim().toLowerCase() === name.toLowerCase())) name = `New category ${suffix++}`;
    const id = crypto.randomUUID();
    pendingFocus.current = id;
    onChange([...categories, { id, name, weight: 0 }]);
  };
  return <section ref={sectionRef} className="class-coursework class-grading-categories" aria-label="Grading categories">
    <div className="class-grading-table" role="table" aria-label="Categories and weights">
      <div className="class-grading-row class-grading-table-head" role="row"><span role="columnheader">Category name</span><span role="columnheader">Weight</span><span role="columnheader" aria-label="Remove category" /></div>
      {categories.map((category, index) => <div className="class-grading-row" role="row" key={category.id}>
        <div role="cell"><input data-category-name={category.id} aria-label={`Category name ${index + 1}`} maxLength={100} value={category.name} disabled={disabled} aria-invalid={showErrors && (!category.name.trim() || categories.some((other) => other.id !== category.id && other.name.trim().toLowerCase() === category.name.trim().toLowerCase()))} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} onChange={(event) => update(category.id, { name: event.target.value })} /></div>
        <div className="class-grading-weight" role="cell"><input
          aria-label={`${category.name || "Category"} weight`} type="number" inputMode="numeric" min="0" max="100" step="1"
          value={Number.isFinite(category.weight) ? category.weight : 0} disabled={disabled}
          aria-invalid={showErrors && (!Number.isFinite(category.weight) || category.weight < 0 || category.weight > 100)}
          onKeyDown={(event) => {
            if (!event.ctrlKey && !event.metaKey && !event.altKey && /^\d$/.test(event.key) && event.currentTarget.value === "0") {
              event.preventDefault();
              changeWeight(category, event.currentTarget, event.key);
              return;
            }
            if (event.key === "Enter" || (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/^\d$/.test(event.key))) event.preventDefault();
          }}
          onBeforeInput={(event) => {
            const data = event.data ?? event.nativeEvent.data;
            if (data && /\D/.test(data)) event.preventDefault();
            else if (data && event.currentTarget.value === "0") {
              event.preventDefault();
              changeWeight(category, event.currentTarget, data);
            }
          }}
          onPaste={(event) => { if (!/^\d+$/.test(event.clipboardData.getData("text"))) event.preventDefault(); }}
          onChange={(event) => changeWeight(category, event.currentTarget)}
        /><Percent size={17} aria-hidden="true" /></div>
        <div role="cell"><button type="button" className="icon-button class-setup-delete-button" aria-label={`Remove ${category.name || "category"} category`} title="Delete category" disabled={disabled} onClick={() => { pendingFocus.current = categories[index + 1]?.id ?? categories[index - 1]?.id ?? "add"; onRemove(category); }}><Trash2 size={17} aria-hidden="true" /></button></div>
      </div>)}
      <div className="class-grading-row class-grading-add-row" role="row"><div role="cell" aria-colspan={3}><button type="button" className="secondary-button class-grading-add" data-add-category disabled={disabled || categories.length >= 50} onClick={add}><Plus size={18} aria-hidden="true" />Add category</button></div></div>
    </div>
    {!categories.length && <p className="class-coursework-hint">Add your grading categories, or continue and set them up later.</p>}
    <div className="class-grading-allocation">
      <div><span>Total Weight</span><output aria-live="polite" className={total === 100 && !invalidWeights ? "is-complete" : invalidWeights || total > 100 ? "is-invalid" : undefined}>{remainingLabel}</output></div>
      <div className={`class-grading-meter${meterStatus}`} role="meter" aria-label="Total category weight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meterValue} aria-valuetext={remainingLabel}><span ref={meterFillRef} style={{ width: `${meterValue}%` }} /></div>
    </div>
  </section>;
}
