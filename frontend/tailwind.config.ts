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
                        background: "#f8f6fc",
                        foreground: "#241b38",
                        /* 品牌紫 #722ed1 色阶（2026-08-23 唯一主题定稿：磨砂紫金，紫主金辅） */
                        primary: {
                            50: "#f9f0ff",
                            100: "#f0e0ff",
                            200: "#ddc6f5",
                            300: "#c7a5ed",
                            400: "#a87ae0",
                            500: "#9254de",
                            600: "#722ed1",
                            700: "#531dab",
                            800: "#41168a",
                            900: "#2e0e66",
                            DEFAULT: "#722ed1",
                            foreground: "#ffffff",
                        },
                        focus: "#722ed1",
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
                        background: "#131019",
                        foreground: "#ece9f4",
                        content1: "#1c1726",
                        content2: "#181322",
                        content3: "#2a2338",
                        content4: "#37304a",
                        /* 深色品牌紫阶（亮紫系） */
                        primary: {
                            50: "#241836",
                            100: "#2e1f45",
                            200: "#412a63",
                            300: "#5c3c8a",
                            400: "#7d57b8",
                            500: "#9254de",
                            600: "#b885f7",
                            700: "#c9a3f9",
                            800: "#dcc2fb",
                            900: "#efe3fd",
                            DEFAULT: "#b885f7",
                            foreground: "#1a0f2e",
                        },
                        focus: "#b885f7",
                    },
                },
            },
        }),
    ],
};

export default config;
