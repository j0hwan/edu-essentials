import type { CSSProperties } from "react";
import {
  getHomeSkeletonPlacements,
  getHomeSkeletonPreset,
  type HomeSkeletonPreset,
  type HomeSkeletonPresetId,
} from "../lib/home-skeleton";

type HomeSkeletonProps = {
  preset?: HomeSkeletonPreset | HomeSkeletonPresetId;
  reducedMotion?: boolean;
};

type PlacementStyle = CSSProperties & Record<`--${string}`, string | number>;

function HomeSkeletonCard({
  size,
  desktop,
  phone,
  index,
}: {
  size: string;
  desktop: ReturnType<typeof getHomeSkeletonPlacements>["desktop"][number];
  phone: ReturnType<typeof getHomeSkeletonPlacements>["phone"][number];
  index: number;
}) {
  const style: PlacementStyle = {
    "--desktop-column": desktop.column,
    "--desktop-column-span": desktop.columnSpan,
    "--desktop-row": desktop.row,
    "--desktop-row-span": desktop.rowSpan,
    "--phone-column": phone.column,
    "--phone-column-span": phone.columnSpan,
    "--phone-row": phone.row,
    "--phone-row-span": phone.rowSpan,
    "--home-skeleton-delay": `${Math.min(index, 7) * 75}ms`,
  };

  return <article className="home-skeleton__card" data-size={size} style={style} />;
}

export function HomeSkeleton({ preset, reducedMotion = false }: HomeSkeletonProps) {
  const selected = getHomeSkeletonPreset(
    typeof preset === "object" && preset !== null ? preset.id : preset,
  );
  const placements = getHomeSkeletonPlacements(selected);

  return (
    <div
      className={`page home-page home-skeleton${reducedMotion ? " home-skeleton--reduced" : ""}`}
      data-preset={selected.id}
      role="status"
      aria-label="Loading Home workspace"
      aria-busy="true"
    >
      <span className="home-skeleton__status">Loading Home workspace</span>
      <div className="home-skeleton__decoration" aria-hidden="true" inert>
        <header className="home-skeleton__intro" />

        <section className="home-skeleton__today" />

        <div className="home-skeleton__toolbar">
          <div className="home-skeleton__tabs">
            <span className="home-skeleton__tab is-current" />
            <span className="home-skeleton__tab" />
            <span className="home-skeleton__tab" />
          </div>
          <div className="home-skeleton__actions">
            <span className="home-skeleton__action" data-control="widget-customization" />
            <span className="home-skeleton__action" data-control="customize" />
            <span className="home-skeleton__action" data-control="add-widget" />
          </div>
        </div>

        <div className="home-skeleton__grid">
          {selected.widgets.map((widget, index) => (
            <HomeSkeletonCard
              key={`${widget.size}-${index}`}
              size={widget.size}
              desktop={placements.desktop[index]}
              phone={placements.phone[index]}
              index={index}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeSkeleton;
