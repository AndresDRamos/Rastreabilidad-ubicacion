import axios from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.response.use(
  (resp) => resp,
  (error) => {
    // eslint-disable-next-line no-console
    console.error("[api] error", error?.response?.status, error?.response?.data ?? error.message);
    return Promise.reject(error);
  },
);
