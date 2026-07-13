import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { QueryAccount, NewAccount } from "./passwords";
import { shaHash } from "../crypto/encrypt";

// Mock the loader module — it manipulates the DOM directly (querySelector)
// which doesn't exist in the test environment.
jest.mock("../loader/loader", () => ({
  showLoader: jest.fn(),
  hideLoader: jest.fn(),
}));

const aesKey = shaHash("test_master_password");

const commonProps = {
  backend: "http://localhost:8000",
  auth: { en_user: "hashed_user", en_pw: "hashed_pw" },
  aesKey,
  setErrorMsg: jest.fn(),
};

describe("QueryAccount", () => {
  test("renders the account selector", () => {
    render(
      <QueryAccount
        {...commonProps}
        keys={["gmail", "bank"]}
        updateKey={jest.fn()}
        removeKey={jest.fn()}
      />
    );

    expect(
      screen.getByText("Select an account to retrieve:")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select an account")).toBeInTheDocument();
  });

  test("shows a loading label while keys are undefined", () => {
    render(
      <QueryAccount
        {...commonProps}
        keys={undefined}
        updateKey={jest.fn()}
        removeKey={jest.fn()}
      />
    );

    expect(screen.getByLabelText("Loading...")).toBeInTheDocument();
  });
});

describe("NewAccount", () => {
  // NewAccount pre-fills the password row via /generate on mount.
  const GENERATED = "gen-pw-123";

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve(GENERATED),
      })
    );
  });

  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test("renders name field and a pre-added, pre-generated password row", async () => {
    await act(async () => {
      render(<NewAccount {...commonProps} keys={[]} addNewKey={jest.fn()} />);
    });

    expect(screen.getByText("Add a new account:")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toBeInTheDocument();

    // The password detail is simply the first row of the uniform detail
    // list: label prefilled with "password", value pre-populated with a
    // generated password, secret checked, with its own Generate and Remove
    // buttons.
    const row = screen.getByTestId("new-detail-0");
    expect(within(row).getByLabelText("label")).toHaveValue("password");
    expect(within(row).getByLabelText("value")).toHaveValue(GENERATED);
    expect(within(row).getByLabelText("secret")).toBeChecked();
    expect(within(row).getByText("Generate")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Remove" })
    ).toBeInTheDocument();

    expect(screen.getByText("+ Add another detail")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" })
    ).toBeInTheDocument();
  });

  test("does not overwrite a typed password with the late prefill", async () => {
    // Delay the /generate response until after the user has typed.
    let resolveGenerate;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveGenerate = () =>
            resolve({ status: 200, json: () => Promise.resolve(GENERATED) });
        })
    );

    await act(async () => {
      render(<NewAccount {...commonProps} keys={[]} addNewKey={jest.fn()} />);
    });

    const value = within(screen.getByTestId("new-detail-0")).getByLabelText(
      "value"
    );
    fireEvent.change(value, { target: { value: "my-own-password" } });

    await act(async () => {
      resolveGenerate();
    });

    expect(value).toHaveValue("my-own-password");
  });

  test("rejects account names longer than 128 characters", async () => {
    await act(async () => {
      render(<NewAccount {...commonProps} keys={[]} addNewKey={jest.fn()} />);
    });

    fireEvent.change(screen.getByLabelText("Account name"), {
      target: { value: "a".repeat(129) },
    });

    expect(
      screen.getByText("Account name is too long (max 128 characters).")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  });

  test("add-another-detail appends an identical row that can be removed", async () => {
    await act(async () => {
      render(<NewAccount {...commonProps} keys={[]} addNewKey={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText("+ Add another detail"));
    });

    // Two uniform rows now: the pre-added password row and the new one.
    expect(screen.getAllByLabelText("label")).toHaveLength(2);
    expect(screen.getAllByLabelText("value")).toHaveLength(2);
    expect(screen.getAllByLabelText("secret")).toHaveLength(2);
    expect(screen.getAllByText("Generate")).toHaveLength(2);
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons).toHaveLength(2);

    // The new row starts empty and non-secret.
    const row = screen.getByTestId("new-detail-1");
    expect(within(row).getByLabelText("label")).toHaveValue("");
    expect(within(row).getByLabelText("secret")).not.toBeChecked();

    await act(async () => {
      fireEvent.click(removeButtons[1]);
    });
    expect(screen.getAllByLabelText("label")).toHaveLength(1);
  });

  test("the pre-added password row is removable like any other detail", async () => {
    await act(async () => {
      render(<NewAccount {...commonProps} keys={[]} addNewKey={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    expect(screen.queryByLabelText("label")).not.toBeInTheDocument();
    expect(screen.queryByText("Generate")).not.toBeInTheDocument();
    // The rest of the form is intact.
    expect(screen.getByLabelText("Account name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" })
    ).toBeInTheDocument();
  });
});
