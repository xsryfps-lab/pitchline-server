import express from "express";
import cors from "cors";
import { router } from "./routes.js";
import { startPoller } from "./poller.js";
import { seedLeagues } from "./seedLeagues.js";

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const app = express();
app.use(cors());
app.use("/api", router);

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Pitchline AI API listening on :${PORT}`);
  await seedLeagues();
  startPoller();
});
