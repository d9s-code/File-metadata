import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { HoverInfo } from "./InfoPopover";

/** A small "?" that shows what a page or panel is for on hover or focus —
 * instead of a paragraph of explanation that's always on screen. */
export function InfoTip({ children, label = "About this page" }: { children: ReactNode; label?: string }) {
  return (
    <HoverInfo
      label={
        <button type="button" className="info-tip" aria-label={label}>
          ?
        </button>
      }
    >
      <span className="info-tip-content">{children}</span>
    </HoverInfo>
  );
}

export interface SectionLink {
  to: string;
  label: string;
}

/** The pages under one top-menu item, as tabs (e.g. Emitters · Source Groups). */
export const EMITTERS_SECTION: SectionLink[] = [
  { to: "/emitters", label: "Emitters" },
  { to: "/source-groups", label: "Source Groups" },
];
export const MDFS_SECTION: SectionLink[] = [
  { to: "/mdfs", label: "MDFs" },
  { to: "/customers", label: "Customers" },
];

export function SectionTabs({ links }: { links: SectionLink[] }) {
  return (
    <div className="tab-bar section-tabs">
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} end className={({ isActive }) => (isActive ? "tab active" : "tab")}>
          {l.label}
        </NavLink>
      ))}
    </div>
  );
}

/** A list page's title row: the title, an optional "?" with what the page is
 * for, and its actions on the right — with the section's tabs above it. */
export function PageHeader({
  title,
  info,
  section,
  children,
}: {
  title: ReactNode;
  info?: ReactNode;
  section?: SectionLink[];
  children?: ReactNode;
}) {
  return (
    <>
      {section && <SectionTabs links={section} />}
      <div className="page-header-row">
        <div className="page-title">
          <h1>{title}</h1>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {children && <div className="page-header-actions">{children}</div>}
      </div>
    </>
  );
}
