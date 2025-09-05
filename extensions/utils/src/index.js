import { defineEndpoint } from "@directus/extensions-sdk";
import geoip from "geoip-lite";

export default defineEndpoint((router, { services, database, getSchema }) => {
  router.get("/", (req, res) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const geo = geoip.lookup(ip);
    res.json({ ip, geo });
  });

  return router;
});
