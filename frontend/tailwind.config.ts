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
                            small: "8px",
                            medium: "10px",
                            large: "14px",
                        },
                        fontSize: {
                            tiny: "0.6875rem",
                            small: "0.8125rem",
                            medium: "0.9375rem",
                            large: "1.0625rem",
                        },
                        lineHeight: {
                            tiny: "1rem",
                            small: "1.25rem",
                            medium: "1.375rem",
                            large: "1.5rem",
                        },
                        boxShadow: {
                            small: "var(--kaypal-v3-card-shadow)",
                            medium: "var(--kaypal-v3-card-shadow)",
                            large: "var(--kaypal-v3-elevated-shadow)",
                        },
                    },
                    colors: {
                        background: "#f7f5fa",
                        foreground: "#2a2438",
                        primary: {
                            50: "#ede8fd",
                            100: "#ddd2fb",
                            200: "#cfc0f9",
                            300: "#b6a3f5",
                            400: "#977ff2",
                            500: "#7c5cf0",
                            600: "#5b3fd4",
                            700: "#452db0",
                            800: "#322184",
                            900: "#241a5e",
                            DEFAULT: "#7c5cf0",
                            foreground: "#ffffff",
                        },
                        focus: "#7c5cf0",
                    },
                },
                dark: {
                    layout: {
                        radius: {
                            small: "8px",
                            medium: "10px",
                            large: "14px",
                        },
                        fontSize: {
                            tiny: "0.6875rem",
                            small: "0.8125rem",
                            medium: "0.9375rem",
                            large: "1.0625rem",
                        },
                        lineHeight: {
                            tiny: "1rem",
                            small: "1.25rem",
                            medium: "1.375rem",
                            large: "1.5rem",
                        },
                        boxShadow: {
                            small: "var(--kaypal-v3-card-shadow)",
                            medium: "var(--kaypal-v3-card-shadow)",
                            large: "var(--kaypal-v3-elevated-shadow)",
                        },
                    },
                    colors: {
                        background: "#141218",
                        foreground: "#ece9f4",
                        content1: "#1c1923",
                        content2: "#1d1a24",
                        content3: "#2b2735",
                        content4: "#413a52",
                        primary: {
                            50: "#211a3a",
                            100: "#2b2247",
                            200: "#3a2d63",
                            300: "#4e3d8f",
                            400: "#6a52bd",
                            500: "#8b6ff5",
                            600: "#a78ef8",
                            700: "#b7a6f8",
                            800: "#cfc2fa",
                            900: "#e6defb",
                            DEFAULT: "#8b6ff5",
                            foreground: "#ffffff",
                        },
                        focus: "#8b6ff5",
                    },
                },
            },
        }),
    ],
};

export default config;
