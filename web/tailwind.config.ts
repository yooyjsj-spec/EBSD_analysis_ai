import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Noto Sans KR", "system-ui", "sans-serif"],
      },
      colors: {
        metal: {
          bg: "#0b0d10",
          panel: "#14181e",
          line: "#2a323c",
          muted: "#8b95a3",
          text: "#e8edf2",
          gold: "#d4a017",
        },
      },
    },
  },
  plugins: [],
};

export default config;
