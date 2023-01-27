import { useState } from 'react';
import SettingsModal from './settings/settings';
import { QueryPassword, NewPassword } from './passwords';
import { showLoader, hideLoader } from '../loader/loader';
import './account.css';
import logoIcon from "../assets/icons/log-out.png";
import userIcon from "../assets/icons/user-inverted.png";
import settingsIcon from "../assets/icons/settings.png";

const TOGGLE_VIEW_DELAY_IN_MS = 300;



export default function Account({ username, backend, password, reset }) {
  let [isQueryView, setIsQueryView] = useState(true); // true == queryView; false == newPasswordView
  let [showDropdown, setShowDropdown] = useState(false);
  let [showSettings, setShowSettings] = useState(false);
  let [currPassword, setCurrPassword] = useState(password);


  const setQueryView = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsQueryView(b);
    }, TOGGLE_VIEW_DELAY_IN_MS);
  }

  return <div id="account-root" className="Account">
    <div className="Account-dropdown">
      <div className="user" onClick={()=>setShowDropdown(!showDropdown)}><img src={userIcon} alt="user"/></div>
      <div className={showDropdown?"menu active":"menu"}>
        <h3>{username}<br /></h3>
        <ul>
          {/* <li>
            <img src="../assets/icons/user.png" /><a href="#">My profile</a>
          </li>
          <li>
            <img src="../assets/icons/edit.png" /><a href="#">Edit profile</a>
          </li>
          <li>
            <img src="../assets/icons/envelope.png" /><a href="#">Inbox</a>
          </li>
        <li><img src="../assets/icons/question.png" /><a href="#">Help</a></li> */}
          <li>
            <img src={settingsIcon} alt=""/><div onClick={()=>{setShowSettings(true);setShowDropdown(false);}}>Settings</div>
          </li>
          <li>
            <img src={logoIcon} alt=""/><div onClick={reset}>Logout</div>
          </li>
        </ul>
      </div>
    </div>
    <div className="Account-info">
      <div>{currPassword}</div>
      {isQueryView?<QueryPassword
        backend={backend}
        user={username}
        password={currPassword}
        setErrorMsg={()=>{}}
      />:<NewPassword
        backend={backend}
        user={username}
        password={currPassword}
        setErrorMsg={()=>{}}
      />}
      <button className="toggle" onClick={() => {setQueryView(!isQueryView);setShowDropdown(false);}}>
        {isQueryView ? 
          "Generate a new password instead" :
          "Query an existing password"}
      </button>
    </div>
    <SettingsModal
      username={username}
      password={currPassword}
      backend={backend}
      setPassword={setCurrPassword}
      show={showSettings}
      stopShowing={()=>setShowSettings(false)}
    />
  </div>;
}