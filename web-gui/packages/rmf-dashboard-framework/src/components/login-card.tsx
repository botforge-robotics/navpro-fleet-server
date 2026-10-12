import { Button, styled, Typography } from '@mui/material';
import React from 'react';

const prefix = 'login-card';
const classes = {
  container: `${prefix}-container`,
  title: `${prefix}-title`,
  logo: `${prefix}-logo`,
};
const StyledDiv = styled('div')(({ theme }) => ({
  [`&.${classes.container}`]: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: theme.shape.borderRadius,
    borderColor: theme.palette.divider,
    padding: theme.spacing(7),
    width: 'fit-content',
    minWidth: 280,
    backgroundColor: theme.palette.background.paper,
    boxShadow: theme.shadows[3],
  },
  [`& .${classes.title}`]: {
    color: theme.palette.text.primary,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  [`& .${classes.logo}`]: {
    width: 100,
    margin: theme.spacing(3, 0, 5, 0),
  },
}));

export interface LoginCardProps extends React.PropsWithChildren<{}> {
  title: string;
  logo: string;
  onLoginClick?: React.MouseEventHandler;
}

export const LoginCard = React.forwardRef(
  (
    { title, logo, onLoginClick, children }: LoginCardProps,
    ref: React.Ref<HTMLDivElement>,
  ): JSX.Element => {
    return (
      <StyledDiv ref={ref} className={classes.container}>
        <Typography variant="h4" className={classes.title}>
          {title}
        </Typography>
        <img src={logo} alt="" className={classes.logo} />
        <Button variant="contained" aria-label="Login" onClick={onLoginClick}>
          Login
        </Button>
        {children}
      </StyledDiv>
    );
  },
);

export default LoginCard;
