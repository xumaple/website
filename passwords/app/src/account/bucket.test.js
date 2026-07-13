import { render, screen, act, fireEvent } from "@testing-library/react";
import AccountView from "./bucket";
import { shaHash, encryptPwWithKey } from "../crypto/encrypt";

// Mock the loader module — it manipulates the DOM directly (querySelector)
// which doesn't exist in the test environment.
jest.mock("../loader/loader", () => ({
  showLoader: jest.fn(),
  hideLoader: jest.fn(),
}));

const aesKey = shaHash("test_master_password");

const bucket = {
  key: "gmail",
  fields: [
    {
      label: "password",
      en_value: encryptPwWithKey(aesKey, "s3cret_value!"),
      sensitive: true,
    },
    {
      label: "email",
      en_value: encryptPwWithKey(aesKey, "me@example.com"),
      sensitive: false,
    },
  ],
};

const defaultProps = {
  backend: "http://localhost:8000",
  auth: { en_user: "hashed_user", en_pw: "hashed_pw" },
  aesKey,
  bucketKey: "gmail",
  onRenamed: jest.fn(),
  onDeleted: jest.fn(),
  setErrorMsg: jest.fn(),
};

function mockBucketFetch(bucketJson) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      status: 200,
      json: () => Promise.resolve(bucketJson),
    })
  );
}

describe("AccountView", () => {
  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test("renders a chip per detail and preselects the password in the copy box", async () => {
    mockBucketFetch(bucket);

    await act(async () => {
      render(<AccountView {...defaultProps} />);
    });

    // One chip per detail.
    expect(screen.getByRole("button", { name: "password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "email" })).toBeInTheDocument();

    // The copy box shows the password detail by default...
    expect(
      screen.getByText("Retrieved password for gmail!")
    ).toBeInTheDocument();
    expect(screen.getByText("Click here to copy.")).toBeInTheDocument();
    // ...but never the secret value itself.
    expect(screen.queryByText("s3cret_value!")).not.toBeInTheDocument();
  });

  test("clicking a non-secret chip shows its value inline in the copy box", async () => {
    mockBucketFetch(bucket);

    await act(async () => {
      render(<AccountView {...defaultProps} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "email" }));
    });

    expect(screen.getByText("Retrieved email for gmail!")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("Click here to copy.")).toBeInTheDocument();
  });

  test("management panel is collapsed by default and toggles open", async () => {
    mockBucketFetch(bucket);

    await act(async () => {
      render(<AccountView {...defaultProps} />);
    });

    // Collapsed: no management controls.
    expect(screen.queryByText("Rename account")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete account")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" })
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(/Manage this account/));
    });

    // Expanded: per-detail rows with labeled edit/delete icon buttons,
    // secret masked.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("+ Add a detail")).toBeInTheDocument();
    expect(screen.getByText("Rename account")).toBeInTheDocument();
    expect(screen.getByText("Delete account")).toBeInTheDocument();

    // The same toggle (now with a collapse chevron) closes it again.
    await act(async () => {
      fireEvent.click(screen.getByText(/Manage this account/));
    });
    expect(screen.queryByText("Rename account")).not.toBeInTheDocument();
  });

  test("renaming keeps the management panel open", async () => {
    mockBucketFetch(bucket);
    const onRenamed = jest.fn();

    await act(async () => {
      render(<AccountView {...defaultProps} onRenamed={onRenamed} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Manage this account/));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Rename account"));
    });

    fireEvent.change(screen.getByLabelText("New account name"), {
      target: { value: "gmail-renamed" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(onRenamed).toHaveBeenCalledWith("gmail", "gmail-renamed");
    // The panel is still open after the rename completes.
    expect(screen.getByText("Rename account")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  test("account with no details shows the empty state and no copy box", async () => {
    mockBucketFetch({ key: "empty", fields: [] });

    await act(async () => {
      render(<AccountView {...defaultProps} bucketKey="empty" />);
    });

    expect(
      screen.getByText(/This account has no details yet/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Click here to copy.")).not.toBeInTheDocument();
  });
});
