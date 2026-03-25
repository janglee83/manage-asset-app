import { invoke } from "@tauri-apps/api/core";

export const sidecarApi = {
  sidecarAlive: (): Promise<boolean> =>
    invoke("sidecar_alive"),

  restartSidecar: (): Promise<void> =>
    invoke("restart_sidecar"),
};
