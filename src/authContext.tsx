
import { AuthMachine } from './authMachine';
import { createInterpreterContext } from './utils';

const [AuthProvider, useAuth, createAuthSelector] =
  createInterpreterContext('Auth');

export { AuthProvider, useAuth };

export const useLoggedInUserData = createAuthSelector(
  (state) => state.context.loggedInUserData,
);
