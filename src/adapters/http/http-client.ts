export interface HttpClient {
  get<T>(url: string, params?: Record<string, string | number>): Promise<T>;

  post<T>(input: {
    url: string;
    body?: unknown;
    params?: Record<string, string | number>;
    headers?: Record<string, string>;
  }): Promise<T>;
}
