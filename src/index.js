// Cloudflare Worker entry point: wires the real LINE API, KV storage and secrets
// into the app. All logic lives in app.js.
import { createApp } from "./app.js";
import { lineClient } from "./line.js";

const appFor = (env) => createApp({
  kv: env.DB,
  line: lineClient(env.LINE_CHANNEL_ACCESS_TOKEN),
  secret: env.LINE_CHANNEL_SECRET,
});

export default {
  fetch(request, env, ctx) {
    return appFor(env).handleRequest(request, (p) => { ctx.waitUntil(p); });
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(appFor(env).runSchedule(new Date(controller.scheduledTime)));
  },
};
