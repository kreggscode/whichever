import { defineConfig } from "vitest/config";

// Served from GitHub Pages at /whichever/.
export default defineConfig({
    base: "/whichever/",
    build: {
        outDir: "dist",
        sourcemap: false,
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
