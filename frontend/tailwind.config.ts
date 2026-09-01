import { heroui } from "@heroui/react";
import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
        "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                serif: ["var(--kaypal-v3-font-serif)"],
                sans: ["var(--kaypal-v3-font-nav)"],
                mono: ["var(--kaypal-v3-font-mono)"],
            },
            /* 字号 5 档规范（B7 2026-08-23）：text-[Npx] 字面量全站归档到语义档，
               16px+ 走标准类（base/lg/xl/2xl） */
            fontSize: {
                11: ["11px", { lineHeight: "15px" }],
                12: ["12px", { lineHeight: "18px" }],
                13: ["13px", { lineHeight: "19px" }],
                14: ["14px", { lineHeight: "21px" }],
            },
            colors: {
                border: "hsl(var(--agent-cockpit-border))",
                input: "hsl(var(--agent-cockpit-input))",
                ring: "hsl(var(--agent-cockpit-ring))",
                background: "hsl(var(--agent-cockpit-background))",
                foreground: "hsl(var(--agent-cockpit-foreground))",
                card: {
                    DEFAULT: "hsl(var(--agent-cockpit-card))",
                    foreground: "hsl(var(--agent-cockpit-card-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--agent-cockpit-muted))",
                    foreground: "hsl(var(--agent-cockpit-muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--agent-cockpit-accent))",
                    foreground: "hsl(var(--agent-cockpit-accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--agent-cockpit-destructive))",
                    foreground: "hsl(var(--agent-cockpit-destructive-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--agent-cockpit-primary))",
                    foreground: "hsl(var(--agent-cockpit-primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--agent-cockpit-secondary))",
                    foreground: "hsl(var(--agent-cockpit-secondary-foreground))",
                },
            },
        },
    },
    darkMode: "class",
    plugins: [
        heroui({
            themes: {
                light: {
                    layout: {
                        radius: {
                            small: "10px",
                            medium: "10px",
                            large: "14px",
                        },
                        fontSize: {
                            /* 对齐字号 4 档规范（B7）：11/12/13/14 */
                            tiny: "11px",
                            small: "12px",
                            medium: "13px",
                            large: "14px",
                        },
                        lineHeight: {
                            tiny: "1rem",
                            small: "1.25rem",
                            medium: "1.375rem",
                            large: "1.5rem",
                        },
                        boxShadow: {
                            small: "var(--kaypal-v3-shadow-1)",
                            medium: "var(--kaypal-v3-shadow-2)",
                            large: "var(--kaypal-v3-shadow-3)",
                        },
                    },
                    colors: {
                        background: "hsl(260 50% 97.6%)",
                        foreground: "hsl(258.6 34.9% 16.3%)",
                        /* 品牌紫 #722ed1 色阶 · HSL（2026-09-01 迁移：HeroUI 原生格式，与 --agent-cockpit HSL token 同体系） */
                        primary: {
                            50: "hsl(276 100% 97.1%)",
                            100: "hsl(271 100% 93.9%)",
                            200: "hsl(269 70.1% 86.9%)",
                            300: "hsl(268 66.7% 78.8%)",
                            400: "hsl(267 62.2% 67.8%)",
                            500: "hsl(267 67.6% 60%)",
                            600: "hsl(265 63.9% 50%)",
                            700: "hsl(263 71% 39.2%)",
                            800: "hsl(262 72.5% 31.4%)",
                            900: "hsl(262 75.9% 22.7%)",
                            DEFAULT: "hsl(265 63.9% 50%)",
                            foreground: "hsl(0 0% 100%)",
                        },
                        focus: "hsl(265 63.9% 50%)",
                    },
                },
                dark: {
                    layout: {
                        radius: {
                            small: "10px",
                            medium: "10px",
                            large: "14px",
                        },
                        fontSize: {
                            /* 对齐字号 4 档规范（B7）：11/12/13/14 */
                            tiny: "11px",
                            small: "12px",
                            medium: "13px",
                            large: "14px",
                        },
                        lineHeight: {
                            tiny: "1rem",
                            small: "1.25rem",
                            medium: "1.375rem",
                            large: "1.5rem",
                        },
                        boxShadow: {
                            small: "var(--kaypal-v3-shadow-1)",
                            medium: "var(--kaypal-v3-shadow-2)",
                            large: "var(--kaypal-v3-shadow-3)",
                        },
                    },
                    colors: {
                        background: "hsl(260 22% 8%)",
                        foreground: "hsl(256.4 33.3% 93.5%)",
                        content1: "hsl(260 24.6% 12%)",
                        content2: "hsl(260 28.3% 10.4%)",
                        content3: "hsl(260 23.1% 17.8%)",
                        content4: "hsl(256.2 21.3% 23.9%)",
                        /* 深色品牌紫阶（亮紫系） */
                        primary: {
                            50: "hsl(264 38.5% 15.3%)",
                            100: "hsl(263.7 38% 19.6%)",
                            200: "hsl(264.2 40.4% 27.6%)",
                            300: "hsl(264.6 39.4% 38.8%)",
                            400: "hsl(263.5 40.6% 53.1%)",
                            500: "hsl(267 67.6% 60%)",
                            600: "hsl(266.8 87.7% 74.5%)",
                            700: "hsl(266.5 87.8% 80.8%)",
                            800: "hsl(267.4 87.7% 87.3%)",
                            900: "hsl(267.7 86.7% 94.1%)",
                            DEFAULT: "hsl(266.8 87.7% 74.5%)",
                            foreground: "hsl(261.3 50.8% 12%)",
                        },
                        focus: "hsl(266.8 87.7% 74.5%)",
                    },
                },
            },
        }),
    ],
};

export default config;
