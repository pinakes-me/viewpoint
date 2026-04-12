import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sepia: {
          50: "#FAFAF5", // Extremely light, warm paper
          100: "#F2EBE1", // Soft beige
          200: "#E3D5C1", // Warm taupe
          300: "#D1BCA2", // Medium sepia lighter
          400: "#B8A081", // Rich medium sepia
          500: "#9A825F", // Balanced sepia
          600: "#7C6749", // Deep earthy sepia
          700: "#5E4D35", // Deeper brown
          800: "#423624", // Almost black/brown
          900: "#2B2317", // Rich espresso black
        },
        forest: {
          DEFAULT: "#5C6B52", // Sophisticated muted olive green
          bg: "#EEF1EC",      // Very pale tint of olive for bg
          mid: "#8B9D7C",     // Soft sage/olive midtone
        },
        rust: {
          DEFAULT: "#B06A5D", // Elegant terracotta / burnt sienna
          bg: "#F9F3F2",      // Pale tint of terracotta
          mid: "#D18D80",     // Soft terracotta
        },
      },
    },
  },
  plugins: [],
};

export default config;
