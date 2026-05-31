import { homedir } from "node:os";
import { join } from "node:path";

export const MAESTROQ_HOME = join(homedir(), ".maestroq");
export const SOCKET_PATH = join(MAESTROQ_HOME, "daemon.sock");
export const PID_PATH = join(MAESTROQ_HOME, "daemon.pid");
export const QUEUE_PATH = join(MAESTROQ_HOME, "queue.json");
export const CONFIG_PATH = join(MAESTROQ_HOME, "config.yaml");
export const LOCK_PATH = join(MAESTROQ_HOME, "daemon.lock");
export const BUILD_CACHE_PATH = join(MAESTROQ_HOME, "build-cache.json");
export const METRO_CACHE_DIR = join(MAESTROQ_HOME, "metro-cache");
export const DAEMON_LOG_PATH = join(MAESTROQ_HOME, "daemon.log");

export const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "maestroq", "logs");
export const DEFAULT_ARTIFACT_DIR = join(homedir(), ".local", "share", "maestroq", "artifacts");
