import type { ReactNode } from "react";

import { resolveLocalUiPort } from "../lib/local-openclaw";
import { Nav } from "./nav";
import { TopbarOpenClawStatus } from "./topbar-openclaw-status";

type AppShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  statusSlot?: ReactNode;
  viewportLock?: boolean;
  children: ReactNode;
};

export async function AppShell({
  eyebrow,
  title,
  description,
  actions,
  statusSlot,
  viewportLock = false,
  children,
}: AppShellProps) {
  const localUiPort = await resolveLocalUiPort();

  return (
    <>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className="app-shell">
        <Nav />
        <main className={viewportLock ? "main-stage main-stage-locked" : "main-stage"}>
          <header className="topbar">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h2>{title}</h2>
              {description ? <p className="topbar-description">{description}</p> : null}
            </div>
            <div className="topbar-statuses">
              <TopbarOpenClawStatus {...(localUiPort !== undefined ? { localUiPort } : {})} />
              {statusSlot}
              {actions ? <div className="topbar-actions">{actions}</div> : null}
            </div>
          </header>
          <section className={viewportLock ? "view-panel view-panel-locked" : "view-panel"}>{children}</section>
        </main>
      </div>
    </>
  );
}
