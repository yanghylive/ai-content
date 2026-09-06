import React from "react";
import {
  AddOne as ParkAddOne,
  AddUser as ParkAddUser,
  Adjustment as ParkAdjustment,
  AppSwitch as ParkAppSwitch,
  Application as ParkApplication,
  ApplicationMenu as ParkApplicationMenu,
  ArrowDown as ParkArrowDown,
  ArrowLeft as ParkArrowLeft,
  ArrowRight as ParkArrowRight,
  ArrowRightDown as ParkArrowRightDown,
  ArrowRightUp as ParkArrowRightUp,
  ArrowUp as ParkArrowUp,
  Balance as ParkBalance,
  Bank as ParkBank,
  BankCard as ParkBankCard,
  Bill as ParkBill,
  Book as ParkBook,
  BookOpen as ParkBookOpen,
  Box as ParkBox,
  BellRing as ParkBellRing,
  Branch as ParkBranch,
  Briefcase as ParkBriefcase,
  Brightness as ParkBrightness,
  BuildingTwo as ParkBuildingTwo,
  Calendar as ParkCalendar,
  Camera as ParkCamera,
  Attention as ParkAttention,
  ChartHistogram as ParkChartHistogram,
  ChartLine as ParkChartLine,
  Check as ParkCheck,
  CheckCorrect as ParkCheckCorrect,
  CheckOne as ParkCheckOne,
  Checkbox as ParkCheckbox,
  Checklist as ParkChecklist,
  Caution as ParkCaution,
  Clipboard as ParkClipboard,
  Close as ParkClose,
  CloseOne as ParkCloseOne,
  CloudStorage as ParkCloudStorage,
  Comments as ParkComments,
  Code as ParkCode,
  CollectionFiles as ParkCollectionFiles,
  Computer as ParkComputer,
  CooperativeHandshake as ParkCooperativeHandshake,
  Copy as ParkCopy,
  Cpu as ParkCpu,
  Cycle as ParkCycle,
  Cylinder as ParkCylinder,
  Dashboard as ParkDashboard,
  Delete as ParkDelete,
  Dollar as ParkDollar,
  Down as ParkDown,
  Download as ParkDownload,
  Edit as ParkEdit,
  Export as ParkExport,
  Eyes as ParkEyes,
  PreviewClose as ParkPreviewClose,
  PreviewOpen as ParkPreviewOpen,
  FileAddition as ParkFileAddition,
  FileCabinet as ParkFileCabinet,
  FileCode as ParkFileCode,
  FileCollection as ParkFileCollection,
  FileEditing as ParkFileEditing,
  FileExcel as ParkFileExcel,
  FileQuestion as ParkFileQuestion,
  FileSearch as ParkFileSearch,
  FileSuccess as ParkFileSuccess,
  FileText as ParkFileText,
  Filter as ParkFilter,
  Fire as ParkFire,
  Flask as ParkFlask,
  Folder as ParkFolder,
  FolderConversion as ParkFolderConversion,
  FolderFailed as ParkFolderFailed,
  FolderOpen as ParkFolderOpen,
  Forbid as ParkForbid,
  ForkSpoon as ParkForkSpoon,
  Gift as ParkGift,
  GridNine as ParkGridNine,
  HammerAndAnvil as ParkHammerAndAnvil,
  Heart as ParkHeart,
  Heartbeat as ParkHeartbeat,
  History as ParkHistory,
  Home as ParkHome,
  Inbox as ParkInbox,
  InboxIn as ParkInboxIn,
  Info as ParkInfo,
  Iphone as ParkIphone,
  Key as ParkKey,
  Layers as ParkLayers,
  Left as ParkLeft,
  Light as ParkLight,
  Lightning as ParkLightning,
  Link as ParkLink,
  Loading as ParkLoading,
  Local as ParkLocal,
  Lock as ParkLock,
  Logout as ParkLogout,
  Magic as ParkMagic,
  MagicWand as ParkMagicWand,
  Mail as ParkMail,
  Message as ParkMessage,
  MessageOne as ParkMessageOne,
  Monitor as ParkMonitor,
  MonitorOne as ParkMonitorOne,
  Moon as ParkMoon,
  Music as ParkMusic,
  NewspaperFolding as ParkNewspaperFolding,
  Next as ParkNext,
  OrderedList as ParkOrderedList,
  Paint as ParkPaint,
  Paperclip as ParkPaperclip,
  OpenOne as ParkOpenOne,
  Pause as ParkPause,
  PauseOne as ParkPauseOne,
  Pencil as ParkPencil,
  People as ParkPeople,
  Phone as ParkPhone,
  Protect as ParkProtect,
  Pic as ParkPic,
  PictureAlbum as ParkPictureAlbum,
  Pie as ParkPie,
  Pin as ParkPin,
  Play as ParkPlay,
  PlayOne as ParkPlayOne,
  Plug as ParkPlug,
  Plus as ParkPlus,
  ProcessLine as ParkProcessLine,
  Radar as ParkRadar,
  Radio as ParkRadio,
  Refresh as ParkRefresh,
  Reload as ParkReload,
  Remind as ParkRemind,
  Right as ParkRight,
  Road as ParkRoad,
  RobotOne as ParkRobotOne,
  Rocket as ParkRocket,
  Round as ParkRound,
  Rss as ParkRss,
  Save as ParkSave,
  Scan as ParkScan,
  Search as ParkSearch,
  Send as ParkSend,
  Server as ParkServer,
  Setting as ParkSetting,
  SettingTwo as ParkSettingTwo,
  Share as ParkShare,
  Shield as ParkShield,
  Shop as ParkShop,
  ShoppingBag as ParkShoppingBag,
  ShoppingCart as ParkShoppingCart,
  Shuffle as ParkShuffle,
  Speed as ParkSpeed,
  Square as ParkSquare,
  Star as ParkStar,
  Sun as ParkSun,
  Tag as ParkTag,
  Target as ParkTarget,
  TextMessage as ParkTextMessage,
  Time as ParkTime,
  Timer as ParkTimer,
  Tool as ParkTool,
  TreeList as ParkTreeList,
  TrendingDown as ParkTrendingDown,
  TrendingUp as ParkTrendingUp,
  TwoDimensionalCode as ParkTwoDimensionalCode,
  Up as ParkUp,
  UpAndDown as ParkUpAndDown,
  UpdateRotation as ParkUpdateRotation,
  Upload as ParkUpload,
  User as ParkUser,
  Video as ParkVideo,
  VideoFile as ParkVideoFile,
  Wallet as ParkWallet,
  Wifi as ParkWifi,
  World as ParkWorld,
} from "@icon-park/react";

/**
 * IconPark 全站图标适配层（2026-09-03 全站铺开）
 *
 * 背景：全站由 lucide-react（240 文件 / 233 图标名）迁移至 IconPark
 * （iconpark.oceanengine.com 官方 @icon-park/react，线性 outline 主题，48 viewBox）。
 * IconPark 组件渲染 span + 内部 svg、className 落在 span、默认 strokeWidth=4，
 * 与 lucide（24 viewBox、svg 直出、默认 strokeWidth=2、size=24）调用面不同。
 * 本层导出与 lucide 同名同签名组件：换算 size / strokeWidth / Tailwind 宽高档，
 * 调用点只需把 import 源从 lucide-react 切到 @/components/iconpark。
 * 部分 lucide 图标在 IconPark 无 1:1 同款，采用语义近义替代（映射见下方 export 表；
 * 名->图标对照以官方站为准）。类型 LucideIcon 在此弱化为通用组件类型，便于既有
 * Record<string, LucideIcon> 用法平滑迁移。
 */
type HtmlSpan = React.ComponentProps<"span">;

interface CompatProps extends Omit<HtmlSpan, "size" | "color"> {
  size?: number | string;
  color?: string;
  /** lucide 口径（24 viewBox）；内部乘 2 换算为 IconPark 48 viewBox */
  strokeWidth?: number;
  /** IconPark 双色主题用色；不传则 currentColor */
  fill?: string | string[];
  [key: string]: unknown;
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
        size={ px }
        strokeWidth={ strokeWidth != null ? strokeWidth * 2 : undefined }
        theme="outline"
        className={ className }
        style={ color ? { ...style, color } : style }
        {...rest}
      />
    );
  };
}

/* ---------- 233 个 lucide 同名单导出（线性 outline 主题） ---------- */
export const Activity = withPark(ParkHeartbeat);
export const AlertCircle = withPark(ParkInfo);
export const AlertTriangle = withPark(ParkCaution);
export const AppWindow = withPark(ParkApplicationMenu);
export const Archive = withPark(ParkFileCabinet);
export const ArrowDown = withPark(ParkArrowDown);
export const ArrowDownRight = withPark(ParkArrowRightDown);
export const ArrowLeft = withPark(ParkArrowLeft);
export const ArrowRight = withPark(ParkArrowRight);
export const ArrowUp = withPark(ParkArrowUp);
export const ArrowUpDown = withPark(ParkUpAndDown);
export const ArrowUpRight = withPark(ParkArrowRightUp);
export const BadgeCheck = withPark(ParkCheckCorrect);
export const Ban = withPark(ParkForbid);
export const BarChart3 = withPark(ParkChartHistogram);
export const Bell = withPark(ParkRemind);
export const BellRing = withPark(ParkBellRing);
export const Blocks = withPark(ParkAppSwitch);
export const Bolt = withPark(ParkLightning);
export const BookOpen = withPark(ParkBookOpen);
export const BookOpenCheck = withPark(ParkBook);
export const Bot = withPark(ParkRobotOne);
export const Braces = withPark(ParkCode);
export const Briefcase = withPark(ParkBriefcase);
export const BriefcaseBusiness = withPark(ParkBriefcase);
export const Building2 = withPark(ParkBuildingTwo);
export const CalendarClock = withPark(ParkCalendar);
export const CalendarDays = withPark(ParkCalendar);
export const Camera = withPark(ParkCamera);
export const ChartLine = withPark(ParkChartLine);
export const Check = withPark(ParkCheck);
export const CheckCircle = withPark(ParkCheckOne);
export const CheckCircle2 = withPark(ParkCheckOne);
export const CheckIcon = withPark(ParkCheckOne);
export const ChevronDown = withPark(ParkDown);
export const ChevronLeft = withPark(ParkLeft);
export const ChevronRight = withPark(ParkRight);
export const ChevronRightIcon = withPark(ParkRight);
export const ChevronUp = withPark(ParkUp);
export const Circle = withPark(ParkRound);
export const CircleAlert = withPark(ParkInfo);
export const CircleCheck = withPark(ParkCheckOne);
export const CircleDashed = withPark(ParkRound);
export const CircleDollarSign = withPark(ParkDollar);
export const CircleIcon = withPark(ParkRound);
export const CirclePause = withPark(ParkPauseOne);
export const CirclePlay = withPark(ParkPlayOne);
export const Clipboard = withPark(ParkClipboard);
export const ClipboardCheck = withPark(ParkChecklist);
export const ClipboardList = withPark(ParkClipboard);
export const Clock = withPark(ParkTime);
export const Clock3 = withPark(ParkTime);
export const Cloud = withPark(ParkCloudStorage);
export const CloudCog = withPark(ParkCloudStorage);
export const CloudDownload = withPark(ParkCloudStorage);
export const CloudOff = withPark(ParkCloudStorage);
export const CloudUpload = withPark(ParkCloudStorage);
export const Code = withPark(ParkCode);
export const Copy = withPark(ParkCopy);
export const CopyPlus = withPark(ParkCopy);
export const Cpu = withPark(ParkCpu);
export const CreditCard = withPark(ParkBankCard);
export const Database = withPark(ParkCylinder);
export const DatabaseZap = withPark(ParkCylinder);
export const DollarSign = withPark(ParkDollar);
export const Download = withPark(ParkDownload);
export const Edit3 = withPark(ParkEdit);
export const ExternalLink = withPark(ParkOpenOne);
export const Eye = withPark(ParkEyes);
export const EyeOpen = withPark(ParkPreviewOpen);
export const EyeClosed = withPark(ParkPreviewClose);
export const File = withPark(ParkFileText);
export const FileBadge = withPark(ParkFileSuccess);
export const FileCheck2 = withPark(ParkFileSuccess);
export const FileCode2 = withPark(ParkFileCode);
export const FilePenLine = withPark(ParkFileEditing);
export const FilePlus = withPark(ParkFileAddition);
export const FilePlus2 = withPark(ParkFileAddition);
export const FileQuestion = withPark(ParkFileQuestion);
export const FileSearch = withPark(ParkFileSearch);
export const FileSpreadsheet = withPark(ParkFileExcel);
export const FileText = withPark(ParkFileText);
export const FileUp = withPark(ParkExport);
export const FileVideo = withPark(ParkVideoFile);
export const Files = withPark(ParkFileCollection);
export const Filter = withPark(ParkFilter);
export const Flame = withPark(ParkFire);
export const FlaskConical = withPark(ParkFlask);
export const Folder = withPark(ParkFolder);
export const FolderInput = withPark(ParkFolderConversion);
export const FolderOpen = withPark(ParkFolderOpen);
export const FolderSearch = withPark(ParkFileSearch);
export const FolderX = withPark(ParkFolderFailed);
export const Gauge = withPark(ParkSpeed);
export const Gift = withPark(ParkGift);
export const GitBranch = withPark(ParkBranch);
export const GitCompare = withPark(ParkBranch);
export const GitCompareArrows = withPark(ParkBranch);
export const Globe = withPark(ParkWorld);
export const Globe2 = withPark(ParkWorld);
export const Hammer = withPark(ParkHammerAndAnvil);
export const Handshake = withPark(ParkCooperativeHandshake);
export const Heart = withPark(ParkHeart);
export const HeartPulse = withPark(ParkHeartbeat);
export const History = withPark(ParkHistory);
export const Home = withPark(ParkHome);
export const Image = withPark(ParkPic);
export const ImageIcon = withPark(ParkPic);
export const Images = withPark(ParkPictureAlbum);
export const Inbox = withPark(ParkInbox);
export const Info = withPark(ParkInfo);
export const KeyRound = withPark(ParkKey);
export const Landmark = withPark(ParkBank);
export const Laptop = withPark(ParkComputer);
export const Layers = withPark(ParkLayers);
export const Layers3 = withPark(ParkLayers);
export const LayoutDashboard = withPark(ParkDashboard);
export const LayoutGrid = withPark(ParkGridNine);
export const LayoutTemplate = withPark(ParkApplication);
export const Library = withPark(ParkCollectionFiles);
export const LibraryBig = withPark(ParkCollectionFiles);
export const Lightbulb = withPark(ParkLight);
export const LineChart = withPark(ParkChartLine);
export const Link = withPark(ParkLink);
export const Link2 = withPark(ParkLink);
export const ListChecks = withPark(ParkChecklist);
export const ListTree = withPark(ParkTreeList);
export const Loader2 = withPark(ParkLoading);
export const Lock = withPark(ParkLock);
export const LockKeyhole = withPark(ParkLock);
export const LogIn = withPark(ParkInboxIn);
export const Mail = withPark(ParkMail);
export const MapPin = withPark(ParkLocal);
export const MapPinned = withPark(ParkLocal);
export const MessageCircle = withPark(ParkMessage);
export const MessageSquare = withPark(ParkMessageOne);
export const MessageSquareText = withPark(ParkTextMessage);
export const MessagesSquare = withPark(ParkComments);
export const Monitor = withPark(ParkMonitorOne);
export const MonitorCheck = withPark(ParkMonitorOne);
export const MonitorCog = withPark(ParkMonitorOne);
export const MonitorPlay = withPark(ParkMonitor);
export const MonitorSmartphone = withPark(ParkMonitorOne);
export const Moon = withPark(ParkMoon);
export const Music2 = withPark(ParkMusic);
export const Newspaper = withPark(ParkNewspaperFolding);
export const Package = withPark(ParkBox);
export const PackageCheck = withPark(ParkBox);
export const PackagePlus = withPark(ParkBox);
export const Palette = withPark(ParkPaint);
export const PanelsTopLeft = withPark(ParkAppSwitch);
export const Paperclip = withPark(ParkPaperclip);
export const Pause = withPark(ParkPause);
export const PauseCircle = withPark(ParkPauseOne);
export const PenLine = withPark(ParkEdit);
export const Pencil = withPark(ParkPencil);
export const Phone = withPark(ParkPhone);
export const PieChart = withPark(ParkPie);
export const Pin = withPark(ParkPin);
export const Play = withPark(ParkPlay);
export const PlayCircle = withPark(ParkPlayOne);
export const Plug = withPark(ParkPlug);
export const PlugZap = withPark(ParkPlug);
export const Plus = withPark(ParkPlus);
export const PlusCircle = withPark(ParkAddOne);
export const QrCode = withPark(ParkTwoDimensionalCode);
export const Radar = withPark(ParkRadar);
export const Radio = withPark(ParkRadio);
export const ReceiptText = withPark(ParkBill);
export const RefreshCcw = withPark(ParkReload);
export const RefreshCw = withPark(ParkRefresh);
export const Repeat2 = withPark(ParkCycle);
export const Rocket = withPark(ParkRocket);
export const RotateCcw = withPark(ParkUpdateRotation);
export const Route = withPark(ParkRoad);
export const Rss = withPark(ParkRss);
export const Save = withPark(ParkSave);
export const Scale = withPark(ParkBalance);
export const ScanSearch = withPark(ParkScan);
export const ScrollText = withPark(ParkOrderedList);
export const Search = withPark(ParkSearch);
export const SearchX = withPark(ParkSearch);
export const Send = withPark(ParkSend);
export const SendHorizontal = withPark(ParkSend);
export const Server = withPark(ParkServer);
export const Settings = withPark(ParkSetting);
export const Settings2 = withPark(ParkSettingTwo);
export const Share2 = withPark(ParkShare);
export const Shield = withPark(ParkShield);
export const ShieldAlert = withPark(ParkAttention);
export const ShieldCheck = withPark(ParkProtect);
export const ShoppingBag = withPark(ParkShoppingBag);
export const ShoppingCart = withPark(ParkShoppingCart);
export const Shuffle = withPark(ParkShuffle);
export const SkipForward = withPark(ParkNext);
export const SlidersHorizontal = withPark(ParkAdjustment);
export const Smartphone = withPark(ParkIphone);
export const Sparkle = withPark(ParkBrightness);
export const Sparkles = withPark(ParkBrightness);
export const Square = withPark(ParkSquare);
export const SquareCheck = withPark(ParkCheckbox);
export const Star = withPark(ParkStar);
export const StopCircle = withPark(ParkForbid);
export const Store = withPark(ParkShop);
export const Sun = withPark(ParkSun);
export const Tag = withPark(ParkTag);
export const Target = withPark(ParkTarget);
export const TimerReset = withPark(ParkTimer);
export const Trash2 = withPark(ParkDelete);
export const TrendingDown = withPark(ParkTrendingDown);
export const TrendingUp = withPark(ParkTrendingUp);
export const TriangleAlert = withPark(ParkCaution);
export const Upload = withPark(ParkUpload);
export const UploadCloud = withPark(ParkCloudStorage);
export const User = withPark(ParkUser);
export const UserCheck = withPark(ParkUser);
export const UserPlus = withPark(ParkAddUser);
export const UserRound = withPark(ParkUser);
export const UserRoundCheck = withPark(ParkUser);
export const UserRoundPlus = withPark(ParkAddUser);
export const UserRoundSearch = withPark(ParkUser);
export const Users = withPark(ParkPeople);
export const UsersRound = withPark(ParkPeople);
export const Utensils = withPark(ParkForkSpoon);
export const Video = withPark(ParkVideo);
export const Wallet = withPark(ParkWallet);
export const Wand2 = withPark(ParkMagicWand);
export const WandSparkles = withPark(ParkMagicWand);
export const WifiOff = withPark(ParkWifi);
export const Workflow = withPark(ParkProcessLine);
export const Wrench = withPark(ParkTool);
export const X = withPark(ParkClose);
export const XCircle = withPark(ParkCloseOne);
export const XIcon = withPark(ParkClose);
export const Zap = withPark(ParkLightning);

/** 兼容类型：既有 Record<string, LucideIcon> 等用法平滑迁移 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- withPark 返回 CompatProps 组件（strokeWidth:number），与 SVGProps（strokeWidth:string|number）参数逆变不兼容，弱化为通用组件类型
export type LucideIcon = React.ComponentType<any>;

/* ---------- 补充导出（外壳 ShellIcon 等需要的非 lucide 原名） ---------- */
export const Message = withPark(ParkMessage);
export const People = withPark(ParkPeople);
export const Logout = withPark(ParkLogout);

export { withPark };
