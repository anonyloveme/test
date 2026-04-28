import { defineConfig, envField } from "astro/config";
import adapter from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
        output: "hybrid",
        adapter: adapter({
                platformProxy: { enabled: true },
        }),
        // ✅ Khai báo env schema cho Astro 5+
        env: {
                schema: {
                        VITE_SUPABASE_URL: envField.string({ context: "client", access: "public" }),
                        VITE_SUPABASE_ANON_KEY: envField.string({ context: "client", access: "public" }),
                        VITE_MAPBOX_TOKEN: envField.string({ context: "client", access: "public" }),
                        VITE_R2_PUBLIC_URL: envField.string({ context: "client", access: "public" }),
                }
        },
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
