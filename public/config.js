// Set this to the URL printed by `wrangler deploy` before publishing GitHub Pages.
const PRODUCTION_API_URL =
  "https://fox-test-builds-api.fox-test-builds.workers.dev";
export const API_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : PRODUCTION_API_URL;
