import { render, screen, act } from "@testing-library/react";
import Account from "./account";

// Mock the loader module — it manipulates the DOM directly (querySelector)
// which doesn't exist in the test environment.
jest.mock("../loader/loader", () => ({
  showLoader: jest.fn(),
  hideLoader: jest.fn(),
}));

const defaultProps = {
  username: "testuser",
  en_user: "hashed_user",
  backend: "http://localhost:8000",
  password: "plaintext_pw",
  en_pw: "hashed_pw",
  reset: jest.fn(),
};

describe("Account error message display", () => {
  let originalConsoleError;

  beforeEach(() => {
    jest.useFakeTimers();
    // Suppress React/MUI console.error noise in tests.
    originalConsoleError = console.error;
    console.error = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    console.error = originalConsoleError;
    jest.restoreAllMocks();
  });

  test("error div is initially invisible", async () => {
    // Keys fetch succeeds.
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve(["key1"]),
      })
    );

    await act(async () => {
      render(<Account {...defaultProps} />);
    });

    const errorDiv = document.querySelector(".SignIn-error-invis");
    expect(errorDiv).toBeInTheDocument();
    expect(document.querySelector(".SignIn-error")).not.toBeInTheDocument();
  });

  test("shows error message when keys fetch fails", async () => {
    // Keys fetch fails.
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 500,
        json: () => Promise.resolve("Server error"),
      })
    );

    await act(async () => {
      render(<Account {...defaultProps} />);
    });

    expect(
      screen.getByText("Unable to retrieve stored passwords at this time.")
    ).toBeInTheDocument();
    expect(document.querySelector(".SignIn-error")).toBeInTheDocument();
    expect(document.querySelector(".SignIn-error-invis")).not.toBeInTheDocument();
  });

  test("error message auto-clears after timeout", async () => {
    // First call fails (triggers error), subsequent calls succeed (so the
    // useEffect doesn't set the error again after the timeout clears it).
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          status: 500,
          json: () => Promise.resolve("Server error"),
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve([]),
      });
    });

    await act(async () => {
      render(<Account {...defaultProps} />);
    });

    // Error is visible.
    expect(
      screen.getByText("Unable to retrieve stored passwords at this time.")
    ).toBeInTheDocument();
    expect(document.querySelector(".SignIn-error")).toBeInTheDocument();

    // Advance timers past the 10-second auto-clear timeout.
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    // Error should be cleared.
    expect(document.querySelector(".SignIn-error-invis")).toBeInTheDocument();
    expect(document.querySelector(".SignIn-error")).not.toBeInTheDocument();
  });
});
