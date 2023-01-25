import { useState } from 'react';
import { showLoader, hideLoader } from '../loader/loader';
import './account.css';


const TOGGLE_VIEW_DELAY_IN_MS = 300;

export default function PasswordQuery({ username, password, reset }) {
  let [isQueryView, setIsQueryView] = useState(true); // true == queryView; false == newPasswordView
  
  const setQueryView = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsQueryView(b);
    }, TOGGLE_VIEW_DELAY_IN_MS);
  }
  return <div>
    <div>{password}<button onClick={reset}>Log Out</button></div>
    <div onClick={() => {setQueryView(!isQueryView);}}>
      {isQueryView ? 
        "Generate a new password instead" :
        "Query an existing password instead"}
    </div>
  </div>;
}