// Keep the API's local NODE_ENV setting from producing development React assets.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build({ mode: process.argv.includes("--pages") ? "pages" : "production" });
