import React from "react";
import {
  ArrowRight as ParkArrowRight,
  BellRing as ParkBellRing,
  Branch as ParkBranch,
  Caution as ParkCaution,
  Clipboard as ParkClipboard,
  Cpu as ParkCpu,
  FileText as ParkFileText,
  Home as ParkHome,
  Inbox as ParkInbox,
  Logout as ParkLogout,
  Magic as ParkMagic,
  Message as ParkMessage,
  Moon as ParkMoon,
  People as ParkPeople,
  Phone as ParkPhone,
  Refresh as ParkRefresh,
  Robot as ParkRobot,
  Search as ParkSearch,
  Setting as ParkSetting,
  Shield as ParkShield,
  Sun as ParkSun,
  Target as ParkTarget,
  TrendingUp as ParkTrendingUp,
  User as ParkUser,
  Wallet as ParkWallet,
} from "@icon-park/react";

/**
 * IconPark 图标适配层（2026-09-03 引入，试点：外壳 rail + /today + dashboard layout）
 *
 * 背景：全站原直用 lucide-react（242 文件 / 178 图标名）。按大王决策换用 IconPark
 * （iconpark.oceanengine.com 官方 @icon-park/react，线性 outline 主题，48 viewBox）。
 * IconPark 组件渲染 span + 内部 svg、className 落在 span、默认 strokeWidth=4，
 * 与 lucide（24 viewBox、svg 直出、默认 strokeWidth=2、size=24）调用面不同。
 * 本层导出与 lucide 同签名的组件：统一换算 size / strokeWidth / Tailwind w-x h-x，
 * 使既有调用点无需逐个改 props。后续全站铺开时在此扩充映射即可。
 */
type HtmlSpan = React.ComponentProps<"span">;

interface CompatProps extends Omit<HtmlSpan, "size" | "color"> {
  size?: number | string;
  color?: string;
  /** lucide 口径（24 viewBox）；内部乘 2 换算为 IconPark 48 viewBox */
  strokeWidth?: number;
}

/** Tailwind 宽高档位数字换算为 px（1 档 = 4px，h-4=16px） */
const TW_TO_PX = (n: number) => n * 4;

function resolvePx(size: number | string | undefined, className?: string): number {
  if (typeof size === "number" && size > 0) return size;
  if (typeof size === "string" && /^\d+(\.\d+)?$/.test(size)) return Number(size);
  const m = className?.match(/(?:^|\s)(?:w|h)-(\d+(\.\d+)?)/);
  if (m) return TW_TO_PX(Number(m[1]));
  return 24; // lucide 默认尺寸
}

/** 工厂：lucide 签名组件 → IconPark outline 渲染 */
function withPark(Park: React.ComponentType<React.ComponentProps<typeof ParkArrowRight>>) {
  return function ParkCompat({
    size,
    color,
    strokeWidth,
    className,
    style,
    ...rest
  }: CompatProps) {
    const px = resolvePx(size, className);
    return (
      <Park
        size={px}
        strokeWidth={strokeWidth != null ? strokeWidth * 2 : undefined}
        theme="outline"
        className={className}
        style={color ? { ...style, color } : style}
        {...rest}
      />
    );
  };
}

/* ---------- 试点导出：与 lucide 同名，调用点切换 import 源即生效 ---------- */
export const AlertTriangle = withPark(ParkCaution);
export const ArrowRight = withPark(ParkArrowRight);
export const Bot = withPark(ParkRobot);
export const ClipboardList = withPark(ParkClipboard);
export const Cpu = withPark(ParkCpu);
export const FileText = withPark(ParkFileText);
export const Home = withPark(ParkHome);
export const Inbox = withPark(ParkInbox);
export const Logout = withPark(ParkLogout);
export const Message = withPark(ParkMessage);
export const Moon = withPark(ParkMoon);
export const People = withPark(ParkPeople);
export const Phone = withPark(ParkPhone);
export const RefreshCw = withPark(ParkRefresh);
export const Route = withPark(ParkBranch);
export const Search = withPark(ParkSearch);
export const Setting = withPark(ParkSetting);
export const ShieldCheck = withPark(ParkShield);
export const Sparkles = withPark(ParkMagic);
export const Sun = withPark(ParkSun);
export const Target = withPark(ParkTarget);
export const TrendingUp = withPark(ParkTrendingUp);
export const User = withPark(ParkUser);
export const UsersRound = withPark(ParkPeople);
export const Wallet = withPark(ParkWallet);
export const BellRing = withPark(ParkBellRing);

export { withPark };
