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
                        background: "oklch(0.973 0.006 145)",
                        foreground: "oklch(0.18 0.012 240)",
                        content1: "oklch(1 0 0)",
                        content2: "oklch(0.982 0.003 210)",
                        content3: "oklch(0.955 0.007 145)",
                        content4: "oklch(0.89 0.01 145)",
                        default: {
                            50: "oklch(0.982 0.003 210)",
                            100: "oklch(0.955 0.007 145)",
                            200: "oklch(0.89 0.01 145)",
                            300: "oklch(0.78 0.016 145)",
                            400: "oklch(0.56 0.016 240)",
                            500: "oklch(0.46 0.016 240)",
                            600: "oklch(0.36 0.016 240)",
                            700: "oklch(0.28 0.014 240)",
                            800: "oklch(0.22 0.013 240)",
                            900: "oklch(0.18 0.012 240)",
                            DEFAULT: "oklch(0.955 0.007 145)",
                            foreground: "oklch(0.18 0.012 240)",
                        },
                        primary: {
                            50: "oklch(0.92 0.035 165)",
                            100: "oklch(0.86 0.045 165)",
                            200: "oklch(0.76 0.06 165)",
                            300: "oklch(0.66 0.08 165)",
                            400: "oklch(0.55 0.095 165)",
                            500: "oklch(0.45 0.105 165)",
                            600: "oklch(0.39 0.098 165)",
                            700: "oklch(0.32 0.09 165)",
                            800: "oklch(0.25 0.08 165)",
                            900: "oklch(0.2 0.07 165)",
                            DEFAULT: "oklch(0.45 0.105 165)",
                            foreground: "#ffffff",
                        },
                        focus: "oklch(0.45 0.105 165)",
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
                        background: "oklch(0.22 0.012 230)",
                        foreground: "oklch(0.91 0.006 230)",
                        content1: "oklch(0.265 0.012 230)",
                        content2: "oklch(0.285 0.012 230)",
                        content3: "oklch(0.31 0.014 230)",
                        content4: "oklch(0.39 0.014 230)",
                        default: {
                            50: "oklch(0.31 0.014 230)",
                            100: "oklch(0.35 0.014 230)",
                            200: "oklch(0.39 0.014 230)",
                            300: "oklch(0.49 0.016 230)",
                            400: "oklch(0.64 0.012 230)",
                            500: "oklch(0.75 0.01 230)",
                            600: "oklch(0.82 0.008 230)",
                            700: "oklch(0.87 0.007 230)",
                            800: "oklch(0.91 0.006 230)",
                            900: "oklch(0.96 0.004 230)",
                            DEFAULT: "oklch(0.31 0.014 230)",
                            foreground: "oklch(0.91 0.006 230)",
                        },
                        primary: {
                            50: "oklch(0.34 0.03 168)",
                            100: "oklch(0.4 0.036 168)",
                            200: "oklch(0.48 0.046 168)",
                            300: "oklch(0.56 0.055 168)",
                            400: "oklch(0.64 0.064 168)",
                            500: "oklch(0.7 0.07 168)",
                            600: "oklch(0.76 0.062 168)",
                            700: "oklch(0.82 0.052 168)",
                            800: "oklch(0.88 0.042 168)",
                            900: "oklch(0.93 0.03 168)",
                            DEFAULT: "oklch(0.7 0.07 168)",
                            foreground: "oklch(0.18 0.012 240)",
                        },
                        focus: "oklch(0.7 0.07 168)",
                    },
                },
            },
        }),
    ],
};

export default config;
