// Set this to the URL printed by `wrangler deploy` before publishing GitHub Pages.
const PRODUCTION_API_URL = "REPLACE_WITH_WORKER_URL";
export const API_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:8787"
  : PRODUCTION_API_URL;
