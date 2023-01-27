import { useState, useEffect } from 'react';
import { showLoader, hideLoader } from '../loader/loader';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

export function QueryPassword({ backend, user, password, setErrorMsg, show }) {
  let [keys, setKeys] = useState(undefined);
  let [kvs, setKvs] = useState(new Object());
  let [acValue, setAcValue] = useState("");

  useEffect(() => {
    if (keys === undefined) {
      showLoader();
      fetch(
        `${backend}/api/v1/get/getkeys?username=${user}&password=${password}`,
        { 
          method: 'GET',
        }
      )
      .then((response) => {
        if (response.status !== 200 ){
          console.log(response);
          throw new Error("Error while trying to get keys.");
        }
        return response.json();
      })
      .then((updatedKeys) => {
        console.log(updatedKeys);
        setKeys(updatedKeys);
      })
      .catch((e) => {
        console.error(e);
        setErrorMsg("Unable to retrieve stored passwords at this time.");
      })
      .finally(() => {
        console.log("Finished retrieving keys");
        hideLoader();
      });
    }
  });

  const onAcChange = (e, newKey, reason) => {
    setAcValue(newKey);
    if (newKey !== null) {
      if (!(newKey in kvs)) {
        fetch(
          `${backend}/api/v1/get/getpw/${newKey}?username=${user}&password=${password}`,
          { 
            method: 'GET',
          }
        )
        .then((response) => {
          if (response.status !== 200 ){
            console.log(response);
            throw new Error("Error while trying to get keys.");
          }
          return response.json();
        })
        .then((s) => {
          if (!(newKey in kvs)) {
            kvs[newKey] = s;
            setKvs(kvs);
          }
        })
        .catch((e) => {
          console.error(e);
          setErrorMsg("Unable to retrieve stored passwords at this time.");
        })
        .finally(() => {
          console.log("Finished retrieving pw");
          hideLoader();
        });
      }
    }
  }

  console.log("kvs", kvs);

  return <div>
    <Autocomplete
      className="ac"
      disablePortal
      id="my-id"
      sx={{width:300, color:"primary.main"}}
      options={keys}
      autoComplete={true}
      autoSelect={true}
      autoHighlight={true}
      clearOnBlur={true}
      clearOnEscape={true}
      openOnFocus={true}
      selectOnFocus={true}
      readOnly={keys === undefined}
      renderInput={(s)=> <TextField {...s} label={keys===undefined?"Loading...":"Select a password key"} />}

      onChange={onAcChange}
    />
  </div>;
}

export function NewPassword({ backend, user, password, setErrorMsg }) {
  return <div>
    hallo
  </div>;
}