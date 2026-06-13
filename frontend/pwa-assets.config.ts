import {
  defineConfig,
  minimal2023Preset,
  createAppleSplashScreens,
} from "@vite-pwa/assets-generator/config";

export default defineConfig({
  headLinkOptions: {
    preset: "2023",
  },
  preset: {
    ...minimal2023Preset,
    appleSplashScreens: createAppleSplashScreens({
      padding: 0.25,
      resizeOptions: { background: "#ffffff", fit: "contain" },
      darkResizeOptions: { background: "#1e1e2e", fit: "contain" },
    }),
  },
  images: ["public/icon-transparent.svg"],
});
