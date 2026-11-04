import { setupServer } from "msw/node";

export const server = setupServer();
export const API = () => `${window.location.origin}/api/v1`;
