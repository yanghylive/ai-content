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
                        background: "#F5F5F7",
                        foreground: "#11181C",
                        primary: {
                            50: "#e6f1fe",
                            100: "#cce3fd",
                            200: "#99c7fb",
                            300: "#66aaf9",
                            400: "#338ef7",
                            500: "#006FEE",
                            600: "#005bc4",
                            700: "#004493",
                            800: "#002e62",
                            900: "#001731",
                            DEFAULT: "#006FEE",
                            foreground: "#ffffff",
                        },
                        focus: "#006FEE",
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
                        background: "#000000",
                        foreground: "#ECEDEE",
                        content1: "#18181b",
                        content2: "#27272a",
                        content3: "#3f3f46",
                        content4: "#52525b",
                        primary: {
                            50: "#001731",
                            100: "#002e62",
                            200: "#004493",
                            300: "#005bc4",
                            400: "#006FEE",
                            500: "#004493",
                            600: "#338ef7",
                            700: "#66aaf9",
                            800: "#99c7fb",
                            900: "#cce3fd",
                            DEFAULT: "#006FEE",
                            foreground: "#ffffff",
                        },
                        focus: "#338ef7",
                    },
                },
            },
        }),
    ],
};

export default config;
