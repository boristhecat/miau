export interface LoggerPort {
  info(message: string): void;
  error(message: string): void;
}
