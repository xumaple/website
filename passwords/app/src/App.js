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
  let [en_user, setEnUser] = useState("");
  let [password, setPassword] = useState("");
  let [en_pw, setEnPw] = useState("");

  const backend = "https://passwords.maplexu.me";
  // const backend = "http://localhost:8000";

  const setAccountInfo = (user, en_user, pw, en_pw) => {
    setUsername(user);
    setEnUser(en_user);
    setPassword(pw);
    setEnPw(en_pw);
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
        <div className="App-content">
          <div className="App-container">
            {isSignedIn ? (
              <Account
                username={username}
                en_user={en_user}
                password={password}
                en_pw={en_pw}
                backend={backend}
                reset={resetAccountInfo}
              />
            ) : (
              <>
                <p style={{ fontWeight: "bold" }}>🔐 Welcome to MapoPass 🔐</p>
                <div className="App-subheader">
                  <SignIn
                    user={username}
                    backend={backend}
                    setAccountInfo={setAccountInfo}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </ThemeProvider>
    </div>
  );
}
