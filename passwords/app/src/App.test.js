import { render, screen, act } from '@testing-library/react';
import App from './App';

// Mock the loader module — it manipulates the DOM directly (querySelector)
// which doesn't exist in the test environment.
jest.mock("./loader/loader", () => ({
  showLoader: jest.fn(),
  hideLoader: jest.fn(),
}));

test('App module exports a component', () => {
  expect(typeof App).toBe('function');
});

describe("backend wake-up ping on mount", () => {
  let originalConsoleError;

  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = jest.fn();
    global.fetch = jest.fn(() => Promise.resolve({ status: 200 }));
  });

  afterEach(() => {
    console.error = originalConsoleError;
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test("fires a GET request to the backend root on mount", async () => {
    await act(async () => {
      render(<App />);
    });

    const pingCall = global.fetch.mock.calls.find(
      (call) => call[0] === "http://localhost:8000/"
    );
    expect(pingCall).toBeDefined();
  });

  test("ping silently ignores network errors", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("network down")));

    // Should not throw.
    await act(async () => {
      render(<App />);
    });

    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8000/");
  });
});
