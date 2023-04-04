import { createTheme } from '@mui/material/styles';
import { deepPurple, blueGrey, lightBlue } from '@mui/material/colors';

const theme = createTheme({
  palette: {
    mode: 'dark',
    text: {
      primary: lightBlue[50],
    },
    secondary: {
      main: '#ce97d8',
    },
    background: {
      default: blueGrey[900]
    },
    contrastThreshold: 4.5,
  },
});

export default theme;

export const primaryColor = theme.palette.primary.default;
export const backgroundColor = theme.palette.background.default;
export const errorColor = theme.palette.error.main;
export const highlightColor = theme.palette.secondary.main;