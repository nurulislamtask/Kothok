import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: token("card"),
        muted: token("muted"),
        "muted-foreground": token("muted-foreground"),
        border: token("border"),
        primary: token("primary"),
        "primary-foreground": token("primary-foreground"),
        sidebar: token("sidebar"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', '"Noto Sans Bengali"', "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "0.875rem" },
    },
  },
  plugins: [],
} satisfies Config;
