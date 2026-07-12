import express from "express";
import cors from "cors";
import { router } from "./routes.js";
import { startPoller } from "./poller.js";

// Safety net: log unexpected errors instead of letting them crash the
// process. Without this, a single bad request or a transient network blip
// during a poll can take the whole server down and trigger a restart loop.
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const app = express();
app.use(cors()); // lock this down to your site's domain once deployed
app.use("/api", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Pitchline AI API listening on :${PORT}`);
  startPoller();
});
