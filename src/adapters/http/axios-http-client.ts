import axios, { type AxiosInstance } from "axios";
import type { HttpClient } from "./http-client.js";

export class AxiosHttpClient implements HttpClient {
  private readonly client: AxiosInstance;

  constructor(baseURL: string, client?: AxiosInstance) {
    this.client =
      client ??
      axios.create({
        baseURL,
        timeout: 10_000
      });
  }

  async get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    const response = await this.client.get<T>(url, { params });
    return response.data;
  }
}
