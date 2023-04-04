import logo from "./logo.svg";
import "./App.css";
import SignIn from "./account/signIn";
import Account from "./account/account";
import { hideLoader } from "./loader/loader";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@mui/material/styles";
import Theme from "./theme";
import CssBaseline from "@mui/material/CssBaseline";

export default function App() {
  useEffect(hideLoader);
  let [isSignedIn, setIsSignedIn] = useState(false);
  let [username, setUsername] = useState("");
  let [password, setPassword] = useState("");

  const backend = "https://passwords.maplexu.me";
  // const backend = "http://localhost:8000";

  const setAccountInfo = (user, pw) => {
    setUsername(user);
    setPassword(pw);
    setIsSignedIn(true);
  };

  const resetAccountInfo = () => {
    setPassword("");
    setIsSignedIn(false);
  };

  return (
    <div className="App">
      <ThemeProvider theme={Theme}>
        <CssBaseline />
        {isSignedIn ? (
          <Account
            username={username}
            password={password}
            backend={backend}
            reset={resetAccountInfo}
          />
        ) : (
          <div className="App-header">
            <p>"Welcome to ObscurePasswordManager!"</p>
            <div className="App-subheader">
              <SignIn
                user={username}
                backend={backend}
                setAccountInfo={setAccountInfo}
              />
            </div>
          </div>
        )}
      </ThemeProvider>
    </div>
  );
}
