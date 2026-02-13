import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff1f1",
          100: "#ffe0e0",
          200: "#ffc6c6",
          300: "#ff9d9d",
          400: "#ff6464",
          500: "#ff2f2f",
          600: "#f31313",
          700: "#cc0c0c",
          800: "#a80f0f",
          900: "#8b1515"
        }
      }
    }
  },
  plugins: []
};

export default config;
