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
                            small: "10px",
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
                        background: "#f4f8fc",
                        foreground: "#1d2b45",
                        primary: {
                            50: "#fdf1e0",
                            100: "#fae3bd",
                            200: "#f6d08d",
                            300: "#efbb5f",
                            400: "#eaa34a",
                            500: "#e39a3e",
                            600: "#c47f26",
                            700: "#a3641d",
                            800: "#7f4c15",
                            900: "#5c360d",
                            DEFAULT: "#e39a3e",
                            foreground: "#173052",
                        },
                        focus: "#e39a3e",
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
                        background: "#10141f",
                        foreground: "#ece9f4",
                        content1: "#1a2130",
                        content2: "#171c2a",
                        content3: "#232b3d",
                        content4: "#2c3648",
                        primary: {
                            50: "#2b2413",
                            100: "#3a2f17",
                            200: "#54421e",
                            300: "#7a5c28",
                            400: "#a97c33",
                            500: "#d9a44e",
                            600: "#eebd72",
                            700: "#f2cd8e",
                            800: "#f7dfb4",
                            900: "#fbf0d9",
                            DEFAULT: "#eebd72",
                            foreground: "#173052",
                        },
                        focus: "#eebd72",
                    },
                },
            },
        }),
    ],
};

export default config;
