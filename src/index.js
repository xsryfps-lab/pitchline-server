import express from "express";
import cors from "cors";
import { router } from "./routes.js";
import { startPoller } from "./poller.js";

const app = express();
app.use(cors()); // lock this down to your site's domain once deployed
app.use("/api", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Pitchline AI API listening on :${PORT}`);
  startPoller();
});
