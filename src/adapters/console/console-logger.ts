import type { LoggerPort } from "../../ports/logger-port.js";

const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  cyan: "\u001b[36m"
};

export class ConsoleLogger implements LoggerPort {
  info(message: string): void {
    // Structured indicator logs are optional and easy to scan in dim cyan.
    console.log(`${colors.cyan}${colors.dim}[info] ${message}${colors.reset}`);
  }

  error(message: string): void {
    console.error(`${colors.red}[error] ${message}${colors.reset}`);
  }
}
