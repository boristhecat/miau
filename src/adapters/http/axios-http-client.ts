import axios, { type AxiosInstance } from "axios";
import type { HttpClient } from "./http-client.js";

export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;

  constructor(baseURL: string, client?: AxiosInstance, options?: { timeoutMs?: number }) {
    this.client =
      client ??
      axios.create({
        baseURL,
        timeout: options?.timeoutMs ?? 10_000
      });
  }

  async get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    const response = await this.client.get<T>(url, { params });
    return response.data;
  }

  async post<T>(input: {
    url: string;
    body?: unknown;
    params?: Record<string, string | number>;
    headers?: Record<string, string>;
  }): Promise<T> {
    const response = await this.client.post<T>(input.url, input.body, {
      params: input.params,
      headers: input.headers
    });
    return response.data;
  }
}
