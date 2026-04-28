import { defineConfig } from "astro/config";
import adapter from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
        output: "hybrid",
        adapter: adapter(),
        image: {
                service: {
                        entrypoint: "astro/assets/services/noop",
                },
        },
        integrations: [
                react(),
                tailwind({ applyBaseStyles: false }),
        ],
        vite: {
                optimizeDeps: {
                        include: ["marzipano", "mapbox-gl"],
                },
                build: {
                        rollupOptions: {
                                output: {
                                        manualChunks(id) {
                                                if (id.includes("mapbox-gl")) {
                                                        return "mapbox-gl";
                                                }
                                                if (id.includes("marzipano")) {
                                                        return "marzipano";
                                                }
                                                if (id.includes("@supabase/supabase-js")) {
                                                        return "supabase";
                                                }
                                                return undefined;
                                        },
                                },
                        },
                },
                ssr: {
                        noExternal: ["marzipano", "mapbox-gl"],
                },
        },
});
