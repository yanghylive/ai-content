"use client";

import React from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavHeading,
  SideNavItem,
  type SideNavImperativeCollapseHandle,
} from "@astryxdesign/core/SideNav";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { SidebarItem } from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";

type AstryxDashboardShellProps = {
  items: SidebarItem[];
  selectedKey: string;
  breadcrumbSection: string;
  breadcrumbTitle: string;
  footer: React.ReactNode;
  footerIcons?: React.ReactNode;
  onNavigate: (href: string) => void;
  children: React.ReactNode;
};

function itemContainsSelection(
  item: SidebarItem,
  selectedKey: string,
): boolean {
  if (item.key === selectedKey || item.href === selectedKey) return true;
  return (
    item.items?.some((child) => itemContainsSelection(child, selectedKey)) ??
    false
  );
}

function renderNavigationItems(
  items: SidebarItem[],
  selectedKey: string,
  onNavigate: (href: string) => void,
): React.ReactNode {
  return items.map((item) => {
    const Icon = item.icon;
    const href = item.href;
    const isActive = itemContainsSelection(item, selectedKey);
    const children = item.items?.length
      ? renderNavigationItems(item.items, selectedKey, onNavigate)
      : null;

    return (
      <SideNavItem
        key={`${item.key}:${isActive ? "active" : "idle"}`}
        label={item.title}
        icon={
          Icon ? (
            <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
          ) : undefined
        }
        href={href}
        isSelected={isActive}
        collapsible={children ? { defaultIsCollapsed: !isActive } : false}
        onClick={
          href
            ? (event) => {
                event.preventDefault();
                onNavigate(href);
              }
            : undefined
        }
      >
        {children}
      </SideNavItem>
    );
  });
}

export function AstryxDashboardShell({
  items,
  selectedKey,
  breadcrumbSection,
  breadcrumbTitle,
  footer,
  footerIcons,
  onNavigate,
  children,
}: AstryxDashboardShellProps) {
  const [isSideNavCollapsed, setIsSideNavCollapsed] = React.useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false);
  const sideNavHandleRef = React.useRef<SideNavImperativeCollapseHandle | null>(
    null,
  );
  const navigation = renderNavigationItems(items, selectedKey, onNavigate);

  React.useEffect(() => {
    if (!isMobileNavOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isMobileNavOpen]);
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element -- Static export cannot use next/image optimization.
    <img
      alt="JIUZHANG AI"
      className="h-6 w-auto object-contain"
      src="/brand/jiuzhang-ai-logo.png"
    />
  );

  return (
    <AppShell
      className="ai-content-sla-shell"
      contentPadding={0}
      height="fill"
      mobileNav={{
        breakpoint: "md",
        isOpen: isMobileNavOpen,
        onOpenChange: setIsMobileNavOpen,
      }}
      variant="section"
      sideNav={
        <SideNav
          collapsible={{
            hasButton: false,
            isCollapsed: isSideNavCollapsed,
            onCollapsedChange: setIsSideNavCollapsed,
          }}
          data-testid="astryx-dashboard-sidenav"
          footer={footer}
          footerIcons={footerIcons}
          handleRef={sideNavHandleRef}
          header={
            <SideNavHeading
              heading="JIUZHANG AI"
              headingHref="/"
              icon={logo}
              subheading="智能运营系统"
            />
          }
        >
          {navigation}
        </SideNav>
      }
      topNav={
        <TopNav
          endContent={
            <SideNavCollapseButton
              handleRef={sideNavHandleRef}
              label={isSideNavCollapsed ? "展开导航" : "收起导航"}
            >
              {isSideNavCollapsed ? (
                <PanelLeftOpen aria-hidden="true" size={18} />
              ) : (
                <PanelLeftClose aria-hidden="true" size={18} />
              )}
            </SideNavCollapseButton>
          }
          label="工作台导航"
          heading={
            <TopNavHeading
              heading={breadcrumbTitle}
              superheading={breadcrumbSection}
            />
          }
        />
      }
    >
      <div className="dashboard-shell__viewport h-full min-h-0 w-full min-w-0 overflow-x-hidden overflow-y-auto p-5 max-sm:p-3">
        <div className="mx-auto min-h-full w-full min-w-0 max-w-[1680px] text-14 leading-[22px] text-foreground">
          {children}
        </div>
      </div>
    </AppShell>
  );
}
