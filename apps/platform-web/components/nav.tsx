"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "看板", code: "01" },
  { href: "/conversations", label: "会话", code: "02" },
  { href: "/projects", label: "项目", code: "03" },
  { href: "/tasks", label: "任务", code: "04" },
  { href: "/agents", label: "代理", code: "05" },
  { href: "/users", label: "用户", code: "06" },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="sidebar glass-panel">
      <div className="sidebar-main">
        <div className="brand-block">
          <div className="brand-mark">FS</div>
          <div>
            <p className="eyebrow">AI Workspace</p>
            <h1>Flow System</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              className={isActivePath(pathname, item.href) ? "nav-item active" : "nav-item"}
              href={item.href}
              key={item.href}
            >
              <span className="nav-icon">{item.code}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="sidebar-foot">
        <details className="settings-details">
          <summary className="settings-trigger">
            <span className="settings-badge">+</span>
            <span>设置</span>
          </summary>
          <div className="settings-menu">
            <div className="settings-header">
              <span className="mini-dot" aria-hidden="true" />
              <span>系统菜单</span>
            </div>
            <div className="settings-copy">主站页面已按新的 Flow System 原型统一重构，业务流程保持不变。</div>
            <form action="/api/session/logout" method="post">
              <button className="logout-button" type="submit">
                退出登录
              </button>
            </form>
          </div>
        </details>
      </div>
    </aside>
  );
}
