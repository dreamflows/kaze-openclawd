import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { larkPlugin } from "./src/channel.js";
import { setLarkRuntime } from "./src/runtime.js";

const plugin = {
  id: "lark",
  name: "Lark",
  description: "Lark (Feishu) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setLarkRuntime(api.runtime);
    api.registerChannel({ plugin: larkPlugin });
  },
};

export default plugin;
