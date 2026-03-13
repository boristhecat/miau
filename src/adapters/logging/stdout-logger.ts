import type { LoggerPort } from "../../ports/logger-port.js";

const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  red: "\u001b[31m"
};

export class StdoutLogger implements LoggerPort {
  info(message: string): void {
    console.log(`${colors.cyan}${colors.dim}[info] ${message}${colors.reset}`);
  }

  error(message: string): void {
    console.error(`${colors.red}[error] ${message}${colors.reset}`);
  }
}
