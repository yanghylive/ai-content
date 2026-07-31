"use client";

import { cn, Tooltip } from "@heroui/react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import React from "react";

export enum SidebarItemType {
  Nest = "nest",
}

export type SidebarItem = {
  key: string;
  title: string;
  icon?: LucideIcon;
  href?: string;
  type?: SidebarItemType.Nest;
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  items?: SidebarItem[];
  className?: string;
};

export type SidebarProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "onSelect"
> & {
  items: SidebarItem[];
  isCompact?: boolean;
  hideEndContent?: boolean;
  iconClassName?: string;
  classNames?: {
    base?: string;
    list?: string;
  };
  defaultSelectedKey: string;
  selectedKeys?: Iterable<React.Key>;
  onSelect?: (key: string) => void;
};

function stripQuery(value?: string) {
  return String(value || "").split("?")[0];
}

function hasQuery(value?: string) {
  return String(value || "").includes("?");
}

function valueMatchesSelected(value: string | undefined, selected: string) {
  const candidate = String(value || "");
  if (!candidate) return false;
  if (candidate === selected) return true;

  if (hasQuery(candidate) || hasQuery(selected)) {
    return false;
  }

  return stripQuery(candidate) === stripQuery(selected);
}

function itemMatchesKey(item: SidebarItem, selectedKey: React.Key) {
  const selected = String(selectedKey || "");
  return (
    valueMatchesSelected(item.key, selected) ||
    valueMatchesSelected(item.href, selected)
  );
}

function itemContainsKey(item: SidebarItem, selectedKey: React.Key): boolean {
  if (itemMatchesKey(item, selectedKey)) return true;
  return Boolean(
    item.items?.some((child) => itemContainsKey(child, selectedKey)),
  );
}

function collectExpandedGroupKeys(
  items: SidebarItem[],
  selectedKey: React.Key,
): Set<string> {
  const expandedKeys = new Set<string>();

  const walk = (item: SidebarItem): boolean => {
    const contains = itemContainsKey(item, selectedKey);
    if (contains && item.items?.length) {
      expandedKeys.add(item.key);
      item.items.forEach(walk);
    }
    return contains;
  };

  items.forEach(walk);
  if (expandedKeys.size === 0 && items[0]?.items?.length) {
    expandedKeys.add(items[0].key);
  }

  return expandedKeys;
}

function collectLeafItems(items: SidebarItem[]): SidebarItem[] {
  const leaves: SidebarItem[] = [];

  const walk = (item: SidebarItem) => {
    if (item.href) {
      leaves.push(item);
    }
    item.items?.forEach(walk);
  };

  items.forEach(walk);
  return leaves;
}

function collectCompactItems(items: SidebarItem[]): SidebarItem[] {
  return items.map((item) => {
    if (item.href) return item;
    return collectLeafItems([item])[0] || item;
  });
}

function countLeafItems(item: SidebarItem) {
  return collectLeafItems(item.items || []).length;
}

function findGroupPath(
  items: SidebarItem[],
  key: string,
  path: string[] = [],
): string[] | null {
  for (const item of items) {
    if (item.key === key) return path;
    if (item.items?.length) {
      const childPath = findGroupPath(item.items, key, [...path, item.key]);
      if (childPath) return childPath;
    }
  }

  return null;
}

function findSiblingGroupKeys(items: SidebarItem[], key: string): string[] {
  const walk = (children: SidebarItem[]): string[] | null => {
    if (children.some((item) => item.key === key)) {
      return children
        .filter((item) => item.items?.length)
        .map((item) => item.key);
    }

    for (const item of children) {
      if (item.items?.length) {
        const result = walk(item.items);
        if (result) return result;
      }
    }

    return null;
  };

  return walk(items) || [];
}

function collectDescendantGroupKeys(item: SidebarItem): string[] {
  const keys: string[] = [];

  const walk = (child: SidebarItem) => {
    if (child.items?.length) {
      keys.push(child.key);
      child.items.forEach(walk);
    }
  };

  item.items?.forEach(walk);
  return keys;
}

function findItemByKey(items: SidebarItem[], key: string): SidebarItem | null {
  for (const item of items) {
    if (item.key === key) return item;
    if (item.items?.length) {
      const child = findItemByKey(item.items, key);
      if (child) return child;
    }
  }

  return null;
}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      items,
      isCompact,
      defaultSelectedKey,
      onSelect,
      hideEndContent,
      iconClassName,
      classNames,
      className,
      selectedKeys,
      ...props
    },
    ref,
  ) => {
    const selectedKeyFromProps = React.useMemo(() => {
      const firstKey = selectedKeys ? Array.from(selectedKeys)[0] : null;
      return firstKey ?? defaultSelectedKey;
    }, [defaultSelectedKey, selectedKeys]);
    const [selected, setSelected] =
      React.useState<React.Key>(selectedKeyFromProps);
    const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(() =>
      collectExpandedGroupKeys(items, selectedKeyFromProps),
    );

    React.useEffect(() => {
      setSelected(selectedKeyFromProps);
      const activeExpandedKeys = collectExpandedGroupKeys(
        items,
        selectedKeyFromProps,
      );
      setExpandedKeys(activeExpandedKeys);
    }, [items, selectedKeyFromProps]);

    const compactItems = React.useMemo(
      () => collectCompactItems(items),
      [items],
    );

    const renderIcon = (item: SidebarItem) => {
      if (item.icon) {
        const LucideNavIcon = item.icon;
        return (
          <LucideNavIcon
            aria-hidden="true"
            className={cn(
              "h-[18px] w-[18px] shrink-0 text-default-500 transition-colors",
              "group-aria-current:text-primary group-data-[selected=true]:text-primary",
              iconClassName,
            )}
            size={18}
            strokeWidth={1.75}
          />
        );
      }

      return item.startContent ?? null;
    };

    const selectItem = (item: SidebarItem) => {
      const target = item.href || item.key;
      setSelected(item.key);
      onSelect?.(target);
    };

    const toggleGroup = (key: string) => {
      setExpandedKeys((current) => {
        const next = new Set(current);
        const isOpening = !next.has(key);
        const currentItem = findItemByKey(items, key);
        const siblingKeys = findSiblingGroupKeys(items, key);

        siblingKeys.forEach((siblingKey) => {
          if (siblingKey !== key) {
            next.delete(siblingKey);
            const siblingItem = findItemByKey(items, siblingKey);
            if (siblingItem) {
              collectDescendantGroupKeys(siblingItem).forEach((childKey) =>
                next.delete(childKey),
              );
            }
          }
        });

        if (next.has(key)) {
          next.delete(key);
          if (currentItem) {
            collectDescendantGroupKeys(currentItem).forEach((childKey) =>
              next.delete(childKey),
            );
          }
        } else if (isOpening) {
          findGroupPath(items, key)?.forEach((parentKey) =>
            next.add(parentKey),
          );
          next.add(key);
        }
        return next;
      });
    };

    const renderCompactItem = (item: SidebarItem) => {
      const isSelected = item.items?.length
        ? itemContainsKey(item, selected)
        : itemMatchesKey(item, selected);

      return (
        <Tooltip key={item.key} content={item.title} placement="right">
          <button
            aria-current={isSelected ? "page" : undefined}
            aria-label={item.title}
            className={cn(
              "group flex h-11 w-11 items-center justify-center rounded-[8px]",
              "text-default-500 transition-colors hover:bg-default-100 hover:text-foreground",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              {
                "bg-primary-50 text-primary": isSelected,
              },
            )}
            data-selected={isSelected ? "true" : undefined}
            type="button"
            onClick={() => selectItem(item)}
          >
            {renderIcon(item)}
          </button>
        </Tooltip>
      );
    };

    const renderLeafItem = (item: SidebarItem, depth: number) => {
      const isSelected = itemMatchesKey(item, selected);

      return (
        <button
          key={item.key}
          aria-current={isSelected ? "page" : undefined}
          className={cn(
            "group flex h-[38px] w-full min-w-0 items-center gap-2 rounded-[6px]",
            "px-3 text-left text-[14px] font-medium leading-5 text-default-600",
            "transition-colors hover:bg-default-100 hover:text-foreground",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            {
              "bg-primary-50 font-semibold text-primary": isSelected,
              "px-2": depth > 0,
            },
            item.className,
          )}
          data-selected={isSelected ? "true" : undefined}
          type="button"
          onClick={() => selectItem(item)}
        >
          {renderIcon(item)}
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {hideEndContent ? null : item.endContent}
        </button>
      );
    };

    const renderGroupItem = (item: SidebarItem, depth: number) => {
      const isExpanded = expandedKeys.has(item.key);
      const isActiveGroup = itemContainsKey(item, selected);
      const itemCount = countLeafItems(item);

      return (
        <div
          key={item.key}
          className={cn("dashboard-sidebar__group flex flex-col", {
            "gap-1": depth === 0,
            "gap-0.5": depth > 0,
          })}
        >
          <button
            aria-expanded={isExpanded}
            className={cn(
              "group flex w-full min-w-0 items-center gap-2 rounded-[6px] text-left",
              "transition-colors hover:bg-default-100 hover:text-foreground",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              {
                "h-9 px-3 text-[12px] font-bold leading-4 text-default-500":
                  depth === 0,
                "h-8 px-2 text-[12px] font-semibold leading-4 text-default-500":
                  depth > 0,
                "bg-default-100 text-foreground": isActiveGroup,
              },
            )}
            type="button"
            onClick={() => toggleGroup(item.key)}
          >
            {renderIcon(item)}
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {itemCount > 0 ? (
              <span className="shrink-0 rounded-[4px] bg-default-100 px-1.5 py-0.5 text-[10px] font-bold leading-3 text-default-500 group-hover:bg-background">
                {itemCount}
              </span>
            ) : null}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 text-default-400 transition-transform",
                {
                  "-rotate-90": !isExpanded,
                },
              )}
              strokeWidth={1.75}
            />
          </button>
          {isExpanded ? (
            <div
              className={cn("flex flex-col gap-1", {
                "ml-3 border-l border-default-200 pl-2": depth === 0,
                "ml-2 border-l border-default-200 pl-2": depth > 0,
              })}
            >
              {(item.items || []).map((child) =>
                child.items?.length
                  ? renderGroupItem(child, depth + 1)
                  : renderLeafItem(child, depth + 1),
              )}
            </div>
          ) : null}
        </div>
      );
    };

    return (
      <nav
        {...props}
        ref={ref}
        aria-label="主导航"
        className={cn("list-none", classNames?.base, className)}
        suppressHydrationWarning
      >
        {isCompact ? (
          <div
            className={cn("flex flex-col items-center gap-1", classNames?.list)}
          >
            {compactItems.map(renderCompactItem)}
          </div>
        ) : (
          <div className={cn("flex flex-col gap-2", classNames?.list)}>
            {items.map((item) =>
              item.items?.length
                ? renderGroupItem(item, 0)
                : renderLeafItem(item, 0),
            )}
          </div>
        )}
      </nav>
    );
  },
);

Sidebar.displayName = "Sidebar";

export default Sidebar;
